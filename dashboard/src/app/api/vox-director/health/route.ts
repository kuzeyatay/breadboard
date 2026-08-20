import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { resolveFfmpeg } from "@/lib/vimax/video.ts";
import { resolveFfprobe } from "@/lib/video-use/runtime.ts";
import { comfyUiStatus } from "@/lib/comfyui/service.ts";
import { resolveComfyUiConfig } from "@/lib/comfyui/config.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { voxDirectorCheckpoint } from "@/lib/agent-settings/defaults.ts";
import { getSpeechSettings } from "@/lib/speech/settings.ts";
import { resolveNarrationVoice } from "@/lib/vox-director/audio-backend.ts";
import {
  probePillow,
  resolvePython,
  resolveVoxDirectorRoot,
  voxHealthLevel,
} from "@/lib/vox-director/runtime.ts";
import { VOX_DIRECTOR_AGENT_ID } from "@/lib/vox-director/identity.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_MS = 15_000;
let cached: { at: number; body: Record<string, unknown> } | null = null;

/**
 * Whether a production can actually run, and what it would lose if it did.
 *
 * Three states, and the distinction is the point of the endpoint. `ready` means
 * every piece of the intended path is present. `degraded` means the film will
 * be made but not as asked — no ComfyUI, so the posters are title cards.
 * `unavailable` means no film comes out at all: no clone, no Python, no ffmpeg,
 * or no voice, since a narrated explainer with no narrator is not a film.
 *
 * A cloned directory being present is never on its own a reason to call this
 * healthy; `resolveVoxDirectorRoot` requires the scripts the run really
 * executes, and every other line here is a live probe.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return NextResponse.json(cached.body);
    }

    const clone = resolveVoxDirectorRoot();
    const python = resolvePython(clone?.root ?? null);
    const pillow = python ? await probePillow(python) : false;
    const ffmpeg = resolveFfmpeg();
    const ffprobe = resolveFfprobe();

    const { baseURL } = resolveChatmockBaseUrl(request);
    const chatmock = await reachable(`${baseURL.replace(/\/$/, "")}/models`);

    const comfyConfig = resolveComfyUiConfig();
    const comfy = await comfyUiStatus(comfyConfig).catch(() => null);
    const settings = agentSettingsFor(userId, VOX_DIRECTOR_AGENT_ID);
    const configuredCheckpoint = voxDirectorCheckpoint(settings);
    const checkpoints = comfy?.capabilities?.checkpoints ?? [];
    const checkpoint =
      configuredCheckpoint && checkpoints.includes(configuredCheckpoint)
        ? configuredCheckpoint
        : checkpoints[0] ?? null;

    let voiceProfileId: string | null = null;
    try {
      voiceProfileId = getSpeechSettings(userId).profileId;
    } catch {
      voiceProfileId = null;
    }
    const voice = await resolveNarrationVoice({ userId, preferredProfileId: voiceProfileId });

    const blocking: string[] = [];
    const degraded: string[] = [];
    if (!clone) blocking.push("The vox-director clone was not found next to the dashboard.");
    if (!python) blocking.push("No Python interpreter was found.");
    else if (!pillow) blocking.push("Pillow is not installed in that Python (pip install pillow).");
    if (!ffmpeg) blocking.push("No ffmpeg was found.");
    if (!ffprobe) blocking.push("No ffprobe was found.");
    if (!chatmock) blocking.push("ChatMock is not answering, so nothing can be planned.");
    if (!voice.ok) blocking.push(voice.reason);
    if (comfy?.state !== "ready") {
      degraded.push(
        `${comfy?.message ?? "ComfyUI is not reachable."} Posters fall back to the deterministic paper title cards.`,
      );
    } else if (!checkpoint) {
      degraded.push("ComfyUI has no checkpoint, so posters fall back to title cards.");
    }

    const status = voxHealthLevel({ blocking, degraded });

    const body = {
      ok: true,
      status,
      available: blocking.length === 0,
      voxDirectorClone: clone?.root ?? null,
      cloneSource: clone?.source ?? null,
      python,
      pillow,
      ffmpeg,
      ffprobe,
      chatmock,
      comfyui: {
        state: comfy?.state ?? "unavailable",
        message: comfy?.message ?? "ComfyUI is not reachable.",
      },
      comfyuiCheckpoint: checkpoint,
      tts: voice.ok
        ? { available: true, voice: voice.voice.name, engine: voice.voice.engine, reason: "" }
        : { available: false, voice: null, engine: null, reason: voice.reason },
      blocking,
      degraded,
    };
    cached = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

async function reachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
