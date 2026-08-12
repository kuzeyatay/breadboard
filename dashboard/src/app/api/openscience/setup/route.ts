import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { install, setupStatus } from "@/lib/openscience/setup.ts";
import { stopService } from "@/lib/openscience/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The actions only a person may authorize. Nothing a model says reaches this
 * route: it is called by the button in the settings dialog, and a run never
 * installs anything.
 */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action : "install";

    if (action === "restart") {
      // The server reads its configuration once at boot, so a person who has
      // changed a provider or model wants the next run on a fresh one.
      stopService();
      return NextResponse.json({ ok: true, message: "Stopped. The next run starts a fresh server.", status: setupStatus() });
    }

    if (action !== "install") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }

    const result = await install();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
