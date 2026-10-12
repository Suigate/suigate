import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectError } from "@mysten/sui/client";
import { MemoryEntitlementCache } from "../src/cache.js";
import {
  addr,
  BUYER,
  ENTITLEMENT,
  entitlementObject,
  errorCode,
  fixture,
  NOW,
  OWNER,
  PACKAGE,
  planValue,
  SERVICE,
  serviceObject,
} from "./fixtures.js";

const query = {
  serviceId: SERVICE,
  plan: "pro",
  owner: BUYER,
  entitlementId: ENTITLEMENT,
};

test("fetches on-chain Service and Plan through the Core API", async () => {
  const { core, fieldQuery } = fixture();
  assert.equal((await core.getService(SERVICE)).owner, OWNER);
  assert.equal(
    (await core.getPlan({ serviceId: SERVICE, plan: "pro" })).price,
    1000n,
  );
  assert.equal(
    fieldQuery.mock.calls[0]?.arguments[0].name.type,
    "0x1::ascii::String",
  );
});

test("verifies live entitlement without trusting caller metadata or requiring current plan version", async () => {
  const { core } = fixture();
  const result = await core.verifyEntitlement(query);
  assert.equal(result.id, ENTITLEMENT);
  assert.equal(result.planVersion, 1n);
  assert.equal(
    (await core.getPlan({ serviceId: SERVICE, plan: "pro" })).version,
    3n,
  );
});

for (const [label, overrides, code] of [
  ["wrong service", { service_id: addr("0x999") }, "WRONG_SERVICE"],
  ["wrong plan", { plan_key: "team" }, "WRONG_PLAN"],
  ["expired", { expires_at: BigInt(NOW) }, "EXPIRED"],
  ["future issuance", { issued_at: BigInt(NOW + 1) }, "NOT_YET_VALID"],
] as const) {
  test(`rejects ${label}`, async () => {
    const { core, state } = fixture();
    state.objects.set(ENTITLEMENT, entitlementObject(overrides));
    await assert.rejects(core.verifyEntitlement(query), errorCode(code));
  });
}

test("rejects the wrong authenticated owner", async () => {
  const { core } = fixture();
  await assert.rejects(
    core.verifyEntitlement({ ...query, owner: OWNER }),
    errorCode("WRONG_OWNER"),
  );
});

test("rejects nonexistent, deleted, or counterfeit entitlements", async () => {
  const { core, state } = fixture({ hasEntitlement: false });
  await assert.rejects(core.verifyEntitlement(query), errorCode("NOT_FOUND"));
  state.objects.set(ENTITLEMENT, {
    ...entitlementObject(),
    type: `${addr("0xbad")}::subscriptions::Entitlement`,
  });
  await assert.rejects(core.verifyEntitlement(query), errorCode("WRONG_TYPE"));
  state.objectFailure = new ObjectError("deleted", "Deleted", {
    reason: "deleted",
  });
  await assert.rejects(core.verifyEntitlement(query), errorCode("NOT_FOUND"));
});

test("revocation and provider failures always fail closed", async () => {
  const { core, state } = fixture();
  state.revoked = true;
  await assert.rejects(core.verifyEntitlement(query), errorCode("REVOKED"));
  state.revoked = false;
  state.fieldFailure = new Error("service unavailable");
  await assert.rejects(core.verifyEntitlement(query), errorCode("RPC_ERROR"));
  state.fieldFailure = new ObjectError("unknown", "Unknown lookup failure", {
    reason: "unknown",
  });
  await assert.rejects(core.verifyEntitlement(query), errorCode("RPC_ERROR"));
});

test("rejects plan data belonging to a different service or key", async () => {
  const { core, state } = fixture();
  state.plan = planValue({ service_id: addr("0x999") });
  await assert.rejects(
    core.getPlan({ serviceId: SERVICE, plan: "pro" }),
    errorCode("WRONG_SERVICE"),
  );
  state.plan = planValue({ key: "team" });
  await assert.rejects(
    core.getPlan({ serviceId: SERVICE, plan: "pro" }),
    errorCode("WRONG_PLAN"),
  );
});

test("rejects an endpoint on the wrong chain", async () => {
  const { core, state, objectQuery } = fixture();
  state.chain = "different-chain";
  await assert.rejects(
    core.verifyEntitlement(query),
    errorCode("WRONG_NETWORK"),
  );
  assert.equal(objectQuery.mock.callCount(), 0);
});

test("cached discovery reads cannot bypass live ownership or revocation checks", async () => {
  const { core, state, objectQuery } = fixture();
  await core.getEntitlement(ENTITLEMENT);
  await core.getEntitlement(ENTITLEMENT);
  assert.equal(objectQuery.mock.callCount(), 1);
  state.revoked = true;
  await assert.rejects(core.verifyEntitlement(query), errorCode("REVOKED"));
  state.revoked = false;
  state.objects.set(ENTITLEMENT, {
    ...entitlementObject(),
    owner: { $kind: "AddressOwner", AddressOwner: OWNER },
  });
  await assert.rejects(core.verifyEntitlement(query), errorCode("WRONG_OWNER"));
});

test("discovery cache expires at entitlement expiry and is optional", async () => {
  const { core, state, objectQuery } = fixture({
    core: { cacheTtlMs: 60_000 },
  });
  await core.getEntitlement(ENTITLEMENT);
  state.now = NOW + 10_000;
  await core.getEntitlement(ENTITLEMENT);
  assert.equal(objectQuery.mock.callCount(), 2);
  await assert.rejects(core.verifyEntitlement(query), errorCode("EXPIRED"));
  const uncached = fixture({ core: { cache: false } });
  await uncached.core.getEntitlement(ENTITLEMENT);
  await uncached.core.getEntitlement(ENTITLEMENT);
  assert.equal(uncached.objectQuery.mock.callCount(), 2);
});

test("service parsing rejects mismatched returned object IDs", async () => {
  const { core, state } = fixture();
  state.objects.set(SERVICE, { ...serviceObject(), objectId: PACKAGE });
  await assert.rejects(core.getService(SERVICE), errorCode("INVALID_OBJECT"));
});

test("slow cache adapters cannot return a snapshot after its expiry", async () => {
  let now = NOW;
  const backing = new MemoryEntitlementCache({ now: () => now });
  const cache = {
    get: async (key: string) => {
      const value = await backing.get(key);
      if (value) now += 20_000;
      return value;
    },
    set: backing.set.bind(backing),
    delete: backing.delete.bind(backing),
  };
  const { core, objectQuery } = fixture({ core: { cache, now: () => now } });
  await core.getEntitlement(ENTITLEMENT);
  await core.getEntitlement(ENTITLEMENT);
  assert.equal(objectQuery.mock.callCount(), 2);
});
