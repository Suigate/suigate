import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  deriveEntitlementId,
  encodeAuthorizationProof,
  type Challenge,
  type DiscoveryDocument,
} from "@suigate/core";
import { suiGate } from "../src/index.js";
import { authorizationFixture } from "../../core/test/authorization-fixture.js";

const discovery = {
  path: "/api/.suigate/discovery",
  challengePath: "/api/auth/challenge",
  openApiPath: "/api/.suigate/openapi",
  checkoutPath: "/checkout",
};
function setup() {
  const f = authorizationFixture();
  const app = express();
  app.use((_req, res, next) => {
    res.set("Link", '</other>; rel="alternate"');
    next();
  });
  const gate = suiGate({ ...f.options, discovery });
  app.use("/api", gate);
  app.get("/api/data", (req, res) =>
    res.json({ wallet: req.suigate!.address }),
  );
  return { ...f, app, gate };
}

describe("Express agent discovery", () => {
  it("bootstraps an unknown client from 401 to discovery, challenge, and authorized access", async () => {
    const f = setup();
    const denied = await request(f.app)
      .get("/api/data")
      .set("Host", "attacker.example")
      .set("X-Forwarded-Host", "attacker.example")
      .expect(401);
    expect(denied.headers["www-authenticate"]).toContain("Suigate");
    expect(denied.headers.link).toContain('</other>; rel="alternate"');
    expect(denied.headers.link).toContain(`</api/.suigate/discovery>`);
    expect(denied.body.suigate.nextAction).toBe("authenticate");
    const document = await request(f.app)
      .get(denied.body.suigate.discovery)
      .expect(200);
    const manifest = document.body as DiscoveryDocument;
    expect(document.headers["cache-control"]).toBe("private, no-store");
    expect(manifest.authentication.audience).toBe("https://api.example");
    expect(manifest.safety.discoveryAuthorizesSpending).toBe(false);
    const entitlementId = deriveEntitlementId({
      ...manifest.deployment,
      owner: f.wallet,
      plan: manifest.policy.plan,
    });
    const challenge = (
      await request(f.app)
        .post(manifest.links.challenge)
        .send({
          address: f.wallet,
          entitlementId,
          method: "GET",
          target: "/api/data",
        })
        .expect(201)
    ).body as Challenge;
    const { signature } = await f.keypair.signPersonalMessage(
      new TextEncoder().encode(challenge.message),
    );
    const proof = encodeAuthorizationProof({
      challengeId: challenge.id,
      signature,
      address: f.wallet,
      entitlementId,
    });
    await request(f.app).get(manifest.links.discovery).expect(200);
    await request(f.app)
      .get("/api/data")
      .set("Authorization", proof)
      .expect(200);
    const replay = await request(f.app)
      .get("/api/data")
      .set("Authorization", proof)
      .expect(401);
    expect(replay.body.suigate.nextAction).toBe("authenticate");
    const api = await request(f.app).get(manifest.links.openapi).expect(200);
    expect(api.body.paths[manifest.links.challenge].post.security).toEqual([]);
  });

  it("does not turn revocation, expiration, or outages into a payment instruction", async () => {
    const f = setup();
    f.state.revoked = true;
    const issued = (
      await request(f.app)
        .post(discovery.challengePath)
        .send(f.challengeInput)
        .expect(201)
    ).body as Challenge;
    const denied = await request(f.app)
      .get("/api/data")
      .set("Authorization", await f.sign(issued))
      .expect(403);
    expect(denied.body.suigate.nextAction).toBe("inspect_entitlement");
    expect(denied.body.error).toEqual({
      code: "FORBIDDEN",
      message: "Access denied.",
    });
    f.state.objectFailure = new Error("private provider error");
    const unavailable = await request(f.app).get(discovery.path).expect(503);
    expect(unavailable.body.suigate.nextAction).toBe("retry_later");
    expect(JSON.stringify(unavailable.body)).not.toContain(
      "private provider error",
    );
    await request(f.app).get(discovery.openApiPath).expect(200);
  });

  it("requires GET for discovery documents, ignores query policy overrides, and supports manual routes", async () => {
    const f = setup();
    await request(f.app)
      .post(discovery.path)
      .expect("Allow", "GET")
      .expect(405);
    await request(f.app)
      .post(discovery.openApiPath)
      .expect("Allow", "GET")
      .expect(405);
    const response = await request(f.app)
      .get(`${discovery.path}?plan=free&serviceId=0x999`)
      .expect(200);
    expect(response.body.policy.plan).toBe("pro");
    expect(response.body.deployment.serviceId).toBe(f.options.serviceId);
    const app = express();
    const gate = suiGate({ ...f.options, discovery, challengePath: false });
    app.all(discovery.path, gate.discovery);
    app.all(discovery.openApiPath, gate.openapi);
    app.post(discovery.challengePath, gate.challenge);
    await request(app).get(discovery.path).expect(200);
    await request(app)
      .post(discovery.challengePath)
      .send(f.challengeInput)
      .expect(201);
  });

  it("is opt-in and validates paths before accepting requests", async () => {
    const f = authorizationFixture();
    const app = express();
    app.use("/api", suiGate(f.options));
    const response = await request(app).get(discovery.path).expect(401);
    expect(response.body.suigate).toBeUndefined();
    expect(response.headers.link).toBeUndefined();
    expect(() =>
      suiGate({
        ...f.options,
        discovery: { ...discovery, path: "/unsafe\r\nheader" },
      }),
    ).toThrow();
  });
});
