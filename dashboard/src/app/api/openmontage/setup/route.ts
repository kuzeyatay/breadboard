// The OpenMontage setup panel's endpoint. GET reports the production
// toolchain; POST performs the two installs Breadboard can do on the person's
// behalf.
//
// Like the Agent Reach and HyperFrames panels, this is a user-initiated trust
// context: nothing a model says can reach it, and each action runs a fixed argv
// (the clone's own requirements file, or an npm install in the clone's own
// composer directory). The action name is matched against a closed set, so the
// request body never contributes a word to a command line.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  installDependencies,
  installRemotion,
  toolchainStatus,
} from "@/lib/openmontage/setup.ts";

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
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "install-dependencies" && action !== "install-remotion") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result =
      action === "install-dependencies" ? await installDependencies() : await installRemotion();
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
