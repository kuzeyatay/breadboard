import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { SETUP_ACTIONS, type SetupAction } from "@/lib/career-ops/setup.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { invalidateCareerOpsHealth } from "@/lib/runtime-v2/career-ops-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set<string>(SETUP_ACTIONS.map((action) => action.id));

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const setupAction = action as SetupAction;
    const result = await runManagedSetupJob({
      userId,
      serviceId: "career-ops",
      action: setupAction,
      signal: request.signal,
    });
    invalidateCareerOpsHealth();
    return NextResponse.json({ ok: true, result: { action: setupAction, ...result } });
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
