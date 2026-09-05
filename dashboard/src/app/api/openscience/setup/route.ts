import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  readOpenscienceRuntimeStatus,
  stopOpenscienceRuntime,
} from "@/lib/openscience/runtime-service.ts";
import { RuntimeAgentServiceError } from "@/lib/runtime-agent-service.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The actions only a person may authorize. Nothing a model says reaches this
 * route: it is called by the button in the settings dialog, and a run never
 * installs anything.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action : "install";

    if (action === "restart") {
      await stopOpenscienceRuntime({ userId });
      const { setup } = await readOpenscienceRuntimeStatus({ userId });
      return NextResponse.json({
        ok: true,
        message: "Stopped. The next import starts a fresh server.",
        status: setup,
      });
    }

    if (action !== "install") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }

    // Best-effort. Before the CLI is installed the Runtime refuses to launch
    // the research service at all ("launch prerequisites were unavailable"),
    // and acquiring the stop lease surfaces that refusal as an error — so the
    // install that would have fixed it never ran, and the button answered
    // with a bare internal error. A service that cannot start has nothing to
    // stop; only a running one needs stopping before it is replaced.
    await stopOpenscienceRuntime({ userId }).catch(() => undefined);
    const result = await runManagedSetupJob({
      userId,
      serviceId: "openscience",
      action: "install",
      signal: request.signal,
    });
    const { setup } = await readOpenscienceRuntimeStatus({ userId });
    return NextResponse.json(
      { ok: result.ok, message: result.message, status: setup },
      { status: result.ok ? 200 : 500 },
    );
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
