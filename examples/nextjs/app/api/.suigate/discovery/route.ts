import { getGate } from "../../../../lib/gate";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await getGate();
  return gate ? gate.discovery(request) : Response.json({ error: "Testnet service is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
