# React

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). Wallet approval and automated tests are not a human audit.

For browser agents, pass a matching `discoveryUrl` to the paywall and add a `rel="describedby"` link to initial HTML. This exposes machine-readable policy and authentication instructions without requesting any signature or payment. See [agent discovery](agent-discovery.md).

Use `@mysten/dapp-kit-react`, not the legacy dApp Kit package or a custom wallet adapter. Mount `SuigateProvider` inside the official `DAppKitProvider`:

```tsx
<DAppKitProvider dAppKit={kit}>
  <SuigateProvider
    deployment={{ network: "testnet", packageId, chainIdentifier }}
  >
    <SuigatePaywall serviceId={serviceId} plan="pro" />
  </SuigateProvider>
</DAppKitProvider>
```

Create `kit` with official `createDAppKit` and `SuiGrpcClient`; see `examples/shared/checkout.tsx`. Supply the expected full genesis chain identifier. Set `typeOrigin` when using an upgraded call package.

The paywall loads authoritative Service/Plan terms, displays price and currency, selects user/sponsored gas, asks the wallet to sign, executes the transaction, waits for indexing, and verifies the entitlement before success. A changed quote requires another explicit approval. Wallet/configuration changes before submission prevent the old checkout from executing.

Customize `labels`, `className`, `style`, `renderCurrency`, `renderLoading`, `renderSuccess`, `renderError`, `onSuccess`, `onError`, and `onStateChange`. Currency selection is limited to the plan's actual on-chain coin type; an arbitrary token cannot buy a single-currency plan.

`useSuigatePurchase` exposes the headless React flow. Framework-independent custom UIs can use `SuigateClient.purchaseEntitlement` and `renewEntitlement`; those core methods return unsigned builders.

Unknown submission/confirmation results retain the computed digest and show a status-check action, not a second payment button. This pending state is in memory and is not persisted across a page reload. Reconcile uncertain transactions rather than repeating payment.

## Example flow

The Vite React and Next.js examples share checkout UI. They read `/api/config`, allow manual configuration, connect via the official wallet button, select Pro, purchase, and display the confirmed entitlement. Returning customers can check an existing entitlement without buying another.

The final API button requests `/api/challenge`, signs its exact message, and calls `/api/pro` with a proof encoded by core. This is a separate authentication signature, not another payment. Wallet/configuration changes abort that flow. Each API call needs a new one-use proof.

For an expired existing entitlement, use core's revision-bound renewal builder; the default paywall is purchase UI and does not implement a renewal checkout or automatic recurring billing.
