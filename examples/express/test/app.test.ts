import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authorizationFixture } from "../../../packages/core/test/authorization-fixture.js";
import {
  PACKAGE,
  SERVICE,
  CHAIN,
} from "../../../packages/core/test/fixtures.js";
import type { Challenge } from "@suigate/core";

describe("Express example", () => {
  it("keeps free access available before a Service is configured", async () => {
    const app = createApp(null);
    expect((await request(app).get("/api/free").expect(200)).body.tier).toBe(
      "free",
    );
    await request(app).get("/api/pro").expect(503);
    await request(app).get("/api/config").expect(503);
    await request(app).get("/api/.suigate/discovery").expect(503);
  });
  it("demonstrates free access and challenge-authenticated Pro access", async () => {
    const f = authorizationFixture();
    const app = createApp(
      {
        network: "testnet",
        packageId: PACKAGE,
        typeOrigin: PACKAGE,
        serviceId: SERVICE,
        chainIdentifier: CHAIN,
        plan: "pro",
      },
      f.options,
    );
    await request(app).get("/api/free").expect(200);
    const missing = await request(app).get("/api/pro").expect(401);
    const manifest = await request(app)
      .get(missing.body.suigate.discovery)
      .expect(200);
    expect(manifest.body.links.challenge).toBe("/api/challenge");
    expect(manifest.body.deployment.serviceId).toBe(SERVICE);
    await request(app).get(manifest.body.links.openapi).expect(200);
    const challenge = (
      await request(app)
        .post("/api/challenge")
        .send({ ...f.challengeInput, target: "/api/pro" })
        .expect(201)
    ).body as Challenge;
    const header = await f.sign(challenge);
    const response = await request(app)
      .get("/api/pro")
      .set("Authorization", header)
      .expect(200);
    expect(response.body.wallet).toBe(f.wallet);
    await request(app).get("/api/pro").set("Authorization", header).expect(401);
  });
});
