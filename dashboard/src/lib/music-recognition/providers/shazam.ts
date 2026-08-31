import { MusicRecognitionError } from "../errors.ts";
import type { MusicRecognitionResult } from "../types.ts";

interface ShazamFingerprint {
  uri: string;
  samplems: number;
}

interface ShazamAction {
  type?: string;
  uri?: string;
}

interface ShazamResponse {
  matches?: Array<{ offset?: number }>;
  track?: {
    title?: string;
    subtitle?: string;
    url?: string;
    images?: {
      coverart?: string;
      coverarthq?: string;
    };
    hub?: {
      actions?: ShazamAction[];
      options?: Array<{ actions?: ShazamAction[] }>;
      providers?: Array<{ type?: string; actions?: ShazamAction[] }>;
    };
    sections?: Array<{
      type?: string;
      metadata?: Array<{ title?: string; text?: string }>;
    }>;
  };
}

export type ShazamFingerprintImpl = (
  bytes: Uint8Array,
) => Promise<ShazamFingerprint[]> | ShazamFingerprint[];

export interface ShazamRecognitionOptions {
  fetchImpl?: typeof fetch;
  fingerprintImpl?: ShazamFingerprintImpl;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const SHAZAM_PROVIDER_TIMEOUT_MS = 20_000;
export const SHAZAM_PROVIDER_ORIGIN = "https://amp.shazam.com";

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function spotifyUrl(value: unknown): string | undefined {
  const safe = safeHttpsUrl(value);
  if (safe?.startsWith("https://open.spotify.com/")) return safe;
  if (typeof value !== "string") return undefined;
  const match = value.match(/^spotify:(album|artist|track):([A-Za-z0-9]+)$/u);
  return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : undefined;
}

function firstActionUrl(actions: ShazamAction[] | undefined): string | undefined {
  return actions?.map((action) => safeHttpsUrl(action.uri)).find(Boolean);
}

function metadataValue(
  response: ShazamResponse,
  title: string,
): string | undefined {
  const metadata = response.track?.sections
    ?.find((section) => section.type?.toUpperCase() === "SONG")
    ?.metadata?.find((entry) => entry.title?.toLowerCase() === title.toLowerCase());
  return metadata?.text?.trim() || undefined;
}

function matchTimecode(offset: unknown): string | undefined {
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
    return undefined;
  }
  const seconds = Math.round(offset);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function fingerprintWithShazamioCore(
  bytes: Uint8Array,
): Promise<ShazamFingerprint[]> {
  const { recognizeBytes } = await import("shazamio-core");
  const signatures = recognizeBytes(bytes, 0, 12);
  return signatures.map((signature) => {
    try {
      return { uri: signature.uri, samplems: signature.samplems };
    } finally {
      signature.free();
    }
  });
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

function recognitionUrl(): string {
  const firstId = crypto.randomUUID().toUpperCase();
  const secondId = crypto.randomUUID().toUpperCase();
  return `${SHAZAM_PROVIDER_ORIGIN}/discovery/v5/en-US/NL/web/-/tag/${firstId}/${secondId}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`;
}

function normalizeShazamResponse(payload: ShazamResponse): MusicRecognitionResult {
  const track = payload.track;
  const title = track?.title?.trim();
  const artist = track?.subtitle?.trim();
  if (!payload.matches?.length || !track || !title || !artist) return { match: null };

  const spotify = track.hub?.providers
    ?.find((provider) => provider.type?.toUpperCase() === "SPOTIFY")
    ?.actions?.map((action) => spotifyUrl(action.uri))
    .find(Boolean);
  const appleMusic = track.hub?.options
    ?.flatMap((option) => option.actions ?? [])
    .map((action) => safeHttpsUrl(action.uri))
    .find((url) => url?.includes("music.apple.com"));
  const directAppleMusic = firstActionUrl(track.hub?.actions);

  return {
    match: {
      title,
      artist,
      album: metadataValue(payload, "Album"),
      releaseDate: metadataValue(payload, "Released"),
      label: metadataValue(payload, "Label"),
      timecode: matchTimecode(payload.matches[0]?.offset),
      isrc: metadataValue(payload, "ISRC"),
      provider: "shazam",
      artwork:
        safeHttpsUrl(track.images?.coverarthq) ||
        safeHttpsUrl(track.images?.coverart),
      links: {
        song: safeHttpsUrl(track.url),
        spotify,
        appleMusic:
          appleMusic ||
          (directAppleMusic?.includes("music.apple.com")
            ? directAppleMusic
            : undefined),
      },
    },
  };
}

export async function recognizeWithShazam(
  audio: Blob,
  options: ShazamRecognitionOptions = {},
): Promise<MusicRecognitionResult> {
  let fingerprints: ShazamFingerprint[];
  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    fingerprints = await (options.fingerprintImpl ?? fingerprintWithShazamioCore)(bytes);
  } catch {
    throw new MusicRecognitionError(
      "music_fingerprint_failed",
      "The captured audio could not be fingerprinted. Try another sample.",
      422,
    );
  }
  if (!fingerprints.length) return { match: null };

  const provider = providerSignal(
    options.signal,
    options.timeoutMs ?? SHAZAM_PROVIDER_TIMEOUT_MS,
  );
  try {
    for (const fingerprint of fingerprints.slice(0, 3)) {
      const response = await (options.fetchImpl ?? fetch)(recognitionUrl(), {
        method: "POST",
        body: JSON.stringify({
          timezone: "Europe/Amsterdam",
          signature: fingerprint,
          timestamp: Date.now(),
          context: {},
          geolocation: {},
        }),
        cache: "no-store",
        redirect: "error",
        signal: provider.signal,
        headers: {
          accept: "application/json",
          "accept-language": "en-US",
          "content-type": "application/json",
          "x-shazam-appversion": "14.1.0",
          "x-shazam-platform": "WEB",
        },
      });
      if (!response.ok) {
        throw new MusicRecognitionError(
          "music_provider_http_error",
          `The music recognition provider returned HTTP ${response.status}.`,
        );
      }

      let payload: ShazamResponse;
      try {
        payload = (await response.json()) as ShazamResponse;
      } catch {
        throw new MusicRecognitionError(
          "music_provider_invalid_response",
          "The music recognition provider returned an invalid response.",
        );
      }
      const normalized = normalizeShazamResponse(payload);
      if (normalized.match) return normalized;
    }
    return { match: null };
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
