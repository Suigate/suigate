import assert from "node:assert/strict";
import { test } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import type { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag } from "@mysten/sui/utils";
import {
  addr,
  BUYER,
  COIN,
  ENTITLEMENT,
  entitlementObject,
  errorCode,
  fixture,
  NOW,
  OWNER,
  PACKAGE,
  planValue,
  REGISTRY,
  SERVICE,
} from "./fixtures.js";

const options = {
  serviceId: SERVICE,
  plan: "pro",
  sender: BUYER,
  nonce: "checkout-1",
};

function call(transaction: Transaction) {
  const calls = transaction
    .getData()
    .commands.filter((command) => command.$kind === "MoveCall");
  assert.equal(calls.length, 1);
  return calls[0]!.MoveCall;
}

function pure<T>(
  transaction: Transaction,
  argumentIndex: number,
  schema: { fromBase64(bytes: string): T },
): T {
  const argument = call(transaction).arguments[argumentIndex];
  assert.equal(argument?.$kind, "Input");
  if (argument?.$kind !== "Input") throw new Error("Expected input");
  const input = transaction.getData().inputs[argument.Input];
  if (input?.$kind !== "Pure") throw new Error("Expected pure input");
  return schema.fromBase64(input.Pure.bytes);
}

function funding(transaction: Transaction) {
  const command = transaction
    .getData()
    .commands.find((command) => command.$kind === "$Intent");
  assert.ok(command?.$Intent);
  return command.$Intent;
}

test("purchase calls only the atomic suigate wrapper with authoritative on-chain terms", async () => {
  const { core } = fixture({ hasEntitlement: false });
  const result = await core.purchaseEntitlement(options);
  const moveCall = call(result.transaction);
  assert.equal(moveCall.package, PACKAGE);
  assert.equal(moveCall.module, "subscriptions");
  assert.equal(moveCall.function, "purchase");
  assert.deepEqual(moveCall.typeArguments, [COIN]);
  assert.equal(moveCall.arguments.length, 9);
  assert.equal(pure(result.transaction, 2, bcs.string()), "pro");
  assert.equal(pure(result.transaction, 3, bcs.u64()), "2");
  assert.equal(pure(result.transaction, 4, bcs.u64()), "3");
  assert.equal(pure(result.transaction, 5, bcs.u64()), String(NOW + 60_000));
  assert.equal(pure(result.transaction, 6, bcs.string()), options.nonce);
  assert.equal(funding(result.transaction).name, "CoinWithBalance");
  assert.equal(funding(result.transaction).data.balance, 1000n);
  assert.equal(result.transaction.getData().sender, BUYER);
  assert.equal(result.entitlementId, ENTITLEMENT);
  assert.equal(result.quote.plan.price, 1000n);
  assert.equal(result.quote.service.registryId, REGISTRY);
  assert.equal(result.gas.mode, "user");
  assert.equal("entitlement" in result, false);
});

test("client-provided price or receiver cannot override plan configuration", async () => {
  const { core } = fixture({ hasEntitlement: false });
  const malicious = {
    ...options,
    price: 1n,
    receiver: BUYER,
    duration: 999_999n,
  };
  const result = await core.purchaseEntitlement(malicious);
  assert.equal(result.quote.plan.price, 1000n);
  assert.equal(result.quote.service.paymentRecipient, OWNER);
  assert.equal(funding(result.transaction).data.balance, 1000n);
});

test("renewal uses the existing object, current terms, and caller-bound revision", async () => {
  const { core } = fixture();
  const result = await core.renewEntitlement({
    ...options,
    expectedRevision: 4n,
  });
  assert.equal(call(result.transaction).function, "renew");
  assert.equal(call(result.transaction).arguments.length, 10);
  assert.equal(pure(result.transaction, 3, bcs.u64()), "4");
  assert.equal(pure(result.transaction, 4, bcs.u64()), "2");
  assert.equal(pure(result.transaction, 5, bcs.u64()), "3");
  assert.equal(result.quote.expectedRevision, 4n);
  assert.equal(result.entitlementId, ENTITLEMENT);
});

test("expired entitlements may be renewed but stale revisions cannot be retried as new renewals", async () => {
  const { core, state } = fixture();
  state.objects.set(
    ENTITLEMENT,
    entitlementObject({ expires_at: BigInt(NOW) }),
  );
  assert.equal(
    (await core.renewEntitlement({ ...options, expectedRevision: 4n }))
      .entitlementId,
    ENTITLEMENT,
  );
  await assert.rejects(
    core.renewEntitlement({ ...options, expectedRevision: 3n }),
    errorCode("STALE_REVISION"),
  );
});

test("renewal rejects wrong service, plan, owner, and revoked state", async () => {
  const { core, state } = fixture();
  await assert.rejects(
    core.renewEntitlement({
      ...options,
      entitlementId: ENTITLEMENT,
      sender: OWNER,
      expectedRevision: 4n,
    }),
    errorCode("WRONG_OWNER"),
  );
  state.objects.set(ENTITLEMENT, entitlementObject({ plan_key: "other" }));
  await assert.rejects(
    core.renewEntitlement({ ...options, expectedRevision: 4n }),
    errorCode("WRONG_PLAN"),
  );
  state.objects.set(
    ENTITLEMENT,
    entitlementObject({ service_id: addr("0x999") }),
  );
  await assert.rejects(
    core.renewEntitlement({ ...options, expectedRevision: 4n }),
    errorCode("WRONG_SERVICE"),
  );
  state.objects.set(ENTITLEMENT, entitlementObject());
  state.revoked = true;
  await assert.rejects(
    core.renewEntitlement({ ...options, expectedRevision: 4n }),
    errorCode("REVOKED"),
  );
});

test("rejects existing issuance, wrong coin, invalid nonce, and unavailable plans", async () => {
  const existing = fixture();
  await assert.rejects(
    existing.core.purchaseEntitlement(options),
    errorCode("ALREADY_ENTITLED"),
  );
  const { core, state } = fixture({ hasEntitlement: false });
  await assert.rejects(
    core.purchaseEntitlement({ ...options, coinType: "0x999::fake::SUI" }),
    errorCode("WRONG_COIN"),
  );
  await assert.rejects(
    core.purchaseEntitlement({ ...options, nonce: "" }),
    errorCode("INVALID_ARGUMENT"),
  );
  await assert.rejects(
    core.purchaseEntitlement({ ...options, nonce: "x".repeat(37) }),
    errorCode("INVALID_ARGUMENT"),
  );
  state.plan = planValue({ purchases_enabled: false });
  await assert.rejects(
    core.purchaseEntitlement(options),
    errorCode("PLAN_UNAVAILABLE"),
  );
});

test("sponsored SUI funding uses customer funds, never the sponsor gas coin", async () => {
  const { core } = fixture({
    hasEntitlement: false,
    core: { sponsor: { address: OWNER } },
  });
  const result = await core.purchaseEntitlement({
    ...options,
    gas: "sponsored",
  });
  assert.equal(funding(result.transaction).data.type, COIN);
  assert.notEqual(funding(result.transaction).data.type, "gas");
  assert.equal(result.transaction.getData().gasData.owner, OWNER);
  assert.deepEqual(result.transaction.getData().gasData.payment, []);
  assert.equal(result.transaction.getData().gasData.price, null);
});

test("stablecoin entitlement transactions do not fabricate zero-gas settings", async () => {
  const { core, state } = fixture({ hasEntitlement: false });
  const stablecoin = normalizeStructTag(
    "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  );
  state.plan = planValue({ coin_type: { name: stablecoin } });
  const result = await core.purchaseEntitlement({
    ...options,
    coinType: stablecoin,
    gas: "auto",
  });
  assert.equal(result.quote.plan.coinType, stablecoin);
  assert.equal(funding(result.transaction).data.type, stablecoin);
  assert.equal(result.transaction.getData().gasData.price, null);
  assert.equal(result.transaction.getData().gasData.budget, null);
  assert.equal(call(result.transaction).function, "purchase");
});

test("new checkout generates a Payment Kit-compatible nonce and duplicate records are rejected", async () => {
  const { core, state } = fixture({ hasEntitlement: false });
  const result = await core.purchaseEntitlement({
    serviceId: SERVICE,
    plan: "pro",
    sender: BUYER,
  });
  assert.match(result.quote.nonce, /^[a-f0-9-]{36}$/);
  state.paymentRecorded = true;
  await assert.rejects(
    core.purchaseEntitlement(options),
    errorCode("DUPLICATE_PAYMENT"),
  );
});

test("supports an upgraded call package while keeping the original type identity", async () => {
  const upgraded = addr("0xdef");
  const { core } = fixture({
    hasEntitlement: false,
    core: { packageId: upgraded, typeOrigin: PACKAGE },
  });
  const result = await core.purchaseEntitlement(options);
  assert.equal(call(result.transaction).package, upgraded);
  assert.equal(result.entitlementId, ENTITLEMENT);
});
