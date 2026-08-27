// The Advanced image tab's view of the local ComfyUI.
//
// GET  — where ComfyUI stands, plus what it can render with (models, samplers,
//        schedulers) so the panel's pickers are the server's real options.
// POST — the two things that change something: install it, or start it. Both
//        are explicit because both are expensive; nothing here happens as a
//        side effect of looking at the tab.
//
// Rendering does not live here: an image has to become a durable artifact, and
// that belongs with every other way an artifact is made — see
// /api/hermes/artifacts/images.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { resolveComfyUiConfig } from "@/lib/comfyui/config.ts";
import { comfyUiStatus, startComfyUi } from "@/lib/comfyui/service.ts";
import {
  beginSetup,
  recordSetupSubmissionFailure,
} from "@/lib/comfyui/server.ts";
import { submitManagedSetupJob } from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { SupervisorResourceExhaustedError } from "@/lib/supervisor-control.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    requireEnabled();
    return NextResponse.json({ ok: true, comfyui: await comfyUiStatus() });
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) {
      return NextResponse.json(
        { error: error.message, ...error.result },
        { status: 503 },
      );
    }
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let setupConfig: ReturnType<typeof resolveComfyUiConfig> | null = null;
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const config = resolveComfyUiConfig();

    if (body.action === "setup") {
      const outcome = beginSetup(config);
      if (!outcome.started) {
        return NextResponse.json(
          { ok: false, error: outcome.reason ?? "Setup could not be started." },
          { status: 409 },
        );
      }
      setupConfig = config;
      await submitManagedSetupJob({
        userId,
        serviceId: "comfyui",
        action: "install",
        signal: request.signal,
      });
      return NextResponse.json({ ok: true, comfyui: await comfyUiStatus(config) });
    }

    if (body.action === "start") {
      const status = await startComfyUi(config);
      const running = status.state === "ready" || status.state === "no_models";
      return NextResponse.json(
        { ok: running, comfyui: status, ...(running ? {} : { error: status.message }) },
        { status: running ? 200 : 409 },
      );
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (setupConfig) recordSetupSubmissionFailure(setupConfig, error);
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SupervisorResourceExhaustedError) {
      return NextResponse.json(
        { error: error.message, ...error.result },
        { status: 503 },
      );
    }
    return apiErrorResponse(error);
  }
}
