import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server.js";
import {
  deriveEntitlementId,
  encodeAuthorizationProof,
  type Challenge,
  type DiscoveryDocument,
} from "@suigate/core";
import { createSuiGate } from "../src/index.js";
import { createSuigateProofPreflight } from "../src/proxy.js";
import { authorizationFixture } from "../../core/test/authorization-fixture.js";

const paths = {
  path: "/api/.suigate/discovery",
  challengePath: "/api/challenge",
  openApiPath: "/api/.suigate/openapi",
  checkoutPath: "/",
};
const url = (path: string) => `https://api.example${path}`;

describe("Next.js agent discovery", () => {
  it("advertises discovery at the optional Proxy boundary without becoming authorization", async () => {
    const proxy = createSuigateProofPreflight({ discovery: paths.path });
    const response = proxy(new NextRequest(url("/api/data")));
    expect(response.status).toBe(401);
    expect((await response.json()).suigate.discovery).toBe(paths.path);
    expect(() =>
      createSuigateProofPreflight({ discovery: "//attacker.example" }),
    ).toThrow();
  });

  it("lets an agent discover protocol and authenticate without a hardcoded challenge endpoint", async () => {
    const f = authorizationFixture();
    const gate = createSuiGate({ ...f.options, discovery: paths });
    const context = { params: Promise.resolve({}) };
    const handler = gate.withAuthorization((_request, auth) =>
      Response.json({ wallet: auth.address }),
    );
    const missing = await handler(new NextRequest(url("/api/data")), context);
    expect(missing.status).toBe(401);
    const hint = (await missing.json()).suigate;
    expect(missing.headers.get("link")).toContain(hint.discovery);
    const response = await gate.discovery(
      new Request(url(hint.discovery), {
        headers: { host: "attacker.example" },
      }),
    );
    expect(response.status).toBe(200);
    const manifest = (await response.json()) as DiscoveryDocument;
    expect(manifest.authentication.audience).toBe("https://api.example");
    expect(manifest.gas.protocolGaslessEligible).toBe(false);
    const entitlementId = deriveEntitlementId({
      ...manifest.deployment,
      owner: f.wallet,
      plan: manifest.policy.plan,
    });
    const issued = await gate.challenge(
      new Request(url(manifest.links.challenge), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: f.wallet,
          entitlementId,
          method: "GET",
          target: "/api/data",
        }),
      }),
    );
    const challenge = (await issued.json()) as Challenge;
    const { signature } = await f.keypair.signPersonalMessage(
      new TextEncoder().encode(challenge.message),
    );
    const header = encodeAuthorizationProof({
      challengeId: challenge.id,
      address: f.wallet,
      entitlementId,
      signature,
    });
    await gate.discovery(new Request(url(paths.path)));
    expect(
      (
        await handler(
          new NextRequest(url("/api/data"), {
            headers: { Authorization: header },
          }),
          context,
        )
      ).status,
    ).toBe(200);
    const replay = await handler(
      new NextRequest(url("/api/data"), { headers: { Authorization: header } }),
      context,
    );
    expect(replay.status).toBe(401);
    expect((await replay.json()).suigate.nextAction).toBe("authenticate");
    const api = await (
      await gate.openapi(new Request(url(manifest.links.openapi)))
    ).json();
    expect(api.paths[manifest.links.challenge].post.operationId).toBe(
      "createSuigateChallenge",
    );
  });

  it("never suggests paying again on a denial or provider outage", async () => {
    const f = authorizationFixture();
    const gate = createSuiGate({ ...f.options, discovery: paths });
    f.state.revoked = true;
    const issued = await gate.challenge(
      new Request(url(paths.challengePath), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f.challengeInput),
      }),
    );
    const proof = await f.sign((await issued.json()) as Challenge);
    const handler = gate.withAuthorization(() =>
      Response.json({ secret: true }),
    );
    const denied = await handler(
      new NextRequest(url("/api/data"), { headers: { Authorization: proof } }),
      { params: Promise.resolve({}) },
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).suigate.nextAction).toBe(
      "inspect_entitlement",
    );
    f.state.objectFailure = new Error("provider token must not leak");
    const failed = await gate.discovery(new Request(url(paths.path)));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      suigate: { nextAction: "retry_later" },
    });
    expect(
      (await gate.openapi(new Request(url(paths.openApiPath)))).status,
    ).toBe(200);
  });

  it("enforces methods and keeps disabled discovery out of legacy responses", async () => {
    const f = authorizationFixture();
    const gate = createSuiGate({ ...f.options, discovery: paths });
    const wrong = await gate.discovery(
      new Request(url(paths.path), { method: "POST" }),
    );
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET");
    expect(
      (
        await gate.openapi(
          new Request(url(paths.openApiPath), { method: "POST" }),
        )
      ).status,
    ).toBe(405);
    const disabled = createSuiGate(f.options);
    const missing = await disabled.withAuthorization(() => Response.json({}))(
      new NextRequest(url("/api/data")),
      { params: Promise.resolve({}) },
    );
    expect((await missing.json()).suigate).toBeUndefined();
    expect(
      (await disabled.discovery(new Request(url(paths.path)))).status,
    ).toBe(503);
    expect(() =>
      createSuiGate({
        ...f.options,
        discovery: { ...paths, challengePath: "//attacker.example" },
      }),
    ).toThrow();
  });
});
