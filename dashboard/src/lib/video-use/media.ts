// Reading a video well enough to plan an edit of it, with ffmpeg alone.
//
// The clone's principle is that the model reads the video rather than watching
// it, through a transcript. That is the right primary surface — but it needs a
// speech-to-text key, and a great many real edit instructions have nothing to
// do with speech at all ("make it vertical", "cut the first ten seconds", "the
// middle drags"). Those should not be gated behind an API key.
//
// So there is a second, always-available reading layer here: the container's
// own facts, and a silence map. A silence map is the cheapest possible version
// of the same idea the transcript serves — it says where the gaps are, and the
// gaps are where the cuts go. With one the planner can remove dead air, tighten
// pacing and trim tails without ever knowing what was said.

import { spawn } from "node:child_process";
import { resolveFfprobe, videoUseEnv } from "./runtime.ts";
import { resolveFfmpeg } from "../vimax/video.ts";

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  sizeBytes: number;
  /** Height greater than width — the renderer scales these by height. */
  portrait: boolean;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(
  binary: string,
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, env: videoUseEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 4_000_000) stdout = stdout.slice(-4_000_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 400_000) stderr = stderr.slice(-400_000);
    });
    const timer = options.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already gone.
          }
        }, options.timeoutMs)
      : null;
    timer?.unref?.();
    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    };
    options.signal?.addEventListener("abort", onAbort);
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(new MediaError(error.message));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseRate(value: unknown): number {
  if (typeof value !== "string") return 0;
  const [numerator, denominator] = value.split("/");
  const top = Number(numerator);
  const bottom = Number(denominator ?? 1);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return 0;
  return Math.round((top / bottom) * 100) / 100;
}

/** Container and stream facts. Every later decision is bounded by these. */
export async function probeVideo(
  filePath: string,
  signal?: AbortSignal,
): Promise<VideoProbe> {
  const ffprobe = resolveFfprobe();
  if (!ffprobe) throw new MediaError("No ffprobe was found, so this video cannot be read.");

  const result = await runCommand(
    ffprobe,
    [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { timeoutMs: 120_000, signal },
  );
  if (result.code !== 0) {
    throw new MediaError("That file could not be read as a video.");
  }

  let parsed: {
    format?: { duration?: string; size?: string };
    streams?: Array<Record<string, unknown>>;
  };
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed;
  } catch {
    throw new MediaError("That file could not be read as a video.");
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video) throw new MediaError("That file has no video track.");

  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const durationSeconds =
    Number(parsed.format?.duration) ||
    Number(video.duration) ||
    0;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new MediaError("That video reports no duration, so it cannot be cut.");
  }

  return {
    durationSeconds: Math.round(durationSeconds * 1000) / 1000,
    width,
    height,
    fps: parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 0,
    hasAudio: Boolean(audio),
    videoCodec: typeof video.codec_name === "string" ? video.codec_name : null,
    audioCodec: audio && typeof audio.codec_name === "string" ? audio.codec_name : null,
    sizeBytes: Number(parsed.format?.size) || 0,
    portrait: height > width,
  };
}

export interface SilenceWindow {
  start: number;
  end: number;
  durationSeconds: number;
}

/**
 * Where the audio drops out, as ffmpeg hears it.
 *
 * `-30dB` over 400ms mirrors the clone's own guidance that silences of 400ms
 * and up are the cleanest cut candidates, and that anything under 150ms is
 * unsafe because it is mid-phrase. A quieter threshold would find room tone; a
 * shorter one would find the space between two words.
 */
export async function detectSilences(
  filePath: string,
  options: { thresholdDb?: number; minimumSeconds?: number; signal?: AbortSignal } = {},
): Promise<SilenceWindow[]> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new MediaError("No ffmpeg was found, so this video cannot be read.");
  const threshold = options.thresholdDb ?? -30;
  const minimum = options.minimumSeconds ?? 0.4;

  const result = await runCommand(
    ffmpeg,
    [
      "-hide_banner", "-nostats",
      "-i", filePath,
      "-af", `silencedetect=noise=${threshold}dB:d=${minimum}`,
      "-f", "null", "-",
    ],
    { timeoutMs: 15 * 60_000, signal: options.signal },
  );

  // silencedetect reports on stderr, one `silence_start:` line and one
  // `silence_end: … | silence_duration: …` line per window. A window that is
  // still open when the file ends never gets its end line, so it is dropped:
  // trailing silence is visible in the duration anyway.
  const windows: SilenceWindow[] = [];
  let open: number | null = null;
  for (const line of result.stderr.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end && open !== null) {
      const stop = Number(end[1]);
      if (Number.isFinite(stop) && stop > open) {
        windows.push({
          start: Math.round(open * 1000) / 1000,
          end: Math.round(stop * 1000) / 1000,
          durationSeconds: Math.round((stop - open) * 1000) / 1000,
        });
      }
      open = null;
    }
  }
  return windows;
}

/**
 * The silence map as the planner reads it: a compact table it can cut from
 * directly, capped so a long recording with a hundred pauses cannot crowd the
 * instruction out of the prompt.
 */
export function renderSilenceMap(
  windows: SilenceWindow[],
  durationSeconds: number,
  limit = 60,
): string {
  if (!windows.length) {
    return "No silences of 400ms or longer were found — the audio runs continuously.";
  }
  const longest = [...windows]
    .sort((left, right) => right.durationSeconds - left.durationSeconds)
    .slice(0, limit)
    .sort((left, right) => left.start - right.start);
  const lines = longest.map(
    (window) =>
      `  [${window.start.toFixed(2)}-${window.end.toFixed(2)}] silence ${window.durationSeconds.toFixed(2)}s`,
  );
  const omitted = windows.length - longest.length;
  return [
    `Silence map (${windows.length} gap${windows.length === 1 ? "" : "s"} of 400ms or longer in ${durationSeconds.toFixed(1)}s):`,
    ...lines,
    omitted > 0 ? `  … ${omitted} shorter gap${omitted === 1 ? "" : "s"} not listed` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export { runCommand as runMediaCommand };
