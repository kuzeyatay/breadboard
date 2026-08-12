import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  invalidateHealth,
  probeVisualQc,
  videoUseHealth,
} from "@/lib/video-use/runtime.ts";
import { subsAiHealth } from "@/lib/subsai/runtime.ts";
import {
  invalidateSpeechEngine,
  resolveSpeechEngine,
  scriberrSpeechStatus,
} from "@/lib/video-use/speech.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Is the editor usable right now, and if not, why not.
 *
 * The composer asks this before it offers to edit a video, so it has to be
 * cheap and it has to be honest: `available` means a render would start,
 * `transcriptionReady` means the speech-aware half of the vocabulary works too.
 */
export async function GET(request: Request) {
  try {
    await requireUserId();
    if (new URL(request.url).searchParams.get("refresh") === "1") {
      invalidateHealth();
      invalidateSpeechEngine();
    }
    const health = videoUseHealth();
    // Starting a Python to see whether numpy imports costs seconds, so it is
    // asked for here — where a person is looking at a settings panel — and
    // never on the path of a run.
    const visualQcReady = await probeVisualQc();
    // Speech comes from Scriberr when it is up and from the subsai venv when it
    // is not; the panel needs both answers to say what is possible and what to
    // do about it.
    const subtitles = subsAiHealth();
    const [scriberr, engine] = await Promise.all([
      scriberrSpeechStatus(),
      resolveSpeechEngine(),
    ]);
    return NextResponse.json({
      ok: true,
      health: {
        available: health.available,
        cloned: health.cloned,
        transcriptionReady: engine !== null,
        transcriptionProvider: engine,
        scriberr: {
          ready: scriberr.ready,
          url: scriberr.url,
          reason: scriberr.reason,
        },
        subtitles: {
          available: subtitles.available,
          cloned: subtitles.cloned,
          uvAvailable: subtitles.uvAvailable,
          models: subtitles.models,
          reason: subtitles.reason,
        },
        visualQcReady,
        // Paths are useful when something is mislocated and harmless to show:
        // this is the operator's own machine, and health is behind auth.
        root: health.root,
        ffmpeg: health.ffmpeg,
        python: health.python,
        reason: health.reason,
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
