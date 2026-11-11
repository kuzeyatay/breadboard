// Optional components the installer leaves out (OCR weights, the PyTorch
// Python environments, the speech server). GET lists them with their installed
// state, or reports one install/remove job; POST starts a job. The Runtime owns
// the job, so a multi-gigabyte download survives this request ending.
import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { ManagedSetupExecutionError } from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import {
  inspectOptionalComponentJob,
  isOptionalComponentId,
  readOptionalComponentStates,
  startOptionalComponentJob,
} from "@/lib/runtime-v2/optional-components.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const runtimeResponse = runtimeAuthorityErrorResponse(error);
  if (runtimeResponse) return runtimeResponse;
  if (error instanceof SyntaxError) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (error instanceof ManagedSetupExecutionError || error instanceof RouteError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const jobId = new URL(request.url).searchParams.get("job")?.trim();
    if (jobId) {
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(jobId)) {
        return NextResponse.json({ ok: false, error: "invalid_job" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, job: await inspectOptionalComponentJob(userId, jobId) });
    }
    return NextResponse.json({ ok: true, components: await readOptionalComponentStates() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 4 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = body.action === "remove" ? "remove" : body.action === "install" ? "install" : null;
    if (!isOptionalComponentId(body.id) || !action) {
      return NextResponse.json({ ok: false, error: "unknown_component_or_action" }, { status: 400 });
    }
    const jobId = await startOptionalComponentJob(userId, body.id, action, request.signal);
    return NextResponse.json({ ok: true, jobId });
  } catch (error) {
    return errorResponse(error);
  }
}
