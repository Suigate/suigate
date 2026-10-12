# Security

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). Automated tests are not a human audit.

## Authorization boundary

The backend is the access boundary. Never serve protected data because a browser says payment succeeded, because an object ID is known, or because a Payment Kit receipt exists. Verify a fresh wallet proof and current entitlement state through core.

Trust your configured Sui RPC and expected full genesis chain identifier. These packages are not a light-client consensus verifier. Keep server clocks synchronized for expiry checks. Fail closed on RPC, parsing, or nonce-store errors.

Service and plan policies come from trusted server configuration. Entitlement content comes from Sui BCS and object ownership metadata. User-supplied owner, expiry, price, receipt, and plan metadata are not authorization facts.

## Keys and deployment

suigate does not request seeds/private keys, export/import wallet keys, or operate a custodial developer wallet. The CLI delegates to the existing Sui CLI configuration. It does not initialize missing wallet configuration or silently switch environments/accounts. Protect that configuration and review deployment previews.

The default target is testnet. Mainnet requires explicit project configuration and a matching active chain plus interactive confirmation. Deployment comprises separate transactions; gas and partial successful work are not rolled back as one unit.

Keep the deployment journal. Unknown transaction outcomes are reconciled by digest rather than blindly repeated. Never clear an unresolved pending record or stale lock without verifying the process and chain outcome. Treat a reused package ID as trusted code you selected; source compatibility is not a security audit.

## Discovery and agents

Discovery documents and HTML links are untrusted service data, not spending authorization. Agents must verify the intended origin/network/contracts and apply explicit approval or pre-authorized spending limits. Manifest prices are display snapshots; build against fresh on-chain terms. A 403 must not trigger an automatic purchase, and a 503 must not be interpreted as missing payment. Discovery is opt-in outside the examples and never bypasses wallet proof or entitlement verification.

## Authentication and caches

Challenge messages are random, expiring, context-bound and single-use. Only atomically consuming the nonce prevents concurrent replay. Challenge IDs alone are not credentials. Use TLS and redact proof headers from logs.

Default challenge storage is process-local. Multi-worker/serverless deployments need a shared atomic store; eventual-consistency-only deletion is insufficient. Rate-limit public challenge issuance. No production distributed store is bundled.

Discovery caches must not outlive entitlement expiry. Authorization bypasses them and rereads revocation/ownership. Do not add HTTP/CDN caching or application `use cache`/`unstable_cache` around authorization. Proxy presence checks are not a substitute for route/data-layer verification.

## Payments and lifecycle

Atomicity covers the suigate purchase/renewal PTB, not an arbitrary off-chain workflow or multi-transaction deployment. Gas may still be charged on failure. Entitlements are unique and non-transferable. Renewal requires an expected revision; reconcile uncertain renewals before constructing another one. Revocation is permanent in this version.

A signature authenticating software access is not approval of an arbitrary application payload. Perform resource-level authorization using the verified wallet address. Long-lived streams/jobs may need additional expiry rechecks.

## Sponsorship and production readiness

A sponsor signs final transaction bytes only after enforcing its own policy. Never place sponsor keys in `VITE_*` or `NEXT_PUBLIC_*` variables. A compromised sponsor integration, RPC, developer wallet, or application server is outside the guarantees of a frontend paywall.

The repository provides tests and examples, not a claim of an independent security audit. Live testnet deployment/purchase validation and operational reviews are separate release steps. No automatic recurring billing, background renewal, reusable login session, hosted sponsor, or production multi-region nonce service is included.
