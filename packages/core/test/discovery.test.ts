import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
afterEach(() => mock.restoreAll());
import { Ajv } from "ajv";
import { SuigateAuthorizer } from "../src/server.js";
import { SuigateClient } from "../src/client.js";
import {
  AUTHORIZATION_PROOF_SCHEMA,
  CHALLENGE_SCHEMA,
  DISCOVERY_SCHEMA,
  createDiscoveryOpenApi,
  normalizeDiscoveryOptions,
} from "../src/discovery.js";
import {
  AuthorizationError,
  authorizationFailure,
  parseAuthorizationProof,
} from "../src/http-auth.js";
import { authorizationFixture } from "./authorization-fixture.js";
import { CHAIN, PACKAGE, SERVICE, planValue } from "./fixtures.js";

const links = {
  path: "/api/.suigate/discovery",
  challengePath: "/api/challenge",
  openApiPath: "/api/.suigate/openapi",
  checkoutPath: "/checkout",
};
const ajv = new Ajv({ strict: false, allErrors: true });

test("discovery validates against its schema and uses live exact-value chain terms", async () => {
  const f = authorizationFixture();
  f.state.plan = planValue({ price: 9_007_199_254_740_993n });
  const authorizer = new SuigateAuthorizer(f.options);
  const purchase = mock.method(
    SuigateClient.prototype,
    "purchaseEntitlement",
    () => {
      throw new Error("must not purchase");
    },
  );
  const manifest = await authorizer.discovery(links);
  const validate = ajv.compile(DISCOVERY_SCHEMA);
  assert.ok(validate(manifest), JSON.stringify(validate.errors));
  assert.deepEqual(manifest.deployment, {
    packageId: PACKAGE,
    typeOrigin: PACKAGE,
    serviceId: SERVICE,
  });
  assert.equal(manifest.network.chainIdentifier, CHAIN);
  assert.equal(manifest.software.aiGeneratedPercentage, 100);
  assert.equal(manifest.software.humanAuditStatus, "not-audited");
  assert.equal(manifest.software.humanAuditReport, null);
  assert.equal(manifest.software.lossOfFundsPossible, true);
  assert.equal(manifest.software.lossOfKeysPossible, true);
  assert.ok(manifest.software.notice.includes("hallucinated"));
  assert.equal(manifest.terms.priceBaseUnits, "9007199254740993");
  assert.equal(manifest.terms.isQuote, false);
  assert.equal(manifest.safety.discoveryAuthorizesSpending, false);
  assert.equal(manifest.gas.protocolGaslessEligible, false);
  assert.equal(manifest.gas.sponsorship, null);
  assert.equal(JSON.stringify(manifest).includes("127.0.0.1:1"), false);
  assert.equal(purchase.mock.callCount(), 0);
  f.state.plan = planValue({
    price: 2000n,
    purchases_enabled: false,
    renewals_enabled: false,
  });
  const updated = await authorizer.discovery(links);
  assert.equal(updated.terms.priceBaseUnits, "2000");
  assert.equal(updated.acquisition.purchase.available, false);
  assert.equal(updated.acquisition.renewal.available, false);
  assert.equal(validate({ ...manifest, version: 2 }), false);
});

test("OpenAPI describes configured public paths and actual challenge/proof shapes", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  const api = createDiscoveryOpenApi(links);
  assert.equal(api.openapi, "3.1.0");
  assert.equal(api["x-suigate"].software.humanAuditStatus, "not-audited");
  assert.ok(api.info.description.includes("100% AI-generated"));
  assert.deepEqual(
    Object.keys(api.paths).sort(),
    [links.path, links.challengePath, links.openApiPath].sort(),
  );
  assert.deepEqual(api.components.schemas.SuigateDiscovery, DISCOVERY_SCHEMA);
  const challenge = await authorizer.issueChallenge(f.challengeInput);
  assert.ok(ajv.compile(CHALLENGE_SCHEMA)(challenge));
  assert.ok(
    ajv.compile(AUTHORIZATION_PROOF_SCHEMA)(
      parseAuthorizationProof(await f.sign(challenge)),
    ),
  );
  assert.equal(api.components.securitySchemes.Suigate.scheme, "Suigate");
  assert.equal(api["x-suigate"].automaticSpending, false);
});

test("discovery does not issue, consume, or authenticate challenges", async () => {
  const f = authorizationFixture();
  const authorizer = new SuigateAuthorizer(f.options);
  const challenge = await authorizer.issueChallenge(f.challengeInput);
  const consume = mock.method(f.store, "consumeIfUnexpired");
  const put = mock.method(f.store, "put");
  await authorizer.discovery(links);
  assert.equal(consume.mock.callCount(), 0);
  assert.equal(put.mock.callCount(), 0);
  await authorizer.authorize({
    method: "GET",
    target: "/api/data",
    authorization: await f.sign(challenge),
  });
  assert.equal(consume.mock.callCount(), 1);
});

test("only explicit sponsorship is advertised and never as protocol gasless", async () => {
  const f = authorizationFixture();
  const manifest = await new SuigateAuthorizer(f.options).discovery({
    ...links,
    sponsorship: { address: f.wallet, endpoint: "/api/sponsor" },
  });
  assert.ok(ajv.compile(DISCOVERY_SCHEMA)(manifest));
  assert.equal(manifest.gas.sponsorship?.address, f.wallet);
  assert.deepEqual(manifest.gas.strategies, ["user", "sponsored"]);
  assert.equal(manifest.gas.protocolGaslessEligible, false);
});

test("unsafe, noncanonical, or colliding discovery URLs are rejected", () => {
  for (const path of [
    "https://attacker.example",
    "//attacker.example",
    "javascript:alert(1)",
    "/a\r\nLink: injected",
    "/a>;<x",
    "/a\\b",
    "/a/../b",
    "/a?token=secret",
    "/a#fragment",
    "/%zz",
  ]) {
    assert.throws(() => normalizeDiscoveryOptions({ ...links, path }));
  }
  assert.throws(() =>
    normalizeDiscoveryOptions({ ...links, path: links.challengePath }),
  );
  assert.throws(() =>
    normalizeDiscoveryOptions({
      ...links,
      sponsorship: { address: "0x1", endpoint: "//attacker.example" },
    }),
  );
});

test("next-action hints preserve legacy responses and never infer that payment fixes a denial", () => {
  const legacy = authorizationFailure(new AuthorizationError(403));
  assert.deepEqual(legacy.body, {
    error: { code: "FORBIDDEN", message: "Access denied." },
  });
  for (const [status, action] of [
    [401, "authenticate"],
    [403, "inspect_entitlement"],
    [503, "retry_later"],
    [429, "retry_later"],
  ] as const) {
    const response = authorizationFailure(
      new AuthorizationError(status, {
        cause: new Error("private wallet/provider details"),
      }),
      { discovery: links.path },
    );
    assert.equal(response.status, status);
    assert.equal(response.body.suigate?.nextAction, action);
    assert.equal(
      response.body.suigate?.software.humanAuditStatus,
      "not-audited",
    );
    assert.equal(response.body.suigate?.software.aiGenerated, true);
    assert.equal(
      response.headers.get("Link"),
      `</api/.suigate/discovery>; rel="describedby"; type="application/json"`,
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(
      JSON.stringify(response.body).includes("private wallet/provider"),
      false,
    );
  }
  assert.equal(
    authorizationFailure(new AuthorizationError(405), {
      allow: "GET",
    }).headers.get("Allow"),
    "GET",
  );
});

test("RPC failure never produces fabricated payment terms or payment-required responses", async () => {
  const f = authorizationFixture();
  f.state.objectFailure = new Error("provider unavailable");
  await assert.rejects(new SuigateAuthorizer(f.options).discovery(links));
  assert.equal(
    authorizationFailure(f.state.objectFailure, { discovery: links.path })
      .status,
    503,
  );
});
