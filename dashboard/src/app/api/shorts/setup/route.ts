import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { invalidatePythonAgentProbe } from "@/lib/runtime-v2/python-agent-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Building, repairing or removing the clone's Python environment. Only the user
 * can authorize it — a run never installs anything, because the install is
 * hundreds of megabytes and several minutes.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 4 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (!["install", "reinstall", "remove"].includes(action)) {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runManagedSetupJob({
      userId,
      serviceId: "shorts",
      action,
      signal: request.signal,
    });
    invalidatePythonAgentProbe("shorts");
    return NextResponse.json({ ok: true, result });
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
