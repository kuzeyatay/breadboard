import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { assertStorageOwner } from "@/lib/storage/store";
import { runStorageMaintenance } from "@/lib/storage/service";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertStorageOwner(db, await requireUserId());
    const body = await request.json().catch(() => null);
    if (!body || !["tick", "clean", "scan", "compact"].includes(body.action)
      || Object.keys(body).some(key => !["action", "idleMs"].includes(key))
      || (body.idleMs !== undefined && (!Number.isFinite(body.idleMs) || body.idleMs < 0)))
      return NextResponse.json({ error: "Invalid storage maintenance request." }, { status: 400 });
    return NextResponse.json(await runStorageMaintenance({ action: body.action, idleMs: body.idleMs, signal: request.signal }));
  } catch (error) { return routeErrorResponse(error); }
}
