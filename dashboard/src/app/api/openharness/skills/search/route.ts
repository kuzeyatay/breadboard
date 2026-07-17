import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/openharness/route-helpers.ts";
import { searchRegistry } from "@/lib/openharness/skills.ts";

export const dynamic = "force-dynamic";

// Search the curated skill registry. Terminal/scout surface only — this is a
// dashboard-user action (authenticated). Returns candidate METADATA only; no
// download or install happens here.
export async function GET(request: Request) {
  try {
    await requireUserId();
    requireEnabled();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ candidates: searchRegistry(query) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
