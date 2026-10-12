import { SUI_NETWORKS } from "@suigate/core";
import { normalizeSuiAddress } from "@mysten/sui/utils";

export interface PublicConfiguration {
  network: "testnet";
  packageId: string;
  typeOrigin: string;
  serviceId: string;
  chainIdentifier: string;
  plan: string;
}

export function publicConfiguration(value: unknown): PublicConfiguration {
  const data = value as Partial<PublicConfiguration>;
  const address = (input: unknown) => {
    if (typeof input !== "string" || !/^(0x)?[a-fA-F0-9]{1,64}$/.test(input))
      throw new Error("Enter valid Sui package and service IDs.");
    return normalizeSuiAddress(input);
  };
  if (
    !data ||
    data.network !== "testnet" ||
    data.chainIdentifier !== SUI_NETWORKS.testnet.chainIdentifier
  )
    throw new Error(
      "These examples only support the verified Sui testnet chain.",
    );
  if (
    typeof data.plan !== "string" ||
    !data.plan.length ||
    data.plan.length > 64 ||
    /[^\x00-\x7f]/.test(data.plan)
  )
    throw new Error("Enter an ASCII plan key.");
  return {
    network: "testnet",
    packageId: address(data.packageId),
    typeOrigin: address(data.typeOrigin ?? data.packageId),
    serviceId: address(data.serviceId),
    chainIdentifier: data.chainIdentifier,
    plan: data.plan,
  };
}
