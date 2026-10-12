import express from "express";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SUI_NETWORKS } from "@suigate/core";
import { suiGate, type SuiGateOptions } from "@suigate/express";
import type { PublicConfiguration } from "../../shared/model.js";
import { EXAMPLE_DISCOVERY } from "../../shared/discovery.js";

export function createApp(
  configuration: PublicConfiguration | null,
  overrides: Partial<SuiGateOptions> = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/api/free", (_request, response) =>
    response.json({
      tier: "free",
      message: "Free software access. No wallet required.",
    }),
  );
  app.get("/api/config", (_request, response) => {
    response.set("Cache-Control", "no-store");
    if (!configuration) {
      response.status(503).json({
        error:
          "Run suigate init and deploy, or configure the example environment.",
      });
      return;
    }
    response.json(configuration);
  });
  if (configuration) {
    const gate = suiGate({
      client: new SuiGrpcClient({
        network: "testnet",
        baseUrl: process.env.SUIGATE_RPC_URL ?? SUI_NETWORKS.testnet.rpcUrl,
      }),
      packageId: configuration.packageId,
      typeOrigin: configuration.typeOrigin,
      chainIdentifier: configuration.chainIdentifier,
      serviceId: configuration.serviceId,
      plan: configuration.plan,
      audience: process.env.SUIGATE_AUDIENCE ?? "http://localhost:3001",
      challengePath: false,
      discovery: EXAMPLE_DISCOVERY,
      ...overrides,
    });
    app.post("/api/challenge", gate.challenge);
    app.all(EXAMPLE_DISCOVERY.path, gate.discovery);
    app.all(EXAMPLE_DISCOVERY.openApiPath, gate.openapi);
    app.get("/api/pro", gate, (request, response) =>
      response.json({
        tier: "pro",
        message: "Live entitlement verified on Sui.",
        wallet: request.suigate!.address,
        entitlementId: request.suigate!.entitlement.id,
        expiresAt: request.suigate!.entitlement.expiresAt.toString(),
      }),
    );
  } else {
    app.use(
      [
        "/api/pro",
        "/api/challenge",
        EXAMPLE_DISCOVERY.path,
        EXAMPLE_DISCOVERY.openApiPath,
      ],
      (_request, response) =>
        response
          .status(503)
          .json({ error: "Testnet service is not configured." }),
    );
  }
  return app;
}
