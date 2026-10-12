import { NextResponse, type NextRequest } from "next/server.js";
import {
  authorizationFailure,
  parseAuthorizationProof,
  privateResponseHeaders,
  discoveryLink,
} from "@suigate/core/server";

export function suigateProofPreflight(request: NextRequest): NextResponse {
  return preflight(request);
}

export function createSuigateProofPreflight(options: { discovery: string }) {
  discoveryLink(options.discovery);
  const path = options.discovery;
  return (request: NextRequest): NextResponse => preflight(request, path);
}

function preflight(request: NextRequest, discovery?: string): NextResponse {
  try {
    parseAuthorizationProof(request.headers.get("authorization"));
    return NextResponse.next({ headers: privateResponseHeaders() });
  } catch (error) {
    const failure = authorizationFailure(error, discovery ? { discovery } : {});
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: failure.headers,
    });
  }
}
