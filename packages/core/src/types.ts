import type { SuiClientTypes } from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";

export type SuiObject = Pick<
  SuiClientTypes.Object<{ content: true }>,
  "objectId" | "version" | "digest" | "type" | "owner" | "content"
>;

export interface TableReference {
  readonly id: string;
  readonly size: bigint;
}

export interface Service {
  readonly id: string;
  readonly objectVersion: string;
  readonly owner: string;
  readonly adminCapId: string;
  readonly paymentRecipient: string;
  readonly registryId: string;
  readonly version: bigint;
  readonly plans: TableReference;
  readonly revocations: TableReference;
}

export interface Plan {
  readonly serviceId: string;
  readonly key: string;
  readonly price: bigint;
  readonly coinType: string;
  readonly durationMs: bigint;
  readonly version: bigint;
  readonly purchasesEnabled: boolean;
  readonly renewalsEnabled: boolean;
}

export interface Entitlement {
  readonly id: string;
  readonly objectVersion: string;
  readonly owner: string;
  readonly serviceId: string;
  readonly plan: string;
  readonly holder: string;
  readonly issuedAt: bigint;
  readonly expiresAt: bigint;
  readonly revision: bigint;
  readonly planVersion: bigint;
}

export type GasStrategy = "auto" | "user" | "sponsored";

export interface Sponsor {
  readonly address: string;
  readonly gasPayment?: readonly {
    objectId: string;
    version: string;
    digest: string;
  }[];
  readonly budget?: bigint;
}

export interface GasSelection {
  readonly mode: "user" | "sponsored";
  readonly owner: string;
}

export interface EntitlementQuery {
  readonly serviceId: string;
  readonly plan: string;
  readonly owner: string;
  readonly entitlementId?: string;
}

export interface PurchaseOptions {
  readonly serviceId: string;
  readonly plan: string;
  readonly sender: string;
  readonly coinType?: string;
  readonly gas?: GasStrategy;
  readonly nonce?: string;
}

export interface RenewalOptions extends PurchaseOptions {
  readonly entitlementId?: string;
  readonly expectedRevision: bigint;
}

export interface EntitlementTransaction {
  readonly transaction: Transaction;
  readonly entitlementId: string;
  readonly gas: GasSelection;
  readonly quote: {
    readonly nonce: string;
    readonly service: Service;
    readonly plan: Plan;
    readonly deadlineMs: bigint;
    readonly expectedRevision?: bigint;
  };
}
