// 100% AI-generated and unaudited. Authorization bugs can expose access/data; see NOTICE.md for risks and liability limitations.
import express, { type RequestHandler, type Response } from "express";
import onHeaders from "on-headers";
import {
  AuthorizationError,
  SuigateAuthorizer,
  authorizationFailure,
  privateResponseHeaders,
  MAX_CHALLENGE_BODY_BYTES,
  createDiscoveryOpenApi,
  normalizeDiscoveryOptions,
  discoveryLink,
  type AuthorizationContext,
  type ServerAuthorizationOptions,
  type DiscoveryOptions,
} from "@suigate/core/server";

export type {
  AuthorizationContext,
  ServerAuthorizationOptions,
  DiscoveryOptions,
} from "@suigate/core/server";

export interface SuiGateOptions extends ServerAuthorizationOptions {
  readonly challengePath?: string | false;
  readonly discovery?: DiscoveryOptions | false;
}

export type SuiGateMiddleware = RequestHandler & {
  readonly challenge: RequestHandler;
  readonly discovery: RequestHandler;
  readonly openapi: RequestHandler;
};

declare global {
  namespace Express {
    interface Request {
      suigate?: AuthorizationContext;
    }
  }
}

function preventCaching(response: Response): void {
  const apply = () => {
    privateResponseHeaders({
      Vary: response.getHeader("Vary")?.toString() ?? "",
    }).forEach((value, name) => response.setHeader(name, value));
  };
  apply();
  onHeaders(response, apply);
}

function reject(
  response: Response,
  error: unknown,
  discovery?: string,
  allow: "GET" | "POST" = "POST",
): void {
  const failure = authorizationFailure(error, {
    ...(discovery ? { discovery } : {}),
    allow,
  });
  failure.headers.forEach((value, name) => {
    if (name === "link") response.append("Link", value);
    else if (name !== "vary") response.setHeader(name, value);
  });
  response.status(failure.status).json(failure.body);
}

export function suiGate(options: SuiGateOptions): SuiGateMiddleware {
  const authorizer = new SuigateAuthorizer(options);
  const discoveryOptions = options.discovery
    ? normalizeDiscoveryOptions(options.discovery)
    : null;
  const challengePath = options.challengePath ?? "/.suigate/challenge";
  if (
    challengePath !== false &&
    (!challengePath.startsWith("/") ||
      challengePath.includes("?") ||
      challengePath.includes("#"))
  )
    throw new Error(
      "challengePath must be a path relative to the middleware mount",
    );
  const json = express.json({ limit: MAX_CHALLENGE_BODY_BYTES, strict: true });
  const challenge: RequestHandler = async (request, response) => {
    preventCaching(response);
    if (request.method !== "POST") {
      reject(response, new AuthorizationError(405), discoveryOptions?.path);
      return;
    }
    if (!request.is("application/json")) {
      reject(response, new AuthorizationError(400), discoveryOptions?.path);
      return;
    }
    try {
      await new Promise<void>((resolve, fail) =>
        json(request, response, (error?: { status?: number }) => {
          if (error)
            fail(new AuthorizationError(error.status === 413 ? 413 : 400));
          else resolve();
        }),
      );
      const issued = await authorizer.issueChallenge(request.body);
      if (discoveryOptions)
        response.append("Link", discoveryLink(discoveryOptions.path));
      response.status(201).json(issued);
    } catch (error) {
      reject(response, error, discoveryOptions?.path);
    }
  };
  function publicDocument(openapi: boolean): RequestHandler {
    return async (request, response) => {
      preventCaching(response);
      if (!discoveryOptions) {
        reject(response, new AuthorizationError(503));
        return;
      }
      if (request.method !== "GET") {
        reject(
          response,
          new AuthorizationError(405),
          discoveryOptions.path,
          "GET",
        );
        return;
      }
      try {
        const document = openapi
          ? createDiscoveryOpenApi(discoveryOptions)
          : await authorizer.discovery(discoveryOptions);
        response.append("Link", discoveryLink(discoveryOptions.path));
        response.json(document);
      } catch (error) {
        reject(response, error, discoveryOptions.path, "GET");
      }
    };
  }
  const discovery = publicDocument(false);
  const openapi = publicDocument(true);
  const middleware: RequestHandler = async (request, response, next) => {
    delete request.suigate;
    const path = request.originalUrl.split("?")[0];
    if (discoveryOptions && path === discoveryOptions.path) {
      await discovery(request, response, next);
      return;
    }
    if (discoveryOptions && path === discoveryOptions.openApiPath) {
      await openapi(request, response, next);
      return;
    }
    if (
      challengePath !== false &&
      (discoveryOptions
        ? path === discoveryOptions.challengePath
        : request.path === challengePath)
    ) {
      await challenge(request, response, next);
      return;
    }
    preventCaching(response);
    try {
      const headerCount = request.rawHeaders.filter(
        (name, index) =>
          index % 2 === 0 && name.toLowerCase() === "authorization",
      ).length;
      if (headerCount > 1) throw new AuthorizationError(401);
      request.suigate = await authorizer.authorize({
        authorization: request.get("authorization"),
        method: request.method,
        target: request.originalUrl,
      });
    } catch (error) {
      reject(response, error, discoveryOptions?.path);
      return;
    }
    next();
  };
  return Object.assign(middleware, { challenge, discovery, openapi });
}
