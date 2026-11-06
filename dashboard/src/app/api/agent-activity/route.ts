import { NextResponse } from "next/server";

import { readNotchAgentActivity } from "@/lib/notch-agent-activity";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

let cached: { at: number; payload: Awaited<ReturnType<typeof readNotchAgentActivity>> } | null = null;
let pending: Promise<Awaited<ReturnType<typeof readNotchAgentActivity>>> | null = null;

async function activity() {
  const now = Date.now();
  if (cached && now - cached.at < 1_500) return cached.payload;
  if (!pending) {
    pending = readNotchAgentActivity({ now }).then((payload) => {
      cached = { at: Date.now(), payload };
      return payload;
    }).finally(() => { pending = null; });
  }
  return pending;
}

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json(await activity(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    return NextResponse.json(
      { captured_at: new Date().toISOString(), providers: {} },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
