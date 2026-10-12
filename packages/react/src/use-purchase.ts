import { useEffect, useRef, useState } from "react";
import {
  useDAppKit,
  useWalletConnection,
  type DAppKit,
} from "@mysten/dapp-kit-react";
import { PaywallError, paywallError } from "./errors.js";
import { useSuigate } from "./provider.js";
import {
  assertCurrency,
  checkFunds,
  confirmationError,
  confirmPurchase,
  loadCurrency,
  sameQuote,
  selectGas,
  signPurchase,
  type PendingPurchase,
} from "./internal/checkout.js";
import type { PurchaseInput, PurchaseState } from "./types.js";

const INITIAL: PurchaseState = {
  phase: "loading",
  service: null,
  plan: null,
  currency: null,
  gasMode: "user",
  result: null,
  error: null,
  digest: null,
};

export function useSuigatePurchase(input: PurchaseInput) {
  const context = useSuigate();
  const wallet = useDAppKit<DAppKit<string[]>>();
  const connection = useWalletConnection<DAppKit<string[]>>();
  const account = connection.isConnected ? connection.account : null;
  const gas = input.gas ?? "auto";
  const identity = JSON.stringify([
    context.deployment.network,
    context.deployment.chainIdentifier,
    context.deployment.packageId,
    context.deployment.typeOrigin,
    context.network,
    account?.address,
    input.serviceId,
    input.plan,
  ]);
  const scope = JSON.stringify([identity, gas, input.coinType]);
  const current = useRef({ scope, core: context.core, account });
  current.current = { scope, core: context.core, account };
  const mounted = useRef(true);
  const busy = useRef(false);
  const pending = useRef(new Map<string, PendingPurchase>());
  const nonces = useRef(new Map<string, string>());
  const [reload, setReload] = useState(0);
  const [stored, setStored] = useState({ scope, state: INITIAL });
  const state = stored.scope === scope ? stored.state : INITIAL;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function isCurrent() {
    return (
      mounted.current &&
      current.current.scope === scope &&
      current.current.core === context.core &&
      current.current.account === account
    );
  }

  function update(patch: Partial<PurchaseState>) {
    if (isCurrent())
      setStored((previous) => ({
        scope,
        state: {
          ...(previous.scope === scope ? previous.state : INITIAL),
          ...patch,
        },
      }));
  }

  function assertCurrent() {
    if (!isCurrent())
      throw new PaywallError(
        "WALLET_CHANGED",
        "The wallet or checkout configuration changed. Review the purchase again.",
      );
  }

  useEffect(() => {
    let cancelled = false;
    setStored({ scope, state: INITIAL });
    void (async () => {
      try {
        if (!context.core)
          throw (
            context.error ??
            new PaywallError("LOAD_FAILED", "Invalid suigate configuration.")
          );
        const gasMode = selectGas(gas, context.sponsorship);
        const [service, plan] = await Promise.all([
          context.core.getService(input.serviceId),
          context.core.getPlan({
            serviceId: input.serviceId,
            plan: input.plan,
          }),
        ]);
        const currency = await loadCurrency(context.client, plan);
        if (cancelled) return;
        const existing = pending.current.get(identity);
        setStored({
          scope,
          state: {
            ...INITIAL,
            service,
            plan,
            currency,
            gasMode,
            phase: existing ? "unconfirmed" : "ready",
            digest: existing?.digest ?? null,
            error: existing
              ? confirmationError(new Error("Confirmation pending"))
              : null,
          },
        });
        if (!existing) assertCurrency(input.coinType, plan.coinType);
      } catch (error) {
        if (!cancelled) {
          const existing = pending.current.get(identity);
          update(
            existing
              ? {
                  phase: "unconfirmed",
                  digest: existing.digest,
                  error: confirmationError(error),
                  service: existing.draft.quote.service,
                  plan: existing.draft.quote.plan,
                }
              : { phase: "error", error: paywallError(error, "LOAD_FAILED") },
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context.core, context.error, context.client, scope, reload]);

  async function finish(record: PendingPurchase) {
    if (!context.core) throw context.error;
    update({ phase: "confirming", error: null, digest: record.digest });
    const result = await confirmPurchase(context.core, context.client, record);
    pending.current.delete(identity);
    update({ phase: "success", result, error: null, digest: result.digest });
  }

  function failure(error: unknown) {
    const record = pending.current.get(identity);
    if (record) {
      const converted = confirmationError(error);
      if (converted.code === "TRANSACTION_FAILED") {
        pending.current.delete(identity);
        update({ phase: "error", error: converted, digest: record.digest });
      } else {
        update({
          phase: "unconfirmed",
          error: converted,
          digest: record.digest,
        });
      }
    } else {
      update({ phase: "error", error: paywallError(error) });
    }
  }

  async function purchase(): Promise<void> {
    if (
      busy.current ||
      pending.current.has(identity) ||
      state.phase === "success"
    )
      return;
    if (!account) {
      update({
        phase: "error",
        error: new PaywallError(
          "WALLET_REQUIRED",
          "Connect a Sui wallet to continue.",
        ),
      });
      return;
    }
    if (!context.core || !state.plan || !state.service) return;
    busy.current = true;
    update({ phase: "preparing", error: null, digest: null });
    try {
      const gasMode = selectGas(gas, context.sponsorship);
      assertCurrency(input.coinType, state.plan.coinType);
      const nonce = nonces.current.get(identity) ?? crypto.randomUUID();
      nonces.current.set(identity, nonce);
      const draft = await context.core.purchaseEntitlement({
        serviceId: input.serviceId,
        plan: input.plan,
        sender: account.address,
        gas,
        nonce,
        ...(input.coinType ? { coinType: input.coinType } : {}),
      });
      assertCurrent();
      if (!sameQuote(state.service, state.plan, draft)) {
        const currency = await loadCurrency(context.client, draft.quote.plan);
        update({
          service: draft.quote.service,
          plan: draft.quote.plan,
          currency,
        });
        throw new PaywallError(
          "QUOTE_CHANGED",
          "The plan or payment recipient changed. Review the updated details and approve again.",
        );
      }
      await checkFunds(
        context.client,
        account.address,
        draft.quote.plan,
        gasMode,
      );
      assertCurrent();
      const signed = await signPurchase({
        draft,
        client: context.client,
        wallet,
        account,
        network: context.network,
        sponsorship: context.sponsorship,
        assertCurrent,
        phase: (phase) => update({ phase }),
      });
      assertCurrent();
      pending.current.set(identity, {
        draft,
        digest: signed.digest,
        sender: signed.sender,
      });
      update({ phase: "submitting", digest: signed.digest });
      const executed = await context.client.core.executeTransaction({
        transaction: signed.bytes,
        signatures: signed.signatures,
      });
      if (executed.$kind === "FailedTransaction") {
        throw new PaywallError(
          "TRANSACTION_FAILED",
          "The transaction failed on Sui. Payment was rolled back; a network fee may still apply.",
        );
      }
      await finish(pending.current.get(identity)!);
    } catch (error) {
      failure(error);
    } finally {
      busy.current = false;
      if (mounted.current) setStored((previous) => ({ ...previous }));
    }
  }

  async function checkStatus(): Promise<void> {
    const record = pending.current.get(identity);
    if (!record || busy.current || !context.core) return;
    busy.current = true;
    try {
      await finish(record);
    } catch (error) {
      failure(error);
    } finally {
      busy.current = false;
      if (mounted.current) setStored((previous) => ({ ...previous }));
    }
  }

  const isBusy =
    busy.current ||
    [
      "loading",
      "preparing",
      "awaiting-wallet",
      "sponsoring",
      "submitting",
      "confirming",
    ].includes(state.phase);
  return {
    state,
    account,
    purchase,
    checkStatus,
    isBusy,
    canPurchase: Boolean(
      account &&
      context.core &&
      state.plan?.purchasesEnabled &&
      !isBusy &&
      (state.phase === "ready" || state.phase === "error") &&
      state.error?.code !== "UNSUPPORTED_CURRENCY" &&
      !pending.current.has(identity),
    ),
    refresh: () => {
      if (!busy.current) setReload((value) => value + 1);
    },
  };
}
