import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { setupStatus } from "@/lib/resource2skill/setup.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json({ ok: true, status: setupStatus() });
  } catch (error) {
    if (error instanceof RouteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
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
    const body = text ? (JSON.parse(text) as { action?: unknown }) : {};
    if (body.action !== "install-runtime" && body.action !== "install-web" && body.action !== "install-blender") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runManagedSetupJob({
      userId,
      serviceId: "resource2skill",
      action: body.action,
      signal: request.signal,
    });
    return NextResponse.json({ ok: result.ok, message: result.message, status: setupStatus() });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SyntaxError) return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    if (error instanceof ManagedSetupExecutionError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
