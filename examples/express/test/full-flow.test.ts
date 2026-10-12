import { expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { proAccess } from "../../shared/api.js";
import { authorizationFixture } from "../../../packages/core/test/authorization-fixture.js";
import {
  PACKAGE,
  SERVICE,
  CHAIN,
} from "../../../packages/core/test/fixtures.js";

it("connects the example's client proof flow to the real Express/core authorization path", async () => {
  const f = authorizationFixture();
  f.state.now = Date.now();
  f.putEntitlement({
    issued_at: BigInt(f.state.now - 1000),
    expires_at: BigInt(f.state.now + 60_000),
  });
  const configuration = {
    network: "testnet" as const,
    packageId: PACKAGE,
    typeOrigin: PACKAGE,
    serviceId: SERVICE,
    chainIdentifier: CHAIN,
    plan: "pro",
  };
  const app = createApp(configuration, f.options);
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      let call =
        init?.method === "POST"
          ? request(app).post(path)
          : request(app).get(path);
      new Headers(init?.headers).forEach((value, key) => {
        call = call.set(key, value);
      });
      if (typeof init?.body === "string") call = call.send(init.body);
      const response = await call;
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  const sign = vi.fn((message: Uint8Array) =>
    f.keypair.signPersonalMessage(message),
  );
  const options = {
    configuration,
    address: f.wallet,
    entitlementId: f.entitlementId,
    sign,
    assertCurrent: () => {},
    fetcher: fetcher as typeof fetch,
  };
  expect(await proAccess(options)).toMatchObject({
    tier: "pro",
    wallet: f.wallet,
    entitlementId: f.entitlementId,
  });
  expect(await proAccess(options)).toMatchObject({ tier: "pro" });
  expect(sign).toHaveBeenCalledTimes(2);
  const headers = fetcher.mock.calls
    .filter(([path]) => path === "/api/pro")
    .map(([, init]) => new Headers(init?.headers).get("authorization"));
  expect(headers[0]).not.toBe(headers[1]);
});

it("does not send a protected request if wallet context changes before approval", async () => {
  const f = authorizationFixture();
  const fetcher = vi.fn(async () =>
    Response.json({
      version: 1,
      id: "a".repeat(64),
      message: "message",
      address: f.wallet,
      serviceId: SERVICE,
      chainIdentifier: CHAIN,
      expiresAt: Date.now() + 60_000,
    }),
  );
  const sign = vi.fn();
  await expect(
    proAccess({
      configuration: {
        network: "testnet",
        packageId: PACKAGE,
        typeOrigin: PACKAGE,
        serviceId: SERVICE,
        chainIdentifier: CHAIN,
        plan: "pro",
      },
      address: f.wallet,
      entitlementId: f.entitlementId,
      fetcher: fetcher as typeof fetch,
      sign,
      assertCurrent: () => {
        throw new Error("wallet changed");
      },
    }),
  ).rejects.toThrow("wallet changed");
  expect(sign).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
