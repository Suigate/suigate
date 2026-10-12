import type { ClientWithCoreApi } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import {
  fromBase64,
  normalizeStructTag,
  normalizeSuiAddress,
  SUI_TYPE_ARG,
  toBase64,
} from "@mysten/sui/utils";
import { isValidTransactionSignature } from "@mysten/sui/verify";
import type { DAppKit, UiWalletAccount } from "@mysten/dapp-kit-react";
import type {
  EntitlementTransaction,
  GasStrategy,
  Plan,
  Service,
  SuigateClient,
} from "@suigate/core";
import { PaywallError, paywallError } from "../errors.js";
import type {
  Currency,
  PurchasePhase,
  PurchaseResult,
  Sponsorship,
} from "../types.js";

export function selectGas(
  gas: GasStrategy,
  sponsorship?: Sponsorship,
): "user" | "sponsored" {
  if (!["auto", "user", "sponsored"].includes(gas))
    throw new PaywallError(
      "UNSUPPORTED_GASLESS",
      "Entitlement purchases require a SUI network fee or a sponsor; stablecoin transfers alone can qualify for zero fees.",
    );
  if (gas === "sponsored" && !sponsorship)
    throw new PaywallError(
      "SPONSOR_UNAVAILABLE",
      "Fee sponsorship is not configured for this checkout.",
    );
  return gas === "sponsored" || (gas === "auto" && sponsorship)
    ? "sponsored"
    : "user";
}

export function assertCurrency(
  selected: string | undefined,
  accepted: string,
): void {
  if (selected === undefined) return;
  try {
    if (normalizeStructTag(selected) === normalizeStructTag(accepted)) return;
  } catch {}
  throw new PaywallError(
    "UNSUPPORTED_CURRENCY",
    "This plan only accepts its on-chain currency. Select the accepted currency or a different plan.",
  );
}

export function formatPrice(amount: bigint, decimals: number | null): string {
  if (decimals === null) return `${amount} base units`;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw new Error("Invalid currency decimals");
  if (!decimals) return amount.toString();
  const digits = amount.toString().padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}

export async function loadCurrency(
  client: ClientWithCoreApi,
  plan: Plan,
): Promise<Currency> {
  let symbol = "token";
  let decimals: number | null = null;
  try {
    const { coinMetadata } = await client.core.getCoinMetadata({
      coinType: plan.coinType,
    });
    if (
      coinMetadata &&
      Number.isInteger(coinMetadata.decimals) &&
      coinMetadata.decimals >= 0 &&
      coinMetadata.decimals <= 255
    ) {
      symbol = coinMetadata.symbol.slice(0, 32) || symbol;
      decimals = coinMetadata.decimals;
    }
  } catch {}
  return {
    coinType: plan.coinType,
    symbol,
    decimals,
    formattedPrice: formatPrice(plan.price, decimals),
  };
}

export function sameQuote(
  service: Service,
  plan: Plan,
  draft: EntitlementTransaction,
): boolean {
  return (
    service.id === draft.quote.service.id &&
    service.version === draft.quote.service.version &&
    service.paymentRecipient === draft.quote.service.paymentRecipient &&
    service.registryId === draft.quote.service.registryId &&
    plan.serviceId === draft.quote.plan.serviceId &&
    plan.key === draft.quote.plan.key &&
    plan.version === draft.quote.plan.version &&
    plan.price === draft.quote.plan.price &&
    plan.coinType === draft.quote.plan.coinType &&
    plan.durationMs === draft.quote.plan.durationMs
  );
}

export async function checkFunds(
  client: ClientWithCoreApi,
  sender: string,
  plan: Plan,
  gasMode: "user" | "sponsored",
): Promise<void> {
  const isSui =
    normalizeStructTag(plan.coinType) === normalizeStructTag(SUI_TYPE_ARG);
  const paymentRequest = client.core.getBalance({
    owner: sender,
    coinType: plan.coinType,
  });
  const [payment, sui] = await Promise.all([
    paymentRequest,
    gasMode === "sponsored"
      ? null
      : isSui
        ? paymentRequest
        : client.core.getBalance({ owner: sender, coinType: SUI_TYPE_ARG }),
  ]);
  if (BigInt(payment.balance.balance) < plan.price)
    throw new PaywallError(
      "INSUFFICIENT_FUNDS",
      "Your wallet does not have enough of the accepted currency to buy this plan.",
    );
  if (sui && BigInt(sui.balance.balance) <= (isSui ? plan.price : 0n)) {
    throw new PaywallError(
      "INSUFFICIENT_GAS",
      "Your wallet needs SUI for the network fee. Add SUI or use a sponsored checkout.",
    );
  }
}

export interface PendingPurchase {
  readonly digest: string;
  readonly draft: EntitlementTransaction;
  readonly sender: string;
}

export async function signPurchase(options: {
  draft: EntitlementTransaction;
  client: ClientWithCoreApi;
  wallet: Pick<DAppKit<string[]>, "signTransaction">;
  account: UiWalletAccount;
  network: string;
  sponsorship: Sponsorship | undefined;
  phase: (phase: PurchasePhase) => void;
  assertCurrent: () => void;
}): Promise<PendingPurchase & { bytes: Uint8Array; signatures: string[] }> {
  const {
    draft,
    client,
    wallet,
    account,
    network,
    sponsorship,
    phase,
    assertCurrent,
  } = options;
  const bytes = await draft.transaction.build({ client });
  const data = Transaction.from(bytes).getData();
  if (
    !data.gasData.price ||
    !data.gasData.budget ||
    BigInt(data.gasData.price) === 0n ||
    BigInt(data.gasData.budget) === 0n
  ) {
    throw new PaywallError(
      "UNSUPPORTED_GASLESS",
      "This purchase creates an entitlement and cannot use the gasless stablecoin-transfer path.",
    );
  }
  if (
    !data.sender ||
    normalizeSuiAddress(data.sender) !== normalizeSuiAddress(account.address) ||
    !data.gasData.owner ||
    normalizeSuiAddress(data.gasData.owner) !==
      normalizeSuiAddress(draft.gas.owner)
  ) {
    throw new PaywallError(
      "PURCHASE_FAILED",
      "The transaction sender or fee payer does not match this checkout.",
    );
  }
  const digest = await Transaction.from(bytes).getDigest();
  assertCurrent();
  phase("awaiting-wallet");
  const signed = await wallet.signTransaction({
    transaction: toBase64(bytes),
    account,
    network,
  });
  assertCurrent();
  const returned = fromBase64(signed.bytes);
  if (
    returned.length !== bytes.length ||
    !bytes.every((byte, i) => byte === returned[i]) ||
    !(await isValidTransactionSignature(bytes, signed.signature, {
      address: account.address,
      client,
    }))
  ) {
    throw new PaywallError(
      "INVALID_SIGNATURE",
      "The wallet did not sign the exact purchase transaction.",
    );
  }
  const signatures = [signed.signature];
  if (draft.gas.mode === "sponsored") {
    if (!sponsorship)
      throw new PaywallError(
        "SPONSOR_UNAVAILABLE",
        "The configured sponsor is unavailable.",
      );
    phase("sponsoring");
    try {
      const sponsored = await sponsorship.sign({
        bytes: bytes.slice(),
        sender: account.address,
        network,
        serviceId: draft.quote.service.id,
        entitlementId: draft.entitlementId,
        nonce: draft.quote.nonce,
      });
      assertCurrent();
      if (
        !(await isValidTransactionSignature(bytes, sponsored.signature, {
          address: sponsorship.sponsor.address,
          client,
        }))
      ) {
        throw new PaywallError(
          "INVALID_SIGNATURE",
          "The sponsor did not authorize this exact transaction.",
        );
      }
      signatures.push(sponsored.signature);
    } catch (error) {
      if (error instanceof PaywallError) throw error;
      throw new PaywallError(
        "SPONSOR_UNAVAILABLE",
        "Fee sponsorship is unavailable. No payment was submitted by this checkout.",
        { cause: error },
      );
    }
  }
  assertCurrent();
  return { digest, draft, sender: account.address, bytes, signatures };
}

export async function confirmPurchase(
  core: SuigateClient,
  client: ClientWithCoreApi,
  pending: PendingPurchase,
): Promise<PurchaseResult> {
  const result = await client.core.waitForTransaction({
    digest: pending.digest,
    include: { effects: true },
  });
  if (result.$kind === "FailedTransaction")
    throw new PaywallError(
      "TRANSACTION_FAILED",
      "The transaction failed on Sui. The payment and entitlement change were rolled back; network fees may still apply.",
    );
  if (
    result.Transaction.digest !== pending.digest ||
    !result.Transaction.effects?.changedObjects.some(
      (object) =>
        object.objectId === pending.draft.entitlementId &&
        object.idOperation === "Created",
    )
  )
    throw new PaywallError(
      "UNCONFIRMED",
      "The transaction has not provided the expected entitlement creation effect. Check its status before trying another payment.",
    );
  const entitlement = await core.verifyEntitlement({
    entitlementId: pending.draft.entitlementId,
    serviceId: pending.draft.quote.service.id,
    plan: pending.draft.quote.plan.key,
    owner: pending.sender,
  });
  return { digest: pending.digest, entitlement };
}

export function confirmationError(error: unknown): PaywallError {
  if (error instanceof PaywallError && error.code === "TRANSACTION_FAILED")
    return error;
  return new PaywallError(
    "UNCONFIRMED",
    "The purchase was submitted, but its entitlement could not yet be verified. Check status; do not pay again.",
    { cause: paywallError(error) },
  );
}
