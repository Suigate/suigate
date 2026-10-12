import { bcs } from "@mysten/sui/bcs";
import { ObjectError, type ClientWithCoreApi } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { MemoryEntitlementCache, type EntitlementCache } from "./cache.js";
import { SuigateError } from "./errors.js";
import { configureGas } from "./gas.js";
import { PaymentAdapter } from "./internal/payment-kit.js";
import { rpc } from "./internal/rpc.js";
import { decode } from "./internal/schema.js";
import {
  address,
  ascii,
  coinType,
  paymentNonce,
  planKey,
  positiveMilliseconds,
  timestamp,
  u64,
  U64_MAX,
} from "./internal/validation.js";
import {
  assertType,
  deriveEntitlementId,
  parseEntitlement,
  parsePlan,
  parseService,
} from "./parsing.js";
import type {
  Entitlement,
  EntitlementQuery,
  EntitlementTransaction,
  Plan,
  PurchaseOptions,
  RenewalOptions,
  Service,
  Sponsor,
  SuiObject,
} from "./types.js";

export interface SuigateClientOptions {
  readonly client: ClientWithCoreApi;
  readonly packageId: string;
  readonly typeOrigin?: string;
  readonly chainIdentifier: string;
  readonly sponsor?: Sponsor;
  readonly cache?: EntitlementCache | false;
  readonly cacheTtlMs?: number;
  readonly quoteTtlMs?: number;
  readonly now?: () => number;
}

export class SuigateClient {
  readonly #client: ClientWithCoreApi;
  readonly #packageId: string;
  readonly #typeOrigin: string;
  readonly #chainIdentifier: string;
  readonly #payments: PaymentAdapter;
  readonly #sponsor: Sponsor | undefined;
  readonly #cache: EntitlementCache | false;
  readonly #cacheTtlMs: number;
  readonly #quoteTtlMs: number;
  readonly #now: () => number;

  constructor(options: SuigateClientOptions) {
    this.#client = options.client;
    this.#packageId = address(options.packageId);
    this.#typeOrigin = address(options.typeOrigin ?? options.packageId);
    this.#chainIdentifier = ascii(
      options.chainIdentifier,
      "Chain identifier",
      128,
    );
    this.#payments = new PaymentAdapter(options.client);
    this.#sponsor = options.sponsor;
    this.#now = options.now ?? Date.now;
    this.#cache =
      options.cache ?? new MemoryEntitlementCache({ now: this.#now });
    this.#cacheTtlMs = positiveMilliseconds(
      options.cacheTtlMs ?? 5_000,
      "Cache TTL",
      60_000,
    );
    this.#quoteTtlMs = positiveMilliseconds(
      options.quoteTtlMs ?? 60_000,
      "Quote TTL",
    );
  }

  async getService(serviceId: string): Promise<Service> {
    await this.#checkNetwork();
    return this.#service(address(serviceId));
  }

  async getPlan(options: { serviceId: string; plan: string }): Promise<Plan> {
    await this.#checkNetwork();
    return this.#plan(
      await this.#service(address(options.serviceId)),
      planKey(options.plan),
    );
  }

  async listPlans(options: {
    serviceId: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{ plans: Plan[]; cursor: string | null; hasNextPage: boolean }> {
    await this.#checkNetwork();
    const service = await this.#service(address(options.serviceId));
    const limit = positiveMilliseconds(options.limit ?? 50, "Page size", 100);
    const page = await rpc(() =>
      this.#client.core.listDynamicFields({
        parentId: service.plans.id,
        limit,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      }),
    );
    const plans = await Promise.all(
      page.dynamicFields.map(async (field) => {
        if (field.$kind !== "DynamicField")
          throw new SuigateError(
            "INVALID_OBJECT",
            "Unexpected plan table entry",
          );
        assertType(field.name.type, "0x1::ascii::String");
        assertType(field.valueType, `${this.#typeOrigin}::subscriptions::Plan`);
        return this.#plan(
          service,
          planKey(decode(bcs.string(), field.name.bcs)),
        );
      }),
    );
    if (page.hasNextPage && (!page.cursor || page.cursor === options.cursor))
      throw new SuigateError("RPC_ERROR", "Invalid plan pagination cursor");
    return { plans, cursor: page.cursor, hasNextPage: page.hasNextPage };
  }

  async getEntitlement(
    entitlementId: string,
    options: { fresh?: boolean } = {},
  ): Promise<Entitlement> {
    await this.#checkNetwork();
    return this.#entitlement(address(entitlementId), options.fresh ?? false);
  }

  async verifyEntitlement(options: EntitlementQuery): Promise<Entitlement> {
    await this.#checkNetwork();
    const query = this.#query(options);
    const [service, entitlement] = await Promise.all([
      this.#service(query.serviceId),
      this.#entitlement(query.entitlementId, true),
    ]);
    this.#assertBindings(entitlement, query);
    await this.#assertNotRevoked(service, entitlement.id);
    const now = BigInt(timestamp(this.#now));
    if (now < entitlement.issuedAt)
      throw new SuigateError(
        "NOT_YET_VALID",
        "Entitlement issuance is in the future",
      );
    if (now >= entitlement.expiresAt)
      throw new SuigateError("EXPIRED", "Entitlement has expired");
    return entitlement;
  }

  async purchaseEntitlement(
    options: PurchaseOptions,
  ): Promise<EntitlementTransaction> {
    await this.#checkNetwork();
    const query = this.#query({ ...options, owner: options.sender });
    const service = await this.#service(query.serviceId);
    const plan = await this.#plan(service, query.plan);
    if (!plan.purchasesEnabled)
      throw new SuigateError(
        "PLAN_UNAVAILABLE",
        "Plan does not accept purchases",
      );
    try {
      await this.#object(query.entitlementId);
      throw new SuigateError(
        "ALREADY_ENTITLED",
        "This wallet already has an entitlement; use renewal",
      );
    } catch (error) {
      if (!(error instanceof SuigateError) || error.code !== "NOT_FOUND")
        throw error;
    }
    return this.#transaction(options, service, plan, query.entitlementId);
  }

  async renewEntitlement(
    options: RenewalOptions,
  ): Promise<EntitlementTransaction> {
    await this.#checkNetwork();
    const query = this.#query({ ...options, owner: options.sender });
    const [service, entitlement] = await Promise.all([
      this.#service(query.serviceId),
      this.#entitlement(query.entitlementId, true),
    ]);
    this.#assertBindings(entitlement, query);
    if (
      u64(options.expectedRevision, "Entitlement revision") !==
      entitlement.revision
    ) {
      throw new SuigateError(
        "STALE_REVISION",
        "Entitlement changed; reconcile the previous renewal before creating another",
      );
    }
    await this.#assertNotRevoked(service, entitlement.id);
    const plan = await this.#plan(service, query.plan);
    if (!plan.renewalsEnabled)
      throw new SuigateError(
        "PLAN_UNAVAILABLE",
        "Plan does not accept renewals",
      );
    return this.#transaction(
      options,
      service,
      plan,
      entitlement.id,
      entitlement,
    );
  }

  async #checkNetwork(): Promise<void> {
    const { chainIdentifier } = await rpc(() =>
      this.#client.core.getChainIdentifier(),
    );
    if (chainIdentifier !== this.#chainIdentifier) {
      throw new SuigateError(
        "WRONG_NETWORK",
        "Sui endpoint does not match the configured chain identifier",
      );
    }
  }

  async #object(objectId: string): Promise<SuiObject> {
    const { object } = await rpc(() =>
      this.#client.core.getObject({ objectId, include: { content: true } }),
    );
    if (!object || address(object.objectId) !== objectId) {
      throw new SuigateError(
        "INVALID_OBJECT",
        "Sui returned an unexpected object",
      );
    }
    return object;
  }

  async #service(id: string): Promise<Service> {
    return parseService(await this.#object(id), this.#typeOrigin);
  }

  async #plan(service: Service, key: string): Promise<Plan> {
    const { dynamicField } = await rpc(() =>
      this.#client.core.getDynamicField({
        parentId: service.plans.id,
        name: {
          type: "0x1::ascii::String",
          bcs: bcs.string().serialize(key).toBytes(),
        },
      }),
    );
    const plan = parsePlan(dynamicField.value, this.#typeOrigin);
    if (plan.serviceId !== service.id)
      throw new SuigateError(
        "WRONG_SERVICE",
        "Plan belongs to a different service",
      );
    if (plan.key !== key)
      throw new SuigateError("WRONG_PLAN", "Sui returned a different plan");
    return plan;
  }

  async #entitlement(id: string, fresh: boolean): Promise<Entitlement> {
    const key = `${this.#chainIdentifier}:${this.#typeOrigin}:${id}`;
    if (this.#cache && !fresh) {
      const cached = await this.#cache.get(key);
      const now = BigInt(timestamp(this.#now));
      if (
        cached &&
        cached.validUntil > now &&
        cached.entitlement.expiresAt > now &&
        cached.entitlement.id === id
      ) {
        return cached.entitlement;
      }
    }
    if (this.#cache) await this.#cache.delete(key);
    const entitlement = parseEntitlement(
      await this.#object(id),
      this.#typeOrigin,
    );
    const now = BigInt(timestamp(this.#now));
    const ttl = now + BigInt(this.#cacheTtlMs);
    if (this.#cache && entitlement.expiresAt > now) {
      await this.#cache.set(key, {
        entitlement,
        validUntil: ttl < entitlement.expiresAt ? ttl : entitlement.expiresAt,
      });
    }
    return entitlement;
  }

  #query(options: EntitlementQuery): Required<EntitlementQuery> {
    const serviceId = address(options.serviceId);
    const owner = address(options.owner);
    const plan = planKey(options.plan);
    return {
      serviceId,
      owner,
      plan,
      entitlementId:
        options.entitlementId === undefined
          ? deriveEntitlementId({
              typeOrigin: this.#typeOrigin,
              serviceId,
              owner,
              plan,
            })
          : address(options.entitlementId),
    };
  }

  #assertBindings(
    entitlement: Entitlement,
    query: Required<EntitlementQuery>,
  ): void {
    if (entitlement.serviceId !== query.serviceId)
      throw new SuigateError(
        "WRONG_SERVICE",
        "Entitlement belongs to a different service",
      );
    if (entitlement.plan !== query.plan)
      throw new SuigateError(
        "WRONG_PLAN",
        "Entitlement is for a different plan",
      );
    if (
      entitlement.owner !== query.owner ||
      entitlement.holder !== query.owner
    ) {
      throw new SuigateError(
        "WRONG_OWNER",
        "Wallet does not own the entitlement",
      );
    }
    if (
      entitlement.id !==
      deriveEntitlementId({ ...query, typeOrigin: this.#typeOrigin })
    ) {
      throw new SuigateError(
        "INVALID_OBJECT",
        "Entitlement ID does not match its derived identity",
      );
    }
  }

  async #assertNotRevoked(
    service: Service,
    entitlementId: string,
  ): Promise<void> {
    const revoked = await rpc(async () => {
      try {
        const { dynamicField } = await this.#client.core.getDynamicField({
          parentId: service.revocations.id,
          name: {
            type: "0x2::object::ID",
            bcs: bcs.Address.serialize(entitlementId).toBytes(),
          },
        });
        assertType(dynamicField.value.type, "bool");
        return true;
      } catch (error) {
        if (error instanceof ObjectError && error.reason === "notFound")
          return false;
        throw error;
      }
    });
    if (revoked)
      throw new SuigateError("REVOKED", "Entitlement has been revoked");
  }

  async #transaction(
    options: PurchaseOptions,
    service: Service,
    plan: Plan,
    entitlementId: string,
    entitlement?: Entitlement,
  ): Promise<EntitlementTransaction> {
    if (
      options.coinType !== undefined &&
      coinType(options.coinType) !== plan.coinType
    ) {
      throw new SuigateError(
        "WRONG_COIN",
        "Coin type does not match the on-chain plan",
      );
    }
    const nonce = paymentNonce(options.nonce);
    const now = BigInt(timestamp(this.#now));
    const base =
      entitlement && entitlement.expiresAt > now ? entitlement.expiresAt : now;
    if (base + plan.durationMs > U64_MAX || entitlement?.revision === U64_MAX) {
      throw new SuigateError(
        "INVALID_ARGUMENT",
        "Entitlement renewal would overflow u64",
      );
    }
    await this.#payments.assertUnused(service, plan, nonce);
    const deadlineMs = u64(
      BigInt(timestamp(this.#now)) + BigInt(this.#quoteTtlMs),
      "Quote deadline",
    );
    const transaction = new Transaction();
    const gas = configureGas(transaction, {
      sender: options.sender,
      ...(options.gas === undefined ? {} : { gas: options.gas }),
      ...(this.#sponsor === undefined ? {} : { sponsor: this.#sponsor }),
    });
    const payment = this.#payments.coin(transaction, plan, gas);
    transaction.moveCall({
      target: `${this.#packageId}::subscriptions::${entitlement ? "renew" : "purchase"}`,
      typeArguments: [plan.coinType],
      arguments: [
        transaction.object(service.id),
        transaction.object(service.registryId),
        ...(entitlement
          ? [
              transaction.object(entitlement.id),
              transaction.pure.u64(entitlement.revision),
            ]
          : [transaction.pure.string(plan.key)]),
        transaction.pure.u64(service.version),
        transaction.pure.u64(plan.version),
        transaction.pure.u64(deadlineMs),
        transaction.pure.string(nonce),
        payment,
        transaction.object("0x6"),
      ],
    });
    return Object.freeze({
      transaction,
      entitlementId,
      gas,
      quote: Object.freeze({
        nonce,
        service,
        plan,
        deadlineMs,
        ...(entitlement ? { expectedRevision: entitlement.revision } : {}),
      }),
    });
  }
}
