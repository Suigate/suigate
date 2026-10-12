# Wallet authentication

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). Automated tests are not a human audit.

An entitlement ID and wallet address are public identifiers. Access requires proof of wallet control and a currently valid entitlement.

## Request flow

1. POST the following JSON to your public challenge handler:

```json
{
  "address": "0xCUSTOMER_ADDRESS",
  "entitlementId": "0xENTITLEMENT_ID",
  "method": "GET",
  "target": "/api/pro"
}
```

2. The server returns a challenge: its random `id` is the nonce, `expiresAt` is an expiry timestamp, and `message` is the exact text to sign.
3. Use the official wallet's Sui personal-message signing feature on `new TextEncoder().encode(challenge.message)`.
4. Build the authorization header:

```ts
import { encodeAuthorizationProof } from "@suigate/core";

const authorization = encodeAuthorizationProof({
  challengeId: challenge.id,
  signature,
  address: walletAddress,
  entitlementId,
});
```

5. Send it as the `Authorization` header on the exact method/target that was challenged.

The target is a canonical origin-relative path including its query string. Mount prefixes matter. Express uses `originalUrl`; Next Route Handlers use the URL pathname and search. The server fixes Service and plan policy; the client cannot select them in the challenge request.

## Verification

Core retrieves the stored challenge, verifies its canonical message, expected origin/chain/wallet/Service/request binding and expiry, verifies the wallet signature, then atomically consumes the nonce. The HTTP binding includes plan, entitlement ID, method, and target. The backend then rereads the entitlement from Sui, checking type, Service, plan, owner/holder, expiry, and revocation.

Only one concurrent redemption can succeed. Invalid signatures do not consume a valid challenge. An authenticated request denied by entitlement checks does consume it. A later RPC failure may also occur after consumption; obtain a new challenge for the next attempt.

## Limits

Challenges last at most five minutes. The default store holds at most 10,000 entries. HTTP challenge bodies are bounded to 8 KiB and proof headers to 16 KiB. Rate-limit public issuance with your application's ingress policy.

These are **single-use request proofs**, not reusable sessions or bearer API keys. Cookie/JWT session issuance is not included. Default memory stores do not work as shared storage across independent workers. Custom stores must implement atomic `consumeIfUnexpired` and enforce expiry.

Use TLS, avoid logging proof headers, and validate application payloads separately: these proofs authenticate access and bind routing context, not the contents of an arbitrary business request body. Use the verified wallet identity for customer-specific data authorization.
