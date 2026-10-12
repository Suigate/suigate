import "server-only";
import { createSuiGate } from "@suigate/nextjs";
import { SUI_NETWORKS } from "@suigate/core";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { loadExampleConfiguration } from "../../shared/config";
import { EXAMPLE_DISCOVERY } from "../../shared/discovery";

const processState = globalThis as typeof globalThis & {
  suigateExampleGates?: Map<string, ReturnType<typeof createSuiGate>>;
};
processState.suigateExampleGates ??= new Map();

export async function getGate() {
  const config = await loadExampleConfiguration();
  if (!config) return null;
  const audience = process.env.SUIGATE_AUDIENCE ?? "http://localhost:3000";
  const key = JSON.stringify([config, audience]);
  let gate = processState.suigateExampleGates!.get(key);
  if (!gate) {
    gate = createSuiGate({
      ...config,
      audience,
      discovery: EXAMPLE_DISCOVERY,
      client: new SuiGrpcClient({
        network: "testnet",
        baseUrl: process.env.SUIGATE_RPC_URL ?? SUI_NETWORKS.testnet.rpcUrl,
      }),
    });
    processState.suigateExampleGates!.set(key, gate);
  }
  return gate;
}
