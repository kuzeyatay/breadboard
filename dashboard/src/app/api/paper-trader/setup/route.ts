import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { isSetupAction, runSetupAction, SetupError } from "@/lib/paper-trader/setup.ts";
import { stopDesk } from "@/lib/paper-trader/supervisor.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Two kinds of step, both of which only the user can authorise: building the
 * arena backend, and stopping the desk. Stopping is here as well as on the card
 * because the settings dialog has to be able to take a desk down before removing
 * the build it is running from.
 */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (body.action === "stop") {
      await stopDesk();
      return NextResponse.json({
        ok: true,
        result: { ok: true, message: "The trading desk was stopped.", detail: "" },
      });
    }

    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (!isSetupAction(action)) {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runSetupAction(action);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof SetupError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
