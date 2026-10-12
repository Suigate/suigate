import { deriveObjectID, normalizeStructTag } from "@mysten/sui/utils";
import { SuigateError } from "./errors.js";
import {
  decode,
  EntitlementBcs,
  EntitlementKeyBcs,
  PlanBcs,
  ServiceBcs,
} from "./internal/schema.js";
import { address, coinType, planKey } from "./internal/validation.js";
import type { Entitlement, Plan, Service, SuiObject } from "./types.js";

export function assertType(actual: string, expected: string): void {
  if (actual === expected) return;
  try {
    if (normalizeStructTag(actual) === normalizeStructTag(expected)) return;
  } catch {
    throw new SuigateError("WRONG_TYPE", "Invalid Move object type");
  }
  throw new SuigateError("WRONG_TYPE", `Expected ${expected}`);
}

function assertObject(
  object: SuiObject,
  packageId: string,
  name: string,
): void {
  assertType(object.type, `${address(packageId)}::subscriptions::${name}`);
  if (!/^[0-9]+$/.test(object.version) || !object.digest) {
    throw new SuigateError(
      "INVALID_OBJECT",
      "Missing object version or digest",
    );
  }
}

function assertId(object: SuiObject, decodedId: string): void {
  if (address(object.objectId) !== decodedId) {
    throw new SuigateError(
      "INVALID_OBJECT",
      "Object UID does not match the object ID",
    );
  }
}

export function parseService(object: SuiObject, typeOrigin: string): Service {
  assertObject(object, typeOrigin, "Service");
  if (object.owner.$kind !== "Shared")
    throw new SuigateError("INVALID_OBJECT", "Service must be shared");
  const data = decode(ServiceBcs, object.content);
  assertId(object, data.id);
  return Object.freeze({
    id: data.id,
    objectVersion: object.version,
    owner: data.owner,
    adminCapId: data.admin_cap_id,
    paymentRecipient: data.payment_recipient,
    registryId: data.registry_id,
    version: BigInt(data.version),
    plans: Object.freeze({ id: data.plans.id, size: BigInt(data.plans.size) }),
    revocations: Object.freeze({
      id: data.revocations.id,
      size: BigInt(data.revocations.size),
    }),
  });
}

export function parsePlan(
  value: { type: string; bcs: Uint8Array },
  typeOrigin: string,
): Plan {
  assertType(value.type, `${address(typeOrigin)}::subscriptions::Plan`);
  const data = decode(PlanBcs, value.bcs);
  if (BigInt(data.price) === 0n || BigInt(data.duration_ms) === 0n) {
    throw new SuigateError(
      "INVALID_OBJECT",
      "Paid plans require positive price and duration",
    );
  }
  return Object.freeze({
    serviceId: data.service_id,
    key: planKey(data.key),
    price: BigInt(data.price),
    coinType: coinType(data.coin_type.name),
    durationMs: BigInt(data.duration_ms),
    version: BigInt(data.version),
    purchasesEnabled: data.purchases_enabled,
    renewalsEnabled: data.renewals_enabled,
  });
}

export function parseEntitlement(
  object: SuiObject,
  typeOrigin: string,
): Entitlement {
  assertObject(object, typeOrigin, "Entitlement");
  if (object.owner.$kind !== "AddressOwner") {
    throw new SuigateError("WRONG_OWNER", "Entitlement must be address-owned");
  }
  const data = decode(EntitlementBcs, object.content);
  assertId(object, data.id);
  const owner = address(object.owner.AddressOwner);
  if (owner !== data.holder)
    throw new SuigateError("WRONG_OWNER", "Owner and holder do not match");
  if (BigInt(data.expires_at) <= BigInt(data.issued_at)) {
    throw new SuigateError(
      "INVALID_OBJECT",
      "Entitlement has an invalid validity interval",
    );
  }
  return Object.freeze({
    id: data.id,
    objectVersion: object.version,
    owner,
    serviceId: data.service_id,
    plan: planKey(data.plan_key),
    holder: data.holder,
    issuedAt: BigInt(data.issued_at),
    expiresAt: BigInt(data.expires_at),
    revision: BigInt(data.revision),
    planVersion: BigInt(data.plan_version),
  });
}

export function deriveEntitlementId(options: {
  typeOrigin: string;
  serviceId: string;
  owner: string;
  plan: string;
}): string {
  return deriveObjectID(
    address(options.serviceId),
    `${address(options.typeOrigin)}::subscriptions::EntitlementKey`,
    EntitlementKeyBcs.serialize({
      holder: address(options.owner),
      plan_key: planKey(options.plan),
    }).toBytes(),
  );
}
