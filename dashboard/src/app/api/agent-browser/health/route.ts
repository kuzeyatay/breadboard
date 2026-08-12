import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { runtimeAvailability } from "@/lib/agent-browser/run-manager.ts";
import { agentBrowserErrorResponse } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const availability = runtimeAvailability();
    return NextResponse.json({
      ok: true,
      available: availability.available,
      reason: availability.reason ?? null,
      // Never expose absolute install paths beyond a boolean presence signal.
      installed: Boolean(availability.entry),
      browserFound: Boolean(availability.browser),
    });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}
