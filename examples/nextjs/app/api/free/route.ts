export function GET() {
  return Response.json({
    tier: "free",
    message: "Free software access. No wallet required.",
  });
}
