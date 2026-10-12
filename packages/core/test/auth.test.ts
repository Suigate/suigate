import assert from "node:assert/strict";
import { test } from "node:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { MultiSigPublicKey } from "@mysten/sui/multisig";
import {
  createChallenge,
  MemoryChallengeStore,
  verifyChallenge,
  verifySignature,
} from "../src/auth.js";
import { CHAIN, errorCode, fixture, NOW, SERVICE } from "./fixtures.js";

function authFixture() {
  const keypair = new Ed25519Keypair();
  const store = new MemoryChallengeStore();
  const state = { now: NOW };
  const context = {
    audience: "https://app.example",
    address: keypair.toSuiAddress(),
    serviceId: SERVICE,
    chainIdentifier: CHAIN,
    binding: "browser-request-123",
  };
  const options = { store, now: () => state.now };
  return { keypair, store, state, context, options };
}

test("challenges are unpredictable, bounded, domain-separated messages", async () => {
  const { context, options } = authFixture();
  const [first, second] = await Promise.all([
    createChallenge(context, options),
    createChallenge(context, options),
  ]);
  assert.match(first.id, /^[a-f0-9]{64}$/);
  assert.notEqual(first.id, second.id);
  assert.equal(first.expiresAt - first.issuedAt, 300_000);
  for (const field of [
    context.audience,
    context.address,
    context.serviceId,
    context.chainIdentifier,
    context.binding,
    first.id,
  ]) {
    assert.ok(first.message.includes(field));
  }
  assert.ok(Object.isFrozen(first));
  await assert.rejects(
    createChallenge(context, { ...options, ttlMs: 300_001 }),
    errorCode("INVALID_ARGUMENT"),
  );
  await assert.rejects(
    createChallenge(
      { ...context, binding: "injected\nOrigin: attacker" },
      options,
    ),
    errorCode("INVALID_ARGUMENT"),
  );
});

for (const Keypair of [Ed25519Keypair, Secp256k1Keypair, Secp256r1Keypair]) {
  test(`personal-message verification supports ${Keypair.name}`, async () => {
    const keypair = new Keypair();
    const message = new TextEncoder().encode("suigate authentication");
    const { signature } = await keypair.signPersonalMessage(message);
    assert.equal(
      await verifySignature({
        message,
        signature,
        address: keypair.toSuiAddress(),
      }),
      keypair.toSuiAddress(),
    );
  });
}

test("verifies multisig personal-message signatures", async () => {
  const signer = new Ed25519Keypair();
  const publicKey = MultiSigPublicKey.fromPublicKeys({
    threshold: 1,
    publicKeys: [{ publicKey: signer.getPublicKey(), weight: 1 }],
  });
  const message = new TextEncoder().encode("multisig challenge");
  const signed = await signer.signPersonalMessage(message);
  const signature = publicKey.combinePartialSignatures([signed.signature]);
  assert.equal(
    await verifySignature({
      message,
      signature,
      address: publicKey.toSuiAddress(),
    }),
    publicKey.toSuiAddress(),
  );
});

test("rejects wrong wallet, altered message, malformed signature, and transaction intent", async () => {
  const signer = new Ed25519Keypair();
  const message = new TextEncoder().encode("original message");
  const { signature } = await signer.signPersonalMessage(message);
  const address = signer.toSuiAddress();
  await assert.rejects(
    verifySignature({
      message,
      signature,
      address: new Ed25519Keypair().toSuiAddress(),
    }),
    errorCode("INVALID_SIGNATURE"),
  );
  await assert.rejects(
    verifySignature({
      message: new TextEncoder().encode("different"),
      signature,
      address,
    }),
    errorCode("INVALID_SIGNATURE"),
  );
  await assert.rejects(
    verifySignature({ message, signature: "invalid", address }),
    errorCode("INVALID_SIGNATURE"),
  );
  const transactionSignature = await signer.signTransaction(message);
  await assert.rejects(
    verifySignature({
      message,
      signature: transactionSignature.signature,
      address,
    }),
    errorCode("INVALID_SIGNATURE"),
  );
});

test("challenge verification authenticates exact server-stored bytes and consumes once", async () => {
  const { context, options, keypair } = authFixture();
  const challenge = await createChallenge(context, options);
  const { signature } = await keypair.signPersonalMessage(
    new TextEncoder().encode(challenge.message),
  );
  const input = { id: challenge.id, signature, expected: context };
  assert.deepEqual(await verifyChallenge(input, options), {
    address: context.address,
    serviceId: SERVICE,
    chainIdentifier: CHAIN,
  });
  await assert.rejects(
    verifyChallenge(input, options),
    errorCode("CHALLENGE_NOT_FOUND"),
  );
});

test("concurrent replay permits exactly one successful authentication", async () => {
  const { context, options, keypair } = authFixture();
  const challenge = await createChallenge(context, options);
  const { signature } = await keypair.signPersonalMessage(
    new TextEncoder().encode(challenge.message),
  );
  const input = { id: challenge.id, signature, expected: context };
  const results = await Promise.allSettled([
    verifyChallenge(input, options),
    verifyChallenge(input, options),
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

test("rejects expiry at the exact boundary and future-dated challenges", async () => {
  const { context, options, keypair, state } = authFixture();
  const challenge = await createChallenge(context, { ...options, ttlMs: 100 });
  const { signature } = await keypair.signPersonalMessage(
    new TextEncoder().encode(challenge.message),
  );
  const input = { id: challenge.id, signature, expected: context };
  state.now = challenge.expiresAt;
  await assert.rejects(
    verifyChallenge(input, options),
    errorCode("CHALLENGE_EXPIRED"),
  );
  state.now = challenge.issuedAt - 1;
  await assert.rejects(
    verifyChallenge(input, options),
    errorCode("CHALLENGE_MISMATCH"),
  );
});

test("invalid signatures and wrong scope do not consume a valid challenge", async () => {
  const { context, options, keypair } = authFixture();
  const challenge = await createChallenge(context, options);
  const { signature } = await keypair.signPersonalMessage(
    new TextEncoder().encode(challenge.message),
  );
  const input = { id: challenge.id, signature, expected: context };
  for (const expected of [
    { ...context, audience: "https://other.example" },
    { ...context, binding: "other-request" },
    { ...context, serviceId: "0x999" },
    { ...context, chainIdentifier: "other-chain" },
    { ...context, address: new Ed25519Keypair().toSuiAddress() },
  ]) {
    await assert.rejects(
      verifyChallenge({ ...input, expected }, options),
      errorCode("CHALLENGE_MISMATCH"),
    );
  }
  await assert.rejects(
    verifyChallenge({ ...input, signature: "invalid" }, options),
    errorCode("INVALID_SIGNATURE"),
  );
  assert.equal(
    (await verifyChallenge(input, options)).address,
    context.address,
  );
});

test("checks the verifier client chain when a client is supplied", async () => {
  const { context, options, keypair } = authFixture();
  const chain = fixture();
  chain.state.chain = "wrong-chain";
  const challenge = await createChallenge(context, options);
  const { signature } = await keypair.signPersonalMessage(
    new TextEncoder().encode(challenge.message),
  );
  await assert.rejects(
    verifyChallenge(
      { id: challenge.id, signature, expected: context },
      { ...options, client: chain.client },
    ),
    errorCode("WRONG_NETWORK"),
  );
});

test("expiry during signature verification cannot be consumed", async () => {
  const { context, keypair, store } = authFixture();
  const challenge = await createChallenge(context, {
    store,
    now: () => NOW,
    ttlMs: 10,
  });
  const { signature } = await keypair.signPersonalMessage(
    new TextEncoder().encode(challenge.message),
  );
  let reads = 0;
  await assert.rejects(
    verifyChallenge(
      { id: challenge.id, signature, expected: context },
      { store, now: () => (++reads === 1 ? NOW : NOW + 10) },
    ),
    errorCode("CHALLENGE_CONSUMED"),
  );
});

test("challenge store bounds memory and prunes expired records", async () => {
  const { context } = authFixture();
  const store = new MemoryChallengeStore({ maxEntries: 1 });
  const challenge = await createChallenge(context, {
    store,
    now: () => NOW,
    ttlMs: 10,
  });
  await assert.rejects(
    createChallenge(context, { store, now: () => NOW }),
    errorCode("CHALLENGE_STORE_FULL"),
  );
  await createChallenge(context, { store, now: () => NOW + 10 });
  assert.equal(await store.get(challenge.id), null);
});
