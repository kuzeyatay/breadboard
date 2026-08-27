// The OpenWork setup panel's endpoint. GET reports what is prepared; POST does
// the one preparation Breadboard can submit to the authenticated Runtime job
// owner on the person's behalf.
//
// Like the other setup panels this is a user-initiated trust context: nothing a
// model says can reach it, and the request only selects a closed setup operation
// whose source closure and output root are fixed by the worker.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  readOpenworkRuntimeStatus,
  stopOpenworkRuntime,
} from "@/lib/openwork/runtime-service.ts";
import { RuntimeAgentServiceError } from "@/lib/runtime-agent-service.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const { setup } = await readOpenworkRuntimeStatus({ userId });
    return NextResponse.json({ ok: true, status: setup });
  } catch (error) {
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
    if (body.action !== "prepare-server") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    await stopOpenworkRuntime({ userId });
    const result = await runManagedSetupJob({
      userId,
      serviceId: "openwork",
      action: "prepare-server",
      signal: request.signal,
    });
    const { setup } = await readOpenworkRuntimeStatus({ userId });
    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      status: setup,
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RuntimeAgentServiceError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
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
