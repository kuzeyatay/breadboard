import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { invalidateHealth } from "@/lib/video-use/runtime.ts";
import { invalidateSpeechEngine, scriberrSpeechStatus } from "@/lib/video-use/speech.ts";
import { invalidateSubsAiHealth } from "@/lib/runtime-v2/subsai-probe-job.ts";
import {
  ManagedSetupExecutionError,
  runManagedSetupJob,
} from "@/lib/runtime-v2/managed-setup-job.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The things a person may set up, all of which are local: rechecking the
 * transcription service, and building the fallback Whisper environment.
 *
 * There is no key to store here and no account to connect. Only ever reached by
 * someone pressing a button — a run never sets anything up on its own.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const action = typeof body.action === "string" ? body.action : "";

    // Someone who just started Scriberr should not have to wait out the
    // liveness cache to see it.
    if (action === "recheck_speech") {
      invalidateHealth();
      invalidateSpeechEngine();
      const status = await scriberrSpeechStatus();
      return NextResponse.json({
        ok: true,
        result: {
          ok: status.ready,
          message: status.ready
            ? "Scriberr is up. Filler-word cuts and burned captions are available."
            : (status.reason ?? "Scriberr is not answering."),
        },
      });
    }

    // Building the local subtitle engine is gigabytes and minutes, so it only
    // ever happens here — behind a button somebody pressed, never behind a run.
    if (action === "build_subtitles") {
      const result = await runManagedSetupJob({
        userId,
        serviceId: "subsai",
        action: "build-subtitles",
        signal: request.signal,
      });
      invalidateSubsAiHealth();
      invalidateHealth();
      invalidateSpeechEngine();
      return NextResponse.json({ ok: true, result });
    }

    if (action === "remove_subtitles") {
      const result = await runManagedSetupJob({
        userId,
        serviceId: "subsai",
        action: "remove-subtitles",
        signal: request.signal,
      });
      invalidateSubsAiHealth();
      invalidateHealth();
      invalidateSpeechEngine();
      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
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
