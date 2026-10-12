import type { ClientWithCoreApi } from "@mysten/sui/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { toHex } from "@mysten/sui/utils";
import {
  createChallenge,
  MemoryChallengeStore,
  normalizeChallengeContext,
  verifyChallenge,
  type Challenge,
  type ChallengeContext,
  type ChallengeStore,
} from "./auth.js";
import type { EntitlementCache } from "./cache.js";
import { SuigateClient } from "./client.js";
import { SuigateError } from "./errors.js";
import {
  AuthorizationError,
  normalizeRequestTarget,
  parseAuthorizationProof,
  parseChallengeRequest,
  type AuthorizationRequest,
  type ChallengeRequest,
} from "./http-auth.js";
import {
  address,
  planKey,
  positiveMilliseconds,
  timestamp,
} from "./internal/validation.js";
import type { Entitlement } from "./types.js";
import {
  createDiscoveryDocument,
  normalizeDiscoveryOptions,
  type DiscoveryOptions,
} from "./discovery.js";
export {
  createDiscoveryOpenApi,
  normalizeDiscoveryOptions,
  discoveryLink,
} from "./discovery.js";
export type { DiscoveryOptions, DiscoveryDocument } from "./discovery.js";

export {
  AuthorizationError,
  authorizationFailure,
  privateResponseHeaders,
  parseAuthorizationProof,
  readChallengeRequest,
  MAX_CHALLENGE_BODY_BYTES,
} from "./http-auth.js";
export type {
  AuthorizationRequest,
  AuthorizationProof,
  ChallengeRequest,
  RequestTarget,
} from "./http-auth.js";

export interface ServerAuthorizationOptions {
  readonly serviceId: string;
  readonly plan: string;
  readonly client?: ClientWithCoreApi;
  readonly packageId?: string;
  readonly typeOrigin?: string;
  readonly chainIdentifier?: string;
  readonly audience?: string;
  readonly network?: "mainnet" | "testnet";
  readonly rpcUrl?: string;
  readonly challengeStore?: ChallengeStore;
  readonly challengeTtlMs?: number;
  readonly cache?: EntitlementCache | false;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}

export interface AuthorizationContext {
  readonly address: string;
  readonly entitlement: Entitlement;
}

function required(value: string | undefined, name: string): string {
  if (!value)
    throw new SuigateError(
      "INVALID_ARGUMENT",
      `Configure ${name} before accepting requests`,
    );
  return value;
}

export class SuigateAuthorizer {
  readonly #core: SuigateClient;
  readonly #client: ClientWithCoreApi;
  readonly #context: Pick<
    ChallengeContext,
    "audience" | "chainIdentifier" | "serviceId"
  >;
  readonly #plan: string;
  readonly #store: ChallengeStore;
  readonly #ttl: number;
  readonly #now: () => number;
  readonly #packageId: string;
  readonly #typeOrigin: string;

  constructor(options: ServerAuthorizationOptions) {
    const env: Record<string, string | undefined> =
      typeof process === "undefined" ? {} : process.env;
    let client = options.client;
    if (!client) {
      const network = options.network ?? env.SUIGATE_NETWORK;
      if (network !== "testnet" && network !== "mainnet")
        throw new SuigateError(
          "INVALID_ARGUMENT",
          "Configure SUIGATE_NETWORK as mainnet or testnet",
        );
      client = new SuiGrpcClient({
        network,
        baseUrl: required(
          options.rpcUrl ?? env.SUIGATE_RPC_URL,
          "SUIGATE_RPC_URL",
        ),
      });
    } else if (options.network && client.network !== options.network) {
      throw new SuigateError(
        "INVALID_ARGUMENT",
        "The configured Sui client and network disagree",
      );
    }
    this.#client = client;
    this.#plan = planKey(options.plan);
    const context = normalizeChallengeContext({
      address: "0x0",
      binding: "configuration",
      audience: required(
        options.audience ?? env.SUIGATE_AUDIENCE,
        "SUIGATE_AUDIENCE",
      ),
      chainIdentifier: required(
        options.chainIdentifier ?? env.SUIGATE_CHAIN_IDENTIFIER,
        "SUIGATE_CHAIN_IDENTIFIER",
      ),
      serviceId: address(options.serviceId),
    });
    this.#context = {
      audience: context.audience,
      chainIdentifier: context.chainIdentifier,
      serviceId: context.serviceId,
    };
    this.#store = options.challengeStore ?? new MemoryChallengeStore();
    this.#ttl = positiveMilliseconds(
      options.challengeTtlMs ?? 300_000,
      "Challenge TTL",
    );
    this.#now = options.now ?? Date.now;
    this.#packageId = address(
      required(
        options.packageId ?? env.SUIGATE_PACKAGE_ID,
        "SUIGATE_PACKAGE_ID",
      ),
    );
    this.#typeOrigin = address(options.typeOrigin ?? this.#packageId);
    this.#core = new SuigateClient({
      client,
      packageId: this.#packageId,
      chainIdentifier: context.chainIdentifier,
      now: this.#now,
      ...(options.typeOrigin ? { typeOrigin: options.typeOrigin } : {}),
      ...(options.cache === undefined ? {} : { cache: options.cache }),
      ...(options.cacheTtlMs === undefined
        ? {}
        : { cacheTtlMs: options.cacheTtlMs }),
    });
  }

  async discovery(options: DiscoveryOptions) {
    const links = normalizeDiscoveryOptions(options);
    const service = await this.#core.getService(this.#context.serviceId);
    const plan = await this.#core.getPlan({
      serviceId: this.#context.serviceId,
      plan: this.#plan,
    });
    const network = this.#client.network;
    if (network !== "testnet" && network !== "mainnet")
      throw new AuthorizationError(503);
    return createDiscoveryDocument(
      {
        ...this.#context,
        network: network === "mainnet" ? "mainnet" : "testnet",
        packageId: this.#packageId,
        typeOrigin: this.#typeOrigin,
        plan: this.#plan,
        challengeTtlMs: this.#ttl,
        observedAt: timestamp(this.#now),
      },
      links,
      service,
      plan,
    );
  }

  async #challengeContext(
    request: ChallengeRequest,
  ): Promise<ChallengeContext> {
    const scope = [
      "suigate-http-v1",
      this.#context.audience,
      this.#context.chainIdentifier,
      this.#context.serviceId,
      this.#plan,
      request.address,
      request.entitlementId,
      request.method,
      request.target,
    ];
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(scope)),
    );
    return {
      ...this.#context,
      address: request.address,
      binding: `http:${toHex(new Uint8Array(digest))}`,
      statement: `Authorize software access: ${JSON.stringify({ method: request.method, target: request.target, plan: this.#plan, entitlementId: request.entitlementId })}`,
    };
  }

  async issueChallenge(input: unknown): Promise<Challenge> {
    const request = parseChallengeRequest(input);
    try {
      return await createChallenge(await this.#challengeContext(request), {
        store: this.#store,
        ttlMs: this.#ttl,
        now: this.#now,
      });
    } catch (cause) {
      if (
        cause instanceof SuigateError &&
        cause.code === "CHALLENGE_STORE_FULL"
      )
        throw new AuthorizationError(429, { cause });
      throw new AuthorizationError(503, { cause });
    }
  }

  async authorize(
    request: AuthorizationRequest,
  ): Promise<AuthorizationContext> {
    const proof = parseAuthorizationProof(request.authorization);
    let target;
    try {
      target = normalizeRequestTarget(request);
    } catch (cause) {
      throw new AuthorizationError(401, { cause });
    }
    try {
      await verifyChallenge(
        {
          id: proof.challengeId,
          signature: proof.signature,
          expected: await this.#challengeContext({
            ...target,
            address: proof.address,
            entitlementId: proof.entitlementId,
          }),
        },
        { store: this.#store, client: this.#client, now: this.#now },
      );
    } catch (cause) {
      const invalid =
        cause instanceof SuigateError &&
        [
          "INVALID_ARGUMENT",
          "INVALID_SIGNATURE",
          "CHALLENGE_NOT_FOUND",
          "CHALLENGE_EXPIRED",
          "CHALLENGE_MISMATCH",
          "CHALLENGE_CONSUMED",
        ].includes(cause.code);
      throw new AuthorizationError(invalid ? 401 : 503, { cause });
    }
    try {
      const entitlement = await this.#core.verifyEntitlement({
        serviceId: this.#context.serviceId,
        plan: this.#plan,
        owner: proof.address,
        entitlementId: proof.entitlementId,
      });
      return Object.freeze({ address: proof.address, entitlement });
    } catch (cause) {
      const denied =
        cause instanceof SuigateError &&
        [
          "NOT_FOUND",
          "INVALID_OBJECT",
          "WRONG_TYPE",
          "WRONG_SERVICE",
          "WRONG_PLAN",
          "WRONG_OWNER",
          "EXPIRED",
          "NOT_YET_VALID",
          "REVOKED",
        ].includes(cause.code);
      throw new AuthorizationError(denied ? 403 : 503, { cause });
    }
  }
}
