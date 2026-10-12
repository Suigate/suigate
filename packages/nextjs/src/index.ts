// 100% AI-generated and unaudited. Server-only execution and tests are not a security audit; see NOTICE.md.
import "server-only";
import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import {
  AuthorizationError,
  SuigateAuthorizer,
  authorizationFailure,
  privateResponseHeaders,
  readChallengeRequest,
  createDiscoveryOpenApi,
  normalizeDiscoveryOptions,
  discoveryLink,
  type AuthorizationContext,
  type AuthorizationRequest,
  type ServerAuthorizationOptions,
  type DiscoveryOptions,
} from "@suigate/core/server";

export { AuthorizationError } from "@suigate/core/server";
export type {
  AuthorizationContext,
  AuthorizationRequest,
  ServerAuthorizationOptions,
  DiscoveryOptions,
} from "@suigate/core/server";

export interface SuiGateOptions extends ServerAuthorizationOptions {
  readonly discovery?: DiscoveryOptions | false;
}
export interface RouteContext {
  readonly params: Promise<Record<string, string | string[] | undefined>>;
}

export function authorizationResponse(
  error: unknown,
  options: { discovery?: string; allow?: "GET" | "POST" } = {},
): NextResponse {
  const failure = authorizationFailure(error, options);
  return NextResponse.json(failure.body, {
    status: failure.status,
    headers: failure.headers,
  });
}

export function createSuiGate(options: SuiGateOptions) {
  const authorizer = new SuigateAuthorizer(options);
  const discoveryOptions = options.discovery
    ? normalizeDiscoveryOptions(options.discovery)
    : null;
  const failure = (error: unknown, allow: "GET" | "POST" = "POST") =>
    authorizationResponse(error, {
      ...(discoveryOptions ? { discovery: discoveryOptions.path } : {}),
      allow,
    });
  const authorize = (request: AuthorizationRequest) =>
    authorizer.authorize(request);
  const authorizeRequest = (
    request: Pick<Request, "url" | "method" | "headers">,
  ) => {
    const url = new URL(request.url);
    return authorize({
      authorization: request.headers.get("authorization"),
      method: request.method,
      target: url.pathname + url.search,
    });
  };
  const challenge = async (request: Request): Promise<NextResponse> => {
    if (request.method !== "POST") return failure(new AuthorizationError(405));
    try {
      const issued = await authorizer.issueChallenge(
        await readChallengeRequest(request),
      );
      const headers = privateResponseHeaders();
      if (discoveryOptions)
        headers.set("Link", discoveryLink(discoveryOptions.path));
      return NextResponse.json(issued, { status: 201, headers });
    } catch (error) {
      return failure(error);
    }
  };
  function publicDocument(openapi: boolean) {
    return async (request: Request): Promise<NextResponse> => {
      if (!discoveryOptions) return failure(new AuthorizationError(503));
      if (request.method !== "GET")
        return failure(new AuthorizationError(405), "GET");
      try {
        const document = openapi
          ? createDiscoveryOpenApi(discoveryOptions)
          : await authorizer.discovery(discoveryOptions);
        return NextResponse.json(document, {
          headers: privateResponseHeaders({
            Link: discoveryLink(discoveryOptions.path),
          }),
        });
      } catch (error) {
        return failure(error, "GET");
      }
    };
  }
  function withAuthorization<R extends Request = NextRequest, C = RouteContext>(
    handler: (
      request: R,
      authorization: AuthorizationContext,
      context: C,
    ) => Response | Promise<Response>,
  ): (request: R, context: C) => Promise<Response> {
    return async (request, context) => {
      let authorization: AuthorizationContext;
      try {
        authorization = await authorizeRequest(request);
      } catch (error) {
        return failure(error);
      }
      const response = await handler(request, authorization, context);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: privateResponseHeaders(response.headers),
      });
    };
  }
  return Object.freeze({
    challenge,
    authorize,
    authorizeRequest,
    withAuthorization,
    discovery: publicDocument(false),
    openapi: publicDocument(true),
  });
}
