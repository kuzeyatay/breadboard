// Driving subsai, for the two things subtitles are ever wanted for.
//
//   words()     — one cue per word, converted into the Scribe-shaped JSON the
//                 video editor's transcript layer already reads. This is the
//                 stand-in for the times the Scriberr service is not up: the
//                 editor never learns which engine produced the file it reads.
//   subtitles() — an ordinary subtitle file, for when the ask was a file and the
//                 video should be left alone.
//
// Both go through the clone's own CLI rather than importing its Python: the CLI
// is the documented batch entry point, it owns the model registry and the
// pysubs2 writing, and driving it means no second definition of either.
//
// `faster-whisper` is the default backend because it is the one that gives
// word-level timings without a GPU, and because `word_timestamps` turns its
// output into exactly one subtitle event per word — which is a word list in
// disguise, and the reason the conversion below is a parser rather than a
// second transcription.

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveSubsAiRoot,
  subsAiEnv,
  subsAiHealth,
  venvPython,
} from "./runtime.ts";
import type { SubtitleFormat } from "./identity.ts";
import { scribeTranscript, type ScribeTranscript } from "../video-use/scribe-shape.ts";

const TRANSCRIBE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** The backend Breadboard installs and drives. */
export const DEFAULT_MODEL = "guillaumekln/faster-whisper";

/**
 * Whisper sizes, smallest first. `base` is the default: on a CPU it is roughly
 * real-time, and subtitles that arrive are worth more than subtitles that are
 * marginally better and take an hour.
 */
export const WHISPER_SIZES = ["tiny", "base", "small", "medium", "large-v3"] as const;
export type WhisperSize = (typeof WHISPER_SIZES)[number];

export function isWhisperSize(value: unknown): value is WhisperSize {
  return typeof value === "string" && (WHISPER_SIZES as readonly string[]).includes(value);
}

/**
 * The backend's own defaults are `device: "auto"` and `compute_type: "default"`,
 * and "auto" means CUDA whenever CTranslate2 thinks a GPU might be there — which
 * on a machine without the CUDA runtime fails deep inside the encoder with
 * `cublas64_12.dll is not found`, minutes into a transcription. Pinning the CPU
 * makes the slow path the reliable one; `int8` is what makes it bearable.
 *
 * A GPU box can override this with SUBSAI_DEVICE=cuda.
 */
function cpuModelConfig(size: WhisperSize | undefined): Record<string, unknown> {
  const device = process.env.SUBSAI_DEVICE?.trim() || "cpu";
  return {
    model_size_or_path: size ?? "base",
    device,
    compute_type:
      process.env.SUBSAI_COMPUTE_TYPE?.trim() || (device === "cpu" ? "int8" : "default"),
  };
}

export class SubsAiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SubsAiError";
    this.code = code;
  }
}

export interface TranscribeProgress {
  stage: string;
  detail?: string;
}

interface RunInput {
  media: string;
  destination: string;
  format: SubtitleFormat;
  model: string;
  modelConfig: Record<string, unknown>;
  suffix?: string;
  language?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: TranscribeProgress) => void;
}

function runSubsAi(input: RunInput): Promise<void> {
  const health = subsAiHealth();
  if (!health.available || !health.root || !health.python) {
    throw new SubsAiError(
      "environment_missing",
      health.reason ?? "Subtitles are not set up on this machine.",
    );
  }

  const args = [
    "-m", "subsai.cli",
    input.media,
    "--model", input.model,
    "--model-configs", JSON.stringify(input.modelConfig),
    "--format", input.format,
    "--destination-folder", input.destination,
    ...(input.suffix ? ["--output-suffix", input.suffix] : []),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(health.python!, args, {
      cwd: health.root!,
      windowsHide: true,
      env: subsAiEnv({ PYTHONPATH: path.join(health.root!, "src") }),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrTail = "";
    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    const consume = (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        // The first run of a size downloads its weights, which is most of the
        // wait and worth saying out loud.
        if (/download/i.test(line)) {
          input.onProgress?.({ stage: "Downloading the model", detail: line.slice(0, 120) });
        } else if (/transcrib/i.test(line)) {
          input.onProgress?.({ stage: "Transcribing" });
        }
        newline = buffer.indexOf("\n");
      }
      if (buffer.length > 100_000) buffer = "";
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-8_000);
      consume(chunk);
    });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, TRANSCRIBE_TIMEOUT_MS);
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
      reject(new SubsAiError("spawn_failed", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (code === 0) {
        resolve();
        return;
      }
      if (input.signal?.aborted) {
        reject(new SubsAiError("aborted", "Transcription was stopped."));
        return;
      }
      const detail = stderrTail
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("█") && !/^\s*\d+%/.test(line))
        .slice(-3)
        .join(" ");
      reject(
        new SubsAiError(
          "transcribe_failed",
          detail ? `Subtitles could not be generated: ${detail}` : "Subtitles could not be generated.",
        ),
      );
    });
  });
}

/** The file subsai wrote, found by stem rather than guessed at. */
async function producedFile(
  destination: string,
  format: SubtitleFormat,
): Promise<string> {
  const entries = await fsp.readdir(destination);
  const match = entries.find((entry) => entry.toLowerCase().endsWith(`.${format}`));
  if (!match) {
    throw new SubsAiError(
      "no_output",
      "Transcription finished without writing a subtitle file.",
    );
  }
  return path.join(destination, match);
}

// ---------------------------------------------------------------------------
// SubRip parsing
// ---------------------------------------------------------------------------

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

const TIMESTAMP =
  /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function seconds(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000
  );
}

/** Parse SubRip into cues. Tolerant: a malformed block is skipped, not fatal. */
export function parseSrt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const block of content.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim());
    if (!lines.length) continue;
    const timingLine = lines.find((line) => TIMESTAMP.test(line));
    if (!timingLine) continue;
    const match = TIMESTAMP.exec(timingLine)!;
    const text = lines
      .slice(lines.indexOf(timingLine) + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!text) continue;
    cues.push({
      start: seconds(match[1], match[2], match[3], match[4]),
      end: seconds(match[5], match[6], match[7], match[8]),
      text,
    });
  }
  return cues;
}

/**
 * Word cues into the transcript shape the video editor reads.
 *
 * The shape itself is defined once, in `video-use/scribe-shape.ts`, because
 * every engine has to produce it — this is the parse from subsai's one-cue-per-
 * word SubRip into that shape, and nothing more. Speakers are left unset: local
 * diarization needs whisperX and a Hugging Face token, and one speaker is the
 * honest answer rather than a guess the packer would break phrases on.
 */
export function scribeTranscriptFromWords(cues: readonly SubtitleCue[]): ScribeTranscript {
  return scribeTranscript(cues);
}

// ---------------------------------------------------------------------------
// The two entry points
// ---------------------------------------------------------------------------

async function withScratch<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "subsai-"));
  try {
    return await run(directory);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface TranscribeInput {
  media: string;
  size?: WhisperSize;
  language?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: TranscribeProgress) => void;
}

/**
 * Word-level timings for the video editor. Written to `destination` in the
 * Scribe JSON shape, so the editor's cache and the clone's helpers read it
 * exactly as they read a hosted transcript.
 */
export async function writeWordTranscript(
  input: TranscribeInput & { destination: string },
): Promise<boolean> {
  const cues = await withScratch(async (directory) => {
    await runSubsAi({
      media: input.media,
      destination: directory,
      format: "srt",
      model: DEFAULT_MODEL,
      modelConfig: {
        ...cpuModelConfig(input.size),
        word_timestamps: true,
        ...(input.language ? { language: input.language } : {}),
      },
      signal: input.signal,
      onProgress: input.onProgress,
    });
    return parseSrt(await fsp.readFile(await producedFile(directory, "srt"), "utf8"));
  });

  if (!cues.length) return false;
  const transcript = scribeTranscriptFromWords(cues);
  await fsp.mkdir(path.dirname(input.destination), { recursive: true });
  const draft = `${input.destination}.tmp`;
  await fsp.writeFile(draft, JSON.stringify(transcript, null, 2), "utf8");
  await fsp.rename(draft, input.destination);
  return true;
}

/**
 * An ordinary subtitle file, phrase level, for when the ask was a file. Written
 * by the clone's own pysubs2 path so every format it supports is supported
 * here, and returned as a path for the caller to store as an artifact.
 */
export async function writeSubtitleFile(
  input: TranscribeInput & { format: SubtitleFormat; destination: string },
): Promise<string> {
  return withScratch(async (directory) => {
    await runSubsAi({
      media: input.media,
      destination: directory,
      format: input.format,
      model: DEFAULT_MODEL,
      modelConfig: {
        ...cpuModelConfig(input.size),
        ...(input.language ? { language: input.language } : {}),
      },
      signal: input.signal,
      onProgress: input.onProgress,
    });
    const produced = await producedFile(directory, input.format);
    await fsp.mkdir(path.dirname(input.destination), { recursive: true });
    await fsp.copyFile(produced, input.destination);
    return input.destination;
  });
}

/** Whether the clone is present at all, for callers that degrade rather than fail. */
export function subsAiInstalled(): boolean {
  const root = resolveSubsAiRoot();
  return Boolean(root && venvPython(root.root));
}
