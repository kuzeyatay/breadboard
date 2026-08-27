import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  isFootageCredentialKey,
  setCredential,
} from "@/lib/money-printer/credentials.ts";
import { isSetupAction } from "@/lib/money-printer/setup-contract.ts";
import {
  stopMoneyPrinterRuntime,
} from "@/lib/money-printer/runtime-service.ts";
import { RuntimeAgentServiceError } from "@/lib/runtime-agent-service.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Three kinds of setup step, all of which only the user can authorise: building
 * the clone's Python environment, storing a stock-footage key, and stopping the
 * supervised service. A key is written and never read back — the health route
 * reports only whether one is set.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (typeof body.credential === "string") {
      if (!isFootageCredentialKey(body.credential)) {
        return NextResponse.json({ ok: false, error: "unknown_credential" }, { status: 400 });
      }
      const value = typeof body.value === "string" ? body.value : "";
      if (value.length > 500) {
        return NextResponse.json({ ok: false, error: "value_too_long" }, { status: 413 });
      }
      setCredential(body.credential, value);
      // The running service read the old key set out of config.toml at import,
      // so it has to go before the next run can see the change. The next run
      // rewrites the file and starts a fresh one.
      await stopMoneyPrinterRuntime({ userId });
      return NextResponse.json({
        ok: true,
        result: {
          ok: true,
          message: value.trim() ? "Key saved." : "Key removed.",
          detail: "",
        },
      });
    }

    if (body.action === "stop") {
      await stopMoneyPrinterRuntime({ userId });
      return NextResponse.json({
        ok: true,
        result: { ok: true, message: "The MoneyPrinter service was stopped.", detail: "" },
      });
    }

    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (!isSetupAction(action)) {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    if (action === "reinstall" || action === "remove") {
      await stopMoneyPrinterRuntime({ userId });
    }
    const result = await runManagedSetupJob({
      userId,
      serviceId: "money-printer",
      action,
      signal: request.signal,
    });
    return NextResponse.json({ ok: true, result });
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
