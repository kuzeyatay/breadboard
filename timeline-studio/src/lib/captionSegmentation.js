import { makeId } from "./timeline.js";

// Use recognizer word boundaries, never a character-weighted estimate of speech.
// Ordinary caption clips keep all preview/export/SRT and editing paths identical.
export function captionSegmentsFromWords(chunks, duration, {
  timelineOffset = 0, grouping = "phrases", normalizeText = (text) => text.trim(),
} = {}) {
  const timingError = () => new Error("ASR_WORD_TIMING_UNAVAILABLE");
  if (!Array.isArray(chunks) || !chunks.length || !(duration > 0)) throw timingError();
  const words = chunks.filter((chunk) => String(chunk?.text ?? "").trim());
  const transcript = words.map((word) => String(word.text)).join("");
  const boundaries = typeof Intl.Segmenter === "function"
    ? new Set(Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(transcript), (part) => part.index))
    : null;
  let textOffset = 0;
  const offset = Math.max(0, Number(timelineOffset) || 0);
  const segments = [];
  let group = [];
  let previousEnd = 0;
  const timestamp = (value) => value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value) : null;
  const join = (items) => items.map((item) => item.text).join("").trim();
  const width = (text) => Array.from(text).reduce((sum, char) => sum + (/[^\u0000-\u024f]/u.test(char) ? 2 : 1), 0);
  function flush() {
    if (!group.length) return;
    const rawText = join(group);
    const start = group[0].start;
    const end = group.at(-1).end;
    if (end <= start) return; // Keep zero-length tokens with the next timed word.
    const text = normalizeText(rawText);
    segments.push({
      id: makeId("caption"), text, start: offset + start, end: offset + end,
      hidden: false, source: "asr", timingSource: "asr-word",
      ...(text !== rawText ? { rawText } : {}),
    });
    group = [];
  }
  words.forEach((word, index) => {
    const rawStart = timestamp(word.timestamp?.[0]);
    const rawEnd = timestamp(word.timestamp?.[1]);
    if (rawStart === null) throw timingError();
    const nextStart = timestamp(words[index + 1]?.timestamp?.[0]);
    const start = Math.min(duration, Math.max(previousEnd, rawStart, 0));
    const end = Math.max(start, Math.min(duration, rawEnd ?? nextStart ?? duration,
      nextStart !== null && nextStart >= start ? nextStart : duration));
    const item = { text: String(word.text), start, end };
    // Whisper emits individual characters for Chinese/Japanese. A four-token
    // limit intended for spaced languages would fragment these into tiny clips.
    const maxTokens = /[\u3040-\u30ff\u3400-\u9fff]/u.test(join([...group, item])) ? 12 : 4;
    const canBreak = !boundaries || boundaries.has(textOffset);
    if (group.length && canBreak && (grouping === "words" || (group.length >= maxTokens
      || width(join([...group, item])) > 28 || end - group[0].start > 2.5
      || start - group.at(-1).end > 0.35))) flush();
    textOffset += item.text.length;
    group.push(item);
    previousEnd = end;
    if (/[.!?。！？,，;；:：][”’"']?\s*$/u.test(item.text)) flush();
  });
  flush();
  // A degenerate final token has no independent display interval. Preserve its
  // text on the preceding caption instead of dropping punctuation or a word.
  if (group.length && segments.length) {
    const last = segments.at(-1);
    last.text = normalizeText((last.rawText ?? last.text) + group.map((item) => item.text).join(""));
    delete last.rawText;
  } else if (group.length || !segments.length) throw timingError();
  return segments;
}
