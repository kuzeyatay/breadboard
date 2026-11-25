// A browser-playable copy of an attached video.
//
// Matroska, AVI, MPEG and WMV are stored whole for the Watch skill, but a
// <video> element will not open them. The first time one is played, ffmpeg
// makes an MP4 beside the store and every later play streams that copy. The
// work is as small as the file allows: an H.264 stream is only rewrapped
// (seconds, even for a long recording), and only other codecs are re-encoded.
//
// The copy lives under `playback/u<userId>/`, so ownership is the same path
// property the original has, and a request for somebody else's video still
// finds nothing to convert.

import { spawn } from "node:child_process";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { resolveFfmpeg as resolvePinnedFfmpeg } from "../vimax/video.ts";
import { playbackCopyPath, type StoredVideoBlob } from "./video-blob-store.ts";
import { toolSearchPath } from "../../../scripts/host-path.mjs";

const fsp = fs.promises;

/** Long enough for a feature-length re-encode; a stuck ffmpeg is still ended. */
const CONVERSION_TIMEOUT_MS = 60 * 60 * 1000;

export class VideoPlaybackError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "VideoPlaybackError";
    this.status = status;
    this.code = code;
  }
}

/**
 * The repository-pinned ffmpeg (the desktop's ffmpeg-static, bundled bin) or
 * an explicit setting, then one on PATH for a plain development checkout.
 */
export function resolveFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const pinned = env.BREADBOARD_CHAT_VIDEO_FFMPEG_PATH?.trim() || resolvePinnedFfmpeg(env);
  if (pinned && fs.existsSync(pinned)) return pinned;
  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const directory of toolSearchPath(env)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** One conversion per file, however many range requests arrive while it runs. */
const inFlight = new Map<string, Promise<string>>();

export interface ProbedStreams {
  video: string | null;
  audio: string | null;
}

/** The first video and audio codec names from `ffmpeg -i` output. */
export function parseProbedStreams(stderr: string): ProbedStreams {
  const video = /Stream #\d+:\d+[^:]*: Video: ([a-z0-9_]+)/i.exec(stderr)?.[1]?.toLowerCase() ?? null;
  const audio = /Stream #\d+:\d+[^:]*: Audio: ([a-z0-9_]+)/i.exec(stderr)?.[1]?.toLowerCase() ?? null;
  return { video, audio };
}

/**
 * The ffmpeg arguments for one conversion: copy what a browser already
 * decodes inside MP4, re-encode the rest, and put the index up front so the
 * player can start before the whole file has arrived.
 */
export function playbackConversionArgs(input: string, output: string, streams: ProbedStreams): string[] {
  const copyVideo = streams.video === "h264";
  const copyAudio = streams.audio === "aac" || streams.audio === "mp3";
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i", input,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-sn",
    "-dn",
    ...(copyVideo
      ? ["-c:v", "copy"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
         // Odd dimensions are common in screen recordings and refused by yuv420p.
         "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]),
    ...(streams.audio === null
      ? []
      : copyAudio
        ? ["-c:a", "copy"]
        : ["-c:a", "aac", "-b:a", "160k"]),
    "-movflags", "+faststart",
    "-f", "mp4",
    output,
  ];
}

function run(executable: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Only the head (stream list) and the tail (the error) are ever read.
      stderr = stderr.length < 64_000 ? stderr + chunk : stderr.slice(0, 32_000) + stderr.slice(-32_000) + chunk;
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function convert(blob: StoredVideoBlob, output: string): Promise<string> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    throw new VideoPlaybackError(503, "video_converter_unavailable", "This video needs ffmpeg to play, and ffmpeg was not found.");
  }
  // `ffmpeg -i` with no output lists the streams and exits 1; that is expected.
  const probe = await run(ffmpeg, ["-hide_banner", "-nostdin", "-i", blob.path], 60_000);
  const streams = parseProbedStreams(probe.stderr);
  if (!streams.video) {
    throw new VideoPlaybackError(422, "video_unreadable", "This file has no video stream that could be read.");
  }
  await fsp.mkdir(path.dirname(output), { recursive: true });
  const partial = `${output}.${process.pid}.${Date.now()}.partial`;
  try {
    let result = await run(ffmpeg, playbackConversionArgs(blob.path, partial, streams), CONVERSION_TIMEOUT_MS);
    if (result.code !== 0 && (streams.video === "h264" || streams.audio === "aac" || streams.audio === "mp3")) {
      // A copied stream can still be refused by the MP4 muxer (odd timestamps
      // in an old AVI). Re-encoding everything is the slower answer that works.
      result = await run(
        ffmpeg,
        playbackConversionArgs(blob.path, partial, { video: `${streams.video}-reencode`, audio: streams.audio && `${streams.audio}-reencode` }),
        CONVERSION_TIMEOUT_MS,
      );
    }
    if (result.code !== 0) {
      throw new VideoPlaybackError(422, "video_conversion_failed", "This video could not be converted for playback.");
    }
    await fsp.rename(partial, output);
    return output;
  } finally {
    await fsp.rm(partial, { force: true }).catch(() => undefined);
  }
}

/** The path of an MP4 the browser can play, making it on first request. */
export async function ensurePlaybackCopy(
  userId: number,
  blob: StoredVideoBlob,
  root?: string,
): Promise<string> {
  const output = playbackCopyPath(userId, blob.blobId, root);
  if (fs.statSync(output, { throwIfNoEntry: false })?.isFile()) return output;
  const running = inFlight.get(output);
  if (running) return running;
  const job = convert(blob, output).finally(() => inFlight.delete(output));
  inFlight.set(output, job);
  return job;
}
