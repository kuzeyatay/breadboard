// Running the cut.
//
// The assembly itself is the clone's `helpers/render.py`, called exactly as its
// own documentation calls it. That script is where the production correctness
// lives — per-segment extract then lossless concat rather than one filtergraph,
// 30ms audio fades at every boundary, HDR tone-mapping for HLG and PQ sources,
// per-segment auto-grade, subtitles applied last, and a two-pass loudness
// normalization to -14 LUFS. None of that is worth reimplementing and all of it
// is easy to get subtly wrong, so Breadboard writes an EDL and gets out of the
// way.
//
// What Breadboard adds afterwards is one optional pass for the things an EDL
// has no field for — speed, gain, fades, reverse — because those are properties
// of the finished piece rather than of a segment. It is skipped entirely when
// nothing asked for it, which is the common case, so the usual render is the
// clone's output byte for byte.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { helperScript, resolvePython, videoUseEnv } from "./runtime.ts";
import { resolveFfmpeg } from "../vimax/video.ts";
import { probeVideo } from "./media.ts";
import { toCloneEdl, IDENTITY_TRANSFORM, type VideoEditProgram, type VideoTransform } from "./program.ts";
import { SOURCE_KEY, clearRenderOutputs, type VideoEditSession } from "./session.ts";

const RENDER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class VideoRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoRenderError";
  }
}

export interface RenderProgress {
  /** A short line for the run card: "extracting 6 segments", "normalizing loudness". */
  stage: string;
  detail?: string;
}

export interface RenderResult {
  outputPath: string;
  durationSeconds: number;
  sizeBytes: number;
  width: number;
  height: number;
}

export function isIdentityTransform(transform: VideoTransform): boolean {
  return (
    transform.speed === IDENTITY_TRANSFORM.speed &&
    transform.mute === IDENTITY_TRANSFORM.mute &&
    transform.volumeDb === IDENTITY_TRANSFORM.volumeDb &&
    transform.fadeInSeconds === IDENTITY_TRANSFORM.fadeInSeconds &&
    transform.fadeOutSeconds === IDENTITY_TRANSFORM.fadeOutSeconds &&
    transform.reverse === IDENTITY_TRANSFORM.reverse
  );
}

/**
 * `atempo` only accepts 0.5–2.0 per instance in the builds this ships with, so
 * a bigger change is chained. Two stages cover the whole 0.25–4 range the
 * program allows.
 */
function atempoChain(speed: number): string[] {
  const stages: number[] = [];
  let remaining = speed;
  while (remaining > 2) {
    stages.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    stages.push(0.5);
    remaining /= 0.5;
  }
  stages.push(Math.round(remaining * 1000) / 1000);
  return stages.map((stage) => `atempo=${stage}`);
}

function spawnStep(input: {
  binary: string;
  args: string[];
  cwd?: string;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.binary, input.args, {
      cwd: input.cwd,
      windowsHide: true,
      env: videoUseEnv(),
    });
    let stderrTail = "";
    let buffer = "";
    const consume = (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) input.onLine?.(line);
        newline = buffer.indexOf("\n");
      }
      if (buffer.length > 200_000) buffer = "";
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => consume(chunk));
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-12_000);
    });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, RENDER_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    };
    input.signal?.addEventListener("abort", onAbort);

    child.on("error", (error) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      reject(new VideoRenderError(error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (code === 0) {
        resolve();
        return;
      }
      if (input.signal?.aborted) {
        reject(new VideoRenderError("The edit was stopped."));
        return;
      }
      const detail = stderrTail
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("["))
        .slice(-4)
        .join(" ");
      reject(
        new VideoRenderError(
          detail ? `The render failed: ${detail}` : `The render failed (exit ${code ?? "unknown"}).`,
        ),
      );
    });
  });
}

/** Translate one of render.py's progress lines into something a card can show. */
function renderStage(line: string): RenderProgress | null {
  const extracting = /^extracting (\d+) segment/i.exec(line);
  if (extracting) {
    return { stage: `Extracting ${extracting[1]} segment${extracting[1] === "1" ? "" : "s"}` };
  }
  const segment = /^\[(\d+)]\s+\S+\s+([\d.]+)-\s*([\d.]+)/.exec(line);
  if (segment) {
    return {
      stage: `Segment ${Number(segment[1]) + 1}`,
      detail: `${Number(segment[2]).toFixed(2)}s – ${Number(segment[3]).toFixed(2)}s`,
    };
  }
  if (/^concat/i.test(line)) return { stage: "Joining segments" };
  if (/^compositing/i.test(line)) return { stage: "Burning captions" };
  if (/^building master\.srt|^wrote .*\.srt/i.test(line)) return { stage: "Building captions" };
  if (/^loudness normalization/i.test(line)) return { stage: "Normalizing loudness" };
  if (/^\s*loudnorm pass 1/i.test(line)) return { stage: "Measuring loudness" };
  if (/^\s*loudnorm pass 2/i.test(line)) return { stage: "Normalizing loudness" };
  return null;
}

export interface RenderInput {
  session: VideoEditSession;
  root: string;
  program: Omit<VideoEditProgram, "history" | "version">;
  quality: "final" | "preview";
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}

export async function renderProgram(input: RenderInput): Promise<RenderResult> {
  const python = resolvePython(input.root);
  if (!python) throw new VideoRenderError("No Python interpreter was found to run the renderer.");
  const script = helperScript(input.root, "render.py");
  if (!fs.existsSync(script)) {
    throw new VideoRenderError("The clone's render helper is missing.");
  }

  clearRenderOutputs(input.session);

  const edl = toCloneEdl({
    program: input.program,
    sourceKey: SOURCE_KEY,
    sourcePath: input.session.sourcePath,
    // The renderer resolves a relative subtitles path against the EDL's own
    // directory, which is the edit directory — exactly where it writes it.
    subtitlesPath: input.program.subtitles === "burn" ? "master.srt" : null,
  });
  fs.mkdirSync(path.dirname(input.session.edlPath), { recursive: true });
  fs.writeFileSync(input.session.edlPath, JSON.stringify(edl, null, 2));

  const assembled = path.join(input.session.editDir, "assembled.mp4");
  try {
    fs.rmSync(assembled, { force: true });
  } catch {
    // Nothing to remove.
  }

  input.onProgress?.({ stage: "Assembling the cut" });
  await spawnStep({
    binary: python,
    args: [
      script,
      input.session.edlPath,
      "-o",
      assembled,
      ...(input.quality === "preview" ? ["--preview"] : []),
      ...(input.program.subtitles === "burn" ? ["--build-subtitles"] : ["--no-subtitles"]),
    ],
    cwd: input.root,
    signal: input.signal,
    onLine: (line) => {
      const stage = renderStage(line);
      if (stage) input.onProgress?.(stage);
    },
  });

  if (!fs.existsSync(assembled)) {
    throw new VideoRenderError("The renderer finished without writing a video.");
  }

  const output = isIdentityTransform(input.program.transform)
    ? assembled
    : await applyTransform({
        input: assembled,
        output: input.session.outputPath,
        transform: input.program.transform,
        signal: input.signal,
        onProgress: input.onProgress,
      });

  const probe = await probeVideo(output, input.signal);
  return {
    outputPath: output,
    durationSeconds: probe.durationSeconds,
    sizeBytes: probe.sizeBytes || fs.statSync(output).size,
    width: probe.width,
    height: probe.height,
  };
}

/**
 * The finishing pass: speed, gain, fades, reverse. One re-encode, applied to
 * the assembled cut — never to a segment, because a fade belongs to the piece
 * and a speed change to a segment would drift against the audio.
 */
async function applyTransform(input: {
  input: string;
  output: string;
  transform: VideoTransform;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}): Promise<string> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new VideoRenderError("No ffmpeg was found to finish the edit.");

  const probe = await probeVideo(input.input, input.signal);
  const speed = input.transform.speed || 1;
  const finalDuration = probe.durationSeconds / speed;

  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  if (input.transform.reverse) {
    videoFilters.push("reverse");
    audioFilters.push("areverse");
  }
  if (speed !== 1) {
    videoFilters.push(`setpts=${(1 / speed).toFixed(6)}*PTS`);
    audioFilters.push(...atempoChain(speed));
  }
  if (input.transform.volumeDb !== 0) {
    audioFilters.push(`volume=${input.transform.volumeDb}dB`);
  }
  if (input.transform.fadeInSeconds > 0) {
    const seconds = Math.min(input.transform.fadeInSeconds, finalDuration / 2);
    videoFilters.push(`fade=t=in:st=0:d=${seconds.toFixed(3)}`);
    audioFilters.push(`afade=t=in:st=0:d=${seconds.toFixed(3)}`);
  }
  if (input.transform.fadeOutSeconds > 0) {
    const seconds = Math.min(input.transform.fadeOutSeconds, finalDuration / 2);
    const start = Math.max(0, finalDuration - seconds);
    videoFilters.push(`fade=t=out:st=${start.toFixed(3)}:d=${seconds.toFixed(3)}`);
    audioFilters.push(`afade=t=out:st=${start.toFixed(3)}:d=${seconds.toFixed(3)}`);
  }

  const silent = input.transform.mute || !probe.hasAudio;
  input.onProgress?.({ stage: "Applying the finish" });

  try {
    fs.rmSync(input.output, { force: true });
  } catch {
    // Nothing to remove.
  }

  await spawnStep({
    binary: ffmpeg,
    args: [
      "-y", "-hide_banner", "-nostats",
      "-i", input.input,
      ...(videoFilters.length ? ["-vf", videoFilters.join(",")] : []),
      ...(silent ? ["-an"] : audioFilters.length ? ["-af", audioFilters.join(",")] : []),
      "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
      ...(silent ? [] : ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]),
      "-movflags", "+faststart",
      input.output,
    ],
    signal: input.signal,
  });

  if (!fs.existsSync(input.output)) {
    throw new VideoRenderError("The finishing pass produced no file.");
  }
  return input.output;
}
