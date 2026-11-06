import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { readSearchHistory, updateSearchHistory } from "@/lib/new-tab-search-history";
import { normalizeSearchHistory } from "@/lib/new-tab-search-suggestions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try { return NextResponse.json({ items: readSearchHistory(db, await requireUserId()) }, { headers }); }
  catch (error) { return routeErrorResponse(error); }
}

async function change(request: Request, remove: boolean) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);
    const entry = normalizeSearchHistory([body])[0];
    if (!entry) throw new RouteError(400, "A search query and scope are required.");
    return NextResponse.json({ items: updateSearchHistory(db, userId, entry, remove) }, { headers });
  } catch (error) { return routeErrorResponse(error); }
}

export async function POST(request: Request) { return change(request, false); }
export async function DELETE(request: Request) { return change(request, true); }
