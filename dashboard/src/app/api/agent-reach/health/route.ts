import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { doctor, runtimeAvailability } from "@/lib/agent-reach/runtime.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUserId();
    const availability = runtimeAvailability();
    if (!availability.available) {
      return NextResponse.json({
        ok: true,
        available: false,
        cloned: availability.cloned,
        reason: availability.reason ?? null,
        channels: [],
      });
    }
    // Probing really executes upstream tools, so the default response uses the
    // cached report; `?refresh=1` is the deliberate slow path.
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const channels = await doctor({ force: refresh });
    return NextResponse.json({
      ok: true,
      available: true,
      cloned: true,
      reason: null,
      channels: channels.map((channel) => ({
        channel: channel.channel,
        status: channel.status,
        tier: channel.tier,
        activeBackend: channel.activeBackend,
        backends: channel.backends,
        message: channel.message,
      })),
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
