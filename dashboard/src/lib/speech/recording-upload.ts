// Handing Voicebox a recording that already exists.
//
// Live dictation streams the microphone. This is the other half of the
// microphone menu: a file the user already has — a voice memo, a lecture
// capture, a screen recording — transcribed by the same local Whisper model.
// The browser and the route both import this so they agree on what may be
// sent, how it travels, and what the progress stream says while it works.

import { appendRecognizedSegment } from "./live-dictation.ts";

/**
 * Containers Voicebox decodes by itself (its own ALLOWED_AUDIO_EXTS). Only
 * these can be forwarded untouched when no ffmpeg is around to convert.
 */
export const VOICEBOX_AUDIO_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".m4a",
  ".ogg",
  ".flac",
  ".aac",
  ".webm",
  ".opus",
] as const;

/** Video is welcome too: ffmpeg lifts the audio track out before Whisper sees it. */
export const TRANSCRIBABLE_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".mkv",
  ".m4v",
  ".avi",
  ".wmv",
  ".mpeg",
  ".mpg",
  ".ts",
  ".3gp",
] as const;

export const TRANSCRIBABLE_EXTENSIONS = [
  ...VOICEBOX_AUDIO_EXTENSIONS,
  ".wma",
  ".aiff",
  ".aif",
  ".amr",
  ".mp4a",
  ...TRANSCRIBABLE_VIDEO_EXTENSIONS,
] as const;

/** The two wildcards catch what a phone offers; the list catches what it labels oddly. */
export const RECORDING_ACCEPT_ATTR = ["audio/*", "video/*", ...TRANSCRIBABLE_EXTENSIONS].join(",");

/**
 * Two gigabytes. The upload streams straight to a temporary file instead of
 * being parsed into memory as a form, so the ceiling here is patience and disk,
 * not heap — a full lecture recording fits.
 */
export const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Whisper is handed five minutes at a time. Long files then report real
 * progress instead of one silent wait, and a stall costs one part rather than
 * the whole recording.
 */
export const RECORDING_SEGMENT_SECONDS = 300;

/** The filename travels in a header, so the body can be the raw file. */
export const RECORDING_FILENAME_HEADER = "x-recording-filename";

export function recordingExtension(filename: string): string {
  const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

export function isTranscribableRecording(filename: string): boolean {
  const extension = recordingExtension(filename);
  return (TRANSCRIBABLE_EXTENSIONS as readonly string[]).includes(extension);
}

/** True when Voicebox can read the file as-is, with no conversion step. */
export function isVoiceboxReadable(filename: string): boolean {
  const extension = recordingExtension(filename);
  return (VOICEBOX_AUDIO_EXTENSIONS as readonly string[]).includes(extension);
}

export function isVideoRecording(filename: string): boolean {
  const extension = recordingExtension(filename);
  return (TRANSCRIBABLE_VIDEO_EXTENSIONS as readonly string[]).includes(extension);
}

/** Parts are stitched with the same rule live dictation uses between phrases. */
export function joinTranscriptSegments(segments: readonly string[]): string {
  return segments.reduce((joined, segment) => appendRecognizedSegment(joined, segment), "");
}

export type RecordingTranscriptionEvent =
  | { stage: "preparing" }
  | { stage: "extracting" }
  | { stage: "transcribing"; part: number; parts: number }
  | { stage: "waiting-for-model"; model: string }
  | { stage: "done"; text: string }
  | { stage: "error"; error: string };

export function encodeRecordingEvent(event: RecordingTranscriptionEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Pull whole events out of a growing stream buffer. The trailing fragment is
 * handed back so the next chunk can complete it — a half-arrived line is not
 * an error, it is the normal state of a stream.
 */
export function readRecordingEvents(buffer: string): {
  events: RecordingTranscriptionEvent[];
  rest: string;
} {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: RecordingTranscriptionEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as RecordingTranscriptionEvent;
      if (parsed && typeof parsed.stage === "string") events.push(parsed);
    } catch {
      // A malformed line means one lost progress tick, never a lost transcript:
      // the outcome only ever arrives as a "done" or "error" event.
    }
  }
  return { events, rest };
}

export function describeRecordingProgress(event: RecordingTranscriptionEvent): string {
  switch (event.stage) {
    case "preparing":
      return "Reading the recording…";
    case "extracting":
      return "Pulling the audio out…";
    case "transcribing":
      return event.parts > 1
        ? `Transcribing part ${event.part} of ${event.parts}…`
        : "Transcribing…";
    case "waiting-for-model":
      return `Preparing the ${event.model} speech model…`;
    case "done":
      return "Done.";
    case "error":
      return event.error;
  }
}

export function formatRecordingSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
