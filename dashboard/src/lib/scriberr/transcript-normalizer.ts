// Deterministic transcript normalization. No LLM is ever involved: this module
// turns Scriberr's structured transcript into the internal normalized model,
// preserving every segment's complete text, Unicode intact, in chronological
// order — and fails loudly when there is no transcript text at all.

import { VideoTranscriptionError } from "./errors.ts";
import type {
  NormalizedTranscript,
  NormalizedTranscriptSegment,
  ScriberrTranscript,
} from "./types.ts";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function cleanSegmentText(value: string): string {
  // Whitespace-only normalization: internal newlines become spaces so a
  // segment renders as one transcript line; the words themselves are untouched.
  return normalizeLineEndings(value).replace(/\s+/g, " ").trim();
}

export function normalizeScriberrTranscript(
  transcript: ScriberrTranscript,
  {
    title,
    sourceType,
    fallbackDurationSeconds = null,
    transcriptionModel = null,
  }: {
    title: string;
    sourceType: "audio_upload" | "video_upload" | "youtube";
    fallbackDurationSeconds?: number | null;
    transcriptionModel?: string | null;
  },
): NormalizedTranscript {
  const rawSegments = Array.isArray(transcript.segments)
    ? transcript.segments
    : [];

  interface WorkingSegment {
    startSeconds: number;
    endSeconds: number;
    speaker: string | null;
    text: string;
    order: number;
  }

  const working: WorkingSegment[] = [];
  rawSegments.forEach((segment, index) => {
    const text = cleanSegmentText(segment.text ?? "");
    if (!text) return; // Whitespace-only transport records carry no speech.

    let start = Number(segment.start);
    let end = Number(segment.end);
    if (!Number.isFinite(start)) {
      throw new VideoTranscriptionError("transcript_malformed", {
        detail: `segment ${index} has a non-finite start timestamp`,
      });
    }
    if (!Number.isFinite(end)) end = start;
    // Clamp: timestamps must be non-negative and never run backwards, so a
    // malformed pair cannot break time-window grouping or Markdown output.
    start = Math.max(0, start);
    end = Math.max(start, end);

    working.push({
      startSeconds: start,
      endSeconds: end,
      speaker: segment.speaker ?? null,
      text,
      order: index,
    });
  });

  // Fall back to Scriberr's plain text only when no usable segments exist.
  if (working.length === 0) {
    const plain = cleanSegmentText(transcript.text ?? "");
    if (!plain) {
      throw new VideoTranscriptionError("transcript_malformed", {
        detail: "transcript contained no text",
      });
    }
    working.push({
      startSeconds: 0,
      endSeconds: fallbackDurationSeconds ?? 0,
      speaker: null,
      text: plain,
      order: 0,
    });
  }

  // Stable chronological sort (original order breaks ties).
  working.sort(
    (a, b) =>
      a.startSeconds - b.startSeconds ||
      a.endSeconds - b.endSeconds ||
      a.order - b.order,
  );

  // Remove only provably identical duplicated transport records.
  const seen = new Set<string>();
  const deduped: WorkingSegment[] = [];
  for (const segment of working) {
    const key = `${segment.startSeconds}|${segment.endSeconds}|${segment.speaker ?? ""}|${segment.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(segment);
  }

  const segments: NormalizedTranscriptSegment[] = deduped.map(
    (segment, index) => ({
      id: `seg-${String(index + 1).padStart(5, "0")}`,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      speaker: segment.speaker,
      text: segment.text,
    }),
  );

  const speakers: string[] = [];
  for (const segment of segments) {
    if (segment.speaker && !speakers.includes(segment.speaker)) {
      speakers.push(segment.speaker);
    }
  }

  const lastEnd = segments.length
    ? segments[segments.length - 1].endSeconds
    : 0;
  const durationSeconds =
    fallbackDurationSeconds !== null && fallbackDurationSeconds > lastEnd
      ? fallbackDurationSeconds
      : lastEnd > 0
        ? lastEnd
        : fallbackDurationSeconds;

  return {
    title,
    language: transcript.language,
    durationSeconds,
    sourceType,
    segments,
    speakers,
    transcriptionModel: transcriptionModel ?? transcript.modelUsed,
  };
}

/**
 * Comparable text: Unicode-normalized with all whitespace removed. Used to
 * prove the rendered Markdown carries every character of transcript speech.
 */
export function comparableTranscriptText(value: string): string {
  return normalizeLineEndings(value).normalize("NFC").replace(/\s+/g, "");
}

export function transcriptComparableText(
  transcript: NormalizedTranscript,
): string {
  return transcript.segments
    .map((segment) => comparableTranscriptText(segment.text))
    .join("");
}

/**
 * Detect suspicious incompleteness in a transcript relative to the media
 * duration: a non-trivial video whose transcript covers almost none of it.
 * Returns a warning string (never throws — silence can be legitimate).
 */
export function detectSuspiciouslyIncomplete(
  transcript: NormalizedTranscript,
  mediaDurationSeconds: number | null,
): string | null {
  if (!mediaDurationSeconds || mediaDurationSeconds < 120) return null;
  const lastEnd = transcript.segments.length
    ? transcript.segments[transcript.segments.length - 1].endSeconds
    : 0;
  if (lastEnd < mediaDurationSeconds * 0.5) {
    return `Transcript ends at ${Math.round(lastEnd)}s of ~${Math.round(mediaDurationSeconds)}s of media.`;
  }
  return null;
}
