import { requireReadableClusterFromSlug, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { corsHeaders } from "@/lib/hermes/quartz-support.ts";
import { readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { requireSameOrigin } from "@/lib/request-origin";
import { gardenReadEntries } from "@/lib/hermes/garden-reader.ts";
import { pageUnderstanding } from "@/lib/page-understanding.ts";
import { understandingPageSlug } from "@/lib/page-understanding-types.ts";
import { getReviewStore } from "@/lib/review/instance.ts";
import { resolveUnderstandingPage } from "@/lib/page-understanding-path.ts";

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

/** Reads and changes always belong to the signed-in reader, including shared gardens. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { ...corsHeaders(origin), "Cache-Control": "no-store" };
  try {
    if (!origin || headers["Access-Control-Allow-Origin"] !== origin) {
      requireSameOrigin(request, "This origin cannot save understanding.");
      if (origin) headers["Access-Control-Allow-Origin"] = origin;
    }
    const body = await readJsonBody(request, 8_192);
    if (typeof body.gardenSlug !== "string" || !body.gardenSlug || body.gardenSlug.length > 200) {
      throw new RouteError(400, "A garden is required.");
    }
    const { userId, cluster } = await requireReadableClusterFromSlug(body.gardenSlug);
    if (Object.hasOwn(body, "understood")) {
      if (typeof body.understood !== "boolean" || typeof body.pageSlug !== "string" || body.pageSlug.length > 1000) {
        throw new RouteError(400, "A page and a boolean understood value are required.");
      }
      const contentPath = process.env.QUARTZ_CONTENT_PATH;
      if (!contentPath) throw new RouteError(503, "Garden content is unavailable.");
      const relativePath = await resolveUnderstandingPage(contentPath, cluster.slug, body.pageSlug);
      if (!relativePath) throw new RouteError(404, "Page not found or ambiguous.");
      const base = body.pageSlug.split("/").at(-1)!;
      const reviews = getReviewStore();
      // Only an unmigrated legacy review card requires a uniqueness scan. Once
      // migrated (or for pages without one), toggling does no recursive walk.
      if (body.pageSlug !== base && reviews.hasPageCard(userId, cluster.slug, base) && !reviews.hasPageCard(userId, cluster.slug, body.pageSlug)) {
        const pages = await gardenReadEntries(contentPath, cluster.slug, undefined, { includeIndexes: true });
        if (pages.filter(page => understandingPageSlug(page.relPath).split("/").at(-1) === base).length === 1) {
          reviews.migratePageSlug(userId, cluster.slug, base, body.pageSlug);
        }
      }
      pageUnderstanding.set(userId, cluster.slug, relativePath, body.understood);
    }
    return Response.json({ pages: pageUnderstanding.list(userId, cluster.slug) }, { headers });
  } catch (error) {
    const response = routeErrorResponse(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
