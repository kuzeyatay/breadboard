import { MusicRecognitionError } from "../errors.ts";
import type { MusicRecognitionResult } from "../types.ts";

interface AuddResponse {
  status?: "success" | "error";
  result?: null | {
    artist?: string;
    title?: string;
    album?: string;
    release_date?: string;
    label?: string;
    timecode?: string;
    song_link?: string;
    spotify?: {
      external_urls?: { spotify?: string };
      album?: { images?: Array<{ url?: string }> };
      external_ids?: { isrc?: string };
    };
    apple_music?: {
      url?: string;
      artwork?: { url?: string };
      isrc?: string;
    };
  };
  error?: {
    error_code?: number;
    error_message?: string;
  };
}

export interface AudDRecognitionOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const AUDD_PROVIDER_URL = "https://api.audd.io/";
export const AUDD_PROVIDER_TIMEOUT_MS = 20_000;

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function appleArtwork(value: unknown): string | undefined {
  const safe = safeHttpsUrl(value);
  return safe?.replaceAll("{w}", "256").replaceAll("{h}", "256");
}

function providerSignal(external: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timeoutFired = false;
  const abort = () => controller.abort(external?.reason);
  if (external?.aborted) abort();
  else external?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timeoutFired = true;
    controller.abort(new DOMException("Music recognition timed out.", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeoutFired,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    },
  };
}

export async function recognizeWithAudD(
  audio: Blob,
  filename = "music-sample.webm",
  options: AudDRecognitionOptions = {},
): Promise<MusicRecognitionResult> {
  const token = (options.env ?? process.env).AUDD_API_TOKEN?.trim();
  if (!token) {
    throw new MusicRecognitionError(
      "music_recognition_not_configured",
      "Music recognition is not configured. Set the server-side AUDD_API_TOKEN.",
      503,
    );
  }

  const form = new FormData();
  form.set("api_token", token);
  form.set("return", "spotify,apple_music");
  form.set("file", audio, filename);

  const provider = providerSignal(
    options.signal,
    options.timeoutMs ?? AUDD_PROVIDER_TIMEOUT_MS,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(AUDD_PROVIDER_URL, {
      method: "POST",
      body: form,
      cache: "no-store",
      redirect: "error",
      signal: provider.signal,
    });
    if (!response.ok) {
      throw new MusicRecognitionError(
        "music_provider_http_error",
        `The music recognition provider returned HTTP ${response.status}.`,
      );
    }

    let payload: AuddResponse;
    try {
      payload = (await response.json()) as AuddResponse;
    } catch {
      throw new MusicRecognitionError(
        "music_provider_invalid_response",
        "The music recognition provider returned an invalid response.",
      );
    }
    if (payload.status !== "success") {
      throw new MusicRecognitionError(
        "music_provider_error",
        payload.error?.error_message?.slice(0, 240) || "Music recognition failed.",
      );
    }
    const result = payload.result;
    const title = result?.title?.trim();
    const artist = result?.artist?.trim();
    if (!result || !title || !artist) {
      return { match: null };
    }
    const spotifyArtwork = safeHttpsUrl(result.spotify?.album?.images?.[0]?.url);
    return {
      match: {
        title,
        artist,
        album: result.album?.trim() || undefined,
        releaseDate: result.release_date?.trim() || undefined,
        label: result.label?.trim() || undefined,
        timecode: result.timecode?.trim() || undefined,
        isrc:
          result.spotify?.external_ids?.isrc?.trim() ||
          result.apple_music?.isrc?.trim() ||
          undefined,
        provider: "audd",
        artwork: spotifyArtwork || appleArtwork(result.apple_music?.artwork?.url),
        links: {
          song: safeHttpsUrl(result.song_link),
          spotify: safeHttpsUrl(result.spotify?.external_urls?.spotify),
          appleMusic: safeHttpsUrl(result.apple_music?.url),
        },
      },
    };
  } catch (error) {
    if (error instanceof MusicRecognitionError) throw error;
    if (options.signal?.aborted) {
      throw new MusicRecognitionError(
        "music_recognition_cancelled",
        "Music recognition was cancelled.",
        499,
      );
    }
    if (provider.timedOut()) {
      throw new MusicRecognitionError(
        "music_provider_timeout",
        "The music recognition provider timed out.",
        504,
      );
    }
    throw new MusicRecognitionError(
      "music_provider_unavailable",
      "The music recognition provider is temporarily unavailable.",
    );
  } finally {
    provider.dispose();
  }
}
