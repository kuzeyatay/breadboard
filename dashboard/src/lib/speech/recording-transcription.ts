import "server-only";

// Turning an uploaded recording into text with the local speech model.
//
// Voicebox transcribes one audio file per request and has no notion of a long
// recording, so this is what stands between the two: the upload is written
// straight to disk, ffmpeg lifts out a mono 16 kHz audio track and cuts it into
// five-minute parts, and each part is transcribed in turn. Progress is reported
// part by part, because the honest answer to "how long will this take" is only
// knowable once you can see how many parts there are.

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { RouteError } from "@/lib/server-auth";
import { resolveFfmpeg } from "../vimax/video.ts";
import {
  MAX_RECORDING_BYTES,
  RECORDING_SEGMENT_SECONDS,
  isVoiceboxReadable,
  joinTranscriptSegments,
  recordingExtension,
  type RecordingTranscriptionEvent,
} from "./recording-upload.ts";
import { voiceboxFetch, voiceboxResponseError } from "./voicebox-client.ts";

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

function runFfmpeg(ffmpeg: string, args: string[], signal: AbortSignal): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    child.stderr?.on("data", (chunk: Buffer) => {
      // Only the tail matters — it is what ffmpeg puts the actual complaint in.
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000);
    });
    child.on("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/**
 * Cut the recording's audio into WAV parts Whisper is happy with. Segmenting
 * with `-f segment` needs no duration probe: ffmpeg simply writes as many parts
 * as the recording has, and counting the files afterwards tells us how many.
 */
async function segmentAudio(
  input: string,
  directory: string,
  signal: AbortSignal,
): Promise<string[]> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return [];
  const partsDirectory = path.join(directory, "parts");
  await fsp.mkdir(partsDirectory, { recursive: true });

  const { code, stderr } = await runFfmpeg(
    ffmpeg,
    [
      "-nostdin", "-y", "-loglevel", "error",
      "-i", input,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "pcm_s16le",
      "-f", "segment",
      "-segment_time", String(RECORDING_SEGMENT_SECONDS),
      "-reset_timestamps", "1",
      path.join(partsDirectory, "part-%04d.wav"),
    ],
    signal,
  );

  const parts = (await fsp.readdir(partsDirectory).catch(() => []))
    .filter((name) => name.endsWith(".wav"))
    .sort()
    .map((name) => path.join(partsDirectory, name));

  if (parts.length === 0) {
    throw new RouteError(
      415,
      stderr.toLowerCase().includes("does not contain any stream") || code !== 0
        ? "No audio could be read from that file. It may have no sound track, or be a format ffmpeg does not know."
        : "That recording came out silent.",
    );
  }
  return parts;
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
  workspace,
  filename,
  model,
  language,
  signal,
  onEvent,
}: TranscribeRecordingOptions): Promise<string> {
  onEvent({ stage: "extracting" });
  let parts = await segmentAudio(workspace.filePath, workspace.directory, signal);

  if (parts.length === 0) {
    // No ffmpeg on this machine. Voicebox can still read the plain audio
    // containers by itself, so those go straight through; anything else needs
    // a converter we do not have, and saying so beats a decoder stack trace.
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
    transcripts.push(
      await transcribePart(part, model, language, signal, () => {
        if (announcedDownload) return;
        announcedDownload = true;
        onEvent({ stage: "waiting-for-model", model });
      }),
    );
  }

  const text = joinTranscriptSegments(transcripts);
  if (!text) throw new RouteError(422, "Voicebox did not hear any words in that recording.");
  return text;
}
