import "server-only";

// Turning a response into spoken audio, once, for the two places that want it.
//
// The speaker button and the download menu ask Voicebox for exactly the same
// thing and disagree only about what happens next: playback streams the audio
// through as it arrives, while a download has to wait for the last byte before
// ffmpeg can wrap it in a container. Sharing the part in front of that split is
// what keeps a voice that was never finished cloning from failing one way in
// the transcript and another way in the menu.

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RouteError } from "@/lib/server-auth";
import { getSpeechSettings } from "./settings.ts";
import { resolveFfmpeg } from "../vimax/video.ts";
import { voiceboxFetch, voiceboxJson, voiceboxResponseError } from "./voicebox-client.ts";

interface VoiceProfile {
  id: string;
  name: string;
  voice_type: "cloned" | "preset" | "designed";
  default_engine?: string | null;
  preset_engine?: string | null;
}

/** One request, one reading. Longer than this and the engine is the wrong tool. */
export const MAX_SPEECH_CHARACTERS = 50_000;

export const SPEECH_DOWNLOAD_MIME = "audio/mpeg";

/** `breadboard-dictation-2026-08-19.mp3` — the same shape the Markdown download uses. */
export function speechDownloadFilename(now = new Date()): string {
  return `breadboard-dictation-${now.toISOString().slice(0, 10)}.mp3`;
}

/**
 * Ask Voicebox to read `text` in the user's chosen voice.
 *
 * Returns the upstream response with its body untouched, so the caller decides
 * whether to stream it or hold it: the checks that can fail have all already
 * happened by the time it comes back.
 */
export async function synthesizeSpeech({
  userId,
  text,
  signal,
}: {
  userId: number;
  text: unknown;
  signal?: AbortSignal;
}): Promise<Response> {
  const settings = getSpeechSettings(userId);
  if (!settings.enabled) {
    throw new RouteError(409, "Speech is turned off in Intelligence → Settings → Speech.");
  }
  if (!settings.profileId) {
    throw new RouteError(409, "Choose a speech voice in Intelligence → Settings → Speech first.");
  }
  const spoken = typeof text === "string" ? text.trim() : "";
  if (!spoken) throw new RouteError(400, "There is no response text to speak.");
  if (spoken.length > MAX_SPEECH_CHARACTERS) {
    throw new RouteError(413, "Responses longer than 50,000 characters cannot be spoken at once.");
  }

  const profile = await voiceboxJson<VoiceProfile>(
    `/profiles/${encodeURIComponent(settings.profileId)}`,
  );
  if (profile.voice_type === "cloned") {
    const samples = await voiceboxJson<unknown[]>(
      `/profiles/${encodeURIComponent(settings.profileId)}/samples`,
    );
    if (samples.length === 0) {
      throw new RouteError(
        409,
        `${profile.name} has no voice recording yet. Open Intelligence → Settings → Speech and finish cloning it first.`,
      );
    }
  }
  const engine =
    settings.engine === "auto"
      ? profile.default_engine || profile.preset_engine || "qwen"
      : settings.engine;

  const response = await voiceboxFetch(
    "/generate/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        profile_id: settings.profileId,
        text: spoken,
        language: settings.language,
        engine,
        model_size: settings.modelSize,
      }),
    },
    10 * 60_000,
  );
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new RouteError(
      response.status,
      voiceboxResponseError(errorBody, "Voicebox could not synthesize this response."),
    );
  }
  return response;
}

function runFfmpeg(
  ffmpeg: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      // Only the tail matters: it is where ffmpeg puts the actual complaint.
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000);
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/**
 * Re-encode synthesized audio as an MP3.
 *
 * Voicebox hands back a WAV, which is what an <audio> element wants and the
 * worst thing to keep: a few minutes of speech is tens of megabytes, and a
 * saved file outlives the tab it was made in. MP3 is the format that every
 * phone, player and messaging app opens without being asked twice.
 *
 * Both ends go through a temporary file rather than a pipe. ffmpeg would
 * happily stream this one, but a file is what lets a failed encode be reported
 * as an empty output instead of a half-written download.
 */
export async function speechAsMp3(audio: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    throw new RouteError(
      503,
      "No ffmpeg was found, so the spoken response could not be encoded as an .mp3 file.",
    );
  }
  if (audio.byteLength === 0) throw new RouteError(502, "Voicebox returned no audio to save.");

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "breadboard-dictation-"));
  const input = path.join(directory, "speech.wav");
  const output = path.join(directory, "speech.mp3");
  try {
    await fsp.writeFile(input, audio);
    const { code, stderr } = await runFfmpeg(
      ffmpeg,
      [
        "-nostdin", "-y", "-loglevel", "error",
        "-i", input,
        "-vn",
        "-c:a", "libmp3lame",
        // One voice, no music. Asking for more than this buys nothing: LAME
        // clamps the rate anyway at the sample rates a speech engine produces.
        "-b:a", "128k",
        output,
      ],
      signal,
    );
    const encoded = await fsp.readFile(output).catch(() => null);
    if (code !== 0 || !encoded?.byteLength) {
      throw new RouteError(
        502,
        stderr.trim()
          ? `The spoken response could not be saved as an .mp3 file: ${stderr.trim().split("\n").pop()}`
          : "The spoken response could not be saved as an .mp3 file.",
      );
    }
    return new Uint8Array(encoded);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
