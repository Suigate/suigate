// 100% AI-generated and unaudited. Incorrect or hallucinated code may cause loss of funds or keys; see NOTICE.md.
export { RISK_NOTICE, SOFTWARE_RISK } from "./risk.js";
export { SuigateClient } from "./client.js";
export { DISCOVERY_SCHEMA, discoveryPath } from "./discovery.js";
export type { DiscoveryDocument, DiscoveryOptions } from "./discovery.js";
export { SUI_NETWORKS } from "./networks.js";
export type { SuiNetwork } from "./networks.js";
export { encodeAuthorizationProof } from "./http-auth.js";
export type {
  AuthorizationProof,
  ChallengeRequest,
  RequestTarget,
} from "./http-auth.js";
export type { SuigateClientOptions } from "./client.js";
export { SuigateError } from "./errors.js";
export type { SuigateErrorCode } from "./errors.js";
export {
  deriveEntitlementId,
  parseService,
  parsePlan,
  parseEntitlement,
} from "./parsing.js";
export { MemoryEntitlementCache } from "./cache.js";
export type { EntitlementCache, CachedEntitlement } from "./cache.js";
export { configureGas } from "./gas.js";
export {
  createChallenge,
  verifyChallenge,
  verifySignature,
  MemoryChallengeStore,
} from "./auth.js";
export type { Challenge, ChallengeContext, ChallengeStore } from "./auth.js";
export type {
  Service,
  Plan,
  Entitlement,
  TableReference,
  SuiObject,
  GasStrategy,
  Sponsor,
  GasSelection,
  EntitlementQuery,
  PurchaseOptions,
  RenewalOptions,
  EntitlementTransaction,
} from "./types.js";
