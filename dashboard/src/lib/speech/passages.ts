type PassageLimits = { maxCharacters: number; maxWords?: number };

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'approx',
  'fig', 'no', 'dept', 'inc', 'ltd', 'e.g', 'i.e', 'a.m', 'p.m', 'u.s', 'u.k',
]);

/** Sentence/paragraph first, then clause, then word. Limits never drop content. */
export function splitSpeechPassages(text: string, { maxCharacters, maxWords = Infinity }: PassageLimits): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 2 || !(maxWords >= 1)) {
    throw new RangeError('Invalid speech passage limits.');
  }
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining) {
    let end = Math.min(maxCharacters, remaining.length);
    let words = 0;
    for (const word of remaining.matchAll(/\S+/gu)) {
      if (word.index >= end) break;
      if (++words > maxWords) { end = word.index; break; }
    }
    if (end < remaining.length) {
      let sentenceEnd = 0;
      // Inspect the original following character, not an artificially truncated
      // prefix: a period at the size limit can still be part of a decimal.
      for (const match of remaining.slice(0, end + 1).matchAll(/\n{2,}|[.!?。！？]+["'”’»）)\]]*/gu)) {
        const stop = match.index + match[0].length;
        if (stop > end) continue;
        if (match[0].startsWith('\n')) { sentenceEnd = stop; continue; }
        const cjk = /[。！？]/u.test(match[0]);
        if (!cjk && remaining[stop] && !/\s/u.test(remaining[stop])) continue;
        if (match[0].startsWith('.')) {
          if (match[0].startsWith('..')) continue;
          const word = remaining.slice(0, match.index).match(/[\p{L}.]+$/u)?.[0] ?? '';
          if (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{L}$/u.test(word) || /^(?:\p{L}\.)+\p{L}$/u.test(word)) continue;
        }
        sentenceEnd = stop;
      }
      let clauseEnd = 0;
      for (const match of remaining.slice(0, end + 1).matchAll(/[,;:—–，；：、]["'”’»）)\]]*(?=\s|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu)) {
        const stop = match.index + match[0].length;
        if (stop <= end) clauseEnd = stop;
      }
      const space = [...remaining.slice(0, end + 1).matchAll(/\s+/gu)].at(-1)?.index ?? 0;
      end = sentenceEnd || clauseEnd || space || end;
      // Keep astral characters intact even when an unbroken token needs cutting.
      if (/[\uD800-\uDBFF]/u.test(remaining[end - 1])) end--;
    }
    parts.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }
  return parts;
}
