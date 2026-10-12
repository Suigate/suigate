import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { SUI_NETWORKS } from "@suigate/core";
import { publicConfiguration, type PublicConfiguration } from "./model.ts";

export async function loadExampleConfiguration(
  directory = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<PublicConfiguration | null> {
  if (env.SUIGATE_PACKAGE_ID || env.SUIGATE_SERVICE_ID) {
    return publicConfiguration({
      network: env.SUIGATE_NETWORK ?? "testnet",
      packageId: env.SUIGATE_PACKAGE_ID,
      typeOrigin: env.SUIGATE_TYPE_ORIGIN ?? env.SUIGATE_PACKAGE_ID,
      serviceId: env.SUIGATE_SERVICE_ID,
      chainIdentifier:
        env.SUIGATE_CHAIN_IDENTIFIER ?? SUI_NETWORKS.testnet.chainIdentifier,
      plan: env.SUIGATE_PLAN ?? "pro",
    });
  }
  let current = resolve(directory);
  for (let depth = 0; depth < 8; depth++) {
    try {
      const state = JSON.parse(
        await readFile(
          join(current, ".suigate/deployments/testnet.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      if (state.pending)
        throw new Error(
          "Deployment is pending; reconcile it before starting the examples.",
        );
      return publicConfiguration({
        network: state.network,
        packageId: state.packageId,
        typeOrigin: state.typeOrigin ?? state.packageId,
        serviceId: state.serviceId,
        chainIdentifier: state.chainIdentifier,
        plan: env.SUIGATE_PLAN ?? "pro",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) break;
    current = dirname(current);
  }
  return null;
}
