import { bcs } from "@mysten/sui/bcs";
import type { BcsType } from "@mysten/bcs";
import { SuigateError } from "../errors.js";

const Table = bcs.struct("Table", { id: bcs.Address, size: bcs.u64() });

export const ServiceBcs = bcs.struct("Service", {
  id: bcs.Address,
  owner: bcs.Address,
  admin_cap_id: bcs.Address,
  payment_recipient: bcs.Address,
  registry_id: bcs.Address,
  version: bcs.u64(),
  plans: Table,
  revocations: Table,
});

export const PlanBcs = bcs.struct("Plan", {
  service_id: bcs.Address,
  key: bcs.string(),
  price: bcs.u64(),
  coin_type: bcs.struct("TypeName", { name: bcs.string() }),
  duration_ms: bcs.u64(),
  version: bcs.u64(),
  purchases_enabled: bcs.bool(),
  renewals_enabled: bcs.bool(),
});

export const EntitlementBcs = bcs.struct("Entitlement", {
  id: bcs.Address,
  service_id: bcs.Address,
  plan_key: bcs.string(),
  holder: bcs.Address,
  issued_at: bcs.u64(),
  expires_at: bcs.u64(),
  revision: bcs.u64(),
  plan_version: bcs.u64(),
});

export const EntitlementKeyBcs = bcs.struct("EntitlementKey", {
  holder: bcs.Address,
  plan_key: bcs.string(),
});

export function decode<T extends Input, Input>(
  schema: BcsType<T, Input>,
  bytes: Uint8Array,
): T {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length > 65_536)
      throw new Error("Invalid BCS bytes");
    const value = schema.parse(bytes);
    const canonical = schema.serialize(value).toBytes();
    if (
      canonical.length !== bytes.length ||
      !canonical.every((byte, i) => byte === bytes[i])
    ) {
      throw new Error("Unexpected BCS layout or non-canonical bytes");
    }
    return value;
  } catch (cause) {
    throw new SuigateError("INVALID_OBJECT", `Cannot decode ${schema.name}`, {
      cause,
    });
  }
}
