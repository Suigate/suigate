# Testnet deployment and full example

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). Use isolated test-only wallets; testnet does not protect a reused mainnet key.

This walkthrough performs real testnet operations only when you explicitly approve deployment and wallet transactions. Testnet assets are not mainnet assets.

**This setup is not needed for `npm test` or `npm run check`.** Those commands run with mocked chain state and do not need wallets, funds, or a running Sui network. Public Sui testnet already exists; the steps below connect to and deploy on it, rather than starting a new testnet. For Move VM tests, only the native Sui CLI is additionally required; see [local development](local-development.md).

## 1. Install Sui and prepare the developer wallet

The [README live-Testnet setup](../README.md#try-the-live-testnet-example) contains the full installation, PATH troubleshooting, wallet and faucet steps. These are manual prerequisites for live use, not actions performed by automated tests.

Verify installation first:

```sh
sui --version
```

If unavailable, install `suiup` using the [official Sui installation guide](https://www.docs.sui.io/getting-started/onboarding/sui-install), then install/select the tested version:

```sh
suiup install sui@testnet-1.81.0
suiup default set sui@testnet-1.81.0
sui --version
```

A compatible newer 1.x release is also accepted. Ensure the binary directory is on PATH; `SUI_BIN` / `--sui` only select the executable for suigate commands, not for direct shell invocations of `sui`.

Use a test-only developer wallet. If no Sui client configuration exists, run `sui client` yourself in a trusted terminal and follow the [official setup instructions](https://www.docs.sui.io/getting-started/onboarding/configure-sui-client). Native Sui may display recovery material: store it securely and never share it with suigate, the repository, or an AI. Do not delete existing wallet configuration to start this walkthrough.

List environments with `sui client envs`. Only if `testnet` is missing, add it:

```sh
sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
```

Select and verify the environment and developer address:

```sh
sui client switch --env testnet
sui client active-env
sui client active-address
sui client chain-identifier --format base58
```

Expect chain identifier `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`. Stop and investigate a mismatch before funding/deploying; do not rely only on the environment alias.

After checking the active address and Testnet chain, request gas and inspect the balance:

```sh
sui client faucet
sui client balance
```

If faucet requests are unavailable or rate-limited, follow the [official faucet instructions](https://www.docs.sui.io/getting-started/onboarding/get-coins). The browser customer wallet also needs its own testnet funds: the plan price plus network fees unless sponsorship is configured. Developer and customer wallets can be different. Funding the developer CLI address does not fund a different browser wallet.

## 2. Initialize and review

From the built repository root:

```sh
npx --no-install suigate init
npx --no-install suigate deploy --dry-run
```

Review `suigate.config.json`. The default Pro plan costs 1 SUI and lasts 30 days. `gasBudgetMist` defaults to 200,000,000 MIST per deployment transaction (0.2 SUI maximum, not an estimate of the actual fee). Up to three separate transactions are required.

To reuse a protocol package instead of publishing a copy, initialize with `--package-id` pointing to your trusted suigate package. No official suigate deployment ID is fabricated or automatically selected.

## 3. Deploy

```sh
npx --no-install suigate deploy --acknowledge-unaudited
```

Check the printed developer address, testnet environment, full genesis identifier, package/source, registry name, plan terms, and transaction count. Enter `deploy testnet` only if they are correct.

The native Sui CLI signs the prepared transactions with the existing developer wallet. The tool records digests, checks results, verifies the Service owner, creates the configured plans, and prints package, chain and Service values including:

```text
SUIGATE_SERVICE_ID=0x...
```

Confirmed IDs are stored in `.suigate/deployments/testnet.json`. Keep that journal and add `.suigate/` to ignore rules. If an outcome is uncertain, use `deploy --resume`; do not restart publication blindly.

```sh
npx --no-install suigate status
npx --no-install suigate plans
```

Verify the owner and payment recipient are the expected developer wallet and that the Pro price/currency/duration match your intended terms.

## 4. React + Express

In two terminals from the repository root:

```sh
npm run dev:express
```

```sh
npm run dev
```

Open the printed Vite URL. The frontend loads public configuration from `/api/config`, proxied to Express. Select Free to call `GET /api/free` without a wallet.

Connect a Sui testnet wallet, select Pro, and approve the purchase. The paywall waits for chain confirmation and verifies the resulting entitlement. Then choose **Authenticate and call Pro API**, approve the separate personal-message challenge, and observe the protected response from `GET /api/pro`.

A repeated proof is rejected. Each click obtains a fresh challenge. Returning customers can use **Check existing entitlement** rather than buying another. Expired entitlements require the core renewal flow; a confirmed renewal is visible to backend verification without a stale authorization cache.

## 5. Next.js alternative

```sh
npm run dev:nextjs
```

Open the printed local URL. It uses the same shared checkout UI and its own challenge, Free, Pro and public configuration Route Handlers. The demo keeps a shared gate in a single Node process. For serverless/multiple processes, replace memory nonce storage with a shared atomic store before deployment.

## Troubleshooting

- **CLI not found:** put `sui` on PATH or set `SUI_BIN` / pass `--sui`.
- **No configuration:** point `--sui-config` at an existing `client.yaml`; do not pass a private key or keystore file.
- **Chain mismatch:** inspect and switch the native Sui environment explicitly. suigate does not change it for you.
- **Insufficient SUI:** fund the relevant developer/customer testnet wallet. A stablecoin payment does not make entitlement writes gasless.
- **Configuration unavailable:** finish deployment or set the documented server environment variables; restart the examples if needed.
- **Uncertain transaction:** retain the journal and query with `deploy --resume`. A digest not yet found is not proof that nothing executed.
- **Authentication 401:** get a fresh challenge and sign its exact message with the intended wallet.
- **Authorization 403:** check current ownership, Service, plan, expiry and revocation. An object ID is not a login credential.

Automated tests do not execute this public-network walkthrough. A wallet-approved live deployment and purchase are separate validation steps.
