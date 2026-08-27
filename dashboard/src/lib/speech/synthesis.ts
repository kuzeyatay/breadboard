import "server-only";

// Turning a response into spoken audio, once, for the two places that want it.
//
// The speaker button and the download menu ask Voicebox for exactly the same
// thing and disagree only about what happens next: playback streams the audio
// through as it arrives, while a download has to wait for the last byte before
// ffmpeg can wrap it in a container. Sharing the part in front of that split is
// what keeps a voice that was never finished cloning from failing one way in
// the transcript and another way in the menu.

import { RouteError } from "@/lib/server-auth";
import {
  encodeSpeechMp3ViaRuntime,
  SpeechMediaRuntimeError,
  type SpeechMediaRuntimeScope,
} from "../runtime-v2/speech-media-job.ts";
import { getSpeechSettings } from "./settings.ts";
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
    { signal },
  );
  if (profile.voice_type === "cloned") {
    const samples = await voiceboxJson<unknown[]>(
      `/profiles/${encodeURIComponent(settings.profileId)}/samples`,
      { signal },
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

/**
 * Re-encode synthesized audio as an MP3.
 *
 * Voicebox hands back a WAV, which is what an <audio> element wants and the
 * worst thing to keep: a few minutes of speech is tens of megabytes, and a
 * saved file outlives the tab it was made in. MP3 is the format that every
 * phone, player and messaging app opens without being asked twice.
 *
 * Runtime streams the WAV into a sealed input and stages the MP3 as one bounded
 * private output. A failed encode therefore cannot become a half-written
 * download, and ffmpeg never becomes a child of the dashboard server.
 */
export async function speechAsMp3(
  scope: SpeechMediaRuntimeScope,
  audio: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (audio.byteLength === 0) throw new RouteError(502, "Voicebox returned no audio to save.");
  try {
    return await encodeSpeechMp3ViaRuntime(scope, audio, { signal });
  } catch (error) {
    if (signal?.aborted) throw new RouteError(499, "The speech download was cancelled.");
    if (error instanceof SpeechMediaRuntimeError) {
      throw new RouteError(error.status, error.message);
    }
    throw error;
  }
}
