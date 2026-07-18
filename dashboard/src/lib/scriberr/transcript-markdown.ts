// Deterministic transcript → Markdown conversion. Operates directly on the
// normalized transcript; no LLM touches the transcript at any point. The
// generated body is verified to contain every segment's text exactly once and
// in order before it is allowed to be written.

import crypto from "crypto";

import { VideoTranscriptionError } from "./errors";
import {
  comparableTranscriptText,
  transcriptComparableText,
} from "./transcript-normalizer";
import { youtubeTimestampUrl } from "./youtube";
import type { NormalizedTranscript, YouTubeMediaMetadata } from "./types";

export const TRANSCRIPT_WINDOW_SECONDS = 300;

export type TranscriptSourceInfo =
  | {
      kind: "youtube";
      originalUrl: string;
      canonicalUrl: string;
      videoId: string;
      metadata: YouTubeMediaMetadata | null;
    }
  | {
      kind: "upload";
      originalFilename: string;
      mediaSha256: string | null;
    };

export interface TranscriptMarkdownResult {
  /** Markdown body: H1 title, source information, full timestamped transcript. */
  body: string;
  /** Plain transcript text (for word counts / summaries downstream). */
  plainText: string;
  /** Frontmatter metadata for the existing source-writing pipeline. */
  metadata: Record<string, string | string[]>;
  /** sha256 hex of the generated body. */
  contentHash: string;
}

/** hh:mm:ss, always zero-padded (03:15 of speech renders as 00:03:15). */
export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Window heading label, e.g. "00:00–05:00" or "01:00:00–01:05:00". */
export function formatWindowLabel(
  windowStartSeconds: number,
  windowEndSeconds: number,
  useHours: boolean,
): string {
  const label = (value: number): string => {
    const full = formatTimestamp(value);
    return useHours ? full : full.slice(3);
  };
  return `${label(windowStartSeconds)}–${label(windowEndSeconds)}`;
}

/** Compact duration for the source information section (e.g. 01:02:05). */
export function formatDuration(totalSeconds: number): string {
  return formatTimestamp(totalSeconds);
}

function speakerLabel(speaker: string | null): string {
  if (!speaker) return "";
  // Scriberr emits labels such as SPEAKER_00; keep custom labels verbatim.
  const generic = speaker.match(/^speaker[_\s-]?(\d+)$/i);
  if (generic) return `Speaker ${Number.parseInt(generic[1], 10) + 1}`;
  return speaker;
}

function yamlSafe(value: string): string {
  // Existing frontmatter writer quotes values; strip characters that could
  // still break a single-line YAML scalar.
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Deterministic slug-collision suffix: prefer the YouTube video ID, then the
 * media hash, then the job ID.
 */
export function deterministicTitleSuffix({
  youtubeVideoId,
  mediaSha256,
  jobId,
}: {
  youtubeVideoId?: string | null;
  mediaSha256?: string | null;
  jobId?: string | null;
}): string {
  if (youtubeVideoId) return youtubeVideoId;
  if (mediaSha256) return mediaSha256.slice(0, 8);
  return (jobId ?? "").slice(-8) || "copy";
}

/**
 * Verify the rendered Markdown transcript section carries every normalized
 * segment exactly once and in chronological order. The comparison ignores
 * Markdown syntax, headings, timestamps and speaker labels (our own framing),
 * but proves all transcript text is represented.
 */
export function assertMarkdownContainsFullTranscript(
  transcript: NormalizedTranscript,
  body: string,
): void {
  const transcriptSection = body.split(/^## Transcript$/m)[1];
  if (!transcriptSection) {
    throw new VideoTranscriptionError("transcript_incomplete", {
      detail: "rendered Markdown has no Transcript section",
    });
  }
  const renderedLines: string[] = [];
  for (const line of transcriptSection.split("\n")) {
    const match = line.match(/^\*\*\[[^\]]+\](?:\([^)]*\))?[^*]*\*\*\s?(.*)$/);
    if (match) renderedLines.push(match[1]);
  }
  const rendered = renderedLines.map(comparableTranscriptText).join("");
  const source = transcriptComparableText(transcript);
  if (rendered !== source) {
    throw new VideoTranscriptionError("transcript_incomplete", {
      detail: `rendered ${rendered.length} comparable chars, expected ${source.length}`,
    });
  }
  if (renderedLines.length !== transcript.segments.length) {
    throw new VideoTranscriptionError("transcript_incomplete", {
      detail: `rendered ${renderedLines.length} segments, expected ${transcript.segments.length}`,
    });
  }
}

export function buildTranscriptMarkdown({
  transcript,
  source,
  transcribedAt,
  windowSeconds = TRANSCRIPT_WINDOW_SECONDS,
}: {
  transcript: NormalizedTranscript;
  source: TranscriptSourceInfo;
  /** ISO timestamp of when transcription completed (deterministic input). */
  transcribedAt: string;
  windowSeconds?: number;
}): TranscriptMarkdownResult {
  if (transcript.segments.length === 0) {
    throw new VideoTranscriptionError("transcript_malformed", {
      detail: "cannot render an empty transcript",
    });
  }

  const title = transcript.title.trim() || "Video transcript";
  const durationSeconds = transcript.durationSeconds;
  const useHours =
    (durationSeconds ?? 0) >= 3600 ||
    transcript.segments[transcript.segments.length - 1].endSeconds >= 3600;

  // ── Source information ────────────────────────────────────────────────────
  const info: string[] = [];
  if (source.kind === "youtube") {
    info.push("- **Source:** YouTube");
    const channel = source.metadata?.channel;
    if (channel) info.push(`- **Channel:** ${channel}`);
    if (durationSeconds !== null) {
      info.push(`- **Duration:** ${formatDuration(durationSeconds)}`);
    }
    info.push(`- **Original video:** ${source.canonicalUrl}`);
  } else {
    info.push("- **Source:** Uploaded video file");
    info.push(`- **Original filename:** ${source.originalFilename}`);
    if (durationSeconds !== null) {
      info.push(`- **Duration:** ${formatDuration(durationSeconds)}`);
    }
  }
  if (transcript.language) info.push(`- **Language:** ${transcript.language}`);
  if (transcript.speakers.length > 0) {
    info.push(
      `- **Speakers:** ${transcript.speakers.map(speakerLabel).join(", ")}`,
    );
  }
  info.push("- **Transcription:** Scriberr");

  // ── Transcript, grouped into deterministic time windows ───────────────────
  const sections: string[] = [];
  let currentWindow = -1;
  for (const segment of transcript.segments) {
    const windowIndex = Math.floor(segment.startSeconds / windowSeconds);
    if (windowIndex !== currentWindow) {
      currentWindow = windowIndex;
      const windowStart = windowIndex * windowSeconds;
      const windowEnd = windowStart + windowSeconds;
      sections.push(
        `### ${formatWindowLabel(windowStart, windowEnd, useHours)}`,
      );
      sections.push("");
    }
    const stamp = formatTimestamp(segment.startSeconds);
    const label = speakerLabel(segment.speaker);
    const speakerPart = label ? ` ${label}:` : "";
    const timestampPart =
      source.kind === "youtube"
        ? `[${stamp}](${youtubeTimestampUrl(source.videoId, segment.startSeconds)})`
        : `[${stamp}]`;
    sections.push(`**${timestampPart}${speakerPart}** ${segment.text}`);
    sections.push("");
  }

  const body =
    `# ${title}\n\n` +
    `## Source information\n\n${info.join("\n")}\n\n` +
    `## Transcript\n\n${sections.join("\n").trimEnd()}\n`;

  // Fidelity gate: refuse to emit Markdown that lost transcript text.
  assertMarkdownContainsFullTranscript(transcript, body);

  const contentHash = crypto.createHash("sha256").update(body, "utf8").digest("hex");

  // ── Frontmatter metadata for the existing source pipeline ─────────────────
  const metadata: Record<string, string | string[]> = {
    source_type: source.kind === "youtube" ? "youtube" : "video_upload",
    transcription_engine: "scriberr",
    transcribed_at: transcribedAt,
    content_hash: `sha256:${contentHash}`,
    tags: ["source", "video", "transcript"],
  };
  if (transcript.transcriptionModel) {
    metadata.transcription_model = yamlSafe(transcript.transcriptionModel);
  }
  if (transcript.language) metadata.language = yamlSafe(transcript.language);
  if (durationSeconds !== null) {
    metadata.duration_seconds = String(Math.round(durationSeconds));
  }
  metadata.diarization = transcript.speakers.length > 0 ? "true" : "false";

  if (source.kind === "youtube") {
    metadata.original_url = yamlSafe(source.originalUrl);
    metadata.canonical_url = yamlSafe(source.canonicalUrl);
    metadata.youtube_video_id = source.videoId;
    if (source.metadata?.channel) {
      metadata.channel = yamlSafe(source.metadata.channel);
    }
    if (source.metadata?.uploadDate) {
      metadata.upload_date = source.metadata.uploadDate;
    }
    if (source.metadata?.thumbnailUrl) {
      metadata.thumbnail_url = yamlSafe(source.metadata.thumbnailUrl);
    }
  } else {
    metadata.original_filename = yamlSafe(source.originalFilename);
    if (source.mediaSha256) metadata.media_sha256 = source.mediaSha256;
  }

  const plainText = transcript.segments.map((segment) => segment.text).join("\n");

  return { body, plainText, metadata, contentHash };
}
