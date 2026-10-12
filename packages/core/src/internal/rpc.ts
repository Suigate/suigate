import { ObjectError } from "@mysten/sui/client";
import { SuigateError } from "../errors.js";

export function isMissingObject(error: unknown): boolean {
  return (
    error instanceof ObjectError &&
    (error.reason === "notFound" || error.reason === "deleted")
  );
}

export async function rpc<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof SuigateError) throw cause;
    if (isMissingObject(cause))
      throw new SuigateError("NOT_FOUND", "Sui object was not found", {
        cause,
      });
    throw new SuigateError(
      "RPC_ERROR",
      "Unable to read authoritative Sui state",
      { cause },
    );
  }
}
