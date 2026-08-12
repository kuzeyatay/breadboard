import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { PAPER_TRADER_AGENT_ID } from "@/lib/paper-trader/identity.ts";
import { startRun } from "@/lib/paper-trader/run-manager.ts";
import { paperTraderSettingsFrom } from "@/lib/paper-trader/settings.ts";
import { resolveCallbackOrigin } from "@/lib/paper-trader/supervisor.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Carry out one instruction to the desk. The body's `task` is the user's own
 * words; the run manager folds it down to start, stop or show, because there is
 * nothing else a message to a desk can mean.
 *
 * The request's origin is captured here and nowhere else: it is how the arena
 * will reach back for its decisions, and a background restart at boot has no
 * request to read one from.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const task = typeof body.task === "string" ? body.task.trim().slice(0, 2_000) : "";

    const settings = paperTraderSettingsFrom(agentSettingsFor(userId, PAPER_TRADER_AGENT_ID));
    const run = startRun({
      userId,
      task,
      settings,
      callbackOrigin: resolveCallbackOrigin(request),
    });
    return NextResponse.json({ ok: true, run, task }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "runtime_error" },
      { status: 502 },
    );
  }
}
