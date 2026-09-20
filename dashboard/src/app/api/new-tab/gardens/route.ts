import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { readNewTabGardens, refreshNewTabGardenCounts } from "@/lib/new-tab-gardens";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const gardens = await refreshNewTabGardenCounts(readNewTabGardens(db, userId));
    return NextResponse.json({ gardens }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
