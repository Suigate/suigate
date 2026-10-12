import assert from "node:assert/strict";
import { test } from "node:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuigateAuthorizer } from "../src/server.js";
import {
  authorizationFailure,
  encodeAuthorizationProof,
  parseAuthorizationProof,
  readChallengeRequest,
} from "../src/http-auth.js";
import { authorizationFixture } from "./authorization-fixture.js";
import { addr } from "./fixtures.js";

function status(value: number) {
  return (error: unknown) =>
    error instanceof Error && "status" in error && error.status === value;
}

test("shared authorizer authenticates a wallet and reads authoritative entitlement state", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  const challenge = await authorizer.issueChallenge(f.challengeInput);
  assert.ok(challenge.message.includes('"target":"/api/data"'));
  assert.ok(challenge.message.includes('"plan":"pro"'));
  const result = await authorizer.authorize({
    method: "GET",
    target: "/api/data",
    authorization: await f.sign(challenge),
  });
  assert.equal(result.address, f.wallet);
  assert.equal(result.entitlement.id, f.entitlementId);
});

test("proof IDs without a valid signature and replayed proofs never authorize", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  const challenge = await authorizer.issueChallenge(f.challengeInput);
  const header = await f.sign(challenge);
  const request = { method: "GET", target: "/api/data", authorization: header };
  await assert.rejects(
    authorizer.authorize({ ...request, authorization: f.entitlementId }),
    status(401),
  );
  await assert.rejects(
    authorizer.authorize({
      ...request,
      authorization: await f.sign(challenge, new Ed25519Keypair()),
    }),
    status(401),
  );
  await authorizer.authorize(request);
  await assert.rejects(authorizer.authorize(request), status(401));
});

test("concurrent proof redemption authorizes exactly once", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  const challenge = await authorizer.issueChallenge(f.challengeInput);
  const request = {
    method: "GET",
    target: "/api/data",
    authorization: await f.sign(challenge),
  };
  const results = await Promise.allSettled([
    authorizer.authorize(request),
    authorizer.authorize(request),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
});

test("proofs are bound to method, target, entitlement, and configured policy", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  const challenge = await authorizer.issueChallenge(f.challengeInput);
  const request = {
    method: "GET",
    target: "/api/data",
    authorization: await f.sign(challenge),
  };
  await assert.rejects(
    authorizer.authorize({ ...request, method: "POST" }),
    status(401),
  );
  await assert.rejects(
    authorizer.authorize({ ...request, target: "/api/other" }),
    status(401),
  );
  await assert.rejects(
    authorizer.authorize({ ...request, target: "/api/data?q=1" }),
    status(401),
  );
  await assert.rejects(
    authorizer.authorize({
      ...request,
      authorization: await f.sign(challenge, f.keypair, addr("0x999")),
    }),
    status(401),
  );
  const otherPlan = new SuigateAuthorizer({ ...f.options, plan: "team" });
  await assert.rejects(otherPlan.authorize(request), status(401));
  await authorizer.authorize(request);
});

test("authenticated denial consumes the proof; a fresh proof sees a renewed entitlement", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  f.putEntitlement({ expires_at: BigInt(f.NOW) });
  const challenge = await authorizer.issueChallenge(f.challengeInput);
  const request = {
    method: "GET",
    target: "/api/data",
    authorization: await f.sign(challenge),
  };
  await assert.rejects(authorizer.authorize(request), status(403));
  f.putEntitlement({ expires_at: BigInt(f.NOW + 86_400_000), revision: 5n });
  await assert.rejects(authorizer.authorize(request), status(401));
  const renewed = await authorizer.issueChallenge(f.challengeInput);
  const result = await authorizer.authorize({
    ...request,
    authorization: await f.sign(renewed),
  });
  assert.equal(result.entitlement.revision, 5n);
});

test("provider failures and expired challenges fail closed with distinct HTTP categories", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  const challenge = await authorizer.issueChallenge(f.challengeInput);
  f.state.now = challenge.expiresAt;
  await assert.rejects(
    authorizer.authorize({
      method: "GET",
      target: "/api/data",
      authorization: await f.sign(challenge),
    }),
    status(401),
  );
  const fresh = await authorizer.issueChallenge(f.challengeInput);
  f.state.objectFailure = new Error("private upstream endpoint failure");
  await assert.rejects(
    authorizer.authorize({
      method: "GET",
      target: "/api/data",
      authorization: await f.sign(fresh),
    }),
    (error) => {
      assert.equal(authorizationFailure(error).status, 503);
      assert.equal(
        JSON.stringify(authorizationFailure(error).body).includes(
          "private upstream",
        ),
        false,
      );
      return true;
    },
  );
});

test("header codec rejects malformed, oversized, and extra-field credentials", () => {
  for (const header of [
    undefined,
    "Bearer 0x123",
    "Suigate !",
    "Suigate " + "x".repeat(20000),
  ]) {
    assert.throws(() => parseAuthorizationProof(header), status(401));
  }
  assert.throws(
    () =>
      encodeAuthorizationProof({
        challengeId: "bad",
        signature: "invalid",
        address: "0xb",
        entitlementId: "0xc",
      }),
    status(401),
  );
});

test("challenge input is bounded and cannot select service or plan policy", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  for (const input of [
    Object.create(f.challengeInput),
    { ...f.challengeInput, serviceId: "0x999" },
    { ...f.challengeInput, plan: "free" },
    { ...f.challengeInput, target: "//attacker.example/path" },
    { ...f.challengeInput, target: "/api/../admin" },
  ])
    await assert.rejects(authorizer.issueChallenge(input), status(400));
  await assert.rejects(
    readChallengeRequest(
      new Request("https://api.example/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(8193),
      }),
    ),
    status(413),
  );
});
