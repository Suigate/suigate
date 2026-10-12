import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { SOFTWARE_RISK } from "./risk.js";
import { address } from "./internal/validation.js";
import { discoveryLink, discoveryPath } from "./discovery.js";

export const MAX_CHALLENGE_BODY_BYTES = 8192;
const MAX_PROOF_HEADER_BYTES = 16384;

export interface AuthorizationProof {
  readonly version: 1;
  readonly challengeId: string;
  readonly signature: string;
  readonly address: string;
  readonly entitlementId: string;
}

export interface RequestTarget {
  readonly method: string;
  readonly target: string;
}

export interface ChallengeRequest extends RequestTarget {
  readonly address: string;
  readonly entitlementId: string;
}

export interface AuthorizationRequest extends RequestTarget {
  readonly authorization: string | null | undefined;
}

type Status = 400 | 401 | 403 | 405 | 413 | 429 | 503;
const failures = {
  400: ["BAD_REQUEST", "Invalid request."],
  401: ["UNAUTHORIZED", "Authentication required."],
  403: ["FORBIDDEN", "Access denied."],
  405: ["METHOD_NOT_ALLOWED", "Method not allowed."],
  413: ["PAYLOAD_TOO_LARGE", "Request too large."],
  429: ["RATE_LIMITED", "Please try again later."],
  503: [
    "AUTHORIZATION_UNAVAILABLE",
    "Authorization is temporarily unavailable.",
  ],
} as const;

export class AuthorizationError extends Error {
  readonly code: (typeof failures)[Status][0];
  constructor(
    public readonly status: Status,
    options?: ErrorOptions,
  ) {
    super(failures[status][1], options);
    this.name = "AuthorizationError";
    this.code = failures[status][0];
  }
}

export function authorizationFailure(
  error: unknown,
  options: { discovery?: string; allow?: "GET" | "POST" } = {},
) {
  const failure =
    error instanceof AuthorizationError
      ? error
      : new AuthorizationError(503, { cause: error });
  const headers = privateResponseHeaders();
  if (failure.status === 401)
    headers.set("WWW-Authenticate", 'Suigate realm="suigate"');
  if (failure.status === 405) headers.set("Allow", options.allow ?? "POST");
  if (failure.status === 429) headers.set("Retry-After", "60");
  const discovery =
    options.discovery === undefined
      ? undefined
      : discoveryPath(options.discovery);
  if (discovery) headers.set("Link", discoveryLink(discovery));
  return {
    status: failure.status,
    headers,
    body: {
      error: { code: failure.code, message: failure.message },
      ...(discovery
        ? {
            suigate: {
              software: SOFTWARE_RISK,
              version: 1 as const,
              discovery,
              nextAction:
                failure.status === 401
                  ? "authenticate"
                  : failure.status === 403
                    ? "inspect_entitlement"
                    : failure.status === 503 || failure.status === 429
                      ? "retry_later"
                      : "correct_request",
            },
          }
        : {}),
    },
  };
}

export function privateResponseHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  const vary =
    headers
      .get("Vary")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (
    !vary.some(
      (value) => value === "*" || value.toLowerCase() === "authorization",
    )
  )
    vary.push("Authorization");
  headers.set("Vary", vary.join(", "));
  return headers;
}

function record(
  value: unknown,
  keys: readonly string[],
  status: 400 | 401,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new AuthorizationError(status);
  }
  return value as Record<string, unknown>;
}

function identity(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid address");
  return address(value);
}

export function normalizeRequestTarget(input: RequestTarget): RequestTarget {
  if (
    typeof input.method !== "string" ||
    !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(input.method)
  ) {
    throw new AuthorizationError(400);
  }
  if (
    typeof input.target !== "string" ||
    input.target.length > 2048 ||
    !input.target.startsWith("/") ||
    input.target.startsWith("//") ||
    /[^\x21-\x7e]|[\\#]/.test(input.target)
  ) {
    throw new AuthorizationError(400);
  }
  const parsed = new URL(input.target, "https://suigate.invalid");
  if (
    parsed.origin !== "https://suigate.invalid" ||
    parsed.pathname + parsed.search !== input.target
  )
    throw new AuthorizationError(400);
  return { method: input.method, target: input.target };
}

export function parseChallengeRequest(value: unknown): ChallengeRequest {
  try {
    const data = record(
      value,
      ["address", "entitlementId", "method", "target"],
      400,
    );
    if (typeof data.method !== "string" || typeof data.target !== "string")
      throw new Error("Invalid target");
    return {
      address: identity(data.address),
      entitlementId: identity(data.entitlementId),
      ...normalizeRequestTarget({ method: data.method, target: data.target }),
    };
  } catch (cause) {
    throw new AuthorizationError(400, { cause });
  }
}

function proof(value: unknown): AuthorizationProof {
  const data = record(
    value,
    ["version", "challengeId", "signature", "address", "entitlementId"],
    401,
  );
  if (
    data.version !== 1 ||
    typeof data.challengeId !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.challengeId) ||
    typeof data.signature !== "string" ||
    !data.signature.length ||
    data.signature.length > 8192
  ) {
    throw new AuthorizationError(401);
  }
  return {
    version: 1,
    challengeId: data.challengeId,
    signature: data.signature,
    address: identity(data.address),
    entitlementId: identity(data.entitlementId),
  };
}

function base64url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function encodeAuthorizationProof(
  input: Omit<AuthorizationProof, "version">,
): string {
  const normalized = proof({ ...input, version: 1 });
  const header = `Suigate ${base64url(new TextEncoder().encode(JSON.stringify(normalized)))}`;
  if (header.length > MAX_PROOF_HEADER_BYTES) throw new AuthorizationError(401);
  return header;
}

export function parseAuthorizationProof(
  header: string | null | undefined,
): AuthorizationProof {
  try {
    if (typeof header !== "string" || header.length > MAX_PROOF_HEADER_BYTES)
      throw new Error("Missing proof");
    const match = /^Suigate ([A-Za-z0-9_-]+)$/i.exec(header.trim());
    if (!match?.[1]) throw new Error("Invalid proof scheme");
    const encoded = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = fromBase64(
      encoded + "=".repeat((4 - (encoded.length % 4)) % 4),
    );
    if (base64url(bytes) !== match[1]) throw new Error("Non-canonical proof");
    return proof(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch (cause) {
    throw new AuthorizationError(401, { cause });
  }
}

export async function readChallengeRequest(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new AuthorizationError(400);
  const length = request.headers.get("content-length");
  if (
    length &&
    (!/^\d+$/.test(length) || Number(length) > MAX_CHALLENGE_BODY_BYTES)
  )
    throw new AuthorizationError(413);
  if (!request.body) throw new AuthorizationError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CHALLENGE_BODY_BYTES) {
        await reader.cancel();
        throw new AuthorizationError(413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    if (cause instanceof AuthorizationError) throw cause;
    throw new AuthorizationError(400, { cause });
  } finally {
    reader.releaseLock();
  }
}
