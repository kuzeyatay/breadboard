// Start and stop from the card itself, without going through a chat turn.
//
// The card is on screen for as long as the conversation is, and a desk it can
// show but not stop would be a strange thing to hand someone. This is the same
// pair of operations the run manager performs; it just does not write a message.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { PAPER_TRADER_AGENT_ID } from "@/lib/paper-trader/identity.ts";
import { paperTraderSettingsFrom } from "@/lib/paper-trader/settings.ts";

import {
  deskStatus,
  resolveCallbackOrigin,
  startDesk,
  stopDesk,
} from "@/lib/paper-trader/supervisor.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";

    if (action === "stop") {
      return NextResponse.json({ ok: true, desk: await stopDesk() });
    }

    // Refresh is deliberately read-only. Recovery and watchdog work belongs to
    // the background supervisor; a button labelled Refresh must never restart
    // the arena, reconcile an account, or apply changed capital settings. The
    // card itself refreshes its complete snapshot directly. This response stays
    // as a harmless compatibility path for older clients.
    if (action === "refresh") {
      const settings = paperTraderSettingsFrom(agentSettingsFor(userId, PAPER_TRADER_AGENT_ID));
      return NextResponse.json({
        ok: true,
        desk: deskStatus(settings),
      });
    }

    if (action !== "start") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }

    const settings = paperTraderSettingsFrom(agentSettingsFor(userId, PAPER_TRADER_AGENT_ID));
    const started = await startDesk({
      userId,
      settings,
      callbackOrigin: resolveCallbackOrigin(request),
    });
    return NextResponse.json({ ok: true, desk: started.status });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "The trading desk could not be reached.",
        desk: deskStatus(),
      },
      { status: 502 },
    );
  }
}
