import { toBase64 } from "@mysten/sui/utils";
import { SUI_NETWORKS } from "@suigate/core";
import type { Sponsorship } from "@suigate/react";
import { ExampleCheckout } from "../../shared/checkout.js";

function configuredSponsorship(): Sponsorship | undefined {
  const address = import.meta.env.VITE_SUIGATE_SPONSOR_ADDRESS;
  const endpoint = import.meta.env.VITE_SUIGATE_SPONSOR_URL;
  if (!address || !endpoint) return undefined;
  return {
    sponsor: { address },
    async sign({ bytes, ...request }) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, transaction: toBase64(bytes) }),
      });
      if (!response.ok) throw new Error("Sponsorship request failed");
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        !("signature" in result) ||
        typeof result.signature !== "string"
      )
        throw new Error("Sponsor response must contain a signature");
      return { signature: result.signature };
    },
  };
}
const sponsorship = configuredSponsorship();
export function App() {
  return (
    <ExampleCheckout
      rpcUrl={import.meta.env.VITE_SUI_RPC_URL || SUI_NETWORKS.testnet.rpcUrl}
      initial={{
        packageId: import.meta.env.VITE_SUIGATE_PACKAGE_ID || "",
        serviceId: import.meta.env.VITE_SUIGATE_SERVICE_ID || "",
        chainIdentifier:
          import.meta.env.VITE_SUIGATE_CHAIN_IDENTIFIER ||
          SUI_NETWORKS.testnet.chainIdentifier,
        plan: import.meta.env.VITE_SUIGATE_PLAN || "pro",
      }}
      {...(sponsorship ? { sponsorship } : {})}
    />
  );
}
