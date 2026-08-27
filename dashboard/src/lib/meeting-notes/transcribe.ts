import "server-only";

// Turning a meeting recording into words.
//
// Meetily's own transcription is whisper-rs compiled into its Tauri binary, and
// none of that survives a port. It does not need to: Breadboard already runs two
// local transcribers, and this module is the choice between them.
//
//   scriberr — the WhisperX service the garden video transcriptions run on. It
//              diarizes, which is the whole difference for a meeting: "who said
//              they would do it" is most of an action item, and a flat wall of
//              text loses it. Preferred whenever the service is up.
//   voicebox — the local speech model dictation uses. No speakers, but it needs
//              no Docker and is there on a machine where Scriberr is not.
//
// Either way the output is one plain-text transcript with a speaker label per
// turn where there is one, which is all the notes pass reads.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scriberrClientFromConfig } from "../scriberr/client.ts";
import { getVideoTranscriptionConfig } from "../scriberr/config.ts";
// The readiness check lives next to Video Use because that is where a second
// engine was first needed. It already honours the VIDEO_TRANSCRIPTION_ENABLED
// switch and caches the answer, so it is imported rather than written again —
// two health checks that could disagree about the same service is exactly the
// kind of drift worth avoiding.
import { scriberrSpeechStatus } from "../video-use/speech.ts";
import { getSpeechSettings } from "../speech/settings.ts";
import { transcribeStoredRecording } from "../speech/recording-transcription.ts";
import {
  renderSpeakerTurns,
  type MeetingTranscript,
  type TranscriptionEngine,
} from "./report.ts";

export { renderSpeakerTurns };
export type { MeetingTranscript, TranscriptionEngine };

export class TranscriptionUnavailable extends Error {}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("The meeting notes run was stopped."));
      },
      { once: true },
    );
  });
}

/** Is the local Scriberr service up and willing to take work? */
export async function scriberrReady(): Promise<boolean> {
  return (await scriberrSpeechStatus()).ready;
}

/** A failure that is about diarization specifically, not about the audio. */
function looksLikeDiarizationFailure(message: string): boolean {
  return /diariz|speaker|pyannote|hf_token|huggingface/i.test(message);
}

/**
 * One Scriberr job, start to transcript.
 *
 * The job is scratch — the meeting's durable form is the artifact this run
 * writes, not a row in someone's transcription library — so a successful job is
 * deleted afterwards. A failed one is left alone, with its logs.
 */
async function runScriberrJob(input: {
  audioPath: string;
  title: string;
  language: string | null;
  diarize: boolean;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<MeetingTranscript> {
  const config = getVideoTranscriptionConfig();
  const client = scriberrClientFromConfig();

  input.onProgress?.("Sending the recording to Scriberr");
  const uploaded = await client.uploadAudio({
    filePath: input.audioPath,
    filename: path.basename(input.audioPath),
    title: input.title.slice(0, 200),
    signal: input.signal,
  });

  const jobId = uploaded.id;
  let succeeded = false;
  try {
    await client.startTranscription(jobId, {
      modelFamily: config.scriberrModelFamily,
      model: config.scriberrModel,
      language: input.language ?? config.scriberrLanguage,
      diarize: input.diarize,
    });

    input.onProgress?.(
      input.diarize
        ? "Transcribing and separating speakers on this machine"
        : "Transcribing on this machine",
    );
    const deadline = Date.now() + config.transcriptionTimeoutMs;
    for (;;) {
      if (input.signal?.aborted) throw new Error("The meeting notes run was stopped.");
      if (Date.now() > deadline) {
        await client.killJob(jobId).catch(() => undefined);
        throw new Error("Scriberr did not finish transcribing in time.");
      }
      const snapshot = await client.getJobStatus(jobId);
      if (snapshot.status === "completed") break;
      if (snapshot.status === "failed") {
        throw new Error(
          snapshot.errorMessage
            ? `Scriberr could not transcribe the recording: ${snapshot.errorMessage}`
            : "Scriberr could not transcribe the recording.",
        );
      }
      await sleep(config.pollIntervalMs, input.signal);
    }

    const payload = await client.getTranscript(jobId);
    if (!payload.available || !payload.transcript) {
      throw new Error("Scriberr finished but returned no transcript.");
    }
    const { segments, text } = payload.transcript;
    const rendered = renderSpeakerTurns(segments, input.diarize);
    const body = rendered.text || (text ?? "").trim();
    if (!body) throw new Error("Nothing was said in that recording.");
    succeeded = true;
    return {
      text: body,
      engine: "scriberr",
      speakers: rendered.speakers,
      language: payload.transcript.language,
      durationSeconds: segments.at(-1)?.end ?? null,
    };
  } finally {
    if (succeeded) await client.deleteJob(jobId).catch(() => undefined);
    else if (input.signal?.aborted) await client.killJob(jobId).catch(() => undefined);
  }
}

/**
 * Transcribe through Scriberr, asking for speaker separation when the request
 * wants it.
 *
 * `diarize` is a per-job parameter rather than a property of the service, so a
 * meeting asks for it regardless of what the deployment defaults to — separating
 * speakers is most of why a meeting is transcribed at all. A Scriberr without
 * the speaker models refuses the job rather than ignoring the flag, so that one
 * failure is caught and the job re-run without it: a transcript with no labels
 * beats no transcript, as long as the run says which one it got.
 */
export async function transcribeWithScriberr(input: {
  audioPath: string;
  title: string;
  language: string | null;
  speakers: boolean;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<MeetingTranscript> {
  const base = {
    audioPath: input.audioPath,
    title: input.title,
    language: input.language,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  };
  if (!input.speakers) return runScriberrJob({ ...base, diarize: false });
  try {
    return await runScriberrJob({ ...base, diarize: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (input.signal?.aborted || !looksLikeDiarizationFailure(message)) throw error;
    input.onProgress?.(
      "Scriberr cannot separate speakers on this machine — transcribing without labels",
    );
    return runScriberrJob({ ...base, diarize: false });
  }
}

/**
 * Transcribe through Voicebox — the fallback, and the reason a machine with no
 * Docker still gets meeting notes. It cuts the recording into five-minute parts
 * itself and reports part by part, so a long meeting still shows progress.
 */
async function transcribeWithVoicebox(input: {
  userId: number;
  audioPath: string;
  filename: string;
  language: string | null;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<MeetingTranscript> {
  const settings = getSpeechSettings(input.userId);
  if (!settings.enabled) {
    throw new TranscriptionUnavailable(
      "Scriberr is not running and speech is turned off, so there is nothing to transcribe the recording with. Start Scriberr, or turn speech on in Intelligence → Settings → Speech.",
    );
  }
  const controller = new AbortController();
  const relay = () => controller.abort();
  input.signal?.addEventListener("abort", relay, { once: true });
  // The segmenter writes its WAV parts into the workspace directory, so that
  // directory must never be the recording's own. A meeting is usually an
  // artifact or a stored chat attachment, and cutting a two-hour recording into
  // five-minute parts beside it would quietly grow the artifact store by the
  // size of every meeting ever transcribed. `filePath` still points at the
  // original, which is only ever read.
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "breadboard-meeting-"));
  try {
    const text = await transcribeStoredRecording({
      runtimeScope: { userId: input.userId, gardenId: null, conversationId: null },
      workspace: { directory: workspace, filePath: input.audioPath },
      filename: input.filename,
      model: settings.transcriptionModel,
      language: input.language ?? settings.transcriptionLanguage ?? null,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.stage === "extracting") input.onProgress?.("Reading the audio track");
        else if (event.stage === "waiting-for-model") {
          input.onProgress?.("Waiting for the local speech model to download");
        } else if (event.stage === "transcribing") {
          input.onProgress?.(`Transcribing part ${event.part} of ${event.parts}`);
        }
      },
    });
    return {
      text,
      engine: "voicebox",
      speakers: [],
      language: input.language ?? settings.transcriptionLanguage ?? null,
      durationSeconds: null,
    };
  } finally {
    input.signal?.removeEventListener("abort", relay);
    await discardStagedAudio(workspace);
  }
}

export interface TranscribeMeetingInput {
  userId: number;
  audioPath: string;
  filename: string;
  title: string;
  language: string | null;
  speakers: boolean;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}

/**
 * Transcribe one recording with whichever engine this machine has.
 *
 * Scriberr wins when it is up, and a Scriberr that is up but fails is not
 * quietly papered over with the engine that cannot tell speakers apart — that
 * would turn "the diarizer crashed" into notes with no owners on any action.
 * Only an absent Scriberr falls through.
 */
export async function transcribeMeeting(
  input: TranscribeMeetingInput,
): Promise<MeetingTranscript> {
  if (await scriberrReady()) {
    return transcribeWithScriberr({
      audioPath: input.audioPath,
      title: input.title,
      language: input.language,
      speakers: input.speakers,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
  }
  input.onProgress?.("Scriberr is not running — using the local speech model");
  return transcribeWithVoicebox({
    userId: input.userId,
    audioPath: input.audioPath,
    filename: input.filename,
    language: input.language,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  });
}

/**
 * Whether speaker separation can actually happen, as opposed to being asked for.
 *
 * A running Scriberr is not enough. WhisperX diarizes with pyannote, whose model
 * is gated on Hugging Face, so without a token the job fails with a 401 and the
 * run silently falls back to an unattributed transcript. The dashboard cannot
 * see inside the sidecar's process, but it is handed the same environment in
 * both the dev stack and the desktop supervisor, so its own `HF_TOKEN` is the
 * honest proxy — and a wrong answer here is much better as a false negative than
 * as a promise of labels that never arrive.
 */
function diarizationConfigured(): boolean {
  return Boolean(process.env.HF_TOKEN?.trim());
}

/** Which engines this machine could actually use, for the health check. */
export async function transcriptionAvailability(userId: number): Promise<{
  engine: TranscriptionEngine | null;
  scriberr: boolean;
  voicebox: boolean;
  speakerLabels: boolean;
  detail: string;
}> {
  const scriberr = await scriberrReady();
  let voicebox = false;
  try {
    voicebox = getSpeechSettings(userId).enabled;
  } catch {
    voicebox = false;
  }
  const speakerLabels = scriberr && diarizationConfigured();
  return {
    engine: scriberr ? "scriberr" : voicebox ? "voicebox" : null,
    scriberr,
    voicebox,
    speakerLabels,
    detail: speakerLabels
      ? "Scriberr is running, so recordings are transcribed with speaker labels."
      : scriberr
        ? "Scriberr is running, but it cannot separate speakers: pyannote's model is gated on Hugging Face and no HF_TOKEN is set, so the notes will have no attributions."
        : voicebox
          ? "Scriberr is not running. Recordings are transcribed with the local speech model, which cannot tell speakers apart."
          : "Neither Scriberr nor local speech is available, so a recording cannot be transcribed. A transcript you paste in still works.",
  };
}

/** Best-effort removal of a staged recording once its transcript is in hand. */
export async function discardStagedAudio(directory: string): Promise<void> {
  await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined);
}
