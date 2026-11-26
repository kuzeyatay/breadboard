import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { assertStorageOwner } from "@/lib/storage/store";
import { runStorageMaintenance } from "@/lib/storage/service";
import { desktopMaintenanceAuthorized } from "@/lib/storage/maintenance-key";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    // The desktop's per-launch key covers idle ticks while the app is locked;
    // every other action still needs the signed-in installation owner.
    const desktop = desktopMaintenanceAuthorized(request);
    if (!desktop) assertStorageOwner(db, await requireUserId());
    const body = await request.json().catch(() => null);
    if (!body || !["tick", "clean", "scan", "compact"].includes(body.action)
      || Object.keys(body).some(key => !["action", "idleMs"].includes(key))
      || (body.idleMs !== undefined && (!Number.isFinite(body.idleMs) || body.idleMs < 0)))
      return NextResponse.json({ error: "Invalid storage maintenance request." }, { status: 400 });
    if (desktop && body.action !== "tick")
      return NextResponse.json({ error: "The desktop key only runs idle maintenance." }, { status: 403 });
    return NextResponse.json(await runStorageMaintenance({ action: body.action, idleMs: body.idleMs, signal: request.signal }));
  } catch (error) { return routeErrorResponse(error); }
}
