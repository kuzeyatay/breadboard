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
  const rules = parsePronunciations(value).sort((a, b) => b.term.length - a.term.length);
  if (!rules.length) return text;
  const readings = new Map(rules.map(({ term, reading }) => [term, reading]));
  const escaped = rules.map(({ term }) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])(?:${escaped.join('|')})(?![\\p{L}\\p{N}\\p{M}_])`, 'gu');
  // One pass prevents a correction from being rewritten by another correction.
  return text.replace(pattern, match => readings.get(match)!);
}
