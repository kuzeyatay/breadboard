import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  removeIdentityPhoto,
  saveIdentityPhoto,
} from "@/lib/wardrobe/identity-photo.ts";
import {
  readWardrobeRuntimeStatus,
  stopWardrobeRuntime,
} from "@/lib/wardrobe/runtime-service.ts";
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
 * route: it is called by the buttons in the settings dialog, and a run never
 * installs anything or writes an identity photo.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 24 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action : "install";

    if (action === "restart") {
      await stopWardrobeRuntime({ userId });
      const { setup } = await readWardrobeRuntimeStatus({ userId });
      return NextResponse.json({
        ok: true,
        message: "Stopped. The next import starts a fresh server.",
        status: setup,
      });
    }

    if (action === "identity") {
      const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
      if (!dataUrl) {
        return NextResponse.json({ ok: false, error: "missing_photo" }, { status: 400 });
      }
      const result = await saveIdentityPhoto(dataUrl);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    if (action === "identity-remove") {
      return NextResponse.json(await removeIdentityPhoto());
    }

    if (action !== "install") {
      return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
    }

    await stopWardrobeRuntime({ userId });
    const result = await runManagedSetupJob({
      userId,
      serviceId: "wardrobe",
      action: "install",
      signal: request.signal,
    });
    const { setup } = await readWardrobeRuntimeStatus({ userId });
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
