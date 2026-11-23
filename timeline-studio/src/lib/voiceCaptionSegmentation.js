// Split before synthesis so each caption uses its own decoded audio duration.
// This preserves the authored script instead of recognizing TTS back into text
// or estimating word timing by distributing the total duration.
export function splitVoiceCaptionText(rawText) {
  const text = String(rawText ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
  const result = [];
  const width = (value) => Array.from(value).reduce((sum, char) => (
    sum + (/[^\u0000-\u024f]/u.test(char) ? 2 : 1)
  ), 0);
  let phrase = "";
  const flush = () => {
    if (phrase.trim()) {
      if (!/[\p{L}\p{N}]/u.test(phrase) && result.length) result[result.length - 1] += phrase.trim();
      else result.push(phrase.trim());
    }
    phrase = "";
  };
  for (const paragraph of text.split("\n")) {
    const tokens = segmenter
      ? Array.from(segmenter.segment(paragraph), (part) => part.segment)
      : paragraph.match(/[\u3040-\u30ff\u3400-\u9fff]|[^\s\u3040-\u30ff\u3400-\u9fff]+|\s+/gu) || [];
    for (const token of tokens) {
      const punctuation = /^[\p{P}\p{S}\s]+$/u.test(token);
      // Keep words, numbers and closing punctuation intact. A single unusually
      // long word may exceed the target; never truncate or spell it out in TTS.
      if (!punctuation && phrase.trim() && width((phrase + token).trim()) > 24) flush();
      phrase += token;
      if (/[,，;；:：。！？!?]$/u.test(token)) flush();
    }
    flush();
  }
  return result;
}
