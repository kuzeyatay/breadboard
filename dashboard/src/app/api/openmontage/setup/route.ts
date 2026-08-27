// The OpenMontage setup panel's endpoint. GET reports the production
// toolchain; POST performs the two installs Breadboard can do on the person's
// behalf as authenticated finite Runtime jobs.
//
// Like the Agent Reach and HyperFrames panels, this is a user-initiated trust
// context: nothing a model says can reach it. The action name is matched against
// a closed set, so the request body never contributes a word to a command line.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { runOpenMontageProbeViaRuntime } from "@/lib/runtime-v2/openmontage-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const status = await runOpenMontageProbeViaRuntime({ userId, signal: request.signal });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "install-dependencies" && action !== "install-remotion") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runManagedSetupJob({
      userId,
      serviceId: "openmontage",
      action,
      signal: request.signal,
    });
    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      status: await runOpenMontageProbeViaRuntime({ userId, signal: request.signal }),
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof ManagedSetupExecutionError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
