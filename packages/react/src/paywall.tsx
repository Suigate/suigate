import { useEffect, useRef, type CSSProperties } from "react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { discoveryPath, RISK_NOTICE, SOFTWARE_RISK } from "@suigate/core";
import { assertCurrency } from "./internal/checkout.js";
import { paywallError } from "./errors.js";
import { useSuigatePurchase } from "./use-purchase.js";
import { useSuigate } from "./provider.js";
import type { PurchasePhase, SuigatePaywallProps } from "./types.js";

const rootStyle: CSSProperties = {
  border: "1px solid #d5d9e0",
  borderRadius: 12,
  padding: 24,
  maxWidth: 420,
  fontFamily: "system-ui, sans-serif",
  background: "var(--suigate-background, #fff)",
  color: "var(--suigate-color, #172033)",
};
const buttonStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid currentColor",
  font: "inherit",
  cursor: "pointer",
};
const progress: Partial<Record<PurchasePhase, string>> = {
  loading: "Loading plan…",
  preparing: "Preparing your purchase…",
  "awaiting-wallet": "Approve the purchase in your wallet.",
  sponsoring: "Requesting network-fee coverage…",
  submitting: "Submitting your purchase…",
  confirming: "Confirming your entitlement…",
};

// 100% AI-generated and unaudited: keep the risk notice visible; wallet approval and passing tests do not certify safety.
export function SuigatePaywall(props: SuigatePaywallProps) {
  const { network } = useSuigate();
  const discoveryUrl =
    props.discoveryUrl === undefined
      ? undefined
      : discoveryPath(props.discoveryUrl);
  const checkout = useSuigatePurchase(props);
  const { state, account, isBusy } = checkout;
  const callbacks = useRef(props);
  callbacks.current = props;
  const reported = useRef({ result: state.result, error: state.error });
  useEffect(() => {
    callbacks.current.onStateChange?.(state);
    if (state.result && reported.current.result !== state.result) {
      reported.current.result = state.result;
      callbacks.current.onSuccess?.(state.result);
    }
    if (state.error && reported.current.error !== state.error) {
      reported.current.error = state.error;
      callbacks.current.onError?.(state.error);
    }
  }, [state]);
  const labels = {
    title: `Unlock ${props.plan}`,
    connect: "Connect wallet",
    purchase: "Purchase access",
    retry: "Try again",
    checkStatus: "Check purchase status",
    refresh: "Reload plan",
    success: "Access purchased",
    ...props.labels,
  };
  const selectCurrency = (coinType: string) => {
    try {
      assertCurrency(coinType, state.plan!.coinType);
      props.onCoinTypeChange?.(coinType);
    } catch (error) {
      props.onError?.(paywallError(error));
    }
  };
  return (
    <section
      className={props.className}
      style={{ ...rootStyle, ...props.style }}
      aria-label={labels.title}
      data-suigate-state={state.phase}
      data-suigate-service={props.serviceId}
      data-suigate-plan={props.plan}
      data-suigate-discovery={discoveryUrl}
    >
      <h2 style={{ marginTop: 0 }}>{labels.title}</h2>
      <aside
        role="note"
        aria-label="Unaudited software warning"
        data-suigate-human-audit={SOFTWARE_RISK.humanAuditStatus}
        data-suigate-ai-generated="true"
        style={{
          border: "2px solid currentColor",
          padding: 12,
          marginBottom: 16,
        }}
      >
        <strong>100% AI-generated — unaudited</strong>
        <p>{RISK_NOTICE}</p>
      </aside>
      <p data-suigate-network>Sui {network}</p>
      {discoveryUrl && (
        <a href={discoveryUrl} rel="describedby" type="application/json">
          Programmatic access
        </a>
      )}
      {state.currency && (
        <>
          <p style={{ fontSize: "1.4rem", fontWeight: 650 }}>
            {state.currency.formattedPrice} {state.currency.symbol}
          </p>
          {props.renderCurrency ? (
            props.renderCurrency({
              currency: state.currency,
              acceptedCoinTypes: [state.currency.coinType],
              select: selectCurrency,
            })
          ) : (
            <p>
              Accepted currency: <strong>{state.currency.symbol}</strong>
            </p>
          )}
          <details>
            <summary>Currency details</summary>
            <code style={{ overflowWrap: "anywhere", fontSize: "0.75rem" }}>
              {state.currency.coinType}
            </code>
          </details>
          <p>
            {state.gasMode === "sponsored"
              ? "Network fee covered by the service, subject to sponsor approval."
              : "A small SUI network fee applies."}
          </p>
        </>
      )}
      <div data-suigate-wallet style={{ margin: "16px 0" }}>
        <ConnectButton>
          <span>{labels.connect}</span>
        </ConnectButton>
      </div>
      {state.plan && !state.plan.purchasesEnabled && (
        <p role="status">This plan is not accepting new purchases.</p>
      )}
      {progress[state.phase] && (
        <div role="status" aria-live="polite">
          {props.renderLoading
            ? props.renderLoading(state.phase)
            : progress[state.phase]}
        </div>
      )}
      {state.error && (
        <div role="alert">
          {props.renderError
            ? props.renderError(state.error)
            : state.error.message}
        </div>
      )}
      {state.phase === "success" && state.result ? (
        <div role="status" aria-live="polite">
          {props.renderSuccess ? (
            props.renderSuccess(state.result)
          ) : (
            <>
              <h3>{labels.success}</h3>
              <p>Your entitlement is confirmed on Sui.</p>
              <code style={{ overflowWrap: "anywhere", fontSize: "0.75rem" }}>
                {state.result.entitlement.id}
              </code>
            </>
          )}
        </div>
      ) : state.phase === "unconfirmed" ? (
        <button
          type="button"
          style={buttonStyle}
          disabled={isBusy}
          onClick={() => void checkout.checkStatus()}
        >
          {labels.checkStatus}
        </button>
      ) : state.plan ? (
        <button
          type="button"
          style={{ ...buttonStyle, opacity: checkout.canPurchase ? 1 : 0.6 }}
          disabled={!checkout.canPurchase}
          onClick={() => void checkout.purchase()}
        >
          {state.phase === "error" ? labels.retry : labels.purchase}
        </button>
      ) : state.phase === "error" ? (
        <button type="button" style={buttonStyle} onClick={checkout.refresh}>
          {labels.refresh}
        </button>
      ) : null}
      {!account && state.plan && <p>Connect a Sui wallet to continue.</p>}
      {state.digest && (
        <details style={{ marginTop: 12 }}>
          <summary>Transaction</summary>
          <code style={{ overflowWrap: "anywhere" }}>{state.digest}</code>
        </details>
      )}
    </section>
  );
}
