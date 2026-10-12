import { mock } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { ObjectError, type SuiClientTypes } from "@mysten/sui/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import { SuigateClient } from "../src/client.js";
import { deriveEntitlementId, parseEntitlement } from "../src/parsing.js";
import { EntitlementBcs, PlanBcs, ServiceBcs } from "../src/internal/schema.js";
import type { SuigateClientOptions } from "../src/client.js";
import type { SuiObject } from "../src/types.js";

export const addr = normalizeSuiAddress;
export const PACKAGE = addr("0xabc");
export const SERVICE = addr("0x100");
export const BUYER = addr("0xb");
export const OWNER = addr("0xa");
export const REGISTRY = addr("0x200");
export const PLANS = addr("0x300");
export const REVOCATIONS = addr("0x400");
export const COIN = normalizeStructTag("0x2::sui::SUI");
export const CHAIN = "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD";
export const NOW = 1_000_000;
export const ENTITLEMENT = deriveEntitlementId({
  typeOrigin: PACKAGE,
  serviceId: SERVICE,
  owner: BUYER,
  plan: "pro",
});

function object(
  id: string,
  type: string,
  content: Uint8Array,
  owner: SuiClientTypes.ObjectOwner,
): SuiObject {
  return {
    objectId: id,
    type,
    content: new Uint8Array(content),
    owner,
    version: "1",
    digest: "test-object-digest",
  };
}

export function serviceObject(
  overrides: Partial<typeof ServiceBcs.$inferInput> = {},
): SuiObject {
  const data = {
    id: SERVICE,
    owner: OWNER,
    admin_cap_id: addr("0xc"),
    payment_recipient: OWNER,
    registry_id: REGISTRY,
    version: 2n,
    plans: { id: PLANS, size: 1n },
    revocations: { id: REVOCATIONS, size: 0n },
    ...overrides,
  };
  return object(
    SERVICE,
    `${PACKAGE}::subscriptions::Service`,
    ServiceBcs.serialize(data).toBytes(),
    {
      $kind: "Shared",
      Shared: { initialSharedVersion: "1" },
    },
  );
}

export function planValue(overrides: Partial<typeof PlanBcs.$inferInput> = {}) {
  return {
    type: `${PACKAGE}::subscriptions::Plan`,
    bcs: PlanBcs.serialize({
      service_id: SERVICE,
      key: "pro",
      price: 1000n,
      coin_type: { name: COIN },
      duration_ms: 10_000n,
      version: 3n,
      purchases_enabled: true,
      renewals_enabled: true,
      ...overrides,
    }).toBytes(),
  };
}

export function entitlementObject(
  overrides: Partial<typeof EntitlementBcs.$inferInput> = {},
): SuiObject {
  return object(
    ENTITLEMENT,
    `${PACKAGE}::subscriptions::Entitlement`,
    EntitlementBcs.serialize({
      id: ENTITLEMENT,
      service_id: SERVICE,
      plan_key: "pro",
      holder: BUYER,
      issued_at: BigInt(NOW - 1000),
      expires_at: BigInt(NOW + 10_000),
      revision: 4n,
      plan_version: 1n,
      ...overrides,
    }).toBytes(),
    { $kind: "AddressOwner", AddressOwner: BUYER },
  );
}

export function missing(id: string) {
  return new ObjectError("notExists", "Not found", {
    reason: "notFound",
    objectId: id,
  });
}

export function fixture(
  options: {
    hasEntitlement?: boolean;
    core?: Partial<SuigateClientOptions>;
  } = {},
) {
  const client = new SuiGrpcClient({
    network: "testnet",
    baseUrl: "http://127.0.0.1:1",
  });
  const state = {
    now: NOW,
    chain: CHAIN,
    plan: planValue(),
    revoked: false,
    paymentRecorded: false,
    objectFailure: undefined as Error | undefined,
    fieldFailure: undefined as Error | undefined,
    objects: new Map<string, SuiObject>([[SERVICE, serviceObject()]]),
  };
  if (options.hasEntitlement ?? true)
    state.objects.set(ENTITLEMENT, entitlementObject());
  const chainQuery = mock.method(
    client.core,
    "getChainIdentifier",
    async () => ({ chainIdentifier: state.chain }),
  );
  const objectQuery = mock.method(
    client.core,
    "getObject",
    async ({ objectId }: { objectId: string }) => {
      if (state.objectFailure) throw state.objectFailure;
      const object = state.objects.get(objectId);
      if (!object) throw missing(objectId);
      return { object };
    },
  );
  const fieldQuery = mock.method(
    client.core,
    "getDynamicField",
    async (options: SuiClientTypes.GetDynamicFieldOptions) => {
      if (state.fieldFailure) throw state.fieldFailure;
      let value: { type: string; bcs: Uint8Array };
      if (options.parentId === PLANS) {
        if (bcs.string().parse(options.name.bcs) !== "pro")
          throw missing("plan");
        value = state.plan;
      } else if (options.parentId === REVOCATIONS && state.revoked) {
        value = { type: "bool", bcs: bcs.bool().serialize(true).toBytes() };
      } else if (options.parentId === REGISTRY && state.paymentRecorded) {
        value = {
          type: "payment-record-fixture",
          bcs: bcs.u64().serialize(5n).toBytes(),
        };
      } else {
        throw missing("dynamic-field");
      }
      return {
        dynamicField: {
          fieldId: addr("0xdf"),
          type: "fixture",
          name: options.name,
          value,
          valueType: value.type,
          $kind: "DynamicField",
          version: "1",
          digest: "field-digest",
          previousTransaction: "payment-transaction-digest",
        },
      };
    },
  );
  const core = new SuigateClient({
    client,
    packageId: PACKAGE,
    chainIdentifier: CHAIN,
    now: () => state.now,
    ...options.core,
  });
  return { client, core, state, chainQuery, objectQuery, fieldQuery };
}

export function entitlement() {
  return parseEntitlement(entitlementObject(), PACKAGE);
}

export function errorCode(code: string) {
  return (error: unknown) =>
    error instanceof Error && "code" in error && error.code === code;
}
