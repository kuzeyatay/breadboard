import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { assertStorageOwner } from "@/lib/storage/store";
import { storageStatus } from "@/lib/storage/service";

export const dynamic = "force-dynamic";
export async function GET() {
  try { assertStorageOwner(db, await requireUserId()); return NextResponse.json(await storageStatus()); }
  catch (error) { return routeErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    assertStorageOwner(db, await requireUserId());
    const body = await request.json().catch(() => null);
    if (!body || typeof body.automatic !== "boolean" || Object.keys(body).some(key => key !== "automatic"))
      return NextResponse.json({ error: "Choose whether automatic housekeeping is enabled." }, { status: 400 });
    db.prepare("UPDATE storage_settings SET automatic=?,updated_at=? WHERE id=1").run(body.automatic ? 1 : 0, Date.now());
    return NextResponse.json({ automatic: body.automatic });
  } catch (error) { return routeErrorResponse(error); }
}
