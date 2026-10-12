import { getGate } from "../../../lib/gate";
import type { NextRequest } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await getGate();
  if (!gate)
    return Response.json(
      { error: "Testnet service is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  return gate.withAuthorization((_request, auth) =>
    Response.json({
      tier: "pro",
      message: "Live entitlement verified on Sui.",
      wallet: auth.address,
      entitlementId: auth.entitlement.id,
      expiresAt: auth.entitlement.expiresAt.toString(),
    }),
  )(request, { params: Promise.resolve({}) });
}
