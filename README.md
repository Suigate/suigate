# suigate

> **WARNING --- 100% AI-generated, experimental, and NOT independently
> human-audited.**
>
> Code, tests, and documentation may be incorrect or hallucinated. Loss
> of funds, private keys, credentials, data, access, or other assets is
> possible. **Do not use this unaudited release with real funds,
> valuable keys, or production systems.** Read
> [DISCLAIMER.md](DISCLAIMER.md) before installing, deploying, or
> signing. Passing tests is not an audit.

## Can you add crypto payments to a website or API in a few minutes, with a few lines of code?

That is the question behind **suigate**.

A developer already has a product: a website, a SaaS tool, an API, or a
feature they want to put behind a paid plan. Could they accept crypto
without building the payment infrastructure, access-control system,
wallet-verification flow, and checkout UI from scratch?

Suigate explores that idea on Sui. A customer pays, receives an on-chain
entitlement, and proves control of the wallet that owns it. The
application checks that entitlement before granting access.

The goal is a small integration at the surface, with explicit on-chain
rules underneath.

```tsx
<SuigatePaywall serviceId={serviceId} plan="pro" />
```

And on the server:

```ts
import { suiGate } from "@suigate/express";

app.use(
  "/api",
  suiGate({
    serviceId: process.env.SUIGATE_SERVICE_ID!,
    plan: "pro",
  }),
);
```

Those snippets show the intended integration shape. The implementation
is experimental and unaudited; read the warnings and limitations below
before running anything.

## What happens when a customer pays?

```text
Customer wallet
  → approves one purchase transaction
  → Payment Kit sends the exact payment to the configured recipient
  → suigate creates a customer-owned Entitlement in that same transaction
  → customer signs a short-lived authentication challenge
  → backend verifies the signature and current Sui entitlement state
  → application grants access
```

**Payment receipts are not entitlements. Object IDs are not passwords.**
The entitlement is non-transferable and renewable. The backend checks
ownership, Service, plan, expiry, and revocation directly through core.

Evidence that a payment happened is not, by
itself, authorization to use an application. Suigate models access as an
entitlement and verifies the wallet's control of it.

## What is included?

---

Package Responsibility

---

`@suigate/core` Parsing, live verification,
unsigned purchase/renewal builders,
challenges, gas and cache
abstractions

`@suigate/react` Official dApp Kit wallet
connection, checkout, confirmation,
and entitlement results

`@suigate/express` Challenge issuance and Express
request authorization

`@suigate/nextjs` Route Handler wrappers and
server-side authorization

`suigate` `init`, `deploy`, `plans`, and
`status` CLI commands
-----------------------------------------------------------------------

## Audit and installation status

Current status: `aiGenerated: true`, `humanAuditStatus: "not-audited"`,
with no human audit report or audited revision.

A print-only postinstall notice is included, but package managers may
hide or disable it. Read the packaged `DISCLAIMER.md` even when installing
with `--ignore-scripts`; do not enable lifecycle scripts merely to view
a warning. `--acknowledge-unaudited` acknowledges deployment risk, not
safety. See [DISCLAIMER.md](DISCLAIMER.md) for the human-review
requirements before any unaudited warning may be retired.

## Try the automated tests --- no Sui setup required

You can start by inspecting the code and running the automated
TypeScript tests. This first step does not require a wallet, blockchain
process, or testnet funds.

Use **Node 24** and npm. The repository's `.nvmrc` selects the tested
Node version. If you use nvm, run `nvm install` and `nvm use` first;
otherwise install Node 24 using your preferred method.

```sh
npm ci --ignore-scripts
npm test
```

`npm run test` is equivalent to `npm test`. It generates required
notices, builds local library/CLI dependencies, typechecks their tests,
and runs the TypeScript suites. **No Sui CLI, wallet, keys, faucet
funds, deployment configuration, or running blockchain is needed.**
Tests use mocked chain state and local HTTP where appropriate. No
separate build is required before this command.

---

Command What it verifies Additional setup

---

`npm test` Core, adapters, React, Node 24 + installed npm
CLI and example tests dependencies

`npm run check` All of the above plus Same; no Sui setup
production  
example/package builds

`npm run test:move` Move VM unit tests Sui CLI 1.81.x on PATH;
no running chain or
funds

`npm run check:all` TypeScript checks plus Node/npm and Sui CLI
Move build, lint and VM
tests
-----------------------------------------------------------------------

Dependency installation requires access to npm or a populated cache.
Move builds may download pinned Git dependencies. This is separate from
connecting to a running Sui network. See [local
development](docs/local-development.md) for details.

## Try the live Testnet example

The browser examples are a separate, optional step. Unlike the automated
tests above, they use **actual Sui Testnet** and require deployed IDs
and funded testnet wallets for purchases. These instructions do not
publish suigate npm packages.

Use **Node 24**, npm, and **Sui CLI 1.81.x or a compatible newer 1.x**
release. Public Sui Testnet already exists; you do not need to start a
blockchain node. The following installation, wallet, and funding steps
are only for live deployment/purchases, not `npm test`.

### 1. Install and verify the native Sui CLI

First check your terminal:

```sh
sui --version
```

If that reports `command not found`, follow the
[official Sui installation guide](https://www.docs.sui.io/getting-started/onboarding/sui-install)
to install `suiup`, the recommended version manager. With `suiup`
installed, select the version tested by this repository:

```sh
suiup install sui@testnet-1.81.0
suiup default set sui@testnet-1.81.0
```

Alternatively, on macOS with Homebrew installed:

```sh
brew install sui
```

Homebrew may install a different version; verify it meets the version
requirement above. Open a new terminal and check again:

```sh
sui --version
```

If the binary is still not found, check `command -v sui` on macOS/Linux.
The default `suiup` binary directory is `~/.local/bin`; if that is where
yours was installed, add it to your current shell's PATH:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Add the same PATH setting to your shell profile if needed for future
terminals. For a separately installed binary, suigate also accepts
`SUI_BIN` or `--sui /absolute/path/to/sui`. Those settings affect suigate
only; the native `sui client` commands below still assume `sui` is on
PATH. Windows users should follow the platform-specific steps in the
official installation guide.

### 2. Prepare a test-only developer wallet and select Testnet

**Do not use a wallet holding valuable mainnet assets.** If you have no
Sui client configuration, explicitly initialize it in your own trusted
terminal using the [official client setup guide](https://www.docs.sui.io/getting-started/onboarding/configure-sui-client):

```sh
sui client
```

On a fresh setup, native Sui can create a wallet and display its recovery
phrase. Store that securely; never paste it into suigate configuration,
this repository, screenshots, or an AI chat. If a configuration already
exists, do not delete it just to follow this walkthrough. Choose an
appropriate test-only wallet using the official Sui tooling. suigate
itself does not create/import wallets or ask for private keys.

Inspect the configured environments:

```sh
sui client envs
```

Only if the `testnet` environment is missing, add it:

```sh
sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
```

Then explicitly select it and verify the address and chain:

```sh
sui client switch --env testnet
sui client active-env
sui client active-address
sui client chain-identifier --format base58
```

The active address is the developer wallet that will own the Service
and receive payments by default. For this release, the expected Testnet
chain identifier is `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`.
**Stop if it differs**; an environment merely named `testnet` is not
sufficient. Investigate the RPC/network configuration before proceeding.

### 3. Fund the developer wallet with testnet SUI

After confirming the intended address and Testnet chain above:

```sh
sui client faucet
sui client balance
```

The faucet command requests testnet SUI for the active developer wallet.
If it is rate-limited or unavailable, follow the
[official faucet instructions](https://www.docs.sui.io/getting-started/onboarding/get-coins)
and retry as directed. Do not send real SUI to solve a testnet funding
problem.

The default deployment may submit up to three transactions, each with a
maximum gas budget of **0.2 SUI**; the actual fee is determined by Sui.
Keep enough testnet SUI available for the successive transactions.

The **customer's browser wallet also needs testnet funds**: the default
Pro price is **1 SUI**, plus gas unless sponsorship is configured. It can
be a different wallet from the developer's CLI wallet. Funding the CLI
wallet does not automatically fund the browser wallet.

### 4. Configure plans and deploy

The workspace supplies the local `suigate` executable; do not accidentally
fetch an unrelated registry package before building it. From the
repository root, with Node 24 active:

```sh
npm ci --ignore-scripts
npm run build
npx --no-install suigate init
```

If `suigate.config.json` already exists, skip `init`; it refuses to
overwrite your configuration. Edit its `plans` array before deployment,
then preview and approve the intended transactions:

```sh
npx --no-install suigate deploy --dry-run
npx --no-install suigate deploy --acknowledge-unaudited
npx --no-install suigate status
npx --no-install suigate plans
```

If an earlier `init` printed `Sui CLI could not be started`, initialization
may still have succeeded. Install/fix Sui as above and continue with the
existing configuration; that warning is not a reason to delete it.

The release-facing commands are `npx suigate init`,
`npx suigate deploy`, `npx suigate plans`, and `npx suigate status`. In
this checkout, `--no-install` guarantees use of the locally built CLI.

`init` detects the package manager, framework, existing Sui
configuration, and active address. It creates `suigate.config.json`
without overwriting an existing file. The default is **Testnet**, with a
**Pro plan costing 1 SUI for 30 days**. Edit those terms before
deploying.

`deploy` shows the active developer address, exact chain,
package/source, Service, plans, and gas budgets. It requires an
interactive confirmation such as `deploy testnet`. It delegates signing
to the existing Sui CLI and never imports, exports, or requests private
keys.

With no package configured, deployment publishes the bundled Move
package, creates a Service, and creates plans. Those are separate
transactions. The developer wallet owns the Service and its
administration capability and is the initial payment recipient.
Completion prints:

```text
SUIGATE_SERVICE_ID=0x...
```

See [testnet deployment](docs/testnet-deployment.md) for wallet/network
prerequisites and recovery.

## Run the examples

The examples automatically find the CLI's
`.suigate/deployments/testnet.json` from the repository or accept
explicit server environment configuration.

### React + Express

Run these in separate terminals:

```sh
npm run dev:express
npm run dev
```

Open the Vite URL printed in the terminal. Vite proxies `/api` to
Express on port 3001. `GET /api/free` is public; `GET /api/pro` requires
a fresh signed challenge and valid entitlement.

### Next.js

Alternatively, run the full-stack Next.js example:

```sh
npm run dev:nextjs
```

Open the local URL printed by Next.js (port 3000). It provides the same
Free/Pro flow using Route Handlers.

Connect a testnet wallet, select Pro, approve the purchase, receive the
confirmed entitlement, then sign a **separate one-use authentication
message** to call the Pro API. A returning customer can use **Check
existing entitlement**. No payment or deployment occurs automatically on
page load.

## Integrate a paywall

Inside the official dApp Kit and suigate providers:

```tsx
<SuigatePaywall serviceId={serviceId} plan="pro" />
```

Then protect an API route. Supply trusted server deployment/RPC/audience
configuration through options or environment (see [backend integrations](docs/backends.md) for full config options):

```ts
import { suiGate } from "@suigate/express";

app.use(
  "/api",
  suiGate({
    serviceId: process.env.SUIGATE_SERVICE_ID!,
    plan: "pro",
  }),
);
```

This Express mount exposes `POST /api/.suigate/challenge`. See [backend
integrations](docs/backends.md) and [wallet
authentication](docs/wallet-authentication.md) for the complete proof
flow; an entitlement ID alone never authorizes a request.

## Designed to be inspectable by agents, too

The examples advertise a versioned machine-readable policy through
initial HTML links and protected HTTP responses. It describes the
required Service/plan, live display terms, challenge/proof protocol,
purchase/renewal builders, gas, and safety constraints.
`GET /api/.suigate/discovery` links to generated OpenAPI 3.1 at
`/api/.suigate/openapi`.

Library integrations enable this explicitly with
`discovery: { path, challengePath, openApiPath }`; React supports
`discoveryUrl`. Discovery is informational, not permission to spend.
Existing HTTP behavior remains `401`/`403`/`503`, with structured next
actions when enabled. See [agent discovery](docs/agent-discovery.md).

## Documentation

- [Architecture, Payment Kit boundary, and Move
  model](docs/architecture.md)
- [CLI and project configuration](docs/cli.md)
- [React and headless checkout](docs/react.md)
- [Express and Next.js](docs/backends.md)
- [Wallet authentication and replay
  protection](docs/wallet-authentication.md)
- [Agent discovery and OpenAPI](docs/agent-discovery.md)
- [Gas, sponsorship, and supported
  currencies](docs/gas-and-currencies.md)
- [Security and deployment constraints](docs/security.md)
- [Local development and testing](docs/local-development.md)
- [Testnet deployment walkthrough](docs/testnet-deployment.md)

## Verify the project

Run:

```sh
npm run check
```

Automated TypeScript tests use real test signatures with mocked Sui
state. Express tests also use loopback HTTP. Builds do not publish
packages or submit payments. Move tests and isolated-localnet testing
are separate from real testnet purchases.

The browser examples use **actual Testnet**. They require deployed IDs
and funded testnet wallets for purchases. They are not Mainnet examples.

## License

The suigate code is licensed under the [MIT License](LICENSE.md). Third-party dependencies retain their own licenses. The AI-generation and unaudited-risk disclosures in [DISCLAIMER.md](DISCLAIMER.md) remain applicable; an MIT license is not a security audit.

## Current limits and safety boundaries

This is an experimental implementation, not an audited payment or
authorization system. No recurring billing, automatic token conversion,
reusable login-session layer, hosted sponsor, or production distributed
nonce store is included. Add an atomic shared `ChallengeStore` when
using multiple server processes; Redis is optional. Backend
authorization deliberately bypasses the discovery cache.

Please read [DISCLAIMER.md](DISCLAIMER.md)
before installing or deploying. Do not use real funds, valuable keys, or
production systems until the code has received an independent human
security review and the reviewed revision is clearly identified.
