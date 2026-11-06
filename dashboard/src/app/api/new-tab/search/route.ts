import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { searchBreadboard } from "@/lib/breadboard-search-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const result = await searchBreadboard(db, userId, query);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
