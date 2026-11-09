type PassageLimits = { maxCharacters: number; maxWords?: number };

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'approx',
  'fig', 'no', 'dept', 'inc', 'ltd', 'e.g', 'i.e', 'a.m', 'p.m', 'u.s', 'u.k',
]);

/** Sentence ends shared by chunking and readout verification. Abbreviations,
 * initials and decimals do not end a sentence; CJK punctuation needs no space. */
export function speechSentenceEnds(text: string, maxEnd = text.length): number[] {
  const ends: number[] = [];
  for (const match of text.matchAll(/\n{2,}|[.!?。！？]+["'”’»）)\]]*/gu)) {
    const stop = match.index + match[0].length;
    if (stop > maxEnd) break;
    if (match[0].startsWith('\n')) { ends.push(stop); continue; }
    const cjk = /[。！？]/u.test(match[0]);
    if (!cjk && text[stop] && !/\s/u.test(text[stop])) continue;
    if (match[0].startsWith('.')) {
      if (match[0].startsWith('..')) continue;
      const word = text.slice(0, match.index).match(/[\p{L}.]+$/u)?.[0] ?? '';
      // The C/F in an explicit temperature is a unit, not a person's initial.
      const temperatureUnit = /^[cf]$/iu.test(word)
        && /(?:°|\bdegrees?)\s*[cf]$/iu.test(text.slice(0, match.index));
      if (ABBREVIATIONS.has(word.toLowerCase()) || (/^\p{L}$/u.test(word) && !temperatureUnit) || /^(?:\p{L}\.)+\p{L}$/u.test(word)) continue;
    }
    ends.push(stop);
  }
  return ends;
}

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
      for (const stop of speechSentenceEnds(remaining, end)) {
        if (stop <= end) sentenceEnd = stop;
        else break;
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
