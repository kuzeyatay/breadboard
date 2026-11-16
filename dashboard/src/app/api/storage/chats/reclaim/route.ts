import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { assertStorageOwner } from "@/lib/storage/store";
import { reclaimChatFolder } from "@/lib/storage/budget";
import { dashboardDataDir } from "@/lib/runtime-paths";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertStorageOwner(db, await requireUserId());
    const body = await request.json().catch(() => null);
    if (!body || Object.keys(body).join() !== "folder" || typeof body.folder !== "string" || !/^[a-z0-9_-]{1,80}$/u.test(body.folder))
      return NextResponse.json({ error: "Invalid chat reference." }, { status: 400 });
    return NextResponse.json(await reclaimChatFolder(db, dashboardDataDir(), body.folder));
  } catch (error) { return routeErrorResponse(error); }
}
