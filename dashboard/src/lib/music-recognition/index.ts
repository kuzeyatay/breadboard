if (typeof window !== "undefined") {
  throw new Error("Music recognition is server-only.");
}

import { MusicRecognitionError } from "./errors.ts";
import { validateMusicRecognitionAudio } from "./input.ts";
import { recognizeWithAudD } from "./providers/audd.ts";
import {
  recognizeWithShazam,
  type ShazamFingerprintImpl,
} from "./providers/shazam.ts";
import type { MusicRecognitionResult } from "./types.ts";

export interface RecognizeMusicInput {
  audio: Blob;
  filename?: string;
  signal?: AbortSignal;
}

export interface RecognizeMusicOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  providerTimeoutMs?: number;
  shazamFingerprintImpl?: ShazamFingerprintImpl;
}

export async function recognizeMusic(
  input: RecognizeMusicInput,
  options: RecognizeMusicOptions = {},
): Promise<MusicRecognitionResult> {
  validateMusicRecognitionAudio({ size: input.audio.size, type: input.audio.type });
  const env = options.env ?? process.env;
  const provider = env.MUSIC_RECOGNITION_PROVIDER?.trim().toLowerCase() || "shazam";
  if (provider === "shazam" || provider === "songrec") {
    return recognizeWithShazam(input.audio, {
      fetchImpl: options.fetchImpl,
      fingerprintImpl: options.shazamFingerprintImpl,
      signal: input.signal,
      timeoutMs: options.providerTimeoutMs,
    });
  }
  if (provider === "audd") {
    return recognizeWithAudD(input.audio, input.filename ?? "music-sample.webm", {
      env,
      fetchImpl: options.fetchImpl,
      signal: input.signal,
      timeoutMs: options.providerTimeoutMs,
    });
  }
  throw new MusicRecognitionError(
    "unsupported_music_provider",
    `Unsupported music-recognition provider: ${provider}`,
    503,
  );
}

export type { MusicRecognitionResult, RecognizedSong } from "./types.ts";
