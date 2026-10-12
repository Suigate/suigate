import assert from "node:assert/strict";
import { test } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import {
  deriveEntitlementId,
  parseEntitlement,
  parsePlan,
  parseService,
} from "../src/parsing.js";
import {
  addr,
  BUYER,
  COIN,
  ENTITLEMENT,
  entitlementObject,
  errorCode,
  NOW,
  OWNER,
  PACKAGE,
  planValue,
  PLANS,
  SERVICE,
  serviceObject,
} from "./fixtures.js";

test("parses the exact Move Service and table layouts", () => {
  const service = parseService(serviceObject(), PACKAGE);
  assert.equal(service.id, SERVICE);
  assert.equal(service.owner, OWNER);
  assert.equal(service.paymentRecipient, OWNER);
  assert.equal(service.version, 2n);
  assert.deepEqual(service.plans, { id: PLANS, size: 1n });
  assert.ok(Object.isFrozen(service));
  assert.ok(Object.isFrozen(service.plans));
});

test("parses Plan without losing u64 precision", () => {
  const plan = parsePlan(planValue({ price: 9_007_199_254_740_993n }), PACKAGE);
  assert.equal(plan.serviceId, SERVICE);
  assert.equal(plan.key, "pro");
  assert.equal(plan.price, 9_007_199_254_740_993n);
  assert.equal(plan.coinType, COIN);
  assert.equal(plan.durationMs, 10_000n);
  assert.equal(plan.version, 3n);
});

test("parses Entitlement ownership, timestamps, and revision", () => {
  const entitlement = parseEntitlement(entitlementObject(), PACKAGE);
  assert.equal(entitlement.id, ENTITLEMENT);
  assert.equal(entitlement.owner, BUYER);
  assert.equal(entitlement.holder, BUYER);
  assert.equal(entitlement.plan, "pro");
  assert.equal(entitlement.expiresAt, BigInt(NOW + 10_000));
  assert.equal(entitlement.revision, 4n);
});

test("rejects a counterfeit package or object type", () => {
  for (const type of [
    `${addr("0xbad")}::subscriptions::Entitlement`,
    `${PACKAGE}::subscriptions::Service`,
  ]) {
    assert.throws(
      () => parseEntitlement({ ...entitlementObject(), type }, PACKAGE),
      errorCode("WRONG_TYPE"),
    );
  }
});

test("rejects wrong object UID, malformed BCS, and trailing fields", () => {
  assert.throws(
    () => parseService(serviceObject({ id: addr("0x999") }), PACKAGE),
    errorCode("INVALID_OBJECT"),
  );
  assert.throws(
    () =>
      parseEntitlement(
        { ...entitlementObject(), content: new Uint8Array([0]) },
        PACKAGE,
      ),
    errorCode("INVALID_OBJECT"),
  );
  const object = entitlementObject();
  assert.throws(
    () =>
      parseEntitlement(
        { ...object, content: new Uint8Array([...object.content, 0]) },
        PACKAGE,
      ),
    errorCode("INVALID_OBJECT"),
  );
});

test("rejects unsupported ownership and mismatched holder", () => {
  assert.throws(
    () =>
      parseEntitlement(
        {
          ...entitlementObject(),
          owner: { $kind: "Immutable", Immutable: true },
        },
        PACKAGE,
      ),
    errorCode("WRONG_OWNER"),
  );
  assert.throws(
    () => parseEntitlement(entitlementObject({ holder: OWNER }), PACKAGE),
    errorCode("WRONG_OWNER"),
  );
  assert.throws(
    () =>
      parseService(
        {
          ...serviceObject(),
          owner: { $kind: "AddressOwner", AddressOwner: OWNER },
        },
        PACKAGE,
      ),
    errorCode("INVALID_OBJECT"),
  );
});

test("rejects impossible paid plans and invalid validity intervals", () => {
  assert.throws(
    () => parsePlan(planValue({ price: 0n }), PACKAGE),
    errorCode("INVALID_OBJECT"),
  );
  assert.throws(
    () => parsePlan(planValue({ duration_ms: 0n }), PACKAGE),
    errorCode("INVALID_OBJECT"),
  );
  assert.throws(
    () =>
      parseEntitlement(
        entitlementObject({ expires_at: BigInt(NOW - 1000) }),
        PACKAGE,
      ),
    errorCode("INVALID_OBJECT"),
  );
});

test("derivation uses the actual holder+ASCII plan key and type origin", () => {
  const bytes = new Uint8Array([
    ...bcs.Address.serialize(BUYER).toBytes(),
    ...bcs.string().serialize("pro").toBytes(),
  ]);
  assert.equal(
    ENTITLEMENT,
    deriveObjectID(SERVICE, `${PACKAGE}::subscriptions::EntitlementKey`, bytes),
  );
  assert.notEqual(
    deriveEntitlementId({
      serviceId: SERVICE,
      typeOrigin: PACKAGE,
      owner: BUYER,
      plan: "team",
    }),
    ENTITLEMENT,
  );
  assert.throws(
    () =>
      deriveEntitlementId({
        serviceId: SERVICE,
        typeOrigin: PACKAGE,
        owner: "not-an-address",
        plan: "pro",
      }),
    errorCode("INVALID_ARGUMENT"),
  );
});
