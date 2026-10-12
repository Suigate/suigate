import { describe, expect, it, vi } from "vitest";
import {
  formatPrice,
  selectGas,
  assertCurrency,
  loadCurrency,
} from "../src/internal/checkout.js";
import { COIN, fixture, plan } from "./fixtures.js";

describe("checkout helpers", () => {
  it("formats base units exactly without floating point loss", () => {
    expect(formatPrice(9_007_199_254_740_993n, 6)).toBe("9007199254.740993");
    expect(formatPrice(1n, 9)).toBe("0.000000001");
    expect(formatPrice(1_500_000_000n, 9)).toBe("1.5");
    expect(formatPrice(20n, 0)).toBe("20");
    expect(formatPrice(20n, null)).toBe("20 base units");
    expect(() => formatPrice(1n, -1)).toThrow("Invalid currency decimals");
  });

  it("selects configured sponsorship but honors explicit user gas", () => {
    const f = fixture({ sponsored: true });
    expect(selectGas("auto")).toBe("user");
    expect(selectGas("auto", f.sponsorship)).toBe("sponsored");
    expect(selectGas("user", f.sponsorship)).toBe("user");
    expect(() => selectGas("sponsored")).toThrow("not configured");
  });

  it("only accepts the on-chain coin type, not a symbol or alternative token", () => {
    expect(() => assertCurrency("0x2::sui::SUI", COIN)).not.toThrow();
    expect(() => assertCurrency("SUI", COIN)).toThrow("only accepts");
    expect(() => assertCurrency("0x999::sui::SUI", COIN)).toThrow(
      "only accepts",
    );
  });

  it("uses explicit base units when currency metadata cannot be loaded", async () => {
    const f = fixture();
    vi.mocked(f.client.core.getCoinMetadata).mockRejectedValueOnce(
      new Error("metadata unavailable"),
    );
    const currency = await loadCurrency(f.client, plan);
    expect(currency.decimals).toBeNull();
    expect(currency.formattedPrice).toBe("1500000000 base units");
    expect(currency.coinType).toBe(COIN);
  });
});
