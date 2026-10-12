import { SuigateError } from "./errors.js";
import { positiveMilliseconds, timestamp } from "./internal/validation.js";
import type { Entitlement } from "./types.js";

export interface CachedEntitlement {
  readonly entitlement: Entitlement;
  readonly validUntil: bigint;
}

export interface EntitlementCache {
  get(key: string): Promise<CachedEntitlement | null>;
  set(key: string, value: CachedEntitlement): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryEntitlementCache implements EntitlementCache {
  readonly #entries = new Map<string, CachedEntitlement>();
  readonly #now: () => number;
  readonly #maxEntries: number;

  constructor(options: { maxEntries?: number; now?: () => number } = {}) {
    this.#maxEntries = positiveMilliseconds(
      options.maxEntries ?? 1_000,
      "Cache capacity",
      100_000,
    );
    this.#now = options.now ?? Date.now;
  }

  async get(key: string): Promise<CachedEntitlement | null> {
    const value = this.#entries.get(key);
    if (!value) return null;
    if (BigInt(timestamp(this.#now)) >= value.validUntil) {
      this.#entries.delete(key);
      return null;
    }
    return value;
  }

  async set(key: string, value: CachedEntitlement): Promise<void> {
    if (value.validUntil > value.entitlement.expiresAt) {
      throw new SuigateError(
        "INVALID_ARGUMENT",
        "Cache lifetime cannot exceed entitlement expiry",
      );
    }
    this.#entries.delete(key);
    if (value.validUntil <= BigInt(timestamp(this.#now))) return;
    if (this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(
      key,
      Object.freeze({
        entitlement: Object.freeze({ ...value.entitlement }),
        validUntil: value.validUntil,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }
}
