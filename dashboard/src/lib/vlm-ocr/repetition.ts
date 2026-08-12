// Repetition-degeneration guards, ported from HunyuanOCR-1.5's
// inference/utils/output_utils.py (has_tail_repetition / clean_repeated_substrings).
//
// The model is decoded greedily (temperature 0, top_k 1), which occasionally
// makes it loop on a short unit for the rest of the budget. Upstream stops the
// stream when it sees that and trims any loop that still slipped through.

/** True when the tail of `text` is a small unit repeated `minRepeats` times. */
export function hasTailRepetition(
  text: string,
  minRepeats = 8,
  maxUnit = 256,
): boolean {
  const n = text.length;
  if (n < minRepeats * 2) return false;

  const upper = Math.min(maxUnit, Math.floor(n / minRepeats));
  for (let length = 1; length <= upper; length += 1) {
    const unit = text.slice(n - length);
    if (!unit.trim()) continue;

    let ok = true;
    for (let k = 2; k <= minRepeats; k += 1) {
      if (text.slice(n - length * k, n - length * (k - 1)) !== unit) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Trim a long repeated suffix down to a single occurrence. */
export function cleanRepeatedSubstrings(text: string, minRepeats = 10): string {
  const n = text.length;
  if (n < 2_000) return text;

  const upper = Math.floor(n / minRepeats);
  for (let length = 2; length <= upper; length += 1) {
    const candidate = text.slice(n - length);
    let count = 0;
    let i = n - length;
    while (i >= 0 && text.slice(i, i + length) === candidate) {
      count += 1;
      i -= length;
    }
    if (count >= minRepeats) {
      return text.slice(0, n - length * (count - 1));
    }
  }
  return text;
}
