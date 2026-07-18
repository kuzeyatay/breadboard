// Real media validation with ffprobe. Extensions and browser MIME types are
// advisory only; the probe is the authority on what a file actually contains.

import fs from "fs";

import { CommandNotFoundError, runCommand } from "./exec.ts";
import { VideoTranscriptionError } from "./errors.ts";
import type { MediaProbeResult } from "./types.ts";

interface FfprobeStream {
  codec_type?: unknown;
  codec_name?: unknown;
}

interface FfprobeOutput {
  format?: {
    format_name?: unknown;
    duration?: unknown;
    size?: unknown;
  };
  streams?: FfprobeStream[];
}

/** Pure parser for ffprobe's JSON output (unit-testable without ffprobe). */
export function parseFfprobeOutput(raw: unknown): MediaProbeResult {
  if (!raw || typeof raw !== "object") {
    throw new VideoTranscriptionError("media_unsupported", {
      detail: "ffprobe returned no parseable output",
    });
  }
  const output = raw as FfprobeOutput;
  const streams = Array.isArray(output.streams) ? output.streams : [];

  const codecs: string[] = [];
  let hasAudio = false;
  let hasVideo = false;
  for (const stream of streams) {
    const type = typeof stream.codec_type === "string" ? stream.codec_type : "";
    const codec = typeof stream.codec_name === "string" ? stream.codec_name : "";
    if (codec) codecs.push(codec);
    if (type === "audio") hasAudio = true;
    if (type === "video") hasVideo = true;
  }

  const duration = Number.parseFloat(String(output.format?.duration ?? ""));
  const size = Number.parseInt(String(output.format?.size ?? ""), 10);

  return {
    container:
      typeof output.format?.format_name === "string"
        ? output.format.format_name
        : null,
    codecs,
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
    hasAudio,
    hasVideo,
    sizeBytes: Number.isFinite(size) && size >= 0 ? size : null,
  };
}

export async function probeMediaFile(
  ffprobePath: string,
  filePath: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<MediaProbeResult> {
  if (!fs.existsSync(filePath)) {
    throw new VideoTranscriptionError("media_missing");
  }

  let result;
  try {
    result = await runCommand(
      ffprobePath,
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { timeoutMs },
    );
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      throw new VideoTranscriptionError("ffprobe_unavailable", { cause: error });
    }
    throw new VideoTranscriptionError("internal_error", {
      detail: "ffprobe failed to start",
      cause: error,
    });
  }

  if (result.timedOut) {
    throw new VideoTranscriptionError("media_unsupported", {
      detail: "ffprobe timed out",
    });
  }
  if (result.code !== 0) {
    throw new VideoTranscriptionError("media_unsupported", {
      detail: `ffprobe exit ${result.code}`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new VideoTranscriptionError("media_unsupported", {
      detail: "ffprobe output was not JSON",
    });
  }
  return parseFfprobeOutput(parsed);
}

/** Enforce the audio/duration policy on a probe result. */
export function assertProbeAcceptable(
  probe: MediaProbeResult,
  { maxDurationSeconds }: { maxDurationSeconds: number },
): void {
  if (!probe.hasAudio) {
    throw new VideoTranscriptionError("media_no_audio");
  }
  if (
    probe.durationSeconds !== null &&
    probe.durationSeconds > maxDurationSeconds
  ) {
    throw new VideoTranscriptionError("media_too_long");
  }
}
