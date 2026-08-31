import { MusicRecognitionError } from "./errors.ts";

export const MAX_MUSIC_RECOGNITION_BYTES = 10 * 1024 * 1024;

export const MUSIC_RECOGNITION_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
]);

export function normalizedAudioType(value: string | undefined): string {
  return (value ?? "").split(";", 1)[0].trim().toLowerCase();
}

export function validateMusicRecognitionAudio(input: {
  size: number;
  type?: string;
}): void {
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new MusicRecognitionError(
      "music_sample_empty",
      "The audio sample is empty.",
      400,
    );
  }
  if (input.size > MAX_MUSIC_RECOGNITION_BYTES) {
    throw new MusicRecognitionError(
      "music_sample_too_large",
      "Music samples may be at most 10 MB.",
      413,
    );
  }
  const type = normalizedAudioType(input.type);
  if (type && !MUSIC_RECOGNITION_AUDIO_TYPES.has(type)) {
    throw new MusicRecognitionError(
      "unsupported_music_sample",
      `Breadboard cannot identify music from ${type}.`,
      415,
    );
  }
}
