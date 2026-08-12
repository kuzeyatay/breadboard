// Fetching a linked video once, into the chat's own video store.
//
// yt-dlp does the work. Breadboard already depends on it — the desktop shell
// bundles it and sets `YTDLP_PATH`, Scriberr's importer reads that same
// variable, and `scriberr/ytdlp.ts` already knows how to ask it for a video's
// metadata and refuse a playlist. All of that is reused here; what is new is
// only the download itself, which Scriberr delegates to its own service and so
// never produced a file this side could keep.
//
// The result is deliberately an ordinary video blob. A link that has been
// fetched becomes indistinguishable from a video someone attached, which is why
// nothing downstream needed changing to support one.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { CommandNotFoundError, runCommand } from "../scriberr/exec.ts";
import { buildYtdlpMetadataArgs } from "../scriberr/ytdlp.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import {
  MAX_VIDEO_ATTACHMENT_BYTES,
  isVideoAttachmentFormat,
  type VideoAttachmentFormat,
} from "../video-attachments.ts";
import { adoptVideoBlob, type StoredVideoBlob } from "../conversations/video-blob-store.ts";
import { recordVideoSource } from "./store.ts";
import type { VideoSource } from "./identity.ts";

const METADATA_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

/** Long enough that a fetch is a mistake rather than a wait. */
export const MAX_SOURCE_DURATION_SECONDS = 4 * 60 * 60;

export class VideoDownloadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VideoDownloadError";
    this.code = code;
  }
}

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/**
 * yt-dlp, by the same contract the rest of the app uses: `YTDLP_PATH` first —
 * which is what the desktop shell sets to its bundled copy and what Scriberr
 * and the Watch skill already read — then the copies this repository ships,
 * then PATH.
 */
export function resolveYtDlp(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.YTDLP_PATH?.trim();
  if (configured && configured !== "yt-dlp" && fs.existsSync(configured)) {
    return path.resolve(configured);
  }
  const root = repositoryRoot();
  for (const candidate of [
    path.join(root, "desktop", "resources", "bin", executableName("yt-dlp")),
    path.join(root, "agent-reach", ".tools", "bin", executableName("yt-dlp")),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return configured || null;
}

export interface SourceMetadata {
  title: string;
  durationSeconds: number | null;
  isLive: boolean;
  extension: string;
}

/**
 * Ask yt-dlp what the link is before fetching it, so a livestream, a four-hour
 * upload or a dead link fails in a second rather than after a partial download.
 *
 * Reuses the argument builder Scriberr's importer uses, so there is one
 * definition of "probe a single video, never a playlist".
 */
export async function inspectSource(
  source: VideoSource,
  binary: string,
): Promise<SourceMetadata> {
  let result;
  try {
    result = await runCommand(binary, buildYtdlpMetadataArgs(source.canonicalUrl), {
      timeoutMs: METADATA_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      throw new VideoDownloadError(
        "ytdlp_unavailable",
        "yt-dlp was not found, so linked videos cannot be fetched. Install it or set YTDLP_PATH.",
      );
    }
    throw new VideoDownloadError("probe_failed", "That link could not be read.");
  }
  if (result.timedOut) {
    throw new VideoDownloadError("probe_failed", "Reading that link timed out.");
  }
  if (result.code !== 0) {
    throw new VideoDownloadError(
      "probe_failed",
      "That link could not be read as a single video.",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new VideoDownloadError("probe_failed", "That link could not be read as a video.");
  }
  if (parsed._type === "playlist" || Array.isArray(parsed.entries)) {
    throw new VideoDownloadError("playlist", "That is a playlist. Link one video.");
  }
  if (parsed.is_live === true) {
    throw new VideoDownloadError("live", "That is a live stream, which cannot be fetched.");
  }

  const duration = Number(parsed.duration);
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
  if (durationSeconds && durationSeconds > MAX_SOURCE_DURATION_SECONDS) {
    throw new VideoDownloadError(
      "too_long",
      `That video is ${Math.round(durationSeconds / 3600)} hours long, which is beyond what this fetches.`,
    );
  }

  const extension = typeof parsed.ext === "string" ? parsed.ext.toLowerCase() : "mp4";
  return {
    title:
      (typeof parsed.title === "string" && parsed.title.trim()) || source.label || "video",
    durationSeconds,
    isLive: false,
    extension,
  };
}

export interface DownloadProgress {
  /** 0–100 when yt-dlp reports one. */
  percent: number;
  /** A short line for the composer: "Downloading · 42% · 3.1 MiB/s". */
  detail: string;
}

/**
 * Run the download, reporting progress as yt-dlp prints it.
 *
 * `runCommand` is not used here on purpose: it buffers output and resolves at
 * exit, which is right for a metadata probe and wrong for something that takes
 * minutes and has a progress bar worth showing.
 */
function fetchToDirectory(input: {
  binary: string;
  source: VideoSource;
  directory: string;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--no-part",
      // Cap the fetch so a 4K master does not arrive when a 1080p copy is what
      // gets watched and edited. `b` falls back to whatever single file exists.
      "-f",
      "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b",
      "--merge-output-format",
      "mp4",
      "--max-filesize",
      String(MAX_VIDEO_ATTACHMENT_BYTES),
      "-o",
      path.join(input.directory, "source.%(ext)s"),
      "--",
      input.source.canonicalUrl,
    ];
    const child = spawn(input.binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrTail = "";
    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        // [download]  42.3% of 118.20MiB at 3.11MiB/s ETA 00:21
        const match = /^\[download]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)(?:\s+at\s+(\S+))?/.exec(line);
        if (match) {
          input.onProgress?.({
            percent: Math.min(100, Math.max(0, Number(match[1]) || 0)),
            detail: `${match[1]}% of ${match[2]}${match[3] ? ` at ${match[3]}` : ""}`,
          });
        } else if (/^\[Merger]|^\[ffmpeg]/.test(line)) {
          input.onProgress?.({ percent: 99, detail: "Merging audio and video" });
        }
        newline = buffer.indexOf("\n");
      }
      if (buffer.length > 100_000) buffer = "";
    });
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4_000);
    });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, DOWNLOAD_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    };
    input.signal?.addEventListener("abort", onAbort);

    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      reject(
        error.code === "ENOENT"
          ? new VideoDownloadError(
              "ytdlp_unavailable",
              "yt-dlp was not found, so linked videos cannot be fetched.",
            )
          : new VideoDownloadError("download_failed", "The download could not start."),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (code === 0) {
        resolve();
        return;
      }
      if (input.signal?.aborted) {
        reject(new VideoDownloadError("aborted", "The download was stopped."));
        return;
      }
      const detail = stderrTail
        .split(/\r?\n/)
        .map((line) => line.replace(/^ERROR:\s*/, "").trim())
        .filter(Boolean)
        .slice(-1)[0];
      reject(
        new VideoDownloadError(
          "download_failed",
          detail ? `The video could not be downloaded: ${detail}` : "The video could not be downloaded.",
        ),
      );
    });
  });
}

export interface DownloadedVideo {
  blob: StoredVideoBlob;
  title: string;
  durationSeconds: number | null;
}

/**
 * Fetch a linked video into this user's store and index it, so the next mention
 * of the same video is a lookup rather than a download.
 */
export async function downloadVideoSource(input: {
  userId: number;
  source: VideoSource;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  root?: string;
}): Promise<DownloadedVideo> {
  const binary = resolveYtDlp();
  if (!binary) {
    throw new VideoDownloadError(
      "ytdlp_unavailable",
      "yt-dlp was not found, so linked videos cannot be fetched. Install it or set YTDLP_PATH.",
    );
  }

  input.onProgress?.({ percent: 0, detail: "Reading the link" });
  const metadata = await inspectSource(input.source, binary);

  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "bb-video-source-"));
  try {
    input.onProgress?.({ percent: 1, detail: "Starting the download" });
    await fetchToDirectory({
      binary,
      source: input.source,
      directory: workspace,
      onProgress: input.onProgress,
      signal: input.signal,
    });

    const produced = (await fsp.readdir(workspace)).find((name) => name.startsWith("source."));
    if (!produced) {
      throw new VideoDownloadError(
        "download_failed",
        "The download finished without producing a file — the video may exceed the 2 GB limit.",
      );
    }
    const format = produced.slice(produced.lastIndexOf(".") + 1).toLowerCase();
    if (!isVideoAttachmentFormat(format)) {
      throw new VideoDownloadError(
        "unsupported_format",
        `That video arrived as .${format}, which is not a format this can store.`,
      );
    }

    input.onProgress?.({ percent: 100, detail: "Storing the video" });
    const blob = await adoptVideoBlob({
      userId: input.userId,
      filePath: path.join(workspace, produced),
      format: format as VideoAttachmentFormat,
      root: input.root,
    });

    recordVideoSource({
      userId: input.userId,
      key: input.source.key,
      blob,
      canonicalUrl: input.source.canonicalUrl,
      title: metadata.title,
      durationSeconds: metadata.durationSeconds,
      root: input.root,
    });

    return { blob, title: metadata.title, durationSeconds: metadata.durationSeconds };
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}
