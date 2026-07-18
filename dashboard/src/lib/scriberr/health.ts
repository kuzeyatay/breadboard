// Dependency health checks for the video transcription feature. The UI uses
// these to tell the user exactly which dependency is missing (Scriberr,
// yt-dlp, FFmpeg, ffprobe, writable directories) instead of a generic error.

import fs from "fs";
import path from "path";
import crypto from "crypto";

import { probeCommandVersion } from "./exec";
import type { VideoTranscriptionConfig } from "./config";

export interface HealthCheckItem {
  ok: boolean;
  version?: string;
  detail?: string;
}

export interface VideoTranscriptionHealth {
  enabled: boolean;
  scriberr: HealthCheckItem;
  ytdlp: HealthCheckItem;
  ffmpeg: HealthCheckItem;
  ffprobe: HealthCheckItem;
  /** yt-dlp needs a JavaScript runtime for YouTube extraction; Node qualifies. */
  jsRuntime: HealthCheckItem;
  tempDirWritable: HealthCheckItem;
  sourcesDirWritable: HealthCheckItem;
}

function checkDirWritable(dir: string): HealthCheckItem {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(
      dir,
      `.write-probe-${crypto.randomBytes(4).toString("hex")}`,
    );
    fs.writeFileSync(probe, "ok", "utf8");
    fs.rmSync(probe, { force: true });
    return { ok: true };
  } catch {
    return { ok: false, detail: "not writable" };
  }
}

export async function checkVideoTranscriptionHealth(
  config: VideoTranscriptionConfig,
  {
    contentPath,
    clusterSlug,
    scriberrHealthCheck,
  }: {
    contentPath: string | null;
    clusterSlug: string | null;
    scriberrHealthCheck: () => Promise<{ ok: boolean; detail?: string }>;
  },
): Promise<VideoTranscriptionHealth> {
  const [scriberr, ytdlp, ffmpeg, ffprobe] = await Promise.all([
    scriberrHealthCheck(),
    probeCommandVersion(config.ytdlpPath),
    probeCommandVersion(config.ffmpegPath, ["-version"]),
    probeCommandVersion(config.ffprobePath, ["-version"]),
  ]);

  const sourcesDir =
    contentPath && clusterSlug
      ? path.join(contentPath, clusterSlug, "sources")
      : null;

  return {
    enabled: config.enabled,
    scriberr,
    ytdlp,
    ffmpeg,
    ffprobe,
    jsRuntime: {
      ok: true,
      version: `node ${process.versions.node}`,
    },
    tempDirWritable: checkDirWritable(config.tempDir),
    sourcesDirWritable: sourcesDir
      ? checkDirWritable(sourcesDir)
      : { ok: false, detail: "garden content path not configured" },
  };
}
