# CLI

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). Automated tests are not a human audit.

The workspace package is named `suigate` and exposes a `suigate` binary. Build the checkout before using `npx --no-install suigate`. Ordinary `npx suigate` is the intended installed/released interface; this repository does not publish npm packages automatically.

## init

```sh
npx --no-install suigate init
npx --no-install suigate init --package-id 0xYOUR_EXISTING_SUIGATE_PACKAGE
```

Detects package manager from the project/package-manager declaration and lockfiles, framework dependencies, Move configuration, existing Sui client configuration, active address, environment, and chain. It does not install application dependencies or rewrite application source.

Default configuration:

```json
{
  "version": 1,
  "network": "testnet",
  "registryName": "sg-generated-unique-name",
  "gasBudgetMist": "200000000",
  "plans": [
    {
      "key": "pro",
      "price": "1000000000",
      "coinType": "0x2::sui::SUI",
      "durationMs": "2592000000"
    }
  ],
  "project": { "packageManager": "npm", "frameworks": ["react"] }
}
```

Amounts/durations are positive u64 decimal **strings**, not floating-point amounts. The default is 1 SUI and 30 days. Prices must be positive. Each plan accepts one explicit Move coin type. An optional `packageId` reuses a published protocol; `typeOrigin` can preserve its original type identity after upgrades.

`init` refuses to overwrite an existing configuration. It defaults to testnet even if the active wallet uses a different network. `--network mainnet` is an explicit initialization choice, not an automatic wallet/network switch. Add `.suigate/` to your project's ignore file.

## deploy

```sh
npx --no-install suigate deploy --dry-run
npx --no-install suigate deploy --acknowledge-unaudited
```

The CLI requires an existing Sui CLI configuration and verifies the active chain against the project's pinned network identity. The read RPC must agree with the Sui CLI chain. It shows developer, environment, network, package/source digest, Service, desired plans, and maximum gas budgets before asking for `deploy testnet` or `deploy mainnet`.

Without an existing package, it publishes the bundled Move sources. It then creates the developer-owned Service and creates missing plans. Existing live plans with different terms are rejected, not silently updated. `plans` is read-only; use deliberate Move administration to change terms.

Signing/submission use the existing Sui CLI wallet. The CLI never asks for or exports private keys. Transaction bytes are prepared unsigned and validated, then Sui produces a signed envelope without submitting it. The CLI checks the signed payload against the approved transaction, records the digest of the final signed bytes, and submits that exact envelope. Only a refreshed expiration nonce is tolerated; changed commands, inputs, gas settings or expiration bounds are rejected. Completion prints `SUIGATE_SERVICE_ID=...`, package ID, and full chain identifier.

`--dry-run` means **preview only**, not a protocol gas simulation. It never signs/submits, and it does not prove the wallet has sufficient gas. Real deployment is interactive; there is no implicit `--yes` mode.

## plans / status

```sh
npx --no-install suigate plans
npx --no-install suigate status
```

Read the deployed Service and paginated plan table through core, not from the local desired-plan list. Output includes network, Service, owner, recipient, prices, full currency types, durations in milliseconds, and availability flags. Currency metadata is display-only; unavailable metadata falls back to exact base units.

## Risk acknowledgement

Every CLI invocation prints the AI-generation/unaudited disclaimer to stderr, including help and read-only commands. Before preparing any new deployment transaction, `deploy` requires `--acknowledge-unaudited` in addition to its existing interactive wallet/network confirmation. `--dry-run` remains available without acknowledgement. A resume can query a pending digest without acknowledgement, but any subsequent new transaction still requires it. The flag does not change audit status or establish that funds/keys are safe; there is no `--audited` override.

## Configuration and recovery

- `--config PATH`: defaults to `./suigate.config.json`.
- `--sui PATH` or `SUI_BIN`: native Sui executable.
- `--sui-config PATH`: existing public client configuration file; never a key file.
- `SUIGATE_RPC_URL`: optional read-RPC override, kept in the environment rather than written into generated configuration.
- `.suigate/deployments/testnet.json` / `mainnet.json`: managed deployment journal and confirmed public IDs.

```sh
npx --no-install suigate deploy --resume --acknowledge-unaudited
```

If the CLI reports that a step's **preparation failed before signing/submission**, no transaction was submitted for that step. Fix the preparation issue and rerun `deploy` normally; do not use `--resume` unless the journal actually records a pending digest. Earlier confirmed deployment steps are retained. Native command diagnostics identify the operation and common failure categories, but withhold raw output to avoid leaking RPC credentials or other sensitive configuration.

Resume queries the recorded digest through the Sui Core API. It does not blindly resubmit an unknown transaction. Confirmed success is adopted before previewing remaining steps; a confirmed failure permits a new attempt after confirmation. A digest that is still unavailable remains unresolved.

If a process stopped after recording the digest but before submission, automatic recovery cannot prove it was never broadcast. Inspect the outcome independently before any manual journal repair. Do not delete pending state merely to make a command succeed. A stale `deploy.lock` also requires checking that no deployment is still running before removal. Retain the journal across retries and upgrades.

### Legacy publication digest recovery

Earlier CLI builds submitted through `sui client serialized-tx`, which reconstructs the transaction. With address-balance gas, that can refresh the expiration nonce and produce a different digest from the one originally recorded. A missing recorded digest therefore does not mean publication failed.

If a successful publication has been independently identified for the developer wallet, use its confirmed digest explicitly:

```sh
npx --no-install suigate deploy --resume --recover-publish CONFIRMED_PUBLISH_DIGEST --acknowledge-unaudited
```

This recovery is limited to legacy pending publications. It verifies the configured chain and sender, requires unchanged recorded Move sources, recompiles the package, and compares the entire publish/upgrade-capability-transfer transaction kind with the confirmed transaction. An unrelated package, recipient or sender is rejected. The previous digest is retained in history. No publication is repeated; remaining Service/plan transactions still require normal confirmation.

Do not guess a digest, delete the journal, or use another wallet's publication. New deployments journal the final signed digest and do not need this legacy repair path. Unknown execution results still require reconciliation.

The examples are testnet-only even though the CLI requires explicit confirmation for either supported network.
