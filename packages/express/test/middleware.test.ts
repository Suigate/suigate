import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  MemoryEntitlementCache,
  encodeAuthorizationProof,
  type Challenge,
} from "@suigate/core";
import { suiGate } from "../src/index.js";
import { authorizationFixture } from "../../core/test/authorization-fixture.js";
import { addr } from "../../core/test/fixtures.js";

function setup() {
  const f = authorizationFixture();
  const cache = new MemoryEntitlementCache({ now: () => f.state.now });
  const cacheRead = vi.spyOn(cache, "get");
  const gate = suiGate({ ...f.options, cache });
  const app = express();
  app.use("/api", gate);
  app.get("/api/data", (req, res) =>
    res.set("Cache-Control", "public, max-age=3600").json({
      wallet: req.suigate!.address,
      entitlementId: req.suigate!.entitlement.id,
      revision: req.suigate!.entitlement.revision.toString(),
    }),
  );
  app.post("/api/data", express.json(), (req, res) =>
    res.json({ wallet: req.suigate!.address, body: req.body }),
  );
  async function proof(input = f.challengeInput) {
    const issued = await request(app)
      .post("/api/.suigate/challenge")
      .send(input)
      .expect(201);
    const challenge = issued.body as Challenge;
    return {
      challenge,
      header: await f.sign(challenge, f.keypair, input.entitlementId),
      response: issued,
    };
  }
  return { ...f, cacheRead, app, gate, proof };
}

afterEach(() => vi.unstubAllEnvs());

describe("Express suiGate", () => {
  it("issues challenges and authorizes live entitlement access", async () => {
    const f = setup();
    const { header, response } = await f.proof();
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.message).toContain('"target":"/api/data"');
    const access = await request(f.app)
      .get("/api/data")
      .set("Authorization", header)
      .expect(200);
    expect(access.body).toEqual({
      wallet: f.wallet,
      entitlementId: f.entitlementId,
      revision: "4",
    });
    expect(access.headers["cache-control"]).toBe("private, no-store");
    expect(access.headers.vary).toContain("Authorization");
    expect(f.cacheRead).not.toHaveBeenCalled();
  });

  it("rejects missing proofs and object IDs used as credentials", async () => {
    const f = setup();
    for (const header of [null, f.entitlementId, `Bearer ${f.entitlementId}`]) {
      const call = request(f.app).get("/api/data");
      if (header) call.set("Authorization", header);
      const result = await call.expect(401);
      expect(result.body).toEqual({
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
      });
      expect(result.headers["www-authenticate"]).toContain("Suigate");
    }
    expect(f.objectQuery.mock.callCount()).toBe(0);
  });

  it("does not substitute an owned entitlement for the supplied wrong object ID", async () => {
    const f = setup();
    const { header } = await f.proof({
      ...f.challengeInput,
      entitlementId: addr("0xdead"),
    });
    await request(f.app)
      .get("/api/data")
      .set("Authorization", header)
      .expect(403);
  });

  it("rejects invalid signatures, wrong signing wallets, and replay", async () => {
    const f = setup();
    const { challenge, header } = await f.proof();
    const malformed = encodeAuthorizationProof({
      challengeId: challenge.id,
      address: f.wallet,
      entitlementId: f.entitlementId,
      signature: "invalid",
    });
    await request(f.app)
      .get("/api/data")
      .set("Authorization", malformed)
      .expect(401);
    await request(f.app)
      .get("/api/data")
      .set("Authorization", await f.sign(challenge, new Ed25519Keypair()))
      .expect(401);
    await request(f.app)
      .get("/api/data")
      .set("Authorization", header)
      .expect(200);
    await request(f.app)
      .get("/api/data")
      .set("Authorization", header)
      .expect(401);
  });

  it("allows only one of two concurrent proof redemptions", async () => {
    const f = setup();
    const { header } = await f.proof();
    const responses = await Promise.all([
      request(f.app).get("/api/data").set("Authorization", header),
      request(f.app).get("/api/data").set("Authorization", header),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
  });

  for (const condition of [
    "owner",
    "service",
    "plan",
    "expiry",
    "revoked",
    "missing",
  ] as const) {
    it(`returns 403 for authenticated ${condition} failures without leaking metadata`, async () => {
      const f = setup();
      if (condition === "owner")
        f.putEntitlement({ holder: addr("0x999") }, addr("0x999"));
      if (condition === "service")
        f.putEntitlement({ service_id: addr("0x999") });
      if (condition === "plan") f.putEntitlement({ plan_key: "team" });
      if (condition === "expiry")
        f.putEntitlement({ expires_at: BigInt(f.NOW) });
      if (condition === "revoked") f.state.revoked = true;
      if (condition === "missing") f.state.objects.delete(f.entitlementId);
      const { header } = await f.proof();
      const result = await request(f.app)
        .get("/api/data")
        .set("Authorization", header)
        .expect(403);
      expect(result.body).toEqual({
        error: { code: "FORBIDDEN", message: "Access denied." },
      });
      expect(JSON.stringify(result.body)).not.toContain(f.entitlementId);
    });
  }

  it("observes a confirmed renewal with a fresh challenge and no authorization cache", async () => {
    const f = setup();
    f.putEntitlement({ expires_at: BigInt(f.NOW) });
    await request(f.app)
      .get("/api/data")
      .set("Authorization", (await f.proof()).header)
      .expect(403);
    f.putEntitlement({ expires_at: BigInt(f.NOW + 86_400_000), revision: 5n });
    const response = await request(f.app)
      .get("/api/data")
      .set("Authorization", (await f.proof()).header)
      .expect(200);
    expect(response.body.revision).toBe("5");
    expect(f.cacheRead).not.toHaveBeenCalled();
  });

  it("binds proofs to the actual method and original mounted request target", async () => {
    const f = setup();
    const { header } = await f.proof();
    await request(f.app)
      .post("/api/data")
      .set("Authorization", header)
      .expect(401);
    await request(f.app)
      .get("/api/data?different=1")
      .set("Authorization", header)
      .expect(401);
    await request(f.app)
      .get("/api/data")
      .set("Authorization", header)
      .expect(200);
  });

  it("leaves protected request bodies for the application's body parser", async () => {
    const f = setup();
    const { header } = await f.proof({ ...f.challengeInput, method: "POST" });
    const response = await request(f.app)
      .post("/api/data")
      .set("Authorization", header)
      .send({ value: "application payload" })
      .expect(200);
    expect(response.body.body).toEqual({ value: "application payload" });
  });

  it("returns 503 rather than authenticating on provider outages", async () => {
    const f = setup();
    const { header } = await f.proof();
    f.state.objectFailure = new Error("secret-provider-address");
    const result = await request(f.app)
      .get("/api/data")
      .set("Authorization", header)
      .expect(503);
    expect(JSON.stringify(result.body)).not.toContain(
      "secret-provider-address",
    );
  });

  it("bounds challenge requests and enforces the POST endpoint", async () => {
    const f = setup();
    await request(f.app)
      .get("/api/.suigate/challenge")
      .expect("Allow", "POST")
      .expect(405);
    await request(f.app)
      .post("/api/.suigate/challenge")
      .type("json")
      .send("{")
      .expect(400);
    await request(f.app)
      .post("/api/.suigate/challenge")
      .send({ ...f.challengeInput, extra: "x".repeat(9000) })
      .expect(413);
    await request(f.app)
      .post("/api/.suigate/challenge")
      .send({ ...f.challengeInput, plan: "free" })
      .expect(400);
  });

  it("supports a separately mounted challenge handler and pre-parsed JSON", async () => {
    const f = authorizationFixture();
    const gate = suiGate({ ...f.options, challengePath: false });
    const app = express();
    app.use(express.json());
    app.post("/auth/challenge", gate.challenge);
    app.get("/api/data", gate, (req, res) =>
      res.json({ wallet: req.suigate!.address }),
    );
    const challenge = (
      await request(app)
        .post("/auth/challenge")
        .send(f.challengeInput)
        .expect(201)
    ).body as Challenge;
    await request(app)
      .get("/api/data")
      .set("Authorization", await f.sign(challenge))
      .expect(200);
  });

  it("supports the two-field API with explicit deployment environment configuration", async () => {
    vi.stubEnv("SUIGATE_NETWORK", "testnet");
    vi.stubEnv("SUIGATE_RPC_URL", "http://127.0.0.1:1");
    vi.stubEnv("SUIGATE_PACKAGE_ID", "0xabc");
    vi.stubEnv("SUIGATE_CHAIN_IDENTIFIER", "test-chain");
    vi.stubEnv("SUIGATE_AUDIENCE", "https://api.example");
    const app = express();
    app.use("/api", suiGate({ serviceId: "0x100", plan: "pro" }));
    await request(app).get("/api/data").expect(401);
  });
});
