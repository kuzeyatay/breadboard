import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { invalidateHealth } from "@/lib/video-use/runtime.ts";
import { invalidateSpeechEngine, scriberrSpeechStatus } from "@/lib/video-use/speech.ts";
import { buildEnvironment, removeEnvironment } from "@/lib/subsai/setup.ts";

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
    await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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
      const result = await buildEnvironment();
      return NextResponse.json({ ok: true, result });
    }

    if (action === "remove_subtitles") {
      return NextResponse.json({ ok: true, result: removeEnvironment() });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
