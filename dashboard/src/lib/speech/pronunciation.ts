export const MAX_PRONUNCIATION_CHARACTERS = 20_000;
type Pronunciation = { term: string; reading: string };

/** User-authored, case-sensitive respellings. No guessed acronyms or numbers. */
export function parsePronunciations(value: string): Pronunciation[] {
  if (value.length > MAX_PRONUNCIATION_CHARACTERS) throw new Error('Pronunciation corrections are too long.');
  const rules: Pronunciation[] = [];
  const seen = new Set<string>();
  for (const [index, line] of value.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    const term = line.slice(0, separator).trim();
    const reading = line.slice(separator + 1).trim();
    if (separator < 1 || !term || !reading || term.length > 80 || reading.length > 160 || /[\u0000-\u001f<>\[\]]/u.test(term + reading)) {
      throw new Error(`Pronunciation line ${index + 1}: use word = pronunciation (up to 80 and 160 characters).`);
    }
    if (seen.has(term)) throw new Error(`Pronunciation line ${index + 1}: this word already has a correction.`);
    seen.add(term);
    rules.push({ term, reading });
  }
  if (rules.length > 100) throw new Error('Use at most 100 pronunciation corrections.');
  return rules;
}

export function applyPronunciations(text: string, value = ''): string {
  return preparePronunciations(text, value).text;
}

/** Keep recovery positions in the caller's original script even when a user
 * respelling expands, contracts or introduces sentence punctuation. */
export function preparePronunciations(text: string, value = '') {
  const replacements: { sourceStart: number; sourceEnd: number; spokenStart: number; spokenEnd: number }[] = [];
  let difference = 0;
  const rules = parsePronunciations(value).sort((a, b) => b.term.length - a.term.length);
  if (!rules.length) return { text, sourceOffset: (offset: number) => Math.max(0, Math.min(text.length, offset)) };
  const readings = new Map(rules.map(({ term, reading }) => [term, reading]));
  const escaped = rules.map(({ term }) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])(?:${escaped.join('|')})(?![\\p{L}\\p{N}\\p{M}_])`, 'gu');
  // One pass prevents a correction from being rewritten by another correction.
  const spoken = text.replace(pattern, (match, offset: number) => {
    const reading = readings.get(match)!;
    replacements.push({ sourceStart: offset, sourceEnd: offset + match.length,
      spokenStart: offset + difference, spokenEnd: offset + difference + reading.length });
    difference += reading.length - match.length;
    return reading;
  });
  return { text: spoken, sourceOffset(offset: number) {
    const position = Math.max(0, Math.min(spoken.length, offset));
    let difference = 0;
    for (const replacement of replacements) {
      if (position < replacement.spokenStart) break;
      // A sentence boundary inside a respelling must replay that whole term.
      if (position < replacement.spokenEnd) return replacement.sourceStart;
      difference = replacement.spokenEnd - replacement.sourceEnd;
    }
    return position - difference;
  } };

}
