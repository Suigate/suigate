import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import {
  fixture,
  PACKAGE,
  PLANS,
  SERVICE,
  addr,
  errorCode,
} from "./fixtures.js";

function entry() {
  return {
    $kind: "DynamicField" as const,
    fieldId: addr("0x55"),
    type: "0x2::dynamic_field::Field",
    name: {
      type: "0x1::ascii::String",
      bcs: bcs.string().serialize("pro").toBytes(),
    },
    valueType: `${PACKAGE}::subscriptions::Plan`,
  };
}

test("lists authoritative Service plans using paginated dynamic fields", async () => {
  const f = fixture();
  const list = mock.method(f.client.core, "listDynamicFields", async () => ({
    dynamicFields: [entry()],
    cursor: "next",
    hasNextPage: true,
  }));
  const page = await f.core.listPlans({ serviceId: SERVICE, limit: 20 });
  assert.equal(page.plans[0]?.key, "pro");
  assert.equal(page.plans[0]?.price, 1000n);
  assert.equal(page.cursor, "next");
  assert.equal(list.mock.calls[0]?.arguments[0]?.parentId, PLANS);
});

test("rejects mismatched plan table entries and non-progressing pagination", async () => {
  const f = fixture();
  mock.method(f.client.core, "listDynamicFields", async () => ({
    dynamicFields: [
      { ...entry(), valueType: `${addr("0xdef")}::subscriptions::Plan` },
    ],
    cursor: null,
    hasNextPage: false,
  }));
  await assert.rejects(
    f.core.listPlans({ serviceId: SERVICE }),
    errorCode("WRONG_TYPE"),
  );
  mock.method(f.client.core, "listDynamicFields", async () => ({
    dynamicFields: [],
    cursor: "same",
    hasNextPage: true,
  }));
  await assert.rejects(
    f.core.listPlans({ serviceId: SERVICE, cursor: "same" }),
    errorCode("RPC_ERROR"),
  );
});
