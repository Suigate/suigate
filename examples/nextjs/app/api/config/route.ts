import { loadExampleConfiguration } from "../../../../shared/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadExampleConfiguration();
  return Response.json(
    config ?? {
      error:
        "Run suigate init and deploy, or configure the example environment.",
    },
    { status: config ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
