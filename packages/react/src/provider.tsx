import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useCurrentClient,
  useCurrentNetwork,
  type DAppKit,
} from "@mysten/dapp-kit-react";
import { SuigateClient } from "@suigate/core";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { PaywallError, paywallError } from "./errors.js";
import type { Deployment, Sponsorship } from "./types.js";

interface ContextValue {
  core: SuigateClient | null;
  client: ClientWithCoreApi;
  network: string;
  deployment: Deployment;
  sponsorship: Sponsorship | undefined;
  error: PaywallError | null;
}

const SuigateContext = createContext<ContextValue | null>(null);

export function SuigateProvider({
  deployment,
  sponsorship,
  children,
}: {
  deployment: Deployment;
  sponsorship?: Sponsorship;
  children: ReactNode;
}) {
  const client = useCurrentClient<DAppKit<string[]>>();
  const network = useCurrentNetwork<DAppKit<string[]>>();
  const gasPaymentKey = JSON.stringify(sponsorship?.sponsor.gasPayment);
  const session = useMemo<Pick<ContextValue, "core" | "error">>(() => {
    if (network !== deployment.network || client.network !== network) {
      return {
        core: null,
        error: new PaywallError(
          "WRONG_NETWORK",
          `Switch your wallet to Sui ${deployment.network}.`,
        ),
      };
    }
    try {
      return {
        core: new SuigateClient({
          client,
          packageId: deployment.packageId,
          chainIdentifier: deployment.chainIdentifier,
          ...(deployment.typeOrigin
            ? { typeOrigin: deployment.typeOrigin }
            : {}),
          ...(sponsorship
            ? {
                sponsor: {
                  ...sponsorship.sponsor,
                  ...(sponsorship.sponsor.gasPayment
                    ? {
                        gasPayment: sponsorship.sponsor.gasPayment.map(
                          (coin) => ({ ...coin }),
                        ),
                      }
                    : {}),
                },
              }
            : {}),
        }),
        error: null,
      };
    } catch (error) {
      return { core: null, error: paywallError(error, "LOAD_FAILED") };
    }
  }, [
    client,
    network,
    deployment.network,
    deployment.packageId,
    deployment.chainIdentifier,
    deployment.typeOrigin,
    sponsorship?.sponsor.address,
    sponsorship?.sponsor.budget,
    gasPaymentKey,
  ]);
  const value = useMemo(
    () => ({ ...session, client, network, deployment, sponsorship }),
    [session, client, network, deployment, sponsorship],
  );
  return (
    <SuigateContext.Provider value={value}>{children}</SuigateContext.Provider>
  );
}

export function useSuigate() {
  const context = useContext(SuigateContext);
  if (!context)
    throw new Error(
      "Wrap SuigatePaywall in SuigateProvider inside the official DAppKitProvider.",
    );
  return context;
}
