import assert from "node:assert/strict";
import { test } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { ObjectError } from "@mysten/sui/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { PaymentAdapter } from "../src/internal/payment-kit.js";
import { parsePlan, parseService } from "../src/parsing.js";
import {
  COIN,
  errorCode,
  fixture,
  OWNER,
  PACKAGE,
  planValue,
  REGISTRY,
  serviceObject,
} from "./fixtures.js";

const service = parseService(serviceObject(), PACKAGE);
const plan = parsePlan(planValue(), PACKAGE);

test("adapter delegates key encoding and record lookup to the installed Payment Kit", async () => {
  const { client, fieldQuery } = fixture();
  await new PaymentAdapter(client).assertUnused(service, plan, "adapter-test");
  const args = fieldQuery.mock.calls[0]?.arguments[0];
  assert.ok(args);
  assert.equal(args.parentId, REGISTRY);
  assert.equal(
    args.name.type,
    `@mysten/payment-kit::payment_kit::PaymentKey<${COIN}>`,
  );
  const encodedKey = bcs.struct("ExpectedKey", {
    nonce: bcs.string(),
    payment_amount: bcs.u64(),
    receiver: bcs.Address,
  });
  assert.deepEqual(encodedKey.parse(args.name.bcs), {
    nonce: "adapter-test",
    payment_amount: "1000",
    receiver: OWNER,
  });
});

test("adapter recognizes SDK-decoded records rather than treating receipts as entitlements", async () => {
  const { client, state } = fixture();
  state.paymentRecorded = true;
  await assert.rejects(
    new PaymentAdapter(client).assertUnused(service, plan, "recorded"),
    errorCode("DUPLICATE_PAYMENT"),
  );
});

test("adapter does not confuse network failures with missing records", async () => {
  const { client, state } = fixture();
  state.fieldFailure = new Error("network timeout");
  const adapter = new PaymentAdapter(client);
  await assert.rejects(
    adapter.assertUnused(service, plan, "timeout"),
    errorCode("RPC_ERROR"),
  );
  state.fieldFailure = new ObjectError("unknown", "unknown failure", {
    reason: "unknown",
  });
  await assert.rejects(
    adapter.assertUnused(service, plan, "unknown"),
    errorCode("RPC_ERROR"),
  );
});

test("unsupported Payment Kit networks fail explicitly", () => {
  const client = new SuiGrpcClient({
    network: "localnet",
    baseUrl: "http://127.0.0.1:1",
  });
  assert.throws(() => new PaymentAdapter(client), errorCode("WRONG_NETWORK"));
});
