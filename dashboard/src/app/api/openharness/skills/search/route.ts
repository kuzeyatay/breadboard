import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/openharness/route-helpers.ts";
import { searchRegistry } from "@/lib/openharness/skills.ts";
import { recordAuditEvent } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

// Search the official skill ecosystem. Terminal/scout surface only — this is a
// dashboard-user action (authenticated). Returns candidate METADATA only; no
// download or install happens here.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const candidates = await searchRegistry(query);
    recordAuditEvent({
      eventType: "skill.search",
      userId,
      payload: { query: query.slice(0, 200), resultCount: candidates.length },
    });
    return NextResponse.json({ candidates });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
