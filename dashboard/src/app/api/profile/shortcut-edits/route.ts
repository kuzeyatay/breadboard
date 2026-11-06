import db from "@/lib/db";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-core";
import { validShortcutEdits } from "@/lib/shortcut-edits";
import { readShortcutEdits, writeShortcutEdits } from "@/lib/shortcut-edits-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
async function owner(request: Request) {
  const userId = await requireUserId();
  const user = db.prepare("SELECT email FROM users WHERE id=?").get(userId) as { email: string } | undefined;
  const key = new URL(request.url).searchParams.get("ownerKey")?.trim().toLowerCase();
  if (!key || !user || ![String(userId), user.email.trim().toLowerCase()].includes(key)) {
    throw new RouteError(403, "Your account changed. Reload before editing shortcuts.");
  }
  return userId;
}
export async function GET(request: Request) {
  try { return Response.json({ edits: readShortcutEdits(db, await owner(request)) }, { headers }); }
  catch (error) { return routeErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const userId = await owner(request), body = await readJsonBody(request, 160_000);
    if (!validShortcutEdits(body.edits)) throw new RouteError(400, "Invalid shortcut changes.");
    return Response.json({ edits: writeShortcutEdits(db, userId, body.edits) }, { headers });
  } catch (error) { return routeErrorResponse(error); }
}
