import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { readOpenHarnessConfig } from "@/lib/openharness/config.ts";
import { apiErrorResponse } from "@/lib/openharness/route-helpers.ts";

export const dynamic = "force-dynamic";

// Reports whether OpenHarness is enabled and reachable. When disabled this
// returns `{ enabled: false }` with 200 so the UI can render a clear
// unavailable state instead of hanging or crash-looping.
export async function GET() {
  try {
    await requireUserId();
    const config = readOpenHarnessConfig();
    if (!config.enabled) {
      return NextResponse.json({ enabled: false, healthy: false });
    }
    try {
      const health = await getOpenHarnessGateway().health();
      return NextResponse.json({ enabled: true, healthy: health.healthy, version: health.version });
    } catch {
      // Enabled but unreachable — a recoverable state the UI should surface.
      return NextResponse.json({ enabled: true, healthy: false });
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
