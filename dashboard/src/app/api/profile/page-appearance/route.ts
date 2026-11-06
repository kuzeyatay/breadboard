import db from "@/lib/db";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-core";
import { isAppearancePage, isAppearanceTheme, MAX_SAVED_BACKGROUND_LENGTH, parseSavedBackground } from "@/lib/page-appearance-persistence";
import { readSavedPageAppearance, writeSavedBackground } from "@/lib/page-appearance-store";

export const dynamic = "force-dynamic";

async function requireOwner(ownerKey: unknown): Promise<number> {
  const userId = await requireUserId();
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string } | undefined;
  // A stale tab from the previous account must not copy its image to the
  // newly signed-in account. Ownership still comes exclusively from session.
  if (typeof ownerKey !== "string" || !user || ![user.email.trim().toLowerCase(), String(userId)].includes(ownerKey.trim().toLowerCase())) {
    throw new RouteError(403, "The appearance account has changed. Reload and try again.");
  }
  return userId;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const userId = await requireOwner(params.get("ownerKey"));
    const page = params.get("page");
    if (!isAppearancePage(page)) throw new RouteError(400, "Choose a valid page.");
    return Response.json({ preferences: readSavedPageAppearance(db, userId, page) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireOwner(new URL(request.url).searchParams.get("ownerKey"));
    const body = await readJsonBody(request, MAX_SAVED_BACKGROUND_LENGTH + 4096);
    const value = parseSavedBackground(body.value);
    if (!isAppearancePage(body.page) || !isAppearanceTheme(body.theme) || !value ||
      (body.onlyIfMissing !== undefined && typeof body.onlyIfMissing !== "boolean")) {
      throw new RouteError(400, "Choose a valid background.");
    }
    return Response.json({ value: writeSavedBackground(db, userId, body.page, body.theme, value, body.onlyIfMissing === true) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
