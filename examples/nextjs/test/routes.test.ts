import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server.js";
import { createSuiGate } from "@suigate/nextjs";
import { authorizationFixture } from "../../../packages/core/test/authorization-fixture.js";
import type { Challenge } from "@suigate/core";

const state = vi.hoisted(() => ({
  gate: null as ReturnType<typeof createSuiGate> | null,
}));
vi.mock("../lib/gate", () => ({ getGate: async () => state.gate }));
import { GET as free } from "../app/api/free/route";
import { GET as pro } from "../app/api/pro/route";
import { POST as challenge } from "../app/api/challenge/route";
import { GET as discover } from "../app/api/.suigate/discovery/route";
import { GET as openapi } from "../app/api/.suigate/openapi/route";
import { EXAMPLE_DISCOVERY } from "../../shared/discovery";

describe("Next.js example routes", () => {
  it("serves a free endpoint and fails closed without configuration", async () => {
    state.gate = null;
    expect((await free().json()).tier).toBe("free");
    expect(
      (await pro(new NextRequest("http://localhost:3000/api/pro"))).status,
    ).toBe(503);
  });
  it("exposes public discovery and schema through the example Route Handlers", async () => {
    state.gate = null;
    expect(
      (
        await discover(
          new Request("http://localhost:3000/api/.suigate/discovery"),
        )
      ).status,
    ).toBe(503);
    const f = authorizationFixture();
    state.gate = createSuiGate({ ...f.options, discovery: EXAMPLE_DISCOVERY });
    const denied = await pro(new NextRequest("http://localhost:3000/api/pro"));
    const hint = (await denied.json()).suigate;
    const document = await discover(
      new Request(`http://localhost:3000${hint.discovery}`),
    );
    expect(document.status).toBe(200);
    expect((await document.json()).links.challenge).toBe("/api/challenge");
    expect(
      (await openapi(new Request("http://localhost:3000/api/.suigate/openapi")))
        .status,
    ).toBe(200);
  });

  it("requires a fresh proof for Pro access", async () => {
    const f = authorizationFixture();
    state.gate = createSuiGate({ ...f.options, discovery: EXAMPLE_DISCOVERY });
    expect(
      (await pro(new NextRequest("http://localhost:3000/api/pro"))).status,
    ).toBe(401);
    const issued = await challenge(
      new Request("http://localhost:3000/api/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f.challengeInput, target: "/api/pro" }),
      }),
    );
    const header = await f.sign((await issued.json()) as Challenge);
    const request = () =>
      new NextRequest("http://localhost:3000/api/pro", {
        headers: { Authorization: header },
      });
    expect((await pro(request())).status).toBe(200);
    expect((await pro(request())).status).toBe(401);
  });
});
