import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import {
  arisAvailability,
  arisSourceModifiedAt,
} from "@/lib/aris/agent.ts";
import {
  ARIS_AGENT_COMMAND,
  ARIS_AGENT_NAME,
} from "@/lib/aris/identity.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const availability = arisAvailability();
    return NextResponse.json({
      ok: true,
      agent: {
        name: ARIS_AGENT_NAME,
        command: ARIS_AGENT_COMMAND,
      },
      available: availability.available,
      installed: availability.installed,
      skillCount: availability.skillCount,
      reason: availability.reason,
      source: availability.root ? "Local cloned ARIS" : null,
      sourceModifiedAt: arisSourceModifiedAt(),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
