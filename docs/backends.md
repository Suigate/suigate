# Express and Next.js

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). Authorization safeguards and automated tests are not a human audit.

Both adapters delegate wallet authentication and all entitlement checks to `@suigate/core/server`. They never accept client-provided entitlement metadata as authorization.

Optional `discovery` configuration adds public discovery/OpenAPI handlers, HTTP Link headers, and structured next-action hints without changing authorization or status codes. See [agent discovery](agent-discovery.md) for complete Express/Next.js routing examples.

## Trusted configuration

Supply `client`, `packageId`, `chainIdentifier`, and `audience` directly, plus required `serviceId` and `plan`. Alternatively configure:

```text
SUIGATE_NETWORK=testnet
SUIGATE_RPC_URL=https://fullnode.testnet.sui.io:443
SUIGATE_PACKAGE_ID=your-published-package-id
SUIGATE_CHAIN_IDENTIFIER=69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD
SUIGATE_AUDIENCE=http://localhost:3001
SUIGATE_SERVICE_ID=your-service-id
```

The audience is a trusted origin, not a value inferred from request Host/forwarded headers. `serviceId` remains an explicit adapter option; the examples read it from their configuration loader. Production origins should use HTTPS.

## Express

```ts
import { suiGate } from "@suigate/express";

const gate = suiGate({
  serviceId: process.env.SUIGATE_SERVICE_ID!,
  plan: "pro",
  challengePath: false,
});

app.get("/api/free", (_req, res) => res.json({ tier: "free" }));
app.post("/api/challenge", gate.challenge);
app.get("/api/pro", gate, (req, res) => {
  res.json({ wallet: req.suigate!.address });
});
```

The shorter `app.use('/api', suiGate({ serviceId, plan }))` automatically exposes `POST /api/.suigate/challenge` under that mount and gates the remaining requests. Middleware preserves protected request bodies for application body parsers. Configure CORS and public OPTIONS handling before authentication when necessary.

## Next.js App Router

Create one shared gate in a server-only module:

```ts
import { createSuiGate } from "@suigate/nextjs";

export const gate = createSuiGate({
  serviceId: process.env.SUIGATE_SERVICE_ID!,
  plan: "pro",
});
```

Export `POST = gate.challenge` from the public challenge route. Protect a Route Handler:

```ts
export const GET = gate.withAuthorization(async (_request, auth, context) => {
  const params = await context.params;
  return Response.json({ wallet: auth.address, params });
});
```

`gate.authorizeRequest(request)` and `gate.authorize({ authorization, method, target })` support server/data-access code. The expected target must come from trusted server routing. Call once and pass the returned context downstream; a second call with the same proof is a replay.

Use the Node runtime and request-time rendering. Do not cache authorization functions or statically render protected data. The Next main entry is guarded by `server-only`. Current Next.js uses Promise-based route params and `proxy.ts`, not the deprecated middleware convention.

The optional `suigateProofPreflight` from `@suigate/nextjs/proxy` only checks proof presence/format. **It does not authorize access.** Exclude the public challenge route from its matcher and always verify in protected Route Handlers/server functions. The examples deliberately keep definitive authorization in the routes.

## Responses, caching, and deployments

- `401`: missing, invalid, expired, or replayed authentication proof.
- `403`: valid authentication, insufficient entitlement.
- `503`: verification infrastructure unavailable; access remains denied.
- Challenge endpoints additionally use `400`, `405`, `413`, and `429`.

Responses are generic and avoid disclosing ownership or provider details. Protected responses use `private, no-store` and `Vary: Authorization`.

`cache` and `cacheTtlMs` use core's cache abstraction. Authorization still performs live reads. Default challenge storage is bounded process-local memory; supply a shared atomic `ChallengeStore` for multiple workers or serverless deployments. Redis is not required. The single-process examples are not a production distributed session system.
