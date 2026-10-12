import { encodeAuthorizationProof, type Challenge } from "@suigate/core";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { PublicConfiguration } from "./model.ts";

export async function proAccess(options: {
  configuration: PublicConfiguration;
  address: string;
  entitlementId: string;
  sign(message: Uint8Array): Promise<{ signature: string }>;
  assertCurrent(): void;
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const request = options.fetcher ?? fetch;
  const response = await request("/api/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: options.address,
      entitlementId: options.entitlementId,
      method: "GET",
      target: "/api/pro",
    }),
  });
  if (!response.ok)
    throw new Error("The backend could not issue an authentication challenge.");
  const challenge = (await response.json()) as Challenge;
  if (
    challenge.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(challenge.id) ||
    typeof challenge.message !== "string" ||
    challenge.message.length > 8192 ||
    challenge.address !== normalizeSuiAddress(options.address) ||
    challenge.serviceId !== options.configuration.serviceId ||
    challenge.chainIdentifier !== options.configuration.chainIdentifier ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt <= Date.now() ||
    challenge.expiresAt > Date.now() + 300_000
  )
    throw new Error("Unexpected authentication challenge.");
  options.assertCurrent();
  const signed = await options.sign(
    new TextEncoder().encode(challenge.message),
  );
  options.assertCurrent();
  const authorized = await request("/api/pro", {
    headers: {
      Authorization: encodeAuthorizationProof({
        challengeId: challenge.id,
        signature: signed.signature,
        address: options.address,
        entitlementId: options.entitlementId,
      }),
    },
  });
  if (!authorized.ok)
    throw new Error(
      authorized.status === 403
        ? "The wallet is authenticated, but this entitlement does not grant Pro access."
        : "Backend authorization failed. Request a new challenge before retrying.",
    );
  return authorized.json();
}
