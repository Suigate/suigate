# Gas, sponsorship, and supported currencies

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). Do not entrust sponsor keys or real funds to this release.

## Gas strategies

Core and React accept `auto`, `user`, or `sponsored`.

- `auto` chooses a configured sponsor; otherwise the customer pays SUI network fees.
- `user` leaves normal SDK gas resolution in place.
- `sponsored` requires a configured sponsor. The customer still pays the plan price; the sponsor pays transaction gas.

Entitlement transactions create/mutate objects and invoke Move functions. They **do not qualify for the narrow gasless stablecoin-transfer path**. A stablecoin balance does not replace the need for SUI gas or a sponsor. The UI distinguishes payment-currency shortage from missing network-fee funds.

A failed transaction can charge gas even though payment and entitlement changes roll back. CLI deployments always use the existing developer wallet for gas; deployment sponsorship is not implemented.

## Sponsorship

Pass `sponsorship` to `SuigateProvider`:

```tsx
<SuigateProvider
  deployment={deployment}
  sponsorship={{
    sponsor: { address: sponsorAddress },
    sign: async ({ bytes, sender, network, serviceId }) => {
      return requestSponsorSignature({ bytes, sender, network, serviceId });
    },
  }}
>
  <SuigatePaywall serviceId={serviceId} plan="pro" gas="sponsored" />
</SuigateProvider>
```

`requestSponsorSignature` is your integration, not a provided hosted service. Keep the sponsor's key server-side. Validate final transaction bytes, sender, chain, allowed package/functions, Service, amounts, gas budget, expiration, and abuse limits before signing. Do not trust request metadata instead of inspecting the bytes.

Customer and sponsor sign the same final bytes. The React package checks both signatures and refuses wallet-modified bytes. Sponsored SUI payments use customer-funded payment coins, never the sponsor's gas coin. Sponsorship rejection does not silently fall back to charging the customer gas.

The Vite example supports optional public sponsor-address/endpoint variables. No sponsor server or private key is bundled.

## Currencies

The Move model is generic over `Coin<T>`. A plan accepts **one exact on-chain coin type**, with price in its base units. SUI is the CLI/example default (`0x2::sui::SUI`, nine decimal places). A one-SUI price is `1000000000` base units.

Other ordinary Sui coin types can be configured in their own plans if the deployed Move/Payment Kit path supports that coin's transfer rules. Regulated currencies may impose additional restrictions. There is no claim that every stablecoin or currency implementation is supported, and no built-in whitelist of unofficial token IDs.

Always verify the full network-specific type identifier; symbols can be spoofed. Metadata is for display only. If decimals cannot be loaded, display exact base units. There are no automatic swaps, exchange-rate calculations, or arbitrary frontend currency overrides for a single-currency plan.
