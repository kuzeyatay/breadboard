export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(
    { ok: true, service: "breadboard-skills-catalog" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function HEAD(): Response {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
