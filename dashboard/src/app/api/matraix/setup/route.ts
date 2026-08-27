import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import {
  MATRAIX_DEVELOPMENT_POOL,
  MatraixProbeError,
  runMatraixProbeViaRuntime,
} from "@/lib/runtime-v2/matraix-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const status = await runMatraixProbeViaRuntime({ userId, signal: request.signal });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof MatraixProbeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

// An install is submitted only because a person pressed the setup button.
// Nothing a model produces reaches this authenticated Runtime operation.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as { action?: unknown }) : {};
    if (body.action !== "install-runtime") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runManagedSetupJob({
      userId,
      serviceId: "matraix",
      action: "install-runtime",
      signal: request.signal,
    });
    const status = await runMatraixProbeViaRuntime({ userId, signal: request.signal });
    const personas = status.pools.find(
      (pool) => pool.pool === MATRAIX_DEVELOPMENT_POOL,
    )?.personas ?? 0;
    return NextResponse.json({
      ok: result.ok,
      message: result.ok
        ? `MatrAIx is ready. ${personas} personas are available for sampling.`
        : result.message,
      status,
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof MatraixProbeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
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
