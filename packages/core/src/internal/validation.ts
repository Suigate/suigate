import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import { SuigateError } from "../errors.js";

export const U64_MAX = (1n << 64n) - 1n;

export function address(value: string): string {
  if (typeof value !== "string" || !/^(?:0x)?[a-fA-F0-9]{1,64}$/.test(value)) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Expected a hexadecimal Sui address",
    );
  }
  return normalizeSuiAddress(value);
}

export function coinType(value: string): string {
  try {
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      value.includes("@")
    ) {
      throw new Error("Expected an explicit Move type");
    }
    const type = normalizeStructTag(value);
    if (!type.includes("::")) throw new Error("Expected a coin type");
    return type;
  } catch (cause) {
    throw new SuigateError("INVALID_ARGUMENT", "Invalid coin type", { cause });
  }
}

export function ascii(value: string, name: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > maxLength ||
    /[^\x00-\x7f]/.test(value)
  ) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      `${name} must contain 1–${maxLength} ASCII bytes`,
    );
  }
  return value;
}

export function planKey(value: string): string {
  return ascii(value, "Plan key", 64);
}

export function paymentNonce(
  value: string = globalThis.crypto.randomUUID(),
): string {
  return ascii(value, "Payment nonce", 36);
}

export function positiveMilliseconds(
  value: number,
  name: string,
  max = 300_000,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      `${name} must be an integer between 1 and ${max}`,
    );
  }
  return value;
}

export function timestamp(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Clock must return non-negative integer milliseconds",
    );
  }
  return value;
}

export function u64(value: bigint, name: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) {
    throw new SuigateError("INVALID_ARGUMENT", `${name} must be a u64 bigint`);
  }
  return value;
}
