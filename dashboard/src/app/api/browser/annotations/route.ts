import db from "@/lib/db";
import { requireBuzzUser } from "@/lib/buzz/route-helpers.ts";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { requireSameOrigin } from "@/lib/request-origin.ts";
import { AnnotationError, readBrowserAnnotations, writeBrowserAnnotation } from "@/lib/browser-annotations-store.ts";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return error instanceof AnnotationError
    ? Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    : apiErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    const query = new URL(request.url).searchParams;
    return Response.json(readBrowserAnnotations(db, userId, query.get("scope"), query.get("url"), query.get("thread")), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request, "Post annotations from Breadboard.");
    const { userId, displayName } = await requireBuzzUser();
    return Response.json(writeBrowserAnnotation(db, userId, displayName, await readJsonBody(request, 32000)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
