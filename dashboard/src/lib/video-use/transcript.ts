// Speech, at word resolution — the clone's primary reading surface.
//
// SubsAI remains in its separately managed Runtime lane. The ffmpeg extraction
// needed by Scriberr, and the clone's finite transcript packer, run in the
// disposable speech/media worker.

import fs from "node:fs";
import path from "node:path";

import {
  extractVideoAudioViaRuntime,
  packVideoTranscriptViaRuntime,
  SpeechMediaRuntimeError,
  type SpeechMediaRuntimeScope,
} from "../runtime-v2/speech-media-job.ts";
import { writeWordTranscript } from "../subsai/transcribe.ts";
import type { VideoEditSession } from "./session.ts";
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

function transcriptRuntimeError(error: unknown): never {
  if (error instanceof SpeechMediaRuntimeError) throw new TranscriptError(error.message);
  throw error;
}

export function hasTranscript(session: VideoEditSession): boolean {
  try {
    return fs.statSync(session.transcriptPath).size > 0;
  } catch {
    return false;
  }
}

/**
 * Transcribe the session's source and cache the result. Returns false when
 * there is nothing to transcribe (a silent source, no engine, too long) — a
 * missing transcript narrows what an edit can do, it does not fail it.
 */
export async function transcribeSource(input: {
  runtimeScope: SpeechMediaRuntimeScope;
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

  // SubsAI has its own Runtime worker and writes the same immutable transcript
  // shape. It deliberately stays out of this speech/media job family.
  if (engine === "subsai") {
    input.onProgress?.("Transcribing locally");
    return writeWordTranscript({
      runtimeScope: input.runtimeScope,
      media: input.session.sourcePath,
      destination: input.session.transcriptPath,
      language: input.language ?? null,
      signal: input.signal,
      onProgress: (progress) => input.onProgress?.(progress.stage),
    });
  }

  let extracted;
  try {
    extracted = await extractVideoAudioViaRuntime(
      input.runtimeScope,
      input.session.sourcePath,
      { signal: input.signal },
    );
  } catch (error) {
    return transcriptRuntimeError(error);
  }

  try {
    let transcript;
    try {
      transcript = await transcribeWithScriberr({
        audioPath: extracted.filePath,
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
    extracted.cleanup();
  }
}

/**
 * The packed transcript, produced by the clone's own `pack_transcripts.py`.
 */
export async function packTranscript(input: {
  runtimeScope: SpeechMediaRuntimeScope;
  session: VideoEditSession;
  /** Kept for callers that also inspect the clone root. */
  root: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (!hasTranscript(input.session)) return null;
  try {
    return await packVideoTranscriptViaRuntime(input.runtimeScope, input.session, {
      signal: input.signal,
    });
  } catch (error) {
    return transcriptRuntimeError(error);
  }
}

/** Trim the packed transcript to something a prompt can carry. */
export function clipPackedTranscript(packed: string, maxCharacters = 24_000): string {
  if (packed.length <= maxCharacters) return packed;
  return `${packed.slice(0, maxCharacters)}\n… (transcript truncated)`;
}
