import "server-only";

// Turning an uploaded recording into text with the selected speech provider.
//
// Voicebox transcribes one audio file per request and has no notion of a long
// recording, so this is what stands between the two: the upload is written
// straight to disk, ffmpeg lifts out a mono 16 kHz audio track and cuts it into
// five-minute parts, and each part is transcribed in turn. Progress is reported
// part by part, because the honest answer to "how long will this take" is only
// knowable once you can see how many parts there are.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { RouteError } from "@/lib/server-auth";
import {
  segmentRecordingViaRuntime,
  SpeechMediaRuntimeError,
  type SpeechMediaRuntimeScope,
} from "../runtime-v2/speech-media-job.ts";
import {
  MAX_RECORDING_BYTES,
  isVoiceboxReadable,
  joinTranscriptSegments,
  recordingExtension,
  type RecordingTranscriptionEvent,
} from "./recording-upload.ts";
import { voiceboxFetch, voiceboxResponseError } from "./voicebox-client.ts";
import type { SpeechProvider } from "./providers.ts";

const MODEL_DOWNLOAD_RETRY_MS = 2_000;
const MODEL_DOWNLOAD_WAIT_MS = 10 * 60_000;
const SEGMENT_REQUEST_TIMEOUT_MS = 10 * 60_000;

export interface RecordingWorkspace {
  directory: string;
  filePath: string;
}

/**
 * Write the request body to a temporary file without ever holding it whole.
 * `request.formData()` would parse a multi-gigabyte video into memory; a raw
 * body streamed to disk costs a buffer at a time, which is why the filename
 * rides in a header instead of a form field.
 */
export async function storeUploadedRecording(
  body: ReadableStream<Uint8Array> | null,
  filename: string,
): Promise<RecordingWorkspace> {
  if (!body) throw new RouteError(400, "No recording was received.");
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "breadboard-transcribe-"));
  const filePath = path.join(directory, `recording${recordingExtension(filename) || ".bin"}`);

  let written = 0;
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      if (written > MAX_RECORDING_BYTES) {
        controller.error(new RouteError(413, "That recording is larger than 2 GB."));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(body.pipeThrough(cap) as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(filePath),
    );
  } catch (error) {
    await discardRecording(directory);
    if (error instanceof RouteError) throw error;
    throw new RouteError(400, "The recording upload was interrupted.");
  }

  if (written === 0) {
    await discardRecording(directory);
    throw new RouteError(400, "That file is empty.");
  }
  return { directory, filePath };
}

export async function discardRecording(directory: string): Promise<void> {
  await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

/** One part, one Voicebox request — with the same wait-for-the-model dance dictation does. */
async function transcribePart(
  filePath: string,
  model: string,
  language: string | null,
  signal: AbortSignal,
  onModelDownload: () => void,
): Promise<string> {
  const deadline = Date.now() + MODEL_DOWNLOAD_WAIT_MS;
  while (true) {
    if (signal.aborted) throw new RouteError(499, "The transcription was cancelled.");
    const audio = await fsp.readFile(filePath);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), path.basename(filePath));
    form.set("model", model);
    if (language) form.set("language", language);

    const response = await voiceboxFetch(
      "/transcribe",
      { method: "POST", body: form, signal },
      SEGMENT_REQUEST_TIMEOUT_MS,
    );
    const body = (await response.json().catch(() => null)) as { text?: string } | null;

    if (response.status === 202) {
      if (Date.now() >= deadline) {
        throw new RouteError(
          504,
          voiceboxResponseError(body, "Voicebox is still downloading the speech model."),
        );
      }
      onModelDownload();
      await new Promise((resolve) => setTimeout(resolve, MODEL_DOWNLOAD_RETRY_MS));
      continue;
    }
    if (!response.ok) {
      throw new RouteError(
        response.status >= 400 && response.status < 500 ? response.status : 502,
        voiceboxResponseError(body, "Voicebox could not transcribe this recording."),
      );
    }
    return body?.text?.trim() ?? "";
  }
}

export interface TranscribeRecordingOptions {
  speechProvider?: SpeechProvider;
  runtimeScope: SpeechMediaRuntimeScope;
  workspace: RecordingWorkspace;
  filename: string;
  model: string;
  language: string | null;
  signal: AbortSignal;
  onEvent: (event: RecordingTranscriptionEvent) => void;
}

/**
 * The whole job, reporting as it goes. Returns the joined transcript; the
 * caller owns the workspace and removes it.
 */
export async function transcribeStoredRecording({
  speechProvider = "local",
  runtimeScope,
  workspace,
  filename,
  model,
  language,
  signal,
  onEvent,
}: TranscribeRecordingOptions): Promise<string> {
  onEvent({ stage: "extracting" });
  let segmented;
  try {
    segmented = await segmentRecordingViaRuntime(runtimeScope, workspace.filePath, { signal });
  } catch (error) {
    if (signal.aborted) throw new RouteError(499, "The transcription was cancelled.");
    if (error instanceof SpeechMediaRuntimeError) {
      throw new RouteError(error.code === "recording_unreadable" ? 415 : error.status, error.message);
    }
    throw error;
  }
  let parts = [...segmented.parts];

  try {
    if (!segmented.available) {
      // No ffmpeg in the sealed media worker. Voicebox can still read plain
      // audio containers, so those go straight through without conversion.
      if (!isVoiceboxReadable(filename)) {
        throw new RouteError(
          415,
          "No ffmpeg was found, so the audio could not be pulled out of this file. Upload a .wav, .mp3, .m4a, .ogg, .flac or .opus recording instead.",
        );
      }
      parts = [workspace.filePath];
    }

    const transcripts: string[] = [];
    let announcedDownload = false;
    for (const [index, part] of parts.entries()) {
      if (signal.aborted) throw new RouteError(499, "The transcription was cancelled.");
      onEvent({ stage: "transcribing", part: index + 1, parts: parts.length });
      if (speechProvider !== "local") throw new RouteError(409, "Subscription recordings require the browser audio connection.");
      transcripts.push(
        await transcribePart(part, model, language, signal, () => {
          if (announcedDownload) return;
          announcedDownload = true;
          onEvent({ stage: "waiting-for-model", model });
        }),
      );
    }

    const text = joinTranscriptSegments(transcripts);
    if (!text) throw new RouteError(422, "No words were recognized in that recording.");
    return text;
  } finally {
    segmented.cleanup();
  }
}
