// The HyperFrames setup panel's endpoint. GET reports the video toolchain;
// POST performs the one install Breadboard can do on the person's behalf.
//
// Like the Agent Reach panel, this is a user-initiated trust context: nothing a
// model says can reach it, and the only action runs a fixed argv (npm install
// of a package name pinned to the clone's own CLI version).

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { installCli, toolchainStatus } from "@/lib/hyperframes/setup.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json({ ok: true, status: toolchainStatus() });
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
    if (body.action !== "install-cli") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await installCli();
    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      status: result.status,
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
