// Driving subsai, for the two things subtitles are ever wanted for.
//
//   words()     — one cue per word, converted into the Scribe-shaped JSON the
//                 video editor's transcript layer already reads. This is the
//                 stand-in for the times the Scriberr service is not up: the
//                 editor never learns which engine produced the file it reads.
//   subtitles() — an ordinary subtitle file, for when the ask was a file and the
//                 video should be left alone.
//
// Both go through the clone's own CLI in a fresh disposable Runtime worker: the
// CLI is the documented batch entry point, it owns the model registry and the
// pysubs2 writing, and driving it means no second definition of either. The
// dashboard only streams the media input and reads the worker's bounded output.
//
// `faster-whisper` is the default backend because it is the one that gives
// word-level timings without a GPU, and because `word_timestamps` turns its
// output into exactly one subtitle event per word — which is a word list in
// disguise, and the reason the conversion below is a parser rather than a
// second transcription.

import fsp from "node:fs/promises";
import path from "node:path";
import {
  externalRuntimeCopyFileAsync,
  externalRuntimePathExists,
  externalRuntimeReadUtf8Async,
} from "../external-runtime-filesystem.ts";
import type {
  SubsAiRuntimeOutput,
  SubsAiRuntimeScope,
} from "../runtime-v2/subsai-transcription-job.ts";
import { repositoryRoot, runtimeV2ServiceVenv } from "../runtime-paths.ts";
import type { SubtitleFormat } from "./identity.ts";
import { scribeTranscript, type ScribeTranscript } from "../video-use/scribe-shape.ts";

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

async function transcribeWithRuntime(input: {
  scope: SubsAiRuntimeScope;
  mediaPath: string;
  mode: "words" | "subtitles";
  size?: WhisperSize;
  language?: string | null;
  format?: SubtitleFormat;
  signal?: AbortSignal;
  onProgress?: (progress: TranscribeProgress) => void;
}): Promise<SubsAiRuntimeOutput> {
  const runtime = await import("../runtime-v2/subsai-transcription-job.ts");
  try {
    return await runtime.transcribeWithSubsAiViaRuntime(input);
  } catch (error) {
    if (error instanceof runtime.SubsAiRuntimeError) {
      throw new SubsAiError(error.code, error.message);
    }
    throw error;
  }
}

export interface TranscribeInput {
  runtimeScope: SubsAiRuntimeScope;
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
  const output = await transcribeWithRuntime({
    scope: input.runtimeScope,
    mediaPath: input.media,
    mode: "words",
    size: input.size,
    language: input.language,
    signal: input.signal,
    onProgress: input.onProgress,
  });
  try {
    const cues = parseSrt(await externalRuntimeReadUtf8Async(output.filePath));
    if (!cues.length) return false;
    const transcript = scribeTranscriptFromWords(cues);
    await fsp.mkdir(path.dirname(input.destination), { recursive: true });
    const draft = `${input.destination}.tmp`;
    await fsp.writeFile(draft, JSON.stringify(transcript, null, 2), "utf8");
    await fsp.rename(draft, input.destination);
    return true;
  } finally {
    output.cleanup();
  }
}

/**
 * An ordinary subtitle file, phrase level, for when the ask was a file. Written
 * by the clone's own pysubs2 path so every format it supports is supported
 * here, and returned as a path for the caller to store as an artifact.
 */
export async function writeSubtitleFile(
  input: TranscribeInput & { format: SubtitleFormat; destination: string },
): Promise<string> {
  const output = await transcribeWithRuntime({
    scope: input.runtimeScope,
    mediaPath: input.media,
    mode: "subtitles",
    size: input.size,
    language: input.language,
    format: input.format,
    signal: input.signal,
    onProgress: input.onProgress,
  });
  try {
    await fsp.mkdir(path.dirname(input.destination), { recursive: true });
    await externalRuntimeCopyFileAsync(output.filePath, input.destination);
    return input.destination;
  } finally {
    output.cleanup();
  }
}

function isClone(candidate: string): boolean {
  return externalRuntimePathExists(path.join(candidate, "src", "subsai", "cli.py")) &&
    externalRuntimePathExists(path.join(candidate, "src", "subsai", "configs.py"));
}

function passiveRoot(): string | null {
  const explicitValue = process.env.SUBSAI_ROOT?.trim();
  const explicit = explicitValue ? path.resolve(explicitValue) : null;
  if (process.env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit) ? explicit : null;
  }
  const candidates = [
    explicit,
    path.join(repositoryRoot(), "subsai"),
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && isClone(candidate))) ?? null;
}

/** File checks only; a Video Use run never launches an executable to select its engine. */
export function subsAiInstalled(): boolean {
  if (!passiveRoot()) return false;
  const venv = runtimeV2ServiceVenv("subsai");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  return externalRuntimePathExists(python);
}
