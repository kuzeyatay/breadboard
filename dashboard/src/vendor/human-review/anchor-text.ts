/**
 * Adapted from human-review 0.6.1, src/anchor-text.js.
 * Copyright (c) 2026 Peter Yang. Licensed under the MIT License; see LICENSE.
 */

export const CONTEXT_PAD = 32;

/** Capture a selection plus surrounding context so comments survive edits. */
export function buildContext(text: string, start: number, end: number, pad = CONTEXT_PAD) {
  return {
    prefix: text.slice(Math.max(0, start - pad), start),
    quote: text.slice(start, end),
    suffix: text.slice(end, Math.min(text.length, end + pad)),
  };
}

function commonSuffixLength(a: string, b: string): number {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) length += 1;
  return length;
}

function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

function occurrences(text: string, quote: string): number[] {
  const found: number[] = [];
  let at = text.indexOf(quote);
  while (at !== -1) {
    found.push(at);
    at = text.indexOf(quote, at + 1);
  }
  return found;
}

function bestHit(
  text: string,
  hits: number[],
  quote: string,
  prefix: string,
  suffix: string,
): { at: number; score: number } {
  let best = hits[0] ?? 0;
  let bestScore = -1;
  for (const at of hits) {
    const before = text.slice(Math.max(0, at - prefix.length), at);
    const after = text.slice(at + quote.length, at + quote.length + suffix.length);
    const score = commonSuffixLength(prefix, before) + commonPrefixLength(suffix, after);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return { at: best, score: bestScore };
}

const collapse = (value: string) => String(value || "").replace(/\s+/g, " ");

function collapseWithMap(text: string): { flat: string; map: number[] } {
  let flat = "";
  const map: number[] = [];
  let pendingWhitespace = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index] ?? "")) {
      if (pendingWhitespace === -1) pendingWhitespace = index;
      continue;
    }
    if (pendingWhitespace !== -1 && flat) {
      flat += " ";
      map.push(pendingWhitespace);
    }
    pendingWhitespace = -1;
    flat += text[index];
    map.push(index);
  }
  return { flat, map };
}

export function findQuote(
  text: string,
  context: { quote: string; prefix?: string; suffix?: string },
): { start: number; end: number; exact: boolean } | null {
  const quote = context?.quote;
  if (!quote) return null;
  const hits = occurrences(text, quote);
  if (hits.length === 1) return { start: hits[0]!, end: hits[0]! + quote.length, exact: true };
  if (hits.length > 1) {
    const hit = bestHit(text, hits, quote, context.prefix || "", context.suffix || "");
    return { start: hit.at, end: hit.at + quote.length, exact: hit.score > 0 };
  }
  const { flat, map } = collapseWithMap(text);
  const flatQuote = collapse(quote).trim();
  if (!flatQuote || !map.length) return null;
  const flatHits = occurrences(flat, flatQuote);
  if (!flatHits.length) return null;
  const hit = bestHit(
    flat,
    flatHits,
    flatQuote,
    collapse(context.prefix || ""),
    collapse(context.suffix || ""),
  );
  return {
    start: map[hit.at]!,
    end: map[hit.at + flatQuote.length - 1]! + 1,
    exact: false,
  };
}

export function tidy(text: string, limit = 0): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!limit || flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

