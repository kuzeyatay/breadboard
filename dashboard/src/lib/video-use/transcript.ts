// Speech, at word resolution — the clone's primary reading surface.
//
// The clone gets this from ElevenLabs Scribe via `helpers/transcribe.py`.
// Breadboard does not: speech is transcribed on this machine, by the Scriberr
// service or by the subsai venv behind it (see `speech.ts`), and the result is
// written to the same path in the same shape Scribe would have produced. That
// is what `pack_transcripts.py` and `render.py --build-subtitles` read, so the
// clone's Python needs no fork — and no audio and no key ever leave the machine.
//
// Word-level verbatim is not a preference, it is Hard Rule 8: phrase-level
// output loses the sub-second gaps that cuts are made of, and a normalizing
// model deletes the fillers the edit exists to remove.
//
// Transcripts are cached per source and never regenerated (Hard Rule 9). The
// source of an edit session is immutable, so its transcript is too.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { helperScript, resolvePython, videoUseEnv } from "./runtime.ts";
import { resolveFfmpeg } from "../vimax/video.ts";
import type { VideoEditSession } from "./session.ts";
import { writeWordTranscript } from "../subsai/transcribe.ts";
import { resolveSpeechEngine, transcribeWithScriberr, type SpeechEngine } from "./speech.ts";

/**
 * Transcribing a feature-length source costs minutes of a chat turn for a cut
 * that is almost never planned from its words. Past this, an edit still happens
 * — it is planned from the silence map instead.
 */
export const MAX_TRANSCRIBE_SECONDS = 2 * 60 * 60;

export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptError";
  }
}

export function hasTranscript(session: VideoEditSession): boolean {
  try {
    return fs.statSync(session.transcriptPath).size > 0;
  } catch {
    return false;
  }
}

function extractAudio(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new TranscriptError("No ffmpeg was found, so the audio cannot be read.");
  return new Promise((resolve, reject) => {
    // Mono 16kHz PCM: what Scribe wants, and a tenth the bytes of the source.
    const child = spawn(
      ffmpeg,
      ["-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", destination],
      { windowsHide: true, env: videoUseEnv() },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
    });
    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    };
    signal?.addEventListener("abort", onAbort);
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(new TranscriptError(error.message));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else {
        reject(
          new TranscriptError(
            stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(" ") ||
              "The audio track could not be extracted.",
          ),
        );
      }
    });
  });
}

/**
 * Transcribe the session's source and cache the result. Returns false when
 * there is nothing to transcribe (a silent source, no engine, too long) — a
 * missing transcript narrows what an edit can do, it does not fail it.
 */
export async function transcribeSource(input: {
  session: VideoEditSession;
  durationSeconds: number;
  /** Which local engine to use. Resolved by the caller so it can say so first. */
  engine: SpeechEngine | null;
  language?: string | null;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<boolean> {
  if (hasTranscript(input.session)) return true;
  if (input.durationSeconds > MAX_TRANSCRIBE_SECONDS) return false;

  const engine = input.engine ?? (await resolveSpeechEngine());
  if (!engine) return false;

  // Whichever engine runs, it produces the same file in the same shape at the
  // same path. Everything downstream — the packer, the caption builder, the
  // cache — is unaware of which one it was.
  if (engine === "subsai") {
    input.onProgress?.("Transcribing locally");
    return writeWordTranscript({
      media: input.session.sourcePath,
      destination: input.session.transcriptPath,
      language: input.language ?? null,
      signal: input.signal,
      onProgress: (progress) => input.onProgress?.(progress.stage),
    });
  }

  // Scriberr transcribes an audio file, and mono 16kHz is both what WhisperX
  // wants and a tenth of the bytes of the source to hand it.
  const temporary = path.join(
    os.tmpdir(),
    `video-use-${randomBytes(8).toString("hex")}.wav`,
  );
  try {
    await extractAudio(input.session.sourcePath, temporary, input.signal);
    if (!fs.statSync(temporary).size) return false;

    let transcript;
    try {
      transcript = await transcribeWithScriberr({
        audioPath: temporary,
        title: `Video Use — ${input.session.artifactId}`,
        language: input.language ?? null,
        signal: input.signal,
        onProgress: input.onProgress,
      });
    } catch (error) {
      throw new TranscriptError(
        error instanceof Error ? error.message : "The audio could not be transcribed.",
      );
    }
    if (!transcript?.words.length) return false;

    fs.mkdirSync(path.dirname(input.session.transcriptPath), { recursive: true });
    const draft = `${input.session.transcriptPath}.tmp`;
    fs.writeFileSync(draft, JSON.stringify(transcript, null, 2));
    fs.renameSync(draft, input.session.transcriptPath);
    return true;
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // A leftover temp wav is harmless.
    }
  }
}

/**
 * The packed transcript, produced by the clone's own `pack_transcripts.py`.
 *
 * This is the artifact the planner reads: one phrase-level line per utterance
 * with a `[start-end]` prefix, breaking on silence or speaker change. It is a
 * tenth the tokens of the raw Scribe JSON and still carries word-boundary
 * precision, which is exactly the trade the clone was built around — so it is
 * the clone's script that makes it, not a reimplementation.
 */
export async function packTranscript(input: {
  session: VideoEditSession;
  root: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (!hasTranscript(input.session)) return null;
  const python = resolvePython(input.root);
  if (!python) return null;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      python,
      [helperScript(input.root, "pack_transcripts.py"), "--edit-dir", input.session.editDir],
      { cwd: input.root, windowsHide: true, env: videoUseEnv() },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000);
    });
    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    };
    input.signal?.addEventListener("abort", onAbort);
    child.on("error", (error) => {
      input.signal?.removeEventListener("abort", onAbort);
      reject(new TranscriptError(error.message));
    });
    child.on("close", (code) => {
      input.signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else reject(new TranscriptError(stderr.trim() || "The transcript could not be packed."));
    });
  });

  try {
    return fs.readFileSync(input.session.packedTranscriptPath, "utf8");
  } catch {
    return null;
  }
}

/** Trim the packed transcript to something a prompt can carry. */
export function clipPackedTranscript(packed: string, maxCharacters = 24_000): string {
  if (packed.length <= maxCharacters) return packed;
  return `${packed.slice(0, maxCharacters)}\n… (transcript truncated)`;
}
