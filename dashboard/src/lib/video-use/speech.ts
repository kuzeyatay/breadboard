// Where the editor's speech comes from.
//
// Two engines, both on this machine, and no hosted API between them:
//
//   scriberr — the local transcription service Breadboard already runs for
//              garden video transcription. WhisperX aligns every word, which is
//              exactly the resolution a cut needs, and it is reachable over
//              loopback the moment the service is up. This is the default.
//   subsai   — a Whisper venv inside the subsai clone, built on request from
//              Video Use's settings. It is the fallback for a machine where
//              Scriberr is not running.
//
// Both write the same Scribe-shaped file at the same path, so the clone's
// helpers, the transcript cache and the caption builder never learn which one
// ran. Nothing here is required: with neither engine an edit still happens, it
// is just planned from the silence map instead of from what was said.

import { scriberrClientFromConfig } from "../scriberr/client.ts";
import { getVideoTranscriptionConfig } from "../scriberr/config.ts";
import { subsAiInstalled } from "../subsai/transcribe.ts";
import { scribeTranscript, type ScribeTranscript } from "./scribe-shape.ts";

export type SpeechEngine = "scriberr" | "subsai";

export interface ScriberrSpeechStatus {
  ready: boolean;
  url: string;
  /** Why it is not usable, when it is not. */
  reason: string | null;
}

/**
 * Liveness is a network round trip, and it is asked on the path of every run as
 * well as by the settings panel. Twenty seconds is long enough that a run does
 * not pay for it twice and short enough that starting the service shows up
 * without a restart.
 */
const READY_CACHE_MS = 20_000;
let cachedStatus: { at: number; value: ScriberrSpeechStatus } | null = null;

export function invalidateSpeechEngine(): void {
  cachedStatus = null;
}

/** Is the local Scriberr service up and willing to take work? */
export async function scriberrSpeechStatus(): Promise<ScriberrSpeechStatus> {
  const now = Date.now();
  if (cachedStatus && now - cachedStatus.at < READY_CACHE_MS) return cachedStatus.value;

  const config = getVideoTranscriptionConfig();
  let value: ScriberrSpeechStatus;
  if (!config.enabled) {
    value = {
      ready: false,
      url: config.scriberrBaseUrl,
      reason: "Local transcription is switched off (VIDEO_TRANSCRIPTION_ENABLED).",
    };
  } else {
    const health = await scriberrClientFromConfig()
      .healthCheck()
      .catch(() => ({ ok: false, detail: "unreachable" }));
    value = {
      ready: health.ok === true,
      url: config.scriberrBaseUrl,
      reason: health.ok
        ? null
        : `Scriberr is not answering at ${config.scriberrBaseUrl} (${health.detail ?? "unreachable"}).`,
    };
  }
  cachedStatus = { at: now, value };
  return value;
}

/**
 * Which engine would transcribe right now, or null when neither would.
 *
 * Scriberr wins when it is up: it is already running, it needs no build, and
 * WhisperX gives better timings than the CPU Whisper in the fallback venv.
 */
export async function resolveSpeechEngine(): Promise<SpeechEngine | null> {
  if ((await scriberrSpeechStatus()).ready) return "scriberr";
  return subsAiInstalled() ? "subsai" : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Transcription was stopped."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Transcription was stopped."));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Transcribe one audio file through Scriberr and return it in the shape the
 * clone reads. Null means "nothing was said" — a silent take, not a failure.
 *
 * The Scriberr job is scratch: this transcript is cached against the edit
 * session, so a successful run deletes its job rather than leaving one entry per
 * revision in someone's transcription library. A failed one is left alone, with
 * its logs, for whoever has to work out why.
 */
export async function transcribeWithScriberr(input: {
  audioPath: string;
  title?: string | null;
  language?: string | null;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<ScribeTranscript | null> {
  const config = getVideoTranscriptionConfig();
  const client = scriberrClientFromConfig();

  input.onProgress?.("Sending the audio to Scriberr");
  const uploaded = await client.uploadAudio({
    filePath: input.audioPath,
    filename: "source.wav",
    title: input.title ?? "Video Use edit",
  });

  const jobId = uploaded.id;
  let succeeded = false;
  try {
    await client.startTranscription(jobId, {
      modelFamily: config.scriberrModelFamily,
      model: config.scriberrModel,
      language: input.language ?? config.scriberrLanguage,
      diarize: config.scriberrDiarization,
    });

    input.onProgress?.("Transcribing on this machine");
    const deadline = Date.now() + config.transcriptionTimeoutMs;
    for (;;) {
      if (input.signal?.aborted) throw new Error("Transcription was stopped.");
      if (Date.now() > deadline) {
        await client.killJob(jobId).catch(() => undefined);
        throw new Error("Scriberr did not finish transcribing in time.");
      }
      const snapshot = await client.getJobStatus(jobId);
      if (snapshot.status === "completed") break;
      if (snapshot.status === "failed") {
        throw new Error(
          snapshot.errorMessage
            ? `Scriberr could not transcribe the audio: ${snapshot.errorMessage}`
            : "Scriberr could not transcribe the audio.",
        );
      }
      await sleep(config.pollIntervalMs, input.signal);
    }

    const payload = await client.getTranscript(jobId);
    if (!payload.available || !payload.transcript) return null;
    const { words, segments } = payload.transcript;
    if (!words.length) {
      // Phrase-level output is no use here: the sub-second gaps a cut lands on
      // are exactly what it drops (the clone's Hard Rule 8).
      if (!segments.length) return null;
      throw new Error(
        `Scriberr transcribed the audio but returned no word-level timings, which is what cuts are made on. The "${config.scriberrModelFamily}" model family in SCRIBERR_MODEL_FAMILY produces them; the one in use does not.`,
      );
    }

    const transcript = scribeTranscript(
      words.map((word) => ({
        start: word.start,
        end: word.end,
        text: word.word,
        speaker: word.speaker,
      })),
    );
    succeeded = transcript.words.length > 0;
    return succeeded ? transcript : null;
  } finally {
    if (succeeded) await client.deleteJob(jobId).catch(() => undefined);
  }
}
