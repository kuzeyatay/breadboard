// Encoding a ViMax production into an actual video file.
//
// A film that only exists as a player inside one artifact page is not a film
// you can send anyone. This renders the same animatic the artifact plays — the
// drawn first frame of each shot, held for the duration the storyboard artist
// gave it, drifting in the direction the shot's motion describes — into an MP4
// that can be watched, downloaded and shared.
//
// It uses the ffmpeg that already ships with this repository (the desktop
// shell's ffmpeg-static, or the portable copy Agent Reach installs), so nothing
// new has to be downloaded. Dialogue rides along as a soft subtitle track
// rather than burned-in text: no font handling, no escaping, and the words stay
// selectable.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import type { VimaxProduction, VimaxShot } from "./types.ts";

export interface VideoRenderSuccess {
  ok: true;
  filePath: string;
  width: number;
  height: number;
  durationSeconds: number;
  shotCount: number;
  /** Temporary directory the caller must remove once the file is stored. */
  workspace: string;
}

export interface VideoRenderFailure {
  ok: false;
  reason: string;
}

export type VideoRenderResult = VideoRenderSuccess | VideoRenderFailure;

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/**
 * The ffmpeg this machine already has. Checked in the order that costs least:
 * the Runtime profile's native-minted path, an explicit development setting,
 * then repository-pinned copies. The worker never executes `where`/`which` or
 * accepts a renderer-selected executable.
 */
export function resolveFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit =
    env.BREADBOARD_RUNTIME_V2_VIMAX_FFMPEG_PATH?.trim() ||
    env.BREADBOARD_RUNTIME_V2_VOX_FFMPEG_PATH?.trim() ||
    env.VIMAX_FFMPEG_PATH?.trim() ||
    env.HYPERFRAMES_FFMPEG_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  const root = repositoryRoot();
  const candidates = [
    path.join(root, "desktop", "node_modules", "ffmpeg-static", executableName("ffmpeg")),
    path.join(root, "desktop", "resources", "bin", executableName("ffmpeg")),
    path.join(root, "agent-reach", ".tools", "bin", executableName("ffmpeg")),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function childEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const answer: NodeJS.ProcessEnv = {
    NODE_ENV: env.NODE_ENV ?? "production",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME"]) {
    const value = env[name]?.trim();
    if (value && !/[\u0000\r\n]/u.test(value)) answer[name] = value;
  }
  return answer;
}

function run(
  binary: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number; stderr: string }> {
  if (signal?.aborted) return Promise.resolve({ code: -1, stderr: "The render was cancelled." });
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      env: childEnvironment(),
      detached: process.platform !== "win32",
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    const onAbort = () => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The encoder already exited.
      }
    };
    signal?.addEventListener("abort", onAbort);
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code: -1, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/** The output frame, chosen from the production's own aspect ratio. */
function dimensions(production: VimaxProduction): { width: number; height: number } {
  if (production.aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (production.aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1280, height: 720 };
}

/**
 * The camera move for one shot, as a zoompan expression.
 *
 * Same reading of the shot as the artifact's player: the variation grade sets
 * how far the frame travels, and the motion description decides whether that is
 * a push in, a pull out, or a drift across.
 */
function zoompan(shot: VimaxShot, frames: number, width: number, height: number): string {
  const motion = shot.motion.toLowerCase();
  const peak = shot.variation === "large" ? 1.18 : shot.variation === "medium" ? 1.1 : 1.05;
  const pullOut = /pull[- ]?out|dolly out|zoom out|pull back|wider/.test(motion);
  const step = ((peak - 1) / Math.max(1, frames)).toFixed(6);

  // zoompan runs per output frame; `d=1` advances the zoom every frame rather
  // than holding one still for the whole shot.
  const zoom = pullOut
    ? `if(eq(on,0),${peak},max(zoom-${step},1))`
    : `if(eq(on,0),1,min(zoom+${step},${peak}))`;

  const panLeft = /pan(?:s|ning)? left|tracks? left|moves? left/.test(motion);
  const panRight = /pan(?:s|ning)? right|tracks? right|moves? right/.test(motion);
  const x = panLeft
    ? "(iw-iw/zoom)*(1-on/max(1,%F))"
    : panRight
      ? "(iw-iw/zoom)*(on/max(1,%F))"
      : "iw/2-(iw/zoom/2)";
  const tiltUp = /tilts? up|cranes? up|rises?/.test(motion);
  const tiltDown = /tilts? down|cranes? down|descends?/.test(motion);
  const y = tiltUp
    ? "(ih-ih/zoom)*(1-on/max(1,%F))"
    : tiltDown
      ? "(ih-ih/zoom)*(on/max(1,%F))"
      : "ih/2-(ih/zoom/2)";

  const total = String(frames);
  return [
    `zoompan=z='${zoom}'`,
    `x='${x.replaceAll("%F", total)}'`,
    `y='${y.replaceAll("%F", total)}'`,
    `d=1:s=${width}x${height}:fps=30`,
  ].join(":");
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const milli = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${milli}`;
}

/** Dialogue and narration as a subtitle track, timed to the shots that carry them. */
function subtitles(shots: VimaxShot[]): string {
  const cues: string[] = [];
  let clock = 0;
  let index = 0;
  for (const shot of shots) {
    const lines = shot.dialogue
      .filter((entry) => entry.line.trim())
      .map((entry) => (entry.speaker ? `${entry.speaker.toUpperCase()}: ${entry.line}` : entry.line));
    if (shot.narration?.trim()) lines.unshift(shot.narration.trim());
    if (lines.length) {
      index += 1;
      cues.push(
        `${index}\n${srtTime(clock + 0.15)} --> ${srtTime(clock + shot.durationSeconds - 0.15)}\n${lines.join("\n")}\n`,
      );
    }
    clock += shot.durationSeconds;
  }
  return cues.join("\n");
}

export interface RenderVideoInput {
  production: VimaxProduction;
  /** Absolute path to each shot's drawn frame, in film order. */
  frames: Array<{ shot: VimaxShot; imagePath: string }>;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Encode the animatic. Each shot becomes its own clip and the clips are
 * concatenated: one bad frame then costs one shot rather than the whole film,
 * and a forty-shot graph never has to fit in a single filter expression.
 */
export async function renderProductionVideo(input: RenderVideoInput): Promise<VideoRenderResult> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    return {
      ok: false,
      reason:
        "No ffmpeg was found, so the shots could not be encoded into a video file. Set VIMAX_FFMPEG_PATH to one.",
    };
  }
  if (input.frames.length === 0) {
    return { ok: false, reason: "No drawn frames, so there was nothing to encode." };
  }

  const { width, height } = dimensions(input.production);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vimax-render-"));
  const clips: string[] = [];

  try {
    let index = 0;
    for (const { shot, imagePath } of input.frames) {
      if (input.signal?.aborted) {
        return { ok: false, reason: "The render was stopped." };
      }
      const clip = path.join(workspace, `shot-${String(index).padStart(3, "0")}.mp4`);
      const duration = Math.max(1, Math.min(20, shot.durationSeconds));
      const frames = Math.round(duration * 30);
      const filter = [
        `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase`,
        `crop=${width * 2}:${height * 2}`,
        zoompan(shot, frames, width, height),
        "format=yuv420p",
      ].join(",");

      const result = await run(
        ffmpeg,
        [
          "-nostdin", "-y", "-loglevel", "error",
          // The input frame rate has to be set *before* -i. A looped still
          // decodes at ffmpeg's 25fps default otherwise, so `-t 5` yields 125
          // frames, zoompan emits one per input frame, and tagging the output
          // at 30fps then plays the shot in 4.2s. Every shot came out ~17%
          // short that way, and the subtitles — timed from the storyboard —
          // drifted further out of sync with every shot.
          "-loop", "1", "-r", "30", "-t", String(duration), "-i", imagePath,
          "-vf", filter,
          "-r", "30",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
          "-pix_fmt", "yuv420p",
          clip,
        ],
        input.signal,
      );
      if (result.code === 0 && fs.existsSync(clip)) {
        clips.push(clip);
      } else if (clips.length === 0 && index === input.frames.length - 1) {
        return {
          ok: false,
          reason: `ffmpeg could not encode any shot. ${result.stderr.slice(-400)}`.trim(),
        };
      }
      index += 1;
      input.onProgress?.(index, input.frames.length);
    }

    if (clips.length === 0) {
      return { ok: false, reason: "ffmpeg encoded no shots." };
    }

    // The concat demuxer needs forward slashes even on Windows.
    const listPath = path.join(workspace, "clips.txt");
    fs.writeFileSync(
      listPath,
      clips.map((clip) => `file '${clip.replaceAll("\\", "/")}'`).join("\n"),
      "utf8",
    );

    const srt = subtitles(input.frames.map((entry) => entry.shot));
    const srtPath = path.join(workspace, "captions.srt");
    if (srt.trim()) fs.writeFileSync(srtPath, srt, "utf8");

    const outputPath = path.join(workspace, "film.mp4");
    const concat = await run(
      ffmpeg,
      [
        "-nostdin", "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", listPath,
        ...(srt.trim() ? ["-i", srtPath] : []),
        "-map", "0:v",
        ...(srt.trim() ? ["-map", "1:s", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng"] : []),
        "-c:v", "copy",
        "-movflags", "+faststart",
        outputPath,
      ],
      input.signal,
    );
    if (concat.code !== 0 || !fs.existsSync(outputPath)) {
      return {
        ok: false,
        reason: `ffmpeg could not assemble the film. ${concat.stderr.slice(-400)}`.trim(),
      };
    }

    const durationSeconds = input.frames.reduce(
      (total, entry) => total + Math.max(1, Math.min(20, entry.shot.durationSeconds)),
      0,
    );
    return {
      ok: true,
      filePath: outputPath,
      width,
      height,
      durationSeconds,
      shotCount: clips.length,
      workspace,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The film could not be encoded.",
    };
  }
}
