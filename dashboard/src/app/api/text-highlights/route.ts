import { requireUserId } from "@/lib/server-auth";
import { corsHeaders } from "@/lib/hermes/quartz-support.ts";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { requireSameOrigin } from "@/lib/request-origin";
import { syncTextHighlights } from "@/lib/text-highlight-store.ts";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { ...corsHeaders(origin), "Cache-Control": "no-store" };
  try {
    if (!origin || headers["Access-Control-Allow-Origin"] !== origin) {
      // Next's standalone request URL can contain its bind address rather than
      // the desktop window's per-launch authority. Validate the browser-facing
      // host using the same policy as the other authenticated desktop routes.
      requireSameOrigin(request, "This origin cannot save highlights.");
      if (origin) headers["Access-Control-Allow-Origin"] = origin;
    }
    const userId = await requireUserId();
    const body = await readJsonBody(request, 8 * 1024 * 1024);
    return Response.json(syncTextHighlights(userId, body), { headers });
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
