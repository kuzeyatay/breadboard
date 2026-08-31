import "server-only";

// Turning narration into timed text, without keeping a model resident.
//
// The requirement that shapes this file: Breadboard already carries several
// heavyweight local services, so the speech model must not be one of them. It is
// installed the first time someone teaches a workflow, loaded only for the
// seconds it takes to transcribe one recording, and the process exits. Between
// demonstrations nothing is running and nothing is held in memory.
//
// The transcript is persisted next to the recording, so re-analysing a
// demonstration -- or re-teaching from it -- never transcribes twice, and the
// audio can be deleted while the words stay.

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { repositoryRoot } from "../runtime-paths.ts";
import { ensureDirectory, teachRoot } from "./artifacts.ts";
import { teachLog, teachWarn } from "./redaction.ts";
import type { DemonstrationTranscript, TranscriptSegment } from "./types.ts";

const execFileAsync = promisify(execFile);

const INSTALL_TIMEOUT_MS = 20 * 60_000;
const TRANSCRIBE_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_MODEL = "base";

export interface TranscriptionProgress {
  stage: "preparing" | "installing" | "downloading-model" | "transcribing" | "done";
  detail?: string;
}

export class TranscriptionUnavailable extends Error {
  readonly code: string;
  constructor(message: string, code = "unavailable") {
    super(message);
    this.name = "TranscriptionUnavailable";
    this.code = code;
  }
}

function whisperRoot(): string {
  return path.join(teachRoot(), "speech");
}

function venvDirectory(): string {
  return path.join(whisperRoot(), "venv");
}

function modelCacheDirectory(): string {
  return path.join(whisperRoot(), "models");
}

function venvPython(): string {
  return process.platform === "win32"
    ? path.join(venvDirectory(), "Scripts", "python.exe")
    : path.join(venvDirectory(), "bin", "python");
}

export function transcriptionScriptPath(): string {
  return path.join(repositoryRoot(), "dashboard", "scripts", "teach", "transcribe_demonstration.py");
}

function configuredModel(): string {
  const configured = process.env.BREADBOARD_TEACH_WHISPER_MODEL?.trim();
  return configured && /^[a-z0-9._-]{1,40}$/iu.test(configured) ? configured : DEFAULT_MODEL;
}

/** Interpreters to try when building the speech environment, best first. */
function basePythonCandidates(): string[] {
  const configured = process.env.BREADBOARD_TEACH_PYTHON?.trim();
  const candidates = configured ? [configured] : [];
  if (process.platform === "win32") {
    candidates.push("py", "python", "python3");
  } else {
    candidates.push("python3", "python");
  }
  return candidates;
}

async function resolveBasePython(): Promise<string | null> {
  for (const candidate of basePythonCandidates()) {
    const args = candidate === "py" ? ["-3", "-c", "import sys;print(sys.version_info[0:2])"] : ["-c", "import sys;print(sys.version_info[0:2])"];
    try {
      const { stdout } = await execFileAsync(candidate, args, { timeout: 20_000, windowsHide: true });
      if (/\(\s*3\s*,/u.test(stdout)) return candidate === "py" ? "py" : candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

export interface SpeechAvailability {
  /** The environment exists and can transcribe right now. */
  ready: boolean;
  /** It can be built on demand (a Python 3 interpreter is present). */
  installable: boolean;
  reason?: string;
  model: string;
}

export async function speechAvailability(): Promise<SpeechAvailability> {
  const model = configuredModel();
  if (fs.existsSync(venvPython())) return { ready: true, installable: true, model };
  const python = await resolveBasePython();
  if (!python) {
    return {
      ready: false,
      installable: false,
      model,
      reason: "No Python 3 interpreter was found, so narration cannot be transcribed locally.",
    };
  }
  return { ready: false, installable: true, model };
}

let installInFlight: Promise<string> | null = null;

/**
 * Build the speech environment if it is not already there.
 *
 * Shared between callers, because two demonstrations finishing at once must not
 * run two pip installs into the same directory.
 */
export async function ensureSpeechEnvironment(
  onProgress?: (progress: TranscriptionProgress) => void,
): Promise<string> {
  const python = venvPython();
  if (fs.existsSync(python)) return python;
  if (installInFlight) return installInFlight;
  installInFlight = installSpeechEnvironment(onProgress).finally(() => {
    installInFlight = null;
  });
  return installInFlight;
}

async function installSpeechEnvironment(
  onProgress?: (progress: TranscriptionProgress) => void,
): Promise<string> {
  const base = await resolveBasePython();
  if (!base) {
    throw new TranscriptionUnavailable(
      "No Python 3 interpreter was found, so narration cannot be transcribed locally.",
      "python_missing",
    );
  }

  onProgress?.({ stage: "installing", detail: "Creating the speech environment" });
  ensureDirectory(whisperRoot());

  const createArgs = base === "py" ? ["-3", "-m", "venv", venvDirectory()] : ["-m", "venv", venvDirectory()];
  try {
    await execFileAsync(base, createArgs, { timeout: INSTALL_TIMEOUT_MS, windowsHide: true });
  } catch (error) {
    throw new TranscriptionUnavailable(
      `The speech environment could not be created: ${(error as Error).message}`,
      "venv_failed",
    );
  }

  const python = venvPython();
  if (!fs.existsSync(python)) {
    throw new TranscriptionUnavailable("The speech environment was created without an interpreter.", "venv_failed");
  }

  onProgress?.({ stage: "installing", detail: "Installing the local speech engine" });
  try {
    await execFileAsync(
      python,
      ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "faster-whisper"],
      { timeout: INSTALL_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    const detail = error as { stderr?: string; message?: string };
    throw new TranscriptionUnavailable(
      `The local speech engine could not be installed: ${(detail.stderr || detail.message || "").trim().slice(0, 400)}`,
      "install_failed",
    );
  }

  teachLog("speech", "local speech environment installed");
  return python;
}

interface WhisperResult {
  ok?: boolean;
  code?: string;
  error?: string;
  segments?: Array<{ startMs?: number; endMs?: number; text?: string; confidence?: number }>;
  words?: Array<{ startMs?: number; endMs?: number; text?: string }>;
  language?: string | null;
  durationMs?: number;
  model?: string;
}

async function runWhisper(
  python: string,
  audioPath: string,
  signal: AbortSignal | undefined,
): Promise<WhisperResult> {
  const requestDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "breadboard-teach-stt-"));
  const requestPath = path.join(requestDirectory, "request.json");
  await fsp.writeFile(
    requestPath,
    JSON.stringify({
      audioPath,
      model: configuredModel(),
      downloadRoot: ensureDirectory(modelCacheDirectory()),
      computeType: "int8",
      wordTimestamps: true,
    }),
    "utf8",
  );

  try {
    return await new Promise<WhisperResult>((resolve, reject) => {
      const child = spawn(python, [transcriptionScriptPath(), requestPath], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "production",
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
          ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
          ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          // Keep model downloads inside Breadboard's data root rather than the
          // user's home cache, so retention and disk accounting can see them.
          HF_HOME: modelCacheDirectory(),
          PYTHONIOENCODING: "utf-8",
          PYTHONUNBUFFERED: "1",
        },
      });

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdout.length < 8 * 1024 * 1024) stdout += chunk;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 64 * 1024) stderr += chunk;
      });

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
        reject(new TranscriptionUnavailable("Transcribing the narration took too long.", "timeout"));
      }, TRANSCRIBE_TIMEOUT_MS);

      const onAbort = (): void => {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      child.once("error", (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          reject(new TranscriptionUnavailable("The teaching session was cancelled.", "cancelled"));
          return;
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          reject(
            new TranscriptionUnavailable(
              // stderr from the speech engine describes the engine, never the audio.
              `The speech engine produced no result. ${stderr.trim().slice(0, 300)}`.trim(),
              "no_output",
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(trimmed) as WhisperResult);
        } catch {
          reject(new TranscriptionUnavailable("The speech engine's answer could not be read.", "bad_output"));
        }
      });
    });
  } finally {
    await fsp.rm(requestDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface TranscribeOptions {
  audioPath: string;
  /** Where the audio clock sits relative to the recording clock. */
  audioStartOffsetMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: TranscriptionProgress) => void;
}

/**
 * Transcribe one demonstration's narration.
 *
 * Segment timings come back on the *audio's* clock; the offset that puts them on
 * the recording's clock travels with the transcript rather than being baked in,
 * so a re-analysis can correct a clock estimate without re-transcribing.
 */
export async function transcribeDemonstration(
  options: TranscribeOptions,
): Promise<DemonstrationTranscript> {
  if (!fs.existsSync(options.audioPath)) {
    throw new TranscriptionUnavailable("No narration was recorded for this demonstration.", "audio_missing");
  }

  options.onProgress?.({ stage: "preparing" });
  const python = await ensureSpeechEnvironment(options.onProgress);

  options.onProgress?.({ stage: "transcribing" });
  const result = await runWhisper(python, options.audioPath, options.signal);
  if (result.ok !== true) {
    throw new TranscriptionUnavailable(
      result.error ?? "The narration could not be transcribed.",
      result.code ?? "transcription_failed",
    );
  }

  const segments: TranscriptSegment[] = (result.segments ?? [])
    .filter((segment) => typeof segment.text === "string" && segment.text.trim().length > 0)
    .map((segment) => ({
      startMs: Math.max(0, Math.round(segment.startMs ?? 0)),
      endMs: Math.max(0, Math.round(segment.endMs ?? 0)),
      text: (segment.text as string).trim(),
      ...(typeof segment.confidence === "number" ? { confidence: segment.confidence } : {}),
    }))
    .sort((left, right) => left.startMs - right.startMs);

  const words = (result.words ?? [])
    .filter((word) => typeof word.text === "string" && word.text.trim().length > 0)
    .map((word) => ({
      startMs: Math.max(0, Math.round(word.startMs ?? 0)),
      endMs: Math.max(0, Math.round(word.endMs ?? 0)),
      text: (word.text as string).trim(),
    }));

  teachLog("speech", "narration transcribed", {
    segments: segments.length,
    words: words.length,
    model: result.model,
  });

  return {
    segments,
    ...(words.length > 0 ? { words } : {}),
    ...(result.language ? { language: result.language } : {}),
    ...(result.model ? { model: result.model } : {}),
    audioStartOffsetMs: options.audioStartOffsetMs,
    ...(typeof result.durationMs === "number" ? { durationMs: result.durationMs } : {}),
  };
}

/** Read a transcript persisted beside a recording, if one was written. */
export async function readStoredTranscript(transcriptPath: string): Promise<DemonstrationTranscript | null> {
  try {
    const contents = await fsp.readFile(transcriptPath, "utf8");
    const parsed = JSON.parse(contents) as DemonstrationTranscript;
    if (!Array.isArray(parsed.segments)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeStoredTranscript(
  transcriptPath: string,
  transcript: DemonstrationTranscript,
): Promise<void> {
  ensureDirectory(path.dirname(transcriptPath));
  await fsp.writeFile(transcriptPath, JSON.stringify(transcript, null, 2), "utf8");
}

/**
 * Remove the downloaded speech model and environment.
 *
 * Exposed so the data-lifecycle sweep can reclaim it: a user who taught one
 * workflow in March should not still be carrying a speech engine in July.
 */
export async function removeSpeechEnvironment(): Promise<void> {
  await fsp.rm(whisperRoot(), { recursive: true, force: true }).catch((error: unknown) => {
    teachWarn("speech", "the speech environment could not be removed", {
      message: (error as Error).message,
    });
  });
}
