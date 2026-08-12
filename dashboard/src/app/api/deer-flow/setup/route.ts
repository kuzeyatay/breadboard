import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { invalidateHealth } from "@/lib/deer-flow/runtime.ts";
import { isSetupAction, runSetupAction, SetupError } from "@/lib/deer-flow/setup.ts";
import { stopService } from "@/lib/deer-flow/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The steps only the user can authorize: building the clone's Python
 * environment, repairing it, removing it, and stopping the supervised Gateway.
 * A run never triggers any of them.
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
      await stopService();
      invalidateHealth();
      return NextResponse.json({
        ok: true,
        result: { ok: true, message: "The DeerFlow Gateway was stopped.", detail: "" },
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
