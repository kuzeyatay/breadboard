import test from "node:test";
import assert from "node:assert/strict";
import {
  comparableTranscriptText,
  detectSuspiciouslyIncomplete,
  normalizeScriberrTranscript,
  transcriptComparableText,
} from "../src/lib/scriberr/transcript-normalizer.ts";
import {
  assertMarkdownContainsFullTranscript,
  buildTranscriptMarkdown,
  deterministicTitleSuffix,
  formatTimestamp,
  formatWindowLabel,
} from "../src/lib/scriberr/transcript-markdown.ts";

function rawTranscript(segments, extra = {}) {
  return { segments, text: null, language: "en", modelUsed: "whisper-small", ...extra };
}

const NORMALIZE_OPTS = { title: "Test Video", sourceType: "youtube" };

test("normalization sorts segments chronologically and keeps stable ids", () => {
  const normalized = normalizeScriberrTranscript(
    rawTranscript([
      { start: 10, end: 12, text: "second", speaker: null },
      { start: 0, end: 2, text: "first", speaker: null },
    ]),
    NORMALIZE_OPTS,
  );
  assert.deepEqual(
    normalized.segments.map((s) => s.text),
    ["first", "second"],
  );
  assert.equal(normalized.segments[0].id, "seg-00001");
});

test("normalization removes only provably identical duplicates", () => {
  const normalized = normalizeScriberrTranscript(
    rawTranscript([
      { start: 0, end: 2, text: "hello", speaker: "SPEAKER_00" },
      { start: 0, end: 2, text: "hello", speaker: "SPEAKER_00" },
      { start: 0, end: 2, text: "hello", speaker: "SPEAKER_01" },
    ]),
    NORMALIZE_OPTS,
  );
  assert.equal(normalized.segments.length, 2);
});

test("normalization clamps negative and backwards timestamps", () => {
  const normalized = normalizeScriberrTranscript(
    rawTranscript([{ start: -1, end: -5, text: "clamped", speaker: null }]),
    NORMALIZE_OPTS,
  );
  assert.equal(normalized.segments[0].startSeconds, 0);
  assert.equal(normalized.segments[0].endSeconds, 0);
});

test("normalization rejects non-finite timestamps loudly", () => {
  assert.throws(
    () =>
      normalizeScriberrTranscript(
        rawTranscript([{ start: Number.NaN, end: 1, text: "x", speaker: null }]),
        NORMALIZE_OPTS,
      ),
    (err) => err.code === "transcript_malformed",
  );
});

test("normalization preserves Unicode text exactly", () => {
  const text = "Merhaba dünya — çünkü öğrenme %100 önemli 数学 🎓";
  const normalized = normalizeScriberrTranscript(
    rawTranscript([{ start: 0, end: 1, text, speaker: null }]),
    NORMALIZE_OPTS,
  );
  assert.equal(normalized.segments[0].text, text);
});

test("normalization fails loudly when there is no transcript text", () => {
  assert.throws(
    () => normalizeScriberrTranscript(rawTranscript([]), NORMALIZE_OPTS),
    (err) => err.code === "transcript_malformed",
  );
  assert.throws(
    () =>
      normalizeScriberrTranscript(
        rawTranscript([{ start: 0, end: 1, text: "   ", speaker: null }]),
        NORMALIZE_OPTS,
      ),
    (err) => err.code === "transcript_malformed",
  );
});

test("normalization falls back to plain text only when no segments exist", () => {
  const normalized = normalizeScriberrTranscript(
    rawTranscript([], { text: "just plain text" }),
    { ...NORMALIZE_OPTS, fallbackDurationSeconds: 30 },
  );
  assert.equal(normalized.segments.length, 1);
  assert.equal(normalized.segments[0].text, "just plain text");
});

test("speaker order is preserved and deduplicated", () => {
  const normalized = normalizeScriberrTranscript(
    rawTranscript([
      { start: 0, end: 1, text: "a", speaker: "SPEAKER_01" },
      { start: 1, end: 2, text: "b", speaker: "SPEAKER_00" },
      { start: 2, end: 3, text: "c", speaker: "SPEAKER_01" },
    ]),
    NORMALIZE_OPTS,
  );
  assert.deepEqual(normalized.speakers, ["SPEAKER_01", "SPEAKER_00"]);
});

test("suspicious incompleteness is detected but not fatal", () => {
  const normalized = normalizeScriberrTranscript(
    rawTranscript([{ start: 0, end: 30, text: "short", speaker: null }]),
    NORMALIZE_OPTS,
  );
  assert.ok(detectSuspiciouslyIncomplete(normalized, 3600));
  assert.equal(detectSuspiciouslyIncomplete(normalized, 40), null);
});

test("timestamp formatting is zero-padded hh:mm:ss", () => {
  assert.equal(formatTimestamp(3), "00:00:03");
  assert.equal(formatTimestamp(3725), "01:02:05");
  assert.equal(formatTimestamp(-4), "00:00:00");
});

test("window labels use mm:ss under an hour and h:mm:ss above", () => {
  assert.equal(formatWindowLabel(0, 300, false), "00:00–05:00");
  assert.equal(formatWindowLabel(3600, 3900, true), "01:00:00–01:05:00");
});

function sampleTranscript() {
  return normalizeScriberrTranscript(
    rawTranscript([
      { start: 3, end: 8, text: "Welcome to the lecture.", speaker: "SPEAKER_00" },
      { start: 9, end: 15, text: "Thank you for inviting me.", speaker: "SPEAKER_01" },
      { start: 314, end: 320, text: "Our next topic is entropy.", speaker: "SPEAKER_00" },
    ]),
    { title: "Example Video Title", sourceType: "youtube" },
  );
}

const YOUTUBE_SOURCE = {
  kind: "youtube",
  originalUrl: "https://youtu.be/dQw4w9WgXcQ",
  canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  videoId: "dQw4w9WgXcQ",
  metadata: {
    videoId: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Example Video Title",
    channel: "Example Channel",
    durationSeconds: 321,
    thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg",
    uploadDate: "20240110",
  },
};

test("markdown output groups segments into five-minute windows with timestamps", () => {
  const result = buildTranscriptMarkdown({
    transcript: sampleTranscript(),
    source: YOUTUBE_SOURCE,
    transcribedAt: "2026-07-18T12:00:00.000Z",
  });
  assert.match(result.body, /^# Example Video Title$/m);
  assert.match(result.body, /^## Source information$/m);
  assert.match(result.body, /^## Transcript$/m);
  assert.match(result.body, /^### 00:00–05:00$/m);
  assert.match(result.body, /^### 05:00–10:00$/m);
  assert.match(
    result.body,
    /\*\*\[00:00:03\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=3s\) Speaker 1:\*\* Welcome to the lecture\./,
  );
  assert.ok(result.body.endsWith("\n"));
  assert.ok(!result.body.includes("\r"));
});

test("markdown is deterministic and hashes stably", () => {
  const first = buildTranscriptMarkdown({
    transcript: sampleTranscript(),
    source: YOUTUBE_SOURCE,
    transcribedAt: "2026-07-18T12:00:00.000Z",
  });
  const second = buildTranscriptMarkdown({
    transcript: sampleTranscript(),
    source: YOUTUBE_SOURCE,
    transcribedAt: "2026-07-18T12:00:00.000Z",
  });
  assert.equal(first.body, second.body);
  assert.equal(first.contentHash, second.contentHash);
  assert.match(first.metadata.content_hash, /^sha256:[0-9a-f]{64}$/);
});

test("upload sources render plain timestamps and upload metadata", () => {
  const transcript = normalizeScriberrTranscript(
    rawTranscript([{ start: 0, end: 4, text: "Hello from an upload.", speaker: null }]),
    { title: "Lecture 1", sourceType: "video_upload" },
  );
  const result = buildTranscriptMarkdown({
    transcript,
    source: { kind: "upload", originalFilename: "lecture-1.mp4", mediaSha256: "a".repeat(64) },
    transcribedAt: "2026-07-18T12:00:00.000Z",
  });
  assert.match(result.body, /\*\*\[00:00:00\]\*\* Hello from an upload\./);
  assert.ok(!result.body.includes("youtube.com"));
  assert.equal(result.metadata.source_type, "video_upload");
  assert.equal(result.metadata.original_filename, "lecture-1.mp4");
  assert.equal(result.metadata.media_sha256, "a".repeat(64));
});

test("frontmatter metadata carries YouTube provenance", () => {
  const result = buildTranscriptMarkdown({
    transcript: sampleTranscript(),
    source: YOUTUBE_SOURCE,
    transcribedAt: "2026-07-18T12:00:00.000Z",
  });
  assert.equal(result.metadata.source_type, "youtube");
  assert.equal(result.metadata.youtube_video_id, "dQw4w9WgXcQ");
  assert.equal(result.metadata.channel, "Example Channel");
  assert.equal(result.metadata.transcription_engine, "scriberr");
  assert.equal(result.metadata.diarization, "true");
  assert.deepEqual(result.metadata.tags, ["source", "video", "transcript"]);
  // Multi-line injection into single-line YAML values is neutralized.
  assert.ok(!String(result.metadata.channel).includes("\n"));
});

test("completeness check proves every segment survives rendering", () => {
  const transcript = sampleTranscript();
  const result = buildTranscriptMarkdown({
    transcript,
    source: YOUTUBE_SOURCE,
    transcribedAt: "2026-07-18T12:00:00.000Z",
  });
  assertMarkdownContainsFullTranscript(transcript, result.body);

  const truncated = result.body.replace("Our next topic is entropy.", "");
  assert.throws(
    () => assertMarkdownContainsFullTranscript(transcript, truncated),
    (err) => err.code === "transcript_incomplete",
  );

  const reordered = result.body
    .replace("Welcome to the lecture.", "MARKER_A")
    .replace("Thank you for inviting me.", "Welcome to the lecture.")
    .replace("MARKER_A", "Thank you for inviting me.");
  assert.throws(
    () => assertMarkdownContainsFullTranscript(transcript, reordered),
    (err) => err.code === "transcript_incomplete",
  );
});

test("comparable text ignores whitespace but not characters", () => {
  assert.equal(comparableTranscriptText("a  b\r\nc"), "abc");
  assert.notEqual(comparableTranscriptText("abc"), comparableTranscriptText("abd"));
  const transcript = sampleTranscript();
  assert.equal(
    transcriptComparableText(transcript),
    comparableTranscriptText(
      "Welcome to the lecture.Thank you for inviting me.Our next topic is entropy.",
    ),
  );
});

test("deterministic title suffix prefers video id, then media hash, then job id", () => {
  assert.equal(
    deterministicTitleSuffix({ youtubeVideoId: "dQw4w9WgXcQ", mediaSha256: "ff", jobId: "vtj-1" }),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    deterministicTitleSuffix({ mediaSha256: "abcdef0123456789", jobId: "vtj-1" }),
    "abcdef01",
  );
  assert.equal(deterministicTitleSuffix({ jobId: "vtj-12345678" }), "12345678");
});
