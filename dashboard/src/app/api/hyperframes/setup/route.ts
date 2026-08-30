// The HyperFrames setup panel's endpoint. GET reports the video toolchain;
// POST submits the one install Breadboard can do on the person's behalf to the
// authenticated Runtime job owner.
//
// Like the Agent Reach panel, this is a user-initiated trust context: nothing a
// model says can reach it, and the request can only select the closed,
// version-pinned HyperFrames setup operation.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { toolchainStatus } from "@/lib/hyperframes/setup.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { runCodexProbeViaRuntime } from "@/lib/runtime-v2/codex-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function runtimeToolchainStatus(userId: number, signal: AbortSignal) {
  const codex = await runCodexProbeViaRuntime({ userId, signal });
  return toolchainStatus({ found: codex.available, version: codex.version ?? "" });
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    return NextResponse.json({
      ok: true,
      status: await runtimeToolchainStatus(userId, request.signal),
    });
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
    if (body.action !== "install-cli") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runManagedSetupJob({
      userId,
      serviceId: "hyperframes",
      action: "install-cli",
      signal: request.signal,
    });
    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      status: await runtimeToolchainStatus(userId, request.signal),
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof ManagedSetupExecutionError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
