import "server-only";

// OpenAI (web) speech: ChatGPT's own website voice, reached through the
// signed-in chatgpt.com page that ChatMock already drives for the
// "OpenAI (web)" chat provider. Nothing here holds a credential. ChatMock asks
// the page to call the site's Read aloud and dictation endpoints with the
// person's existing chatgpt.com session, and hands back audio or text.

import { RouteError } from "@/lib/server-auth";
import { voiceBridgeFetch } from "./subscription-server.ts";
import type { SpeechCredentialStatus } from "./providers.ts";

const MAX_WEB_AUDIO_BYTES = 64 * 1024 * 1024;
const UNAVAILABLE = "OpenAI (web) speech is unavailable. Keep Breadboard open and try again.";

async function bridgeFailure(response: Response, fallback: string): Promise<RouteError> {
  if (response.status === 404) {
    await response.body?.cancel();
    return new RouteError(503, "Restart Breadboard to load OpenAI (web) speech.");
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const message = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : fallback;
  return new RouteError(response.status, message);
}

export async function webSpeechStatus(userId: number): Promise<SpeechCredentialStatus> {
  try {
    const response = await voiceBridgeFetch(userId, "web/status", {}, { timeoutMs: 15_000, unavailable: UNAVAILABLE });
    if (!response.ok) throw await bridgeFailure(response, UNAVAILABLE);
    return (await response.json()) as SpeechCredentialStatus;
  } catch (error) {
    return {
      configured: false,
      source: "web",
      reason: "service_unavailable",
      error: error instanceof Error ? error.message : UNAVAILABLE,
    };
  }
}

/** The whole reading as one audio file, in the voice chosen in Voice settings. */
export async function synthesizeWebSpeech(
  userId: number,
  text: string,
  voice: string,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await voiceBridgeFetch(
    userId,
    "web/synthesize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal,
    },
    // Each passage is a short ChatGPT turn plus the site's own reading.
    { timeoutMs: 15 * 60_000, unavailable: UNAVAILABLE },
  );
  if (!response.ok) throw await bridgeFailure(response, "ChatGPT could not read this text aloud.");
  const type = response.headers.get("content-type") || "";
  if (!type.startsWith("audio/")) {
    await response.body?.cancel();
    throw new RouteError(502, "ChatGPT returned no playable audio.");
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) throw new RouteError(502, "ChatGPT returned empty audio.");
  if (audio.byteLength > MAX_WEB_AUDIO_BYTES) throw new RouteError(413, "ChatGPT's audio exceeds 64 MB. Try a shorter response.");
  return new Response(audio, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}

/** ChatGPT's dictation, the same transcription the site's microphone button uses. */
export async function transcribeWebAudio(
  userId: number,
  file: Blob,
  filename: string,
  language: string | null,
  signal?: AbortSignal,
): Promise<{ text: string }> {
  const form = new FormData();
  form.set("file", file, filename);
  if (language) form.set("language", language);
  const response = await voiceBridgeFetch(
    userId,
    "web/transcribe",
    { method: "POST", body: form, signal },
    { timeoutMs: 5 * 60_000, unavailable: UNAVAILABLE },
  );
  if (!response.ok) throw await bridgeFailure(response, "ChatGPT could not transcribe this recording.");
  const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== "string") throw new RouteError(502, "ChatGPT returned an invalid transcript.");
  return { text: body.text.trim() };
}
