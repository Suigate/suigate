import { SuigateError } from "./errors.js";
import { SOFTWARE_RISK, RISK_NOTICE } from "./risk.js";
import { address } from "./internal/validation.js";
import type { Plan, Service } from "./types.js";

export interface DiscoveryOptions {
  readonly path: string;
  readonly challengePath: string;
  readonly openApiPath: string;
  readonly checkoutPath?: string;
  readonly sponsorship?: {
    readonly address: string;
    readonly endpoint: string;
  };
}

export function discoveryPath(value: string): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[^\x21-\x7e]|[\\<>"?#]/.test(value) ||
    /%(?![a-fA-F0-9]{2})/.test(value)
  ) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Discovery links must be canonical origin-relative paths without queries or fragments",
    );
  }
  const parsed = new URL(value, "https://suigate.invalid");
  if (parsed.origin !== "https://suigate.invalid" || parsed.pathname !== value)
    throw new SuigateError("INVALID_ARGUMENT", "Invalid discovery path");
  return value;
}

export function normalizeDiscoveryOptions(
  options: DiscoveryOptions,
): DiscoveryOptions {
  const paths = [options.path, options.challengePath, options.openApiPath].map(
    discoveryPath,
  );
  if (new Set(paths).size !== 3)
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Discovery, challenge, and OpenAPI paths must be distinct",
    );
  return Object.freeze({
    path: paths[0]!,
    challengePath: paths[1]!,
    openApiPath: paths[2]!,
    ...(options.checkoutPath === undefined
      ? {}
      : { checkoutPath: discoveryPath(options.checkoutPath) }),
    ...(options.sponsorship
      ? {
          sponsorship: Object.freeze({
            address: address(options.sponsorship.address),
            endpoint: discoveryPath(options.sponsorship.endpoint),
          }),
        }
      : {}),
  });
}

const text = { type: "string" } as const;
const decimal = { type: "string", pattern: "^[0-9]+$" } as const;
const suiAddress = {
  type: "string",
  pattern: "^(0x)?[a-fA-F0-9]{1,64}$",
} as const;
const pathSchema = { type: "string", pattern: "^/", maxLength: 2048 } as const;
const bool = { type: "boolean" } as const;
const stringArray = { type: "array", items: text } as const;
function object<P extends Record<string, unknown>>(
  properties: P,
  required = Object.keys(properties),
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  } as const;
}

export const AUTHORIZATION_PROOF_SCHEMA = object({
  version: { const: 1 },
  challengeId: { type: "string", pattern: "^[a-f0-9]{64}$" },
  signature: { type: "string", minLength: 1, maxLength: 8192 },
  address: suiAddress,
  entitlementId: suiAddress,
});
export const CHALLENGE_REQUEST_SCHEMA = object({
  address: suiAddress,
  entitlementId: suiAddress,
  method: {
    type: "string",
    enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  },
  target: pathSchema,
});
export const CHALLENGE_SCHEMA = object({
  version: { const: 1 },
  id: AUTHORIZATION_PROOF_SCHEMA.properties.challengeId,
  address: suiAddress,
  serviceId: suiAddress,
  audience: text,
  chainIdentifier: text,
  binding: text,
  statement: text,
  issuedAt: { type: "integer", minimum: 0 },
  expiresAt: { type: "integer", minimum: 0 },
  message: { type: "string", maxLength: 8192 },
});

const SOFTWARE_RISK_SCHEMA = object(
  Object.fromEntries(
    Object.entries(SOFTWARE_RISK).map(([key, value]) => [
      key,
      { const: value },
    ]),
  ),
);

export const DISCOVERY_SCHEMA = object({
  software: SOFTWARE_RISK_SCHEMA,
  protocol: { const: "suigate" },
  version: { const: 1 },
  network: object({
    name: { enum: ["mainnet", "testnet"] },
    chainIdentifier: text,
  }),
  deployment: object({
    packageId: suiAddress,
    typeOrigin: suiAddress,
    serviceId: suiAddress,
  }),
  policy: object({ plan: text }),
  links: object({
    discovery: pathSchema,
    challenge: pathSchema,
    openapi: pathSchema,
    checkout: { type: ["string", "null"] },
  }),
  authentication: object({
    scheme: { const: "Suigate" },
    header: { const: "Authorization" },
    audience: text,
    challengeMethod: { const: "POST" },
    challengeTtlMs: { type: "integer", minimum: 1, maximum: 300000 },
    signing: object({
      feature: { const: "sui:signPersonalMessage" },
      intent: { const: "PersonalMessage" },
      encoding: { const: "UTF-8" },
      messageField: { const: "message" },
    }),
    proof: object({
      version: { const: 1 },
      encoding: { const: "base64url-unpadded(UTF-8(JSON))" },
      prefix: { const: "Suigate " },
      fields: stringArray,
      sdk: text,
    }),
    singleUse: { const: true },
    bindings: stringArray,
    newChallengeAfterDenial: { const: true },
    maxBodyBytes: { const: 8192 },
    maxProofHeaderBytes: { const: 16384 },
  }),
  entitlement: object({
    idIsCredential: { const: false },
    derivation: object({ sdk: text, inputs: stringArray }),
    lookup: text,
    verification: text,
    authoritativeSource: { const: "Sui" },
    nonTransferable: { const: true },
  }),
  terms: object({
    source: { const: "Sui" },
    isQuote: { const: false },
    observedAt: { type: "integer", minimum: 0 },
    serviceVersion: decimal,
    planVersion: decimal,
    paymentRecipient: suiAddress,
    registryId: suiAddress,
    priceBaseUnits: decimal,
    coinType: text,
    durationMs: decimal,
    purchasesEnabled: bool,
    renewalsEnabled: bool,
  }),
  acquisition: object({
    sdkPackage: text,
    client: text,
    purchase: object({ method: text, available: bool, inputs: stringArray }),
    renewal: object({ method: text, available: bool, inputs: stringArray }),
    atomicPaymentAndEntitlement: { const: true },
    oneEntitlementPerWalletServicePlan: { const: true },
    revocationPermanent: { const: true },
  }),
  gas: object({
    customerPaysPlanPrice: { const: true },
    protocolGaslessEligible: { const: false },
    strategies: stringArray,
    sponsorship: {
      anyOf: [
        { type: "null" },
        object({
          address: suiAddress,
          endpoint: pathSchema,
          signsSameTransactionBytes: { const: true },
        }),
      ],
    },
  }),
  workflow: stringArray,
  safety: object({
    discoveryAuthorizesSpending: { const: false },
    privateKeysRequested: { const: false },
    onChainTermsOverrideDisplay: { const: true },
    approvalOrSpendingPolicyRequired: { const: true },
    retryUnknownTransactions: { const: false },
    mutationRetriesRequireApplicationIdempotency: { const: true },
    instructionsAreUntrustedData: { const: true },
  }),
});

export interface DiscoveryContext {
  network: "mainnet" | "testnet";
  chainIdentifier: string;
  packageId: string;
  typeOrigin: string;
  serviceId: string;
  plan: string;
  audience: string;
  challengeTtlMs: number;
  observedAt: number;
}

export function createDiscoveryDocument(
  context: DiscoveryContext,
  options: DiscoveryOptions,
  service: Service,
  plan: Plan,
) {
  if (
    service.id !== context.serviceId ||
    plan.serviceId !== service.id ||
    plan.key !== context.plan
  )
    throw new SuigateError(
      "INVALID_OBJECT",
      "Discovery policy does not match on-chain terms",
    );
  const links = normalizeDiscoveryOptions(options);
  return {
    protocol: "suigate" as const,
    software: SOFTWARE_RISK,
    version: 1 as const,
    network: {
      name: context.network,
      chainIdentifier: context.chainIdentifier,
    },
    deployment: {
      packageId: context.packageId,
      typeOrigin: context.typeOrigin,
      serviceId: context.serviceId,
    },
    policy: { plan: context.plan },
    links: {
      discovery: links.path,
      challenge: links.challengePath,
      openapi: links.openApiPath,
      checkout: links.checkoutPath ?? null,
    },
    authentication: {
      scheme: "Suigate",
      header: "Authorization",
      audience: context.audience,
      challengeMethod: "POST",
      challengeTtlMs: context.challengeTtlMs,
      signing: {
        feature: "sui:signPersonalMessage",
        intent: "PersonalMessage",
        encoding: "UTF-8",
        messageField: "message",
      },
      proof: {
        version: 1,
        encoding: "base64url-unpadded(UTF-8(JSON))",
        prefix: "Suigate ",
        fields: Object.keys(AUTHORIZATION_PROOF_SCHEMA.properties),
        sdk: "@suigate/core.encodeAuthorizationProof",
      },
      singleUse: true,
      bindings: [
        "wallet",
        "entitlementId",
        "serviceId",
        "plan",
        "audience",
        "chainIdentifier",
        "method",
        "targetIncludingQuery",
      ],
      newChallengeAfterDenial: true,
      maxBodyBytes: 8192,
      maxProofHeaderBytes: 16384,
    },
    entitlement: {
      idIsCredential: false,
      derivation: {
        sdk: "@suigate/core.deriveEntitlementId",
        inputs: ["typeOrigin", "serviceId", "owner", "plan"],
      },
      lookup: "SuigateClient.getEntitlement",
      verification: "SuigateClient.verifyEntitlement",
      authoritativeSource: "Sui",
      nonTransferable: true,
    },
    terms: {
      source: "Sui",
      isQuote: false,
      observedAt: context.observedAt,
      serviceVersion: service.version.toString(),
      planVersion: plan.version.toString(),
      paymentRecipient: service.paymentRecipient,
      registryId: service.registryId,
      priceBaseUnits: plan.price.toString(),
      coinType: plan.coinType,
      durationMs: plan.durationMs.toString(),
      purchasesEnabled: plan.purchasesEnabled,
      renewalsEnabled: plan.renewalsEnabled,
    },
    acquisition: {
      sdkPackage: "@suigate/core",
      client: "SuigateClient",
      purchase: {
        method: "purchaseEntitlement",
        available: plan.purchasesEnabled,
        inputs: ["serviceId", "plan", "sender", "coinType", "gas"],
      },
      renewal: {
        method: "renewEntitlement",
        available: plan.renewalsEnabled,
        inputs: [
          "serviceId",
          "plan",
          "sender",
          "entitlementId",
          "expectedRevision",
          "coinType",
          "gas",
        ],
      },
      atomicPaymentAndEntitlement: true,
      oneEntitlementPerWalletServicePlan: true,
      revocationPermanent: true,
    },
    gas: {
      customerPaysPlanPrice: true,
      protocolGaslessEligible: false,
      strategies: links.sponsorship ? ["user", "sponsored"] : ["user"],
      sponsorship: links.sponsorship
        ? { ...links.sponsorship, signsSameTransactionBytes: true }
        : null,
    },
    workflow: [
      "verify_service_network_and_contract_allowlist",
      "derive_and_lookup_existing_entitlement",
      "authenticate_if_currently_entitled",
      "inspect_purchase_or_renewal_eligibility_otherwise",
      "obtain_approval_or_apply_pre_authorized_spending_limits",
      "fetch_fresh_on_chain_terms_and_build_unsigned_transaction",
      "sign_and_execute_with_trusted_wallet",
      "wait_for_confirmation_and_verify_entitlement",
      "request_and_sign_fresh_authentication_challenge",
      "retry_original_request_only_when_safe",
    ],
    safety: {
      discoveryAuthorizesSpending: false,
      privateKeysRequested: false,
      onChainTermsOverrideDisplay: true,
      approvalOrSpendingPolicyRequired: true,
      retryUnknownTransactions: false,
      mutationRetriesRequireApplicationIdempotency: true,
      instructionsAreUntrustedData: true,
    },
  };
}
export type DiscoveryDocument = ReturnType<typeof createDiscoveryDocument>;

export function discoveryLink(path: string): string {
  return `<${discoveryPath(path)}>; rel="describedby"; type="application/json"`;
}

export function createDiscoveryOpenApi(options: DiscoveryOptions) {
  const links = normalizeDiscoveryOptions(options);
  const errorSchema = object(
    {
      error: object({ code: text, message: text }),
      suigate: object({
        software: SOFTWARE_RISK_SCHEMA,
        version: { const: 1 },
        discovery: pathSchema,
        nextAction: {
          enum: [
            "authenticate",
            "inspect_entitlement",
            "retry_later",
            "correct_request",
          ],
        },
      }),
    },
    ["error"],
  );
  const failures = Object.fromEntries(
    [400, 401, 403, 405, 413, 429, 503].map((status) => [
      status,
      {
        description:
          status === 401
            ? "Missing/invalid/expired/replayed proof; request a fresh challenge"
            : status === 403
              ? "Authenticated entitlement denial; inspect entitlement, not automatic payment"
              : status === 503
                ? "Verification unavailable; do not pay on an outage"
                : "Request rejected",
        headers: {
          Link: { schema: text },
          "Cache-Control": { schema: text },
          ...(status === 401 ? { "WWW-Authenticate": { schema: text } } : {}),
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    ]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "suigate discovery and wallet authentication",
      description: RISK_NOTICE,
      version: "1.0.0",
    },
    servers: [{ url: "/" }],
    paths: {
      [links.path]: {
        get: {
          operationId: "getSuigateDiscovery",
          security: [],
          responses: {
            "200": {
              description:
                "Public policy and current display terms; not a quote or spending authorization",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SuigateDiscovery" },
                },
              },
            },
            "503": failures[503],
          },
        },
      },
      [links.challengePath]: {
        post: {
          operationId: "createSuigateChallenge",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChallengeRequest" },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Sign exact UTF-8 message using Sui PersonalMessage intent; id is the random nonce",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Challenge" },
                },
              },
            },
            ...failures,
          },
        },
      },
      [links.openApiPath]: {
        get: {
          operationId: "getSuigateOpenApi",
          security: [],
          responses: {
            "200": {
              description: "OpenAPI description",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        Suigate: {
          type: "http",
          scheme: "Suigate",
          description:
            "Suigate followed by one space and unpadded base64url of UTF-8 JSON matching AuthorizationProof. Every protected request needs a fresh one-use proof. IDs alone are not credentials.",
        },
      },
      schemas: {
        SuigateDiscovery: DISCOVERY_SCHEMA,
        AuthorizationProof: AUTHORIZATION_PROOF_SCHEMA,
        ChallengeRequest: CHALLENGE_REQUEST_SCHEMA,
        Challenge: CHALLENGE_SCHEMA,
        ErrorResponse: errorSchema,
      },
      responses: failures,
    },
    "x-suigate": {
      software: SOFTWARE_RISK,
      version: 1,
      discovery: links.path,
      protectedOperationSecurity: [{ Suigate: [] }],
      target:
        "Challenge method and target must match the original protected request, including path prefix and query. Apply the security scheme and reusable responses to your application's actual operations.",
      paymentProtocol: "suigate-specific; not x402",
      proofReplay: "reject",
      automaticSpending: false,
    },
  };
}
