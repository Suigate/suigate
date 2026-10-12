import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server.js";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { encodeAuthorizationProof, type Challenge } from "@suigate/core";
import { createSuiGate, authorizationResponse } from "../src/index.js";
import { suigateProofPreflight } from "../src/proxy.js";
import { authorizationFixture } from "../../core/test/authorization-fixture.js";
import { addr } from "../../core/test/fixtures.js";

function setup() {
  const f = authorizationFixture();
  const gate = createSuiGate(f.options);
  const route = gate.withAuthorization((_request, auth) =>
    NextResponse.json(
      {
        wallet: auth.address,
        entitlementId: auth.entitlement.id,
        revision: auth.entitlement.revision.toString(),
      },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    ),
  );
  const context = { params: Promise.resolve({}) };
  const makeRequest = (
    authorization?: string,
    target = "/api/data",
    method = "GET",
  ) =>
    new NextRequest(`https://api.example${target}`, {
      method,
      headers: authorization ? { Authorization: authorization } : {},
    });
  async function proof(input = f.challengeInput) {
    const response = await gate.challenge(
      new NextRequest("https://api.example/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    expect(response.status).toBe(201);
    const challenge = (await response.json()) as Challenge;
    return {
      challenge,
      header: await f.sign(challenge, f.keypair, input.entitlementId),
      response,
    };
  }
  return { ...f, gate, route, context, makeRequest, proof };
}

describe("Next.js authorization", () => {
  it("protects Route Handlers and prevents public response caching", async () => {
    const f = setup();
    const { header, response: issued } = await f.proof();
    expect(issued.headers.get("cache-control")).toBe("private, no-store");
    const response = await f.route(f.makeRequest(header), f.context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      wallet: f.wallet,
      entitlementId: f.entitlementId,
      revision: "4",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
  });

  it("rejects missing proof, bare object IDs, invalid signatures, and wrong signing wallets", async () => {
    const f = setup();
    const { challenge } = await f.proof();
    const invalid = encodeAuthorizationProof({
      challengeId: challenge.id,
      signature: "invalid",
      address: f.wallet,
      entitlementId: f.entitlementId,
    });
    for (const header of [
      undefined,
      f.entitlementId,
      invalid,
      await f.sign(challenge, new Ed25519Keypair()),
    ]) {
      const response = await f.route(f.makeRequest(header), f.context);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
      });
    }
  });

  it("verifies the supplied entitlement ID even when the wallet owns another valid entitlement", async () => {
    const f = setup();
    const { header } = await f.proof({
      ...f.challengeInput,
      entitlementId: addr("0xdead"),
    });
    expect((await f.route(f.makeRequest(header), f.context)).status).toBe(403);
  });

  it("prevents replay and concurrent redemption", async () => {
    const f = setup();
    const { header } = await f.proof();
    const results = await Promise.all([
      f.route(f.makeRequest(header), f.context),
      f.route(f.makeRequest(header), f.context),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    expect((await f.route(f.makeRequest(header), f.context)).status).toBe(401);
  });

  for (const condition of [
    "owner",
    "service",
    "plan",
    "expiry",
    "revoked",
    "missing",
  ] as const) {
    it(`returns a generic 403 for authenticated ${condition} failures`, async () => {
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
      const response = await f.route(f.makeRequest(header), f.context);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "FORBIDDEN", message: "Access denied." },
      });
    });
  }

  it("verifies renewed chain state with a fresh proof", async () => {
    const f = setup();
    f.putEntitlement({ expires_at: BigInt(f.NOW) });
    expect(
      (await f.route(f.makeRequest((await f.proof()).header), f.context))
        .status,
    ).toBe(403);
    f.putEntitlement({ expires_at: BigInt(f.NOW + 86_400_000), revision: 5n });
    const response = await f.route(
      f.makeRequest((await f.proof()).header),
      f.context,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe("5");
  });

  it("offers server-side authorization without an HTTP response wrapper", async () => {
    const f = setup();
    const { header } = await f.proof();
    const result = await f.gate.authorize({
      authorization: header,
      method: "GET",
      target: "/api/data",
    });
    expect(result.address).toBe(f.wallet);
    await expect(
      f.gate.authorizeRequest(f.makeRequest(header)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("preserves asynchronous Next.js route params and response cookies", async () => {
    const f = setup();
    const wrapped = f.gate.withAuthorization<
      NextRequest,
      { params: Promise<{ id: string }> }
    >(async (_request, auth, context) => {
      const response = NextResponse.json({
        id: (await context.params).id,
        wallet: auth.address,
      });
      response.cookies.set("application-cookie", "value", { httpOnly: true });
      return response;
    });
    const result = await wrapped(f.makeRequest((await f.proof()).header), {
      params: Promise.resolve({ id: "123" }),
    });
    expect((await result.json()).id).toBe("123");
    expect(result.headers.get("set-cookie")).toContain(
      "application-cookie=value",
    );
  });

  it("treats Proxy as a non-consuming preflight, never as authorization", async () => {
    const f = setup();
    expect(suigateProofPreflight(f.makeRequest()).status).toBe(401);
    const { challenge, header } = await f.proof();
    expect(
      suigateProofPreflight(f.makeRequest(header)).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
    expect((await f.route(f.makeRequest(header), f.context)).status).toBe(200);
    const forged = encodeAuthorizationProof({
      challengeId: challenge.id,
      address: f.wallet,
      entitlementId: f.entitlementId,
      signature: "forged",
    });
    expect(
      suigateProofPreflight(f.makeRequest(forged)).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
    expect((await f.route(f.makeRequest(forged), f.context)).status).toBe(401);
  });

  it("fails closed on outages and does not disguise application handler errors", async () => {
    const f = setup();
    f.state.objectFailure = new Error("private provider details");
    const response = await f.route(
      f.makeRequest((await f.proof()).header),
      f.context,
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private provider",
    );
    f.state.objectFailure = undefined;
    const failure = new Error("application error");
    const handler = f.gate.withAuthorization(() => {
      throw failure;
    });
    await expect(
      handler(f.makeRequest((await f.proof()).header), f.context),
    ).rejects.toBe(failure);
    expect(authorizationResponse(failure).status).toBe(503);
  });

  it("rejects expired challenges and mismatched method or target", async () => {
    const f = setup();
    const { header, challenge } = await f.proof();
    expect(
      (await f.route(f.makeRequest(header, "/api/other"), f.context)).status,
    ).toBe(401);
    expect(
      (await f.route(f.makeRequest(header, "/api/data", "POST"), f.context))
        .status,
    ).toBe(401);
    f.state.now = challenge.expiresAt;
    expect((await f.route(f.makeRequest(header), f.context)).status).toBe(401);
  });

  it("enforces JSON body limits and challenge endpoint methods", async () => {
    const f = setup();
    expect(
      (
        await f.gate.challenge(
          new Request("https://api.example/auth/challenge"),
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await f.gate.challenge(
          new Request("https://api.example/auth/challenge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.gate.challenge(
          new Request("https://api.example/auth/challenge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "x".repeat(8193),
          }),
        )
      ).status,
    ).toBe(413);
  });
});
