import "server-only";
import { RouteError } from "@/lib/server-auth";
import { getElevenLabsApiKey } from "./elevenlabs-credentials.ts";
import { validElevenLabsVoiceId, type ElevenLabsSpeechModel, type ElevenLabsVoice } from "./providers.ts";
import { splitSpeechPassages } from './passages.ts';

// API contracts: https://elevenlabs.io/docs/api-reference
const API_ORIGIN = "https://api.elevenlabs.io";
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

async function elevenLabsFetch(userId: number, pathname: string, init: RequestInit = {}): Promise<Response> {
  const key = getElevenLabsApiKey(userId);
  if (!key) throw new RouteError(409, "Add your ElevenLabs API key in Voice settings first.");
  const headers = new Headers(init.headers);
  headers.set("xi-api-key", key);
  const timeout = AbortSignal.timeout(5 * 60_000);
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${pathname}`, {
      ...init, headers, cache: "no-store", redirect: "error",
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch {
    if (init.signal?.aborted) throw new RouteError(499, "ElevenLabs speech was cancelled.");
    throw new RouteError(503, "ElevenLabs could not be reached. Try again.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    // Never echo an upstream response that could contain credentials or input.
    const message = response.status === 401 ? "ElevenLabs rejected the API key. Update it in Voice settings."
      : response.status === 403 ? "Your ElevenLabs key does not have access to this voice or operation. Check its permissions."
      : response.status === 429 ? "ElevenLabs usage or request limits were reached. Check your account and try again later."
      : response.status === 402 ? "Your ElevenLabs account has insufficient credits."
      : response.status === 404 ? "This ElevenLabs voice is unavailable. Choose another voice in Voice settings."
      : response.status === 400 || response.status === 422 ? "ElevenLabs could not process this input with the selected voice and model. Check Voice settings."
      : "ElevenLabs speech is temporarily unavailable. Try again.";
    throw new RouteError(response.status === 401 || response.status === 403 ? 409 : response.status >= 500 ? 503 : response.status, message);
  }
  return response;
}

export async function listElevenLabsVoices(userId: number, cursor?: string | null, signal?: AbortSignal): Promise<{ voices: ElevenLabsVoice[]; nextCursor: string | null }> {
  const query = new URLSearchParams({ page_size: "100" });
  if (cursor) query.set("next_page_token", cursor);
  const response = await elevenLabsFetch(userId, `/v2/voices?${query}`, { signal });
  const body = await response.json();
  if (!Array.isArray(body.voices)) throw new RouteError(502, "ElevenLabs returned an invalid voice list.");
  const voices: ElevenLabsVoice[] = body.voices
    .filter((voice: { voice_id?: unknown; name?: unknown }) => validElevenLabsVoiceId(voice?.voice_id) && typeof voice.name === "string")
    .map((voice: { voice_id: string; name: string }) => ({ id: voice.voice_id, name: voice.name }));
  return { voices, nextCursor: body.has_more && typeof body.next_page_token === "string" ? body.next_page_token : null };
}

/** Keep complete thoughts together below every supported model's request limit. */
export function elevenLabsTextChunks(text: string): string[] {
  return splitSpeechPassages(text, { maxCharacters: 4_000 });
}

export async function synthesizeElevenLabsSpeech(userId: number, text: string, voiceId: string, model: ElevenLabsSpeechModel, signal?: AbortSignal): Promise<Response> {
  if (!validElevenLabsVoiceId(voiceId)) throw new RouteError(409, "Choose an ElevenLabs voice in Voice settings first.");
  const audio: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const chunks = elevenLabsTextChunks(text);
  for (const [index, chunk] of chunks.entries()) {
    signal?.throwIfAborted();
    const response = await elevenLabsFetch(userId, `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: chunk, model_id: model,
        // Request stitching is supported by v2 models, but not Eleven v3.
        // Keep the user's stored voice settings; context helps without adding
        // theatrical style tags to the words being read.
        ...(model !== 'eleven_v3' ? { previous_text: chunks[index - 1], next_text: chunks[index + 1] } : {}),
      }),
    });
    if (!response.headers.get("Content-Type")?.startsWith("audio/") || !response.body) {
      await response.body?.cancel();
      throw new RouteError(502, "ElevenLabs returned no playable audio.");
    }
    const reader = response.body.getReader();
    const initialSize = size;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_AUDIO_BYTES) {
          await reader.cancel();
          throw new RouteError(413, "ElevenLabs audio exceeds 64 MB. Try a shorter response.");
        }
        audio.push(new Uint8Array(value));
      }
    } finally { reader.releaseLock(); }
    if (size === initialSize) throw new RouteError(502, "ElevenLabs returned empty audio.");
  }
  return new Response(new Blob(audio, { type: "audio/mpeg" }), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}

export async function transcribeElevenLabsAudio(userId: number, file: Blob, filename: string, language: string | null, signal?: AbortSignal): Promise<{ text: string }> {
  const form = new FormData();
  form.set("file", file, filename);
  form.set("model_id", "scribe_v2");
  form.set("tag_audio_events", "false");
  if (language) form.set("language_code", language);
  const response = await elevenLabsFetch(userId, "/v1/speech-to-text", { method: "POST", body: form, signal });
  const body = await response.json();
  if (typeof body.text !== "string") throw new RouteError(502, "ElevenLabs returned an invalid transcript.");
  return { text: body.text.trim() };
}
