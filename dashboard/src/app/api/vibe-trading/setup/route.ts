import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { isVendorCredentialKey, setCredential } from "@/lib/vibe-trading/credentials.ts";
import { invalidateHealth } from "@/lib/vibe-trading/runtime.ts";
import { isSetupAction, SetupError } from "@/lib/vibe-trading/setup.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Three kinds of setup step, all of which only the user can authorise: building
 * the clone's Python environment, storing an optional data-vendor key, and
 * requesting the supervised service's normal idle stop. A key is written and
 * never read back — the health route reports only whether one is set.
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
      if (!isVendorCredentialKey(body.credential)) {
        return NextResponse.json({ ok: false, error: "unknown_credential" }, { status: 400 });
      }
      const value = typeof body.value === "string" ? body.value : "";
      if (value.length > 500) {
        return NextResponse.json({ ok: false, error: "value_too_long" }, { status: 413 });
      }
      setCredential(body.credential, value);
      invalidateHealth();
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
      return NextResponse.json({
        ok: true,
        result: {
          ok: true,
          message:
            "Runtime will stop Vibe Trading after active runs release and its idle timeout expires.",
          detail: "",
        },
      });
    }

    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (!isSetupAction(action)) {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }
    const result = await runManagedSetupJob({
      userId,
      serviceId: "vibe-trading",
      action,
      signal: request.signal,
    });
    invalidateHealth();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof SetupError) {
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
