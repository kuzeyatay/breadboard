import { NextResponse } from "next/server";
import { loadAgentMemoryOverview } from "@/lib/conversations/memory-inspection";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const includeSuperseded =
      new URL(request.url).searchParams.get("includeForgotten") === "1";
    return NextResponse.json(loadAgentMemoryOverview(userId, { includeSuperseded }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
