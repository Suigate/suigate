# Local development

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). Automated tests are not a human audit.

## Toolchains

Use Node 24 LTS (tested with 24.13.0) and npm workspaces. `.nvmrc` pins that tested version: with nvm installed, run `nvm install` followed by `nvm use`. Other Node version managers are fine if they select Node 24. Node 23 is outside a transitive dependency's supported engine range.

## Minimal setup and ordinary tests

From the repository root:

```sh
npm ci --ignore-scripts
npm test
```

`npm run test` is the same command. It needs no Sui CLI, wallet, keys, `.env`, faucet funds, deployed Service, or running localnet/testnet. The root `pretest` automatically regenerates packaged notices, builds core/framework/CLI dependencies and typechecks tests; you do not need to know or copy its internal command chain. The CLI build copies Move source assets but does not invoke Sui or publish anything.

For the complete TypeScript/package/example build check:

```sh
npm run check
```

Both commands are safe to run without configuring a blockchain. They do not submit transactions or run a faucet. Dependency installation needs npm access or a populated cache; that is not a Sui network requirement. Backend tests create loopback HTTP servers, so the test environment must permit local port binding.

Build order is core, framework packages, CLI, then examples. The CLI build packages the canonical Move manifest, lockfile and sources; do not manually maintain a second contract copy. The root lockfile is authoritative for workspace installs.

If Node 24 is not active:

```sh
npm exec --yes --package=node@24.13.0 --call 'npm run check'
```

Use the normal Node 24 shell for `npx --no-install suigate ...`; avoid nesting `npx` inside another `npm exec --call`, which can inherit conflicting npm options.

`npm run notices` regenerates every package's `README.md`/`NOTICE.md` from the canonical risk notice and root disclaimer. Root builds run this step automatically. Do not edit generated notices by hand. The install hook is print-only and runs without requiring a prior TypeScript build; `--ignore-scripts` intentionally suppresses it, and npm may hide dependency output unless foreground scripts are enabled.

## Commands

```sh
npm run dev:express
npm run dev
npm run dev:nextjs
npm run typecheck -w suigate
npm test -w suigate
npm pack -w suigate --dry-run
```

React/Vite proxies `/api` to the Express example on port 3001. Next.js runs its own same-origin API on port 3000. Both UIs use the shared example checkout component and actual testnet configuration. Without deployment configuration, Free works while protected endpoints fail closed.

The example loaders look for `.suigate/deployments/testnet.json` in ancestor project directories. Server environment variables can override deployment configuration. `SUIGATE_RPC_URL` is server-side; `VITE_SUI_RPC_URL` is public frontend configuration. Never put signing keys in frontend variables.

## Tests

Core tests verify BCS parsing, signatures, challenge replay protection, lifecycle and transaction construction. Backend tests use real signatures and mocked chain state; Express tests use loopback HTTP. React tests use the official dApp Kit/Wallet Standard interfaces with a test wallet and mocked Sui responses. CLI tests cover detection, cancellation, chain mismatch, journal recovery, and deployment orchestration without live transactions.

`npm run check` builds all packages/examples and runs the TypeScript suites. It does not deploy to mainnet/testnet. Builds can emit upstream library or bundle-size warnings without failing.

## Move VM tests — no running Sui network

Install the official `testnet-v1.81.0` Sui CLI and put `sui` on PATH. Payment Kit is pinned to commit `34464974de849975872cc67f02715a98db3112ba`. Unlike TypeScript tests, these commands require the native Sui toolchain:

```sh
npm run build:move
npm run lint:move
npm run test:move
```

Or run both the TypeScript and Move checks:

```sh
npm run check:all
```

These run the compiler/linter/Move VM, not a localnet daemon or public-network deployment. `--build-env testnet` selects dependency/address resolution; it does not send testnet transactions. First runs may fetch the pinned Git dependencies. They do not require funded wallets or a faucet. Native Sui may create its own tool caches; suigate does not automate wallet creation for these commands.

To check mainnet dependency resolution without deploying:

```sh
sui move build --path move/suigate --build-env mainnet --warnings-are-errors
```

Do not hand-edit `Move.lock`. Move `expected_failure` tests prove aborts, not post-abort committed state. To inspect rollback, use a disposable isolated local network with independent configuration and test wallets. Never run those transactions against a public environment accidentally.

## Running-chain integration and live testnet

A one-command disposable-localnet end-to-end harness is **not currently shipped**. The automated TypeScript and Move VM suites are not a substitute for inspecting committed transaction effects on a running chain. A future localnet harness should create isolated temporary node/configuration/test-wallet state, deploy local dependencies, exercise the flow and clean up without touching a developer's existing wallet. It must remain separate from `npm test`.

Public Sui testnet already exists; developers do not start a testnet themselves. To try a real browser purchase they must install/configure the Sui CLI, explicitly select testnet, obtain testnet funds, deploy a Service/plans, and approve the customer wallet transaction. The suigate CLI automates configuration/deployment with preview, risk acknowledgement and confirmation, but deliberately does not silently create wallets, request faucet funds, or spend funds as part of tests. Follow [testnet deployment](testnet-deployment.md).

The end-user CLI targets mainnet/testnet, not arbitrary localnet Payment Kit deployments. Localnet protocol testing requires publishing local dependency packages and wiring their temporary addresses explicitly; it is not the same as `suigate deploy --dry-run`.
