// Worker-only live readiness probe. Process discovery and Pillow probing stay
// behind the Vox Director disposable Runtime profile.

import { resolveFfmpeg } from "../vimax/video.ts";
import { comfyUiStatus } from "../comfyui/service.ts";
import { resolveComfyUiConfig } from "../comfyui/config.ts";
import { resolveNarrationVoice } from "./audio-backend.ts";
import {
  probePillow,
  resolvePython,
  resolveVoxFfprobe,
  resolveVoxDirectorRoot,
  voxHealthLevel,
} from "./runtime.ts";

export async function inspectWorkerHealth(input: {
  userId: number;
  baseUrl: string;
  configuredCheckpoint: string | null;
  voiceProfileId: string | null;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const clone = resolveVoxDirectorRoot();
  const python = resolvePython(clone?.root ?? null);
  const pillow = python ? await probePillow(python, 20_000, input.signal) : false;
  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveVoxFfprobe();
  const chatmock = await reachable(`${input.baseUrl.replace(/\/$/u, "")}/models`, input.signal);

  const comfyConfig = resolveComfyUiConfig();
  const comfy = await comfyUiStatus(comfyConfig).catch(() => null);
  const checkpoints = comfy?.capabilities?.checkpoints ?? [];
  const checkpoint =
    input.configuredCheckpoint && checkpoints.includes(input.configuredCheckpoint)
      ? input.configuredCheckpoint
      : checkpoints[0] ?? null;
  const voice = await resolveNarrationVoice({
    userId: input.userId,
    preferredProfileId: input.voiceProfileId,
    ...(input.signal ? { signal: input.signal } : {}),
  });

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
  return {
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
}

async function reachable(url: string, signal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
