import assert from "node:assert/strict";
import { test } from "node:test";
import { Transaction } from "@mysten/sui/transactions";
import { configureGas } from "../src/gas.js";
import { addr, BUYER, errorCode, OWNER } from "./fixtures.js";

test("auto without a sponsor leaves genuine gas eligibility to the SDK", () => {
  const tx = new Transaction();
  assert.deepEqual(configureGas(tx, { sender: BUYER }), {
    mode: "user",
    owner: BUYER,
  });
  assert.equal(tx.getData().sender, BUYER);
  assert.equal(tx.getData().gasData.price, null);
  assert.equal(tx.getData().gasData.budget, null);
  assert.equal(tx.getData().gasData.payment, null);
});

test("auto chooses a configured sponsor using address-balance gas", () => {
  const tx = new Transaction();
  assert.deepEqual(
    configureGas(tx, { sender: BUYER, sponsor: { address: OWNER } }),
    { mode: "sponsored", owner: OWNER },
  );
  assert.deepEqual(tx.getData().gasData.payment, []);
  assert.equal(tx.getData().gasData.owner, OWNER);
  assert.equal(tx.getData().gasData.price, null);
});

test("explicit user gas overrides the default sponsor", () => {
  const tx = new Transaction();
  configureGas(tx, { sender: BUYER, gas: "user", sponsor: { address: OWNER } });
  assert.equal(tx.getData().gasData.owner, null);
  assert.equal(tx.getData().gasData.payment, null);
});

test("supports explicit sponsor gas coins and budget", () => {
  const tx = new Transaction();
  const payment = [
    { objectId: addr("0xaaa"), version: "1", digest: "gas-digest" },
  ];
  configureGas(tx, {
    sender: BUYER,
    gas: "sponsored",
    sponsor: { address: OWNER, gasPayment: payment, budget: 10_000_000n },
  });
  assert.deepEqual(tx.getData().gasData.payment, payment);
  assert.equal(tx.getData().gasData.budget, "10000000");
});

test("rejects missing sponsors, zero budgets, and conflicting transaction settings", () => {
  assert.throws(
    () => configureGas(new Transaction(), { sender: BUYER, gas: "sponsored" }),
    errorCode("SPONSOR_REQUIRED"),
  );
  assert.throws(
    () =>
      configureGas(new Transaction(), {
        sender: BUYER,
        sponsor: { address: OWNER, budget: 0n },
      }),
    errorCode("INVALID_ARGUMENT"),
  );
  const tx = new Transaction();
  tx.setGasPrice(0);
  assert.throws(
    () => configureGas(tx, { sender: BUYER }),
    errorCode("INVALID_ARGUMENT"),
  );
  const funded = new Transaction();
  funded.coin({ balance: 1000n });
  assert.throws(
    () => configureGas(funded, { sender: BUYER, sponsor: { address: OWNER } }),
    errorCode("INVALID_ARGUMENT"),
  );
  const wrongSender = new Transaction();
  wrongSender.setSender(OWNER);
  assert.throws(
    () => configureGas(wrongSender, { sender: BUYER }),
    errorCode("INVALID_ARGUMENT"),
  );
});
