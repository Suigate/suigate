import type { CSSProperties, ReactNode } from "react";
import type {
  Entitlement,
  GasStrategy,
  Plan,
  Service,
  Sponsor,
} from "@suigate/core";
import type { PaywallError } from "./errors.js";

export interface Deployment {
  readonly network: "mainnet" | "testnet";
  readonly packageId: string;
  readonly chainIdentifier: string;
  readonly typeOrigin?: string;
}

export interface Sponsorship {
  readonly sponsor: Sponsor;
  readonly sign: (request: {
    bytes: Uint8Array;
    sender: string;
    network: string;
    serviceId: string;
    entitlementId: string;
    nonce: string;
  }) => Promise<{ signature: string }>;
}

export interface Currency {
  readonly coinType: string;
  readonly symbol: string;
  readonly decimals: number | null;
  readonly formattedPrice: string;
}

export interface PurchaseResult {
  readonly digest: string;
  readonly entitlement: Entitlement;
}

export type PurchasePhase =
  | "loading"
  | "ready"
  | "preparing"
  | "awaiting-wallet"
  | "sponsoring"
  | "submitting"
  | "confirming"
  | "unconfirmed"
  | "success"
  | "error";

export interface PurchaseState {
  readonly phase: PurchasePhase;
  readonly service: Service | null;
  readonly plan: Plan | null;
  readonly currency: Currency | null;
  readonly gasMode: "user" | "sponsored";
  readonly result: PurchaseResult | null;
  readonly error: PaywallError | null;
  readonly digest: string | null;
}

export interface PurchaseInput {
  readonly serviceId: string;
  readonly plan: string;
  readonly coinType?: string;
  readonly gas?: GasStrategy;
}

export interface PaywallLabels {
  title: string;
  connect: string;
  purchase: string;
  retry: string;
  checkStatus: string;
  refresh: string;
  success: string;
}

export interface SuigatePaywallProps extends PurchaseInput {
  readonly discoveryUrl?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly labels?: Partial<PaywallLabels>;
  readonly onSuccess?: (result: PurchaseResult) => void;
  readonly onError?: (error: PaywallError) => void;
  readonly onStateChange?: (state: PurchaseState) => void;
  readonly onCoinTypeChange?: (coinType: string) => void;
  readonly renderCurrency?: (options: {
    currency: Currency;
    acceptedCoinTypes: readonly string[];
    select: (coinType: string) => void;
  }) => ReactNode;
  readonly renderLoading?: (phase: PurchasePhase) => ReactNode;
  readonly renderSuccess?: (result: PurchaseResult) => ReactNode;
  readonly renderError?: (error: PaywallError) => ReactNode;
}
