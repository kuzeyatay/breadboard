import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { health } from "@/lib/paper-trader/runtime.ts";
import { SETUP_ACTIONS } from "@/lib/paper-trader/setup.ts";
import { deskStatus } from "@/lib/paper-trader/supervisor.ts";
import { PAPER_TRADER_AGENT_ID } from "@/lib/paper-trader/identity.ts";
import { paperTraderSettingsFrom } from "@/lib/paper-trader/settings.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Whether the desk can run, and whether it currently is. Every check behind this
 * is a filesystem read, so unlike the other cloned-runtime health routes there is
 * nothing here worth caching.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const snapshot = await health();
    const settings = paperTraderSettingsFrom(agentSettingsFor(userId, PAPER_TRADER_AGENT_ID));
    return NextResponse.json({
      ok: true,
      available: snapshot.available,
      cloned: snapshot.cloned,
      root: snapshot.root,
      dependenciesInstalled: snapshot.dependenciesInstalled,
      built: snapshot.built,
      stale: snapshot.stale,
      node: snapshot.node,
      npm: snapshot.npm,
      deciderReady: snapshot.deciderReady,
      deciderReason: snapshot.deciderReason,
      reason: snapshot.reason,
      setupActions: SETUP_ACTIONS,
      desk: deskStatus(settings),
      settings: {
        startingCapital: settings.startingCapital,
        symbols: settings.symbols,
        stocks: settings.stocks,
        cycleMinutes: settings.cycleMinutes,
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
