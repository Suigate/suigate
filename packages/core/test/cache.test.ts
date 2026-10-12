import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryEntitlementCache } from "../src/cache.js";
import { entitlement, errorCode, NOW } from "./fixtures.js";

test("cache expires exactly at its TTL", async () => {
  let now = NOW;
  const cache = new MemoryEntitlementCache({ now: () => now });
  await cache.set("key", {
    entitlement: entitlement(),
    validUntil: BigInt(NOW + 100),
  });
  assert.ok(await cache.get("key"));
  now += 100;
  assert.equal(await cache.get("key"), null);
});

test("cache rejects a lifetime longer than entitlement expiry", async () => {
  const cache = new MemoryEntitlementCache({ now: () => NOW });
  const value = entitlement();
  await assert.rejects(
    cache.set("key", { entitlement: value, validUntil: value.expiresAt + 1n }),
    errorCode("INVALID_ARGUMENT"),
  );
});

test("cache bounds capacity and protects cached state from mutation", async () => {
  const cache = new MemoryEntitlementCache({ now: () => NOW, maxEntries: 1 });
  const input = { ...entitlement() };
  await cache.set("a", { entitlement: input, validUntil: input.expiresAt });
  input.plan = "forged";
  const cached = await cache.get("a");
  assert.equal(cached?.entitlement.plan, "pro");
  assert.ok(Object.isFrozen(cached?.entitlement));
  await cache.set("b", {
    entitlement: entitlement(),
    validUntil: input.expiresAt,
  });
  assert.equal(await cache.get("a"), null);
  await cache.delete("b");
  assert.equal(await cache.get("b"), null);
});
