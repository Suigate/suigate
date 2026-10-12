import { SuigateError } from "@suigate/core";

export type PaywallErrorCode =
  | "WALLET_REQUIRED"
  | "WALLET_REJECTED"
  | "WALLET_CHANGED"
  | "WRONG_NETWORK"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_GAS"
  | "SPONSOR_UNAVAILABLE"
  | "UNSUPPORTED_GASLESS"
  | "UNSUPPORTED_CURRENCY"
  | "QUOTE_CHANGED"
  | "INVALID_SIGNATURE"
  | "TRANSACTION_FAILED"
  | "UNCONFIRMED"
  | "LOAD_FAILED"
  | "PURCHASE_FAILED";

export class PaywallError extends Error {
  constructor(
    public readonly code: PaywallErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PaywallError";
  }
}

export function paywallError(
  error: unknown,
  fallback: PaywallErrorCode = "PURCHASE_FAILED",
): PaywallError {
  if (error instanceof PaywallError) return error;
  if (error instanceof SuigateError) {
    if (error.code === "WRONG_NETWORK")
      return new PaywallError(
        "WRONG_NETWORK",
        "Switch your wallet to the configured Sui network.",
        { cause: error },
      );
    if (error.code === "WRONG_COIN")
      return new PaywallError(
        "UNSUPPORTED_CURRENCY",
        "This plan does not accept the selected currency.",
        { cause: error },
      );
    return new PaywallError(fallback, error.message, { cause: error });
  }
  const message = error instanceof Error ? error.message : "";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  if (code === 4001 || /reject|cancel|declin/i.test(message)) {
    return new PaywallError(
      "WALLET_REJECTED",
      "Wallet approval was declined. No payment was submitted by this checkout.",
      { cause: error },
    );
  }
  if (
    /insufficient.*(gas|sui)|gas.*(insufficient|balance|too low)|No valid gas coins/i.test(
      message,
    )
  ) {
    return new PaywallError(
      "INSUFFICIENT_GAS",
      "Your wallet needs more SUI for the network fee. Add SUI or use a sponsored checkout.",
      { cause: error },
    );
  }
  if (/insufficient.*balance/i.test(message))
    return new PaywallError(
      "INSUFFICIENT_FUNDS",
      "Your wallet does not have enough of the accepted currency.",
      { cause: error },
    );
  return new PaywallError(
    fallback,
    fallback === "LOAD_FAILED"
      ? "Unable to load this plan. Check the service configuration and try again."
      : "The purchase could not be completed. Please try again.",
    { cause: error },
  );
}
