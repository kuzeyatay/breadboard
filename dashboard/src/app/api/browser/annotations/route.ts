import db from "@/lib/db";
import { requireBuzzUser } from "@/lib/buzz/route-helpers.ts";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { requireSameOrigin } from "@/lib/request-origin.ts";
import { AnnotationError, readBrowserAnnotations, writeBrowserAnnotation } from "@/lib/browser-annotations-store.ts";
import { crumbs, crumbsErrorResponse } from "@/lib/crumbs/service.ts";

export const dynamic = "force-dynamic";
// Three places a discussion can live: this machine ("private" and rooms),
// the AT Protocol network ("public"), or an encrypted organization ("org:<id>").
const ORG_SCOPE = /^org:([a-zA-Z0-9-]{8,64})$/;
function failure(error: unknown) {
  const crumbsFailure = crumbsErrorResponse(error);
  if (crumbsFailure) return crumbsFailure;
  return error instanceof AnnotationError
    ? Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    : apiErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    const query = new URL(request.url).searchParams;
    const scope = query.get("scope") ?? "";
    const org = ORG_SCOPE.exec(scope);
    const result = scope === "public" ? await crumbs.readPublic(userId, query.get("url"), query.get("thread"))
      : org ? await crumbs.readOrg(userId, org[1]!, query.get("url"), query.get("thread"))
      : readBrowserAnnotations(db, userId, scope, query.get("url"), query.get("thread"));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request, "Post annotations from Breadboard.");
    const { userId, displayName } = await requireBuzzUser();
    const body = await readJsonBody(request, 32000);
    const org = ORG_SCOPE.exec(String(body.scope ?? ""));
    const result = body.scope === "public" ? await crumbs.writePublic(userId, body)
      : org ? await crumbs.writeOrg(userId, org[1]!, body)
      : writeBrowserAnnotation(db, userId, displayName, body);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
