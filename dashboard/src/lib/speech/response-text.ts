import { repairDamagedLatex } from '../markdown-safety.ts';
import { splitSpeechPassages } from './passages.ts';

type SpeechOptions = { signal?: AbortSignal; codeOmission?: string; maxCharacters?: number };

// Math is protected before Markdown cleanup, especially _ > | and *.
const REGIONS = /(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:\1|$)|(`+)([^\n]*?)\4|(?<!\\)\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(?<![\\$])\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/g;

function isDollarMath(source: string): boolean {
  // "$5 and $10" and "$18B, up from $7B" are prices, not paired math.
  return !/^\d/.test(source) || /^\d+(?:\.\d+)?$/.test(source)
    || (/[=<>+*/^_{}\\\u2212\u00d7\u00f7\u2264\u2265]/u.test(source) && !/\b[a-zA-Z]{2,}\b/.test(source.replace(/\\[a-zA-Z]+/g, '')));
}

function isBareMath(source: string): boolean {
  return /[=<>^_\u00b2\u00b3\u2070\u00b9\u2074-\u2079\u2080-\u2089\u2264\u2265\u2260\u00b1\u00d7\u00f7\u221a\u2211\u222b]/u.test(source)
    && !/[a-zA-Z]{3,}/.test(source.replace(/\\[a-zA-Z]+/g, ''))
    && /^[\p{L}\p{N}\s\\{}()[\].,+*/^_=<>|!\u2212\u2013\u00b1\u00d7\u00f7\u221a\u2211\u222b\u221e\u2264\u2265\u2260\u2070-\u2079\u2080-\u2089-]+$/u.test(source);
}

/** Soft-wrapped prose stays together; Markdown blocks retain breathing room. */
function speechBlocks(source: string): string {
  const blocks: string[] = [];
  let lines: string[] = [];
  let punctuate = false;
  const flush = () => {
    const text = lines.join(' ').trim();
    const ending = text.replace(/(\*\*|__|\*|_|~~)/g, '');
    if (text) blocks.push(punctuate && !/[.!?。！？:;，；：…]["'”’»）)\]]*$/u.test(ending) ? `${text}.` : text);
    lines = [];
    punctuate = false;
  };
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/^[ \t]{0,3}>[ \t]?/u, '').trim();
    if (!line || /^(?:[-*_][ \t]*){3,}$/u.test(line) || /^\|?[\s:|-]*---[\s:|-]*\|?$/u.test(line)) { flush(); continue; }
    const heading = line.match(/^#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?$/u);
    const item = line.match(/^(?:[-*+]|\d+[.)])[ \t]+(.+)$/u);
    if (heading || item) {
      flush(); lines.push((heading || item)![1]); punctuate = true;
      if (heading) flush();
    } else if (line.startsWith('|') && line.endsWith('|')) {
      flush();
      lines.push(line.slice(1, -1).split('|').map(cell => cell.trim()).filter(Boolean).join('; '));
      punctuate = true; flush();
    } else {
      lines.push(line);
      if (/[ \t]{2,}$/u.test(raw)) flush();
    }
  }
  flush();
  return blocks.join('\n\n');
}

/** Shared by message playback, audio downloads, notifications and voice mode. */
export async function responseTextForSpeech(content: string, options: SpeechOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const formulas: string[] = [];
  const literals: string[] = [];
  const mark = (source: string) => `\uE000${formulas.push(source) - 1}\uE001`;
  const literal = (source: string) => `\uE002${literals.push(source) - 1}\uE003`;
  let text = repairDamagedLatex(content).replace(REGIONS, (match, fence, language, body, ticks, code, display, bracket, paren, inline) => {
    if (fence) {
      if (/^(weather-results|image-results)\s*$/i.test(language.trim())) return ' ';
      if (/^(math|latex|tex)\s*$/i.test(language.trim())) return mark(body);
      return literal(options.codeOmission ?? body.trim());
    }
    if (ticks) return isBareMath(code) ? mark(code) : literal(code);
    if (inline !== undefined && !isDollarMath(inline)) return match;
    return mark(display ?? bracket ?? paren ?? inline);
  });
  text = text.split('\n').map(line => /^[ \t]*>[ \t]*$/u.test(line) ? '' : isBareMath(line.trim()) ? mark(line.trim()) : line).join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\\\$/g, '$');
  text = speechBlocks(text)
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/[^\S\n]+/g, ' ').trim();

  if (formulas.length) {
    const { mathSpeech } = await import('./math-speech.ts');
    const readings: string[] = [];
    // SRE owns a shared engine. Convert serially after its one-time setup.
    for (const formula of formulas) {
      options.signal?.throwIfAborted();
      try { readings.push(await mathSpeech(formula)); }
      catch { readings.push('formula could not be read aloud'); }
    }
    options.signal?.throwIfAborted();
    // Replace once so formula contents can never become Markdown or tokens.
    text = text.replace(/\uE000(\d+)\uE001/g, (_, index) => readings[Number(index)] ?? '');
  }
  // Code is visible message content too. Preserve it through Markdown cleanup
  // instead of dropping whole blocks or deleting underscores from identifiers.
  text = text.replace(/\uE002(\d+)\uE003/g, (_, index) => literals[Number(index)] ?? '');

  // Explicit previews can request a short budget, but never cut an equation.
  const limit = options.maxCharacters;
  if (limit && text.length > limit && !formulas.length) {
    return splitSpeechPassages(text, { maxCharacters: Math.max(2, limit) })[0] ?? '';
  }
  return text;
}
