import db from "@/lib/db";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-core";
import { validShortcutOrder } from "@/lib/shortcut-order";
import { readShortcutOrder, writeShortcutOrder } from "@/lib/shortcut-order-store";

export const dynamic = "force-dynamic";
const headers = {"Cache-Control": "no-store"};
async function owner(request: Request) {
  const userId = await requireUserId();
  const user = db.prepare("SELECT email FROM users WHERE id=?").get(userId) as {email:string} | undefined;
  const key = new URL(request.url).searchParams.get("ownerKey")?.trim().toLowerCase();
  if (!key || !user || ![String(userId), user.email.trim().toLowerCase()].includes(key)) throw new RouteError(403, "Your account changed. Reload before reordering shortcuts.");
  return userId;
}
export async function GET(request: Request) {
  try { return Response.json({order: readShortcutOrder(db, await owner(request))}, {headers}); }
  catch (error) { return routeErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const userId = await owner(request), body = await readJsonBody(request, 80_000);
    if (!validShortcutOrder(body.order)) throw new RouteError(400, "Invalid shortcut order.");
    return Response.json({order: writeShortcutOrder(db, userId, body.order)}, {headers});
  } catch (error) { return routeErrorResponse(error); }
}
