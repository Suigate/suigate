import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { MemoryChallengeStore, type Challenge } from "../src/auth.js";
import { encodeAuthorizationProof } from "../src/http-auth.js";
import { deriveEntitlementId } from "../src/parsing.js";
import type { ServerAuthorizationOptions } from "../src/server.js";
import { EntitlementBcs } from "../src/internal/schema.js";
import {
  addr,
  CHAIN,
  entitlementObject,
  fixture,
  NOW,
  PACKAGE,
  SERVICE,
} from "./fixtures.js";

export function authorizationFixture() {
  const chain = fixture({ hasEntitlement: false });
  const keypair = new Ed25519Keypair();
  const wallet = keypair.toSuiAddress();
  const entitlementId = deriveEntitlementId({
    typeOrigin: PACKAGE,
    serviceId: SERVICE,
    owner: wallet,
    plan: "pro",
  });
  const store = new MemoryChallengeStore();
  const options: ServerAuthorizationOptions = {
    client: chain.client,
    packageId: PACKAGE,
    chainIdentifier: CHAIN,
    serviceId: SERVICE,
    plan: "pro",
    audience: "https://api.example",
    challengeStore: store,
    now: () => chain.state.now,
  };
  function putEntitlement(
    overrides: Partial<typeof EntitlementBcs.$inferInput> = {},
    owner = wallet,
  ) {
    const object = entitlementObject({
      id: entitlementId,
      holder: wallet,
      ...overrides,
    });
    object.objectId = addr(String(overrides.id ?? entitlementId));
    object.owner = { $kind: "AddressOwner", AddressOwner: owner };
    chain.state.objects.set(object.objectId, object);
  }
  putEntitlement();
  const challengeInput = {
    address: wallet,
    entitlementId,
    method: "GET",
    target: "/api/data",
  };
  async function sign(
    challenge: Challenge,
    signer = keypair,
    id = entitlementId,
  ) {
    const { signature } = await signer.signPersonalMessage(
      new TextEncoder().encode(challenge.message),
    );
    return encodeAuthorizationProof({
      challengeId: challenge.id,
      signature,
      address: wallet,
      entitlementId: id,
    });
  }
  return {
    ...chain,
    keypair,
    wallet,
    entitlementId,
    store,
    options,
    putEntitlement,
    challengeInput,
    sign,
    NOW,
  };
}
