import "server-only";

// Worker-only transcription. The dashboard supplies one authenticated Runtime
// blob and a server-selected engine. Executables, loopback endpoints and model
// credentials come only from the sealed native profile.

import fs, { openAsBlob } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { joinTranscriptSegments } from "../speech/recording-upload.ts";
import type { MeetingTranscript } from "./report.ts";
import { TranscriptionUnavailable, transcribeWithScriberr } from "./transcribe.ts";

const MAX_SEGMENTS = 128;
const SEGMENT_SECONDS = 300;
const MAX_VOICEBOX_RESPONSE_BYTES = 1024 * 1024;
const VOICEBOX_REQUEST_TIMEOUT_MS = 10 * 60_000;
const MODEL_DOWNLOAD_WAIT_MS = 10 * 60_000;
const MODEL_DOWNLOAD_RETRY_MS = 2_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function mediaExecutable(): string {
  const root = process.env.BREADBOARD_RUNTIME_V2_MEDIA_BIN?.trim() ?? "";
  if (!root || !path.isAbsolute(root)) {
    throw new Error("The sealed media tools are unavailable.");
  }
  const executable = path.resolve(root, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const relative = path.relative(path.resolve(root), executable);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The sealed media tools are invalid.");
  }
  const metadata = fs.lstatSync(executable);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The sealed media tools are unavailable.");
  }
  return fs.realpathSync.native(executable);
}

function voiceboxBaseUrl(): string {
  const raw = process.env.VOICEBOX_BASE_URL?.trim() ?? "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("The local speech service is misconfigured.");
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error("The local speech service must use a private loopback address.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/u, "");
}

function runFfmpeg(input: {
  inputPath: string;
  outputPattern: string;
  workspacePath: string;
  signal: AbortSignal;
}): Promise<void> {
  if (input.signal.aborted) {
    return Promise.reject(new Error("The meeting notes run was stopped."));
  }
  const childEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
    ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
  };
  const args = [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-i", input.inputPath,
    "-map", "0:a:0", "-ac", "1", "-ar", "16000",
    // Preserve the existing 128-part fence without allowing ffmpeg to fill the
    // workspace with an arbitrarily long decoded stream before we can count it.
    "-t", String(MAX_SEGMENTS * SEGMENT_SECONDS + 1),
    "-f", "segment", "-segment_time", String(SEGMENT_SECONDS), "-reset_timestamps", "1",
    input.outputPattern,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(mediaExecutable(), args, {
      cwd: input.workspacePath,
      env: childEnv,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const stop = () => child.kill();
    input.signal.addEventListener("abort", stop, { once: true });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 8_192) stderr += chunk.slice(0, 8_192 - stderr.length);
    });
    child.once("error", (error) => {
      input.signal.removeEventListener("abort", stop);
      reject(error);
    });
    child.once("close", (code) => {
      input.signal.removeEventListener("abort", stop);
      if (input.signal.aborted) reject(new Error("The meeting notes run was stopped."));
      else if (code === 0) resolve();
      else reject(new Error(stderr.trim().slice(0, 500) || "The recording's audio could not be read."));
    });
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_VOICEBOX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The local speech service returned too much data.");
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8");
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function transcribePart(input: {
  partPath: string;
  model: string;
  language: string | null;
  signal: AbortSignal;
  onModelDownload: () => void;
}): Promise<string> {
  const deadline = Date.now() + MODEL_DOWNLOAD_WAIT_MS;
  for (;;) {
    if (input.signal.aborted) throw new Error("The meeting notes run was stopped.");
    const form = new FormData();
    form.set("file", await openAsBlob(input.partPath, { type: "audio/wav" }), path.basename(input.partPath));
    form.set("model", input.model);
    if (input.language) form.set("language", input.language);
    const controller = new AbortController();
    const relay = () => controller.abort(input.signal.reason);
    input.signal.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(() => controller.abort(), VOICEBOX_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${voiceboxBaseUrl()}/transcribe`, {
        method: "POST",
        body: form,
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", relay);
    }
    const body = await responseJson(response);
    const message = typeof body.message === "string"
      ? body.message
      : typeof body.detail === "string"
        ? body.detail
        : null;
    if (response.status === 202) {
      if (Date.now() >= deadline) {
        throw new Error(message || "Voicebox is still downloading the speech model.");
      }
      input.onModelDownload();
      await new Promise((resolve) => setTimeout(resolve, MODEL_DOWNLOAD_RETRY_MS));
      continue;
    }
    if (!response.ok) throw new Error(message || "Voicebox could not transcribe this recording.");
    return typeof body.text === "string" ? body.text.trim() : "";
  }
}

async function transcribeWithRuntimeVoicebox(input: {
  audioPath: string;
  workspacePath: string;
  model: string;
  language: string | null;
  signal: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<MeetingTranscript> {
  input.onProgress?.("Reading the audio track");
  const segmentsRoot = path.join(input.workspacePath, "segments");
  await fsp.mkdir(segmentsRoot, { recursive: false });
  await runFfmpeg({
    inputPath: input.audioPath,
    outputPattern: path.join(segmentsRoot, "part-%04d.wav"),
    workspacePath: input.workspacePath,
    signal: input.signal,
  });
  const names = (await fsp.readdir(segmentsRoot))
    .filter((name) => /^part-[0-9]{4}\.wav$/u.test(name))
    .sort();
  if (!names.length) throw new Error("Nothing was said in that recording.");
  if (names.length > MAX_SEGMENTS) throw new Error("That recording is too long to transcribe safely.");
  const transcripts: string[] = [];
  let announcedDownload = false;
  for (const [index, name] of names.entries()) {
    input.onProgress?.(`Transcribing part ${index + 1} of ${names.length}`);
    transcripts.push(await transcribePart({
      partPath: path.join(segmentsRoot, name),
      model: input.model,
      language: input.language,
      signal: input.signal,
      onModelDownload: () => {
        if (announcedDownload) return;
        announcedDownload = true;
        input.onProgress?.("Waiting for the local speech model to download");
      },
    }));
  }
  const text = joinTranscriptSegments(transcripts);
  if (!text) throw new Error("Voicebox did not hear any words in that recording.");
  return { text, engine: "voicebox", speakers: [], language: input.language, durationSeconds: null };
}

export async function transcribeRuntimeMeeting(input: {
  engine: "scriberr" | "voicebox" | "none";
  audioPath: string;
  filename: string;
  title: string;
  language: string | null;
  speakers: boolean;
  voiceboxModel: string;
  workspacePath: string;
  signal: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<MeetingTranscript> {
  if (input.engine === "scriberr") {
    return transcribeWithScriberr({
      audioPath: input.audioPath,
      title: input.title,
      language: input.language,
      speakers: input.speakers,
      signal: input.signal,
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
  }
  if (input.engine === "voicebox") {
    input.onProgress?.("Scriberr is not running — using the local speech model");
    return transcribeWithRuntimeVoicebox({
      audioPath: input.audioPath,
      workspacePath: input.workspacePath,
      model: input.voiceboxModel,
      language: input.language,
      signal: input.signal,
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
  }
  throw new TranscriptionUnavailable(
    "Scriberr is not running and speech is turned off, so there is nothing to transcribe the recording with. Start Scriberr, or turn speech on in Intelligence → Settings → Speech.",
  );
}
