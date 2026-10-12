import type { ClientWithCoreApi } from "@mysten/sui/client";
import { isValidPersonalMessageSignature } from "@mysten/sui/verify";
import { SuigateError } from "./errors.js";
import { rpc } from "./internal/rpc.js";
import {
  address,
  positiveMilliseconds,
  timestamp,
} from "./internal/validation.js";

export interface ChallengeContext {
  readonly audience: string;
  readonly chainIdentifier: string;
  readonly address: string;
  readonly serviceId: string;
  readonly binding: string;
  readonly statement?: string;
}

export interface Challenge extends ChallengeContext {
  readonly version: 1;
  readonly id: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly message: string;
}

export interface ChallengeStore {
  put(challenge: Challenge): Promise<void>;
  get(id: string): Promise<Challenge | null>;
  consumeIfUnexpired(id: string, nowMs: number): Promise<boolean>;
}

export class MemoryChallengeStore implements ChallengeStore {
  readonly #entries = new Map<string, Challenge>();
  readonly #maxEntries: number;

  constructor(options: { maxEntries?: number } = {}) {
    this.#maxEntries = positiveMilliseconds(
      options.maxEntries ?? 10_000,
      "Challenge capacity",
      100_000,
    );
  }

  async put(challenge: Challenge): Promise<void> {
    if (this.#entries.has(challenge.id))
      throw new SuigateError("INVALID_ARGUMENT", "Challenge ID already exists");
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt <= challenge.issuedAt) this.#entries.delete(id);
    }
    if (this.#entries.size >= this.#maxEntries) {
      throw new SuigateError(
        "CHALLENGE_STORE_FULL",
        "Challenge store capacity reached",
      );
    }
    this.#entries.set(challenge.id, Object.freeze({ ...challenge }));
  }

  async get(id: string): Promise<Challenge | null> {
    return this.#entries.get(id) ?? null;
  }

  async consumeIfUnexpired(id: string, nowMs: number): Promise<boolean> {
    const challenge = this.#entries.get(id);
    if (!challenge) return false;
    this.#entries.delete(id);
    return nowMs >= challenge.issuedAt && nowMs < challenge.expiresAt;
  }
}

const defaultStore = new MemoryChallengeStore();

function text(value: string, name: string, maxLength = 256): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > maxLength ||
    /[^\x21-\x7e]/.test(value)
  ) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      `${name} must be a bounded, nonempty printable value`,
    );
  }
  return value;
}

export function normalizeChallengeContext(
  input: ChallengeContext,
): ChallengeContext {
  if (
    input.statement !== undefined &&
    (typeof input.statement !== "string" ||
      !input.statement.length ||
      input.statement.length > 4096 ||
      /[^\x20-\x7e]/.test(input.statement))
  ) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Statement must contain 1–4096 printable ASCII characters",
    );
  }
  let audience: string;
  try {
    const url = new URL(text(input.audience, "Audience"));
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Expected an HTTP origin");
    }
    audience = url.origin;
  } catch (cause) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Audience must be an HTTP(S) origin",
      { cause },
    );
  }
  return {
    audience,
    chainIdentifier: text(input.chainIdentifier, "Chain identifier", 128),
    address: address(input.address),
    serviceId: address(input.serviceId),
    binding: text(input.binding, "Request binding"),
    ...(input.statement === undefined ? {} : { statement: input.statement }),
  };
}

function message(challenge: Omit<Challenge, "message">): string {
  return [
    "Sign in to suigate (v1)",
    "This signature authenticates your wallet. It does not authorize a transaction.",
    `Origin: ${challenge.audience}`,
    `Chain: ${challenge.chainIdentifier}`,
    `Wallet: ${challenge.address}`,
    `Service: ${challenge.serviceId}`,
    `Request: ${challenge.binding}`,
    ...(challenge.statement === undefined
      ? []
      : [`Statement: ${challenge.statement}`]),
    `Nonce: ${challenge.id}`,
    `Issued at: ${challenge.issuedAt}`,
    `Expires at: ${challenge.expiresAt}`,
  ].join("\n");
}

export async function createChallenge(
  input: ChallengeContext,
  options: { store?: ChallengeStore; ttlMs?: number; now?: () => number } = {},
): Promise<Challenge> {
  const issuedAt = timestamp(options.now ?? Date.now);
  const ttl = positiveMilliseconds(options.ttlMs ?? 300_000, "Challenge TTL");
  if (!Number.isSafeInteger(issuedAt + ttl))
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Challenge expiration overflows",
    );
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const fields = {
    ...normalizeChallengeContext(input),
    version: 1 as const,
    id: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ),
    issuedAt,
    expiresAt: issuedAt + ttl,
  };
  const challenge = Object.freeze({ ...fields, message: message(fields) });
  await (options.store ?? defaultStore).put(challenge);
  return challenge;
}

export async function verifySignature(options: {
  message: Uint8Array;
  signature: string;
  address: string;
  client?: ClientWithCoreApi;
}): Promise<string> {
  const expectedAddress = address(options.address);
  if (
    !(options.message instanceof Uint8Array) ||
    options.message.length > 8_192 ||
    typeof options.signature !== "string" ||
    options.signature.length > 32_768
  ) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Invalid message or signature size",
    );
  }
  const valid = await rpc(() =>
    isValidPersonalMessageSignature(options.message, options.signature, {
      address: expectedAddress,
      ...(options.client ? { client: options.client } : {}),
    }),
  );
  if (!valid)
    throw new SuigateError(
      "INVALID_SIGNATURE",
      "Signature does not authenticate this wallet and message",
    );
  return expectedAddress;
}

export async function verifyChallenge(
  input: { id: string; signature: string; expected: ChallengeContext },
  options: {
    store?: ChallengeStore;
    client?: ClientWithCoreApi;
    now?: () => number;
  } = {},
): Promise<{
  readonly address: string;
  readonly serviceId: string;
  readonly chainIdentifier: string;
}> {
  if (!/^[a-f0-9]{64}$/.test(input.id))
    throw new SuigateError("INVALID_ARGUMENT", "Invalid challenge ID");
  const store = options.store ?? defaultStore;
  const stored = await store.get(input.id);
  if (!stored)
    throw new SuigateError(
      "CHALLENGE_NOT_FOUND",
      "Challenge is missing or already consumed",
    );
  const challenge = Object.freeze({ ...stored });
  const now = options.now ?? Date.now;
  const currentTime = timestamp(now);
  if (currentTime >= challenge.expiresAt)
    throw new SuigateError("CHALLENGE_EXPIRED", "Challenge has expired");
  const expected = normalizeChallengeContext(input.expected);
  if (
    challenge.version !== 1 ||
    challenge.id !== input.id ||
    challenge.message !== message(challenge) ||
    challenge.statement !== expected.statement ||
    !Number.isSafeInteger(challenge.issuedAt) ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.issuedAt > currentTime ||
    challenge.expiresAt <= challenge.issuedAt ||
    challenge.expiresAt - challenge.issuedAt > 300_000 ||
    Object.entries(expected).some(
      ([key, value]) => challenge[key as keyof ChallengeContext] !== value,
    )
  ) {
    throw new SuigateError(
      "CHALLENGE_MISMATCH",
      "Challenge does not match the expected authentication context",
    );
  }
  if (options.client) {
    const { chainIdentifier } = await rpc(() =>
      options.client!.core.getChainIdentifier(),
    );
    if (chainIdentifier !== expected.chainIdentifier)
      throw new SuigateError(
        "WRONG_NETWORK",
        "Signature verifier is on a different chain",
      );
  }
  await verifySignature({
    message: new TextEncoder().encode(challenge.message),
    signature: input.signature,
    address: expected.address,
    ...(options.client ? { client: options.client } : {}),
  });
  if (!(await store.consumeIfUnexpired(challenge.id, timestamp(now)))) {
    throw new SuigateError(
      "CHALLENGE_CONSUMED",
      "Challenge was consumed concurrently or expired during verification",
    );
  }
  return Object.freeze({
    address: expected.address,
    serviceId: expected.serviceId,
    chainIdentifier: expected.chainIdentifier,
  });
}
