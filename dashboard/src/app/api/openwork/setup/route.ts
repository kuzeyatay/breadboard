// The OpenWork setup panel's endpoint. GET reports what is prepared; POST does
// the one preparation Breadboard can perform on the person's behalf.
//
// Like the other setup panels this is a user-initiated trust context: nothing a
// model says can reach it, and the only action runs a fixed argv — an npm
// install inside a Breadboard-owned directory whose dependency list comes from
// the clone, not from the request.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { prepareServerRuntime, setupStatus } from "@/lib/openwork/setup.ts";
import { stopService } from "@/lib/openwork/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json({ ok: true, status: setupStatus() });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (body.action !== "prepare-server") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    // A running service holds the old copy of the server open. Preparing
    // replaces that copy on disk, so the next run must start a fresh one or it
    // would keep answering from the version that was just replaced.
    stopService();
    const result = await prepareServerRuntime();
    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      status: setupStatus(),
    });
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
