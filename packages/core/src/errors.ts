export type SuigateErrorCode =
  | "INVALID_ARGUMENT"
  | "RPC_ERROR"
  | "WRONG_NETWORK"
  | "NOT_FOUND"
  | "INVALID_OBJECT"
  | "WRONG_TYPE"
  | "WRONG_SERVICE"
  | "WRONG_PLAN"
  | "WRONG_OWNER"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "REVOKED"
  | "PLAN_UNAVAILABLE"
  | "WRONG_COIN"
  | "ALREADY_ENTITLED"
  | "DUPLICATE_PAYMENT"
  | "STALE_REVISION"
  | "SPONSOR_REQUIRED"
  | "INVALID_SIGNATURE"
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_MISMATCH"
  | "CHALLENGE_CONSUMED"
  | "CHALLENGE_STORE_FULL";

export class SuigateError extends Error {
  constructor(
    public readonly code: SuigateErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SuigateError";
  }
}
