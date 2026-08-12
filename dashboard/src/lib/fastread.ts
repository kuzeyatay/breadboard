/**
 * FastRead — RSVP (Rapid Serial Visual Presentation) reading for garden notes.
 *
 * The word maths (optimal recognition point, per-word delay) is ported from the
 * rsvp-reading project. On top of it this module segments a note's markdown
 * into a timeline of prose runs and *stops*: an image, an interactive visual, a
 * code block, a table, display math — anything that is looked at rather than
 * read word by word. Playback halts before each stop so the reader can take it
 * in and press Continue.
 */

export type FastReadStopKind = 'image' | 'visualizer' | 'code' | 'math' | 'table' | 'embed';

export interface FastReadWord {
  /** Display text, with markdown syntax already stripped. */
  text: string;
  /** Inline code and inline math are shown whole instead of being ORP-split. */
  atomic: boolean;
  /** Words that came from a heading, so the display can mark the section start. */
  heading: boolean;
}

export interface FastReadTextSegment {
  kind: 'text';
  words: FastReadWord[];
  sectionTitle: string;
}

export interface FastReadStopSegment {
  kind: FastReadStopKind;
  /** Short human label, e.g. "Image", "Python code", "Interactive visual". */
  label: string;
  /** The block's markdown source, used for rendering and as a fallback preview. */
  raw: string;
  sectionTitle: string;
  /** Image source path exactly as written in the markdown. */
  src?: string;
  alt?: string;
  /** Fenced-block info string, e.g. "python" or "breadboard-visual". */
  lang?: string;
  /** `id:` of a breadboard visual block, when the spec declares one. */
  visualId?: string;
}

export type FastReadSegment = FastReadTextSegment | FastReadStopSegment;

export interface FastReadDocument {
  segments: FastReadSegment[];
  totalWords: number;
  stopCount: number;
}

export const FASTREAD_MIN_WPM = 100;
export const FASTREAD_MAX_WPM = 900;
export const FASTREAD_DEFAULT_WPM = 350;
export const FASTREAD_WPM_STEP = 25;

const VISUAL_BLOCK_LANGS = new Set([
  'breadboard-visual',
  'breadboard-generated-visual',
]);

const DIAGRAM_LANGS = new Set(['mermaid', 'graphviz', 'dot', 'plantuml']);

/** Fences that hold display maths rather than source code. */
const MATH_LANGS = new Set(['math', 'latex', 'tex', 'katex', 'asciimath']);

/** Fences with no language worth naming — "Code" reads better than "Text code". */
const PLAIN_LANGS = new Set(['text', 'plaintext', 'txt', 'plain', 'none']);

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cs: 'C#',
  csharp: 'C#',
  css: 'CSS',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  latex: 'LaTeX',
  markdown: 'Markdown',
  md: 'Markdown',
  matlab: 'MATLAB',
  powershell: 'PowerShell',
  py: 'Python',
  python: 'Python',
  r: 'R',
  rust: 'Rust',
  sh: 'Shell',
  shell: 'Shell',
  sql: 'SQL',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  verilog: 'Verilog',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
};

/** HTML blocks that are looked at, not read. */
const EMBED_TAGS = new Set([
  'iframe',
  'video',
  'audio',
  'canvas',
  'svg',
  'embed',
  'object',
  'figure',
  'table',
  'picture',
]);

const MATH_ENVIRONMENTS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'aligned',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'eqnarray',
  'eqnarray*',
  'split',
  'cases',
  'array',
  'matrix',
  'pmatrix',
  'bmatrix',
  'vmatrix',
]);

const UNICODE_LETTER_RE = /\p{L}/u;

/* -------------------------------------------------------------------------- */
/* Word maths (ported from rsvp-reading)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Index of the letter the eye naturally lands on, by letter count. Punctuation
 * is ignored here; `getActualORPIndex` maps the result back onto the raw word.
 */
export function getORPIndex(word: string): number {
  if (!word) return 0;
  const length = word.replace(/[^\p{L}]/gu, '').length;
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 12) return 3;
  return Math.floor(Math.log2(length - 1)) + 1;
}

/** The ORP index as a character offset into the raw word, skipping punctuation. */
export function getActualORPIndex(word: string): number {
  if (!word) return 0;

  const orpIndex = getORPIndex(word);
  let letterCount = 0;

  for (let index = 0; index < word.length; index += 1) {
    if (UNICODE_LETTER_RE.test(word[index])) {
      if (letterCount === orpIndex) return index;
      letterCount += 1;
    }
  }

  return Math.min(orpIndex, word.length - 1);
}

export interface FastReadWordParts {
  before: string;
  orp: string;
  after: string;
}

/** Split a word into the run before the focal letter, the letter, and the rest. */
export function splitWordForDisplay(word: string): FastReadWordParts {
  if (!word) return { before: '', orp: '', after: '' };

  const orpIndex = getActualORPIndex(word);
  return {
    before: word.slice(0, orpIndex),
    orp: word[orpIndex] ?? '',
    after: word.slice(orpIndex + 1),
  };
}

/**
 * How long a word stays on screen. Sentence-ending punctuation and unusually
 * long words hold longer so comprehension keeps up with the base rate.
 */
export function getWordDelay(word: string, wordsPerMinute: number): number {
  const wpm = wordsPerMinute > 0 ? wordsPerMinute : FASTREAD_DEFAULT_WPM;
  let delay = 60000 / wpm;

  if (!word) return delay;

  // 12+ characters is roughly two standard deviations above average word length.
  if (word.length > 12) {
    delay *= 1 + 0.06 * (word.length - 12);
  }

  if (/[.!?]["'”’)]?$/.test(word)) return delay * 2;
  if (/[;:]$/.test(word)) return delay * 1.6;
  if (/,$/.test(word)) return delay * 1.4;

  return delay;
}

/** Remaining reading time as `M:SS`. */
export function formatTimeRemaining(remainingWords: number, wordsPerMinute: number): string {
  if (remainingWords <= 0 || wordsPerMinute <= 0) return '0:00';

  const seconds = Math.ceil((remainingWords / wordsPerMinute) * 60);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Inline markdown → words                                                     */
/* -------------------------------------------------------------------------- */

function lastPathSegment(target: string): string {
  const parts = target.split(/[/#]/).filter(Boolean);
  return (parts[parts.length - 1] ?? target).trim();
}

/**
 * `$…$` is also how people write prices and shell variables. Treat a span as
 * math only when it looks like math: no padding whitespace, and either a LaTeX
 * construct inside or a single compact token.
 */
function looksLikeMath(inner: string): boolean {
  if (!inner || inner !== inner.trim()) return false;
  if (/[\\^_{}=<>]/.test(inner)) return true;
  return !/\s/.test(inner) && inner.length <= 16;
}

/** LaTeX commands that have a perfectly good single character. */
const LATEX_GLYPHS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  equiv: '≡', sim: '∼', propto: '∝', ll: '≪', gg: '≫',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '*',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', mapsto: '↦',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  infty: '∞', partial: '∂', nabla: '∇', ldots: '…', dots: '…', cdots: '…',
  deg: '°', percent: '%', prime: '′',

  // Operator names typeset as upright roman — the command *is* the word.
  max: 'max', min: 'min', log: 'log', ln: 'ln', exp: 'exp', lim: 'lim',
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  sup: 'sup', inf: 'inf', det: 'det', dim: 'dim', gcd: 'gcd', mod: 'mod',
  arg: 'arg', Re: 'Re', Im: 'Im',
};

/**
 * Rewrite a math span as the closest readable plain text: unwrap typographic
 * wrappers, swap commands for their character, and flatten single-token
 * sub/superscript braces. `V_{\text{th}}` becomes `V_th`, `100\,\mathrm{Hz}`
 * becomes `100 Hz`, `\alpha` becomes `α`.
 */
export function mathToPlainText(math: string): string {
  return math
    .replace(
      /\\(?:mathrm|mathbf|mathit|mathsf|mathbb|mathcal|mathfrak|boldsymbol|text|textrm|textbf|operatorname)\s*\{([^{}]*)\}/g,
      '$1',
    )
    .replace(/\\[,;:!]|\\quad|\\qquad|\\ /g, ' ')
    .replace(/\\left|\\right/g, '')
    .replace(/\\([a-zA-Z]+)/g, (whole, name: string) => LATEX_GLYPHS[name] ?? whole)
    // `_{th}` -> `_th`, but only when the braces hold one plain token.
    .replace(/([_^])\{([^{}\\]*)\}/g, (_whole, mark: string, inner: string) =>
      /^[\p{L}\p{N}.,+-]*$/u.test(inner) ? `${mark}${inner}` : `${mark}{${inner}}`,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** A relation or operator, i.e. the thing that makes a span a statement. */
const OPERATOR_RE = /[=<>+/*·×÷±∓≤≥≠≈≡∼∝≪≫→←⇒↦∈∉⊂⊆∪∩]|(?<=[\p{L}\p{N})}\]])\s*-\s*(?=[\p{L}\p{N}({[])/u;

/**
 * Whether an inline math span has to be typeset to be legible.
 *
 * A *term* reads fine as a word in the stream — a bare symbol (`$B$`), a
 * subscripted name (`$V_{\text{th}}$` → "V_th"), a function reference
 * (`$m(t)$`), a quantity with units (`$100\,\mathrm{Hz}$` → "100 Hz"), or a
 * lone glyph being named (`$\geq$` → "≥"). A *statement* does not: `$x<0$` or
 * `$f_s \ge 2B$` as raw source is noise, so it becomes its own rendered stop.
 *
 * The test is therefore an operator with something to operate on, or leftover
 * structural LaTeX that plain text cannot express (a fraction, a radical).
 */
export function needsTypesetting(math: string): boolean {
  const plain = mathToPlainText(math);
  if (!plain) return false;

  // A command or brace group survived normalisation: \frac, \sqrt, \sum, …
  if (/[\\{}]/.test(plain)) return true;

  // Sub/superscripts are part of a name, not arithmetic on it — without this
  // the `+` in `V(t^+)` would read as an operator and split the sentence.
  const withoutScripts = plain.replace(/[_^][\p{L}\p{N}+-]*/gu, '');

  // An operator only makes a statement when it has an operand beside it, so a
  // lone "≥" introduced as a symbol keeps reading inline.
  return OPERATOR_RE.test(withoutScripts) && /[\p{L}\p{N}]/u.test(withoutScripts);
}

/**
 * Collapse link syntax down to its visible label. Runs before math spans are
 * pulled out, because a wikilink label may itself contain inline math — e.g.
 * `[[…|Ground Model and the $1/d^4$ Rule]]`.
 *
 * Image syntax is deliberately preserved: `keepImages` is set on the line-level
 * path, where images still have to be found and turned into stops.
 */
function resolveInlineLinks(text: string, keepImages = false): string {
  const withoutImages = keepImages
    ? text
    : text
        .replace(/!\[\[[^\]]*\]\]/g, ' ')
        .replace(/!\[(?:[^\]]|\](?!\())*\]\([^)]*\)/g, ' ');

  return withoutImages
    // `(?<!!)` keeps these from biting the `[alt](src)` tail of an image.
    .replace(/(?<!!)\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1')
    .replace(/(?<!!)\[\[([^\]]+)\]\]/g, (_match, target: string) => lastPathSegment(target))
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/(?<!!)\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** Emphasis, inline HTML, and escapes — everything except link structure. */
function stripInlineDecoration(text: string): string {
  return text
    .replace(/<[^<>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\*\*\*|\*\*|\*|~~|==/g, '')
    // Only strip `_` when it wraps a run, so snake_case identifiers survive.
    .replace(/(^|[\s(])__?([^_]+)__?(?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!$])/g, '$1');
}

function cleanInlineMarkdown(text: string): string {
  return stripInlineDecoration(resolveInlineLinks(text));
}

/**
 * A token with neither a letter nor a digit — a stray dash between clauses, a
 * table pipe, an OCR artefact — reads as nothing. Skip it rather than burn a
 * frame on it.
 */
function isReadable(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

/**
 * Atomic spans are deliberately delimited, so a maths glyph carries meaning on
 * its own where the same character would be noise in prose.
 */
function isReadableAtomic(token: string): boolean {
  return /[\p{L}\p{N}·×÷±∓≤≥≠≈≡∼∝≪≫→←⇒↦∈∉⊂⊆∪∩∞∂∇°′]/u.test(token);
}

/** Links are already resolved by the caller, so only decoration is left. */
function pushPlainWords(target: FastReadWord[], text: string, heading: boolean): void {
  for (const token of stripInlineDecoration(text).split(/\s+/)) {
    if (token && isReadable(token)) target.push({ text: token, atomic: false, heading });
  }
}

// Backtick code, LaTeX `\(…\)`, then `$…$`. The first two are unambiguous; only
// the dollar form needs a sanity check.
const ATOMIC_SPAN_RE = /`([^`\n]+)`|\\\((.+?)\\\)|\$([^$\n]+)\$/g;

/**
 * Turn already-link-resolved prose into words. Inline code and inline math that
 * reads as text become single atomic words so they are not broken across frames.
 *
 * Math that needs typesetting has normally been pulled out as a stop before this
 * runs. It survives here only where there is no stop to pull it into — a heading
 * — and stays atomic in that case.
 */
function wordsFromResolved(resolved: string, heading: boolean): FastReadWord[] {
  const words: FastReadWord[] = [];
  ATOMIC_SPAN_RE.lastIndex = 0;
  let cursor = 0;

  for (let match = ATOMIC_SPAN_RE.exec(resolved); match; match = ATOMIC_SPAN_RE.exec(resolved)) {
    const code = match[1];
    const math = match[2] ?? match[3];

    if (match[3] !== undefined && !looksLikeMath(match[3])) continue;

    // Code is shown verbatim; maths is shown as its readable plain form, so the
    // stream never displays raw LaTeX source.
    const inner = code !== undefined ? code.trim() : mathToPlainText(math ?? '');

    pushPlainWords(words, resolved.slice(cursor, match.index), heading);
    cursor = match.index + match[0].length;

    // Absorb punctuation that trails the span, so a sentence ending on `$…$`
    // still earns its full stop pause instead of dropping the mark entirely.
    const trailing = resolved.slice(cursor).match(/^[.,;:!?)\]]+/)?.[0] ?? '';
    cursor += trailing.length;

    if (isReadableAtomic(inner)) words.push({ text: inner + trailing, atomic: true, heading });
  }

  pushPlainWords(words, resolved.slice(cursor), heading);
  return words;
}

/** Turn one line of prose into words, resolving link syntax first. */
export function inlineToWords(line: string, heading = false): FastReadWord[] {
  return wordsFromResolved(resolveInlineLinks(line), heading);
}

/* -------------------------------------------------------------------------- */
/* Block segmentation                                                          */
/* -------------------------------------------------------------------------- */

function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return match ? markdown.slice(match[0].length) : markdown;
}

/** Remove list markers, blockquote arrows, and callout headers from a line. */
function stripLinePrefix(line: string): string {
  let result = line;
  let previous: string;

  do {
    previous = result;
    result = result.replace(/^\s{0,3}>\s?/, '');
  } while (result !== previous);

  return result
    .replace(/^\s*([-*+]|\d{1,9}[.)])\s+/, '')
    .replace(/^\s*\[[ xX]\]\s+/, '')
    .replace(/^\[![a-zA-Z]+\][+-]?\s*/, '');
}

function isBlank(line: string): boolean {
  return !line.trim();
}

function isThematicBreak(line: string): boolean {
  return /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line);
}

function isTableDelimiter(line: string): boolean {
  const compact = line.replace(/\s/g, '');
  if (!compact.includes('-')) return false;
  return /^\|?(:?-+:?\|)*:?-+:?\|?$/.test(compact);
}

function languageLabel(lang: string): string {
  const key = lang.toLowerCase();
  if (LANGUAGE_LABELS[key]) return LANGUAGE_LABELS[key];
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function visualIdFromSpec(spec: string): string | undefined {
  return spec.match(/^\s*id:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1]?.trim() || undefined;
}

// Alt text may itself contain brackets ("Figure 90: … [2]"), so a `]` only ends
// it when `(` follows. The source URL may be empty — PDF-extracted figures often
// keep the caption and drop the file. Those are still stops; the reader then
// shows the caption on its own.
const IMAGE_RE =
  /!\[((?:[^\]]|\](?!\())*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)|!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

interface Builder {
  segments: FastReadSegment[];
  pending: FastReadWord[];
  sectionTitle: string;
}

function flushText(builder: Builder): void {
  if (!builder.pending.length) return;
  builder.segments.push({
    kind: 'text',
    words: builder.pending,
    sectionTitle: builder.sectionTitle,
  });
  builder.pending = [];
}

function pushStop(builder: Builder, stop: Omit<FastReadStopSegment, 'sectionTitle'>): void {
  flushText(builder);
  builder.segments.push({ ...stop, sectionTitle: builder.sectionTitle });
}

// Images and inline math, matched in one pass so they stay in document order.
// Backtick spans are matched only to be skipped — code may contain `$` or `![`
// that must not be read as markup.
const INLINE_SPAN_RE = new RegExp(
  `${IMAGE_RE.source}|(\`[^\`\\n]+\`)|\\\\\\((.+?)\\\\\\)|\\$([^$\\n]+)\\$`,
  'g',
);

/**
 * Scan a prose line for the things that interrupt reading: images, and math that
 * has to be typeset to be legible. Text on either side keeps flowing, so a stop
 * lands exactly where it appears mid-sentence.
 */
function addLineContent(builder: Builder, line: string): void {
  // Links first: a wikilink label can contain inline math that must not be
  // mistaken for a standalone span. Images are kept for the scan below.
  const resolved = resolveInlineLinks(line, true);
  const flushBetween = (text: string) => {
    if (text.trim()) builder.pending.push(...wordsFromResolved(text, false));
  };

  let cursor = 0;
  INLINE_SPAN_RE.lastIndex = 0;

  for (let match = INLINE_SPAN_RE.exec(resolved); match; match = INLINE_SPAN_RE.exec(resolved)) {
    const [whole, mdAlt, mdSrc, wikiSrc, wikiAlt, code, latexMath, dollarMath] = match;

    // Inline code, and math that reads fine as text, stay in the word stream.
    if (code !== undefined) continue;
    const math = latexMath ?? dollarMath;
    if (math !== undefined) {
      if (dollarMath !== undefined && !looksLikeMath(dollarMath)) continue;
      if (!needsTypesetting(math)) continue;

      flushBetween(resolved.slice(cursor, match.index));
      pushStop(builder, {
        kind: 'math',
        label: 'Expression',
        raw: `$$\n${math.trim()}\n$$`,
      });
      cursor = match.index + whole.length;
      continue;
    }

    flushBetween(resolved.slice(cursor, match.index));
    pushStop(builder, {
      kind: 'image',
      label: 'Image',
      raw: whole,
      src: (mdSrc ?? wikiSrc ?? '').trim(),
      alt: (mdAlt || wikiAlt || '').trim(),
    });
    cursor = match.index + whole.length;
  }

  flushBetween(resolved.slice(cursor));
}

/**
 * Segment a note's markdown into the FastRead timeline.
 *
 * Frontmatter, HTML comments, and thematic breaks are dropped outright — they
 * are neither read nor looked at.
 */
export function parseFastReadDocument(markdown: string): FastReadDocument {
  const builder: Builder = { segments: [], pending: [], sectionTitle: '' };
  const lines = stripFrontmatter(markdown ?? '').split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (isBlank(line) || isThematicBreak(line)) {
      index += 1;
      continue;
    }

    // HTML comments carry generator bookkeeping and are invisible on the page.
    if (/^\s*<!--/.test(line)) {
      while (index < lines.length && !lines[index].includes('-->')) index += 1;
      index += 1;
      continue;
    }

    const fence = line.match(/^\s{0,3}(```+|~~~+)\s*([^\s`]*)/);
    if (fence) {
      const [, marker, info] = fence;
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const closing = lines[index].match(/^\s{0,3}(```+|~~~+)\s*$/);
        if (closing && closing[1][0] === marker[0] && closing[1].length >= marker.length) {
          index += 1;
          break;
        }
        body.push(lines[index]);
        index += 1;
      }

      const lang = (info || '').toLowerCase();
      const spec = body.join('\n');
      const raw = `${marker}${info}\n${spec}\n${marker}`;

      if (VISUAL_BLOCK_LANGS.has(lang)) {
        pushStop(builder, {
          kind: 'visualizer',
          label: 'Interactive visual',
          raw,
          lang,
          visualId: visualIdFromSpec(spec),
        });
      } else if (MATH_LANGS.has(lang)) {
        // A ```math fence is display maths, not source to read as code.
        pushStop(builder, { kind: 'math', label: 'Equation', raw: `$$\n${spec.trim()}\n$$`, lang });
      } else if (DIAGRAM_LANGS.has(lang)) {
        pushStop(builder, { kind: 'visualizer', label: 'Diagram', raw, lang });
      } else {
        pushStop(builder, {
          kind: 'code',
          label: lang && !PLAIN_LANGS.has(lang) ? `${languageLabel(lang)} code` : 'Code',
          raw,
          lang,
        });
      }
      continue;
    }

    // Display math, written either as `$$ … $$` or LaTeX `\[ … \]`, on one line
    // or spanning several.
    const displayMath = line.match(/^\s{0,3}(\$\$|\\\[)/);
    if (displayMath) {
      const [open, close] = displayMath[1] === '$$' ? ['$$', '$$'] : ['\\[', '\\]'];
      const trimmed = line.trim();
      const single =
        trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length > open.length + close.length
          ? trimmed.slice(open.length, -close.length).trim()
          : '';

      if (single) {
        pushStop(builder, { kind: 'math', label: 'Equation', raw: `$$\n${single}\n$$` });
        index += 1;
        continue;
      }

      const body: string[] = [trimmed.slice(open.length)];
      index += 1;
      while (index < lines.length) {
        const current = lines[index];
        index += 1;
        if (current.includes(close)) {
          body.push(current.slice(0, current.indexOf(close)));
          break;
        }
        body.push(current);
      }
      pushStop(builder, {
        kind: 'math',
        label: 'Equation',
        raw: `$$\n${body.join('\n').trim()}\n$$`,
      });
      continue;
    }

    const environment = line.match(/^\s{0,3}\\begin\{([^}]+)\}/);
    if (environment && MATH_ENVIRONMENTS.has(environment[1])) {
      const closing = `\\end{${environment[1]}}`;
      const body: string[] = [];
      while (index < lines.length) {
        body.push(lines[index]);
        const done = lines[index].includes(closing);
        index += 1;
        if (done) break;
      }
      pushStop(builder, { kind: 'math', label: 'Equation', raw: `$$\n${body.join('\n')}\n$$` });
      continue;
    }

    const htmlTag = line.match(/^\s{0,3}<([a-zA-Z][a-zA-Z0-9-]*)/);
    if (htmlTag) {
      const tag = htmlTag[1].toLowerCase();
      if (tag === 'img') {
        const src = line.match(/\bsrc\s*=\s*["']([^"']+)["']/)?.[1] ?? '';
        const alt = line.match(/\balt\s*=\s*["']([^"']*)["']/)?.[1] ?? '';
        pushStop(builder, { kind: 'image', label: 'Image', raw: line.trim(), src, alt });
        index += 1;
        continue;
      }

      if (EMBED_TAGS.has(tag)) {
        const closing = `</${tag}`;
        const body: string[] = [];
        while (index < lines.length) {
          body.push(lines[index]);
          const done = lines[index].includes(closing) || isBlank(lines[index]);
          index += 1;
          if (done) break;
        }
        pushStop(builder, {
          kind: tag === 'table' ? 'table' : 'embed',
          label: tag === 'table' ? 'Table' : 'Embedded media',
          raw: body.join('\n').trim(),
        });
        continue;
      }
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const body: string[] = [];
      while (index < lines.length && lines[index].includes('|') && !isBlank(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      pushStop(builder, { kind: 'table', label: 'Table', raw: body.join('\n') });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      const title = cleanInlineMarkdown(heading[2]).trim();
      flushText(builder);
      builder.sectionTitle = title;
      builder.pending.push(...inlineToWords(heading[2], true));
      index += 1;
      continue;
    }

    addLineContent(builder, stripLinePrefix(line));
    index += 1;
  }

  flushText(builder);

  let totalWords = 0;
  let stopCount = 0;
  for (const segment of builder.segments) {
    if (segment.kind === 'text') totalWords += segment.words.length;
    else stopCount += 1;
  }

  return { segments: builder.segments, totalWords, stopCount };
}

/* -------------------------------------------------------------------------- */
/* Playback helpers                                                            */
/* -------------------------------------------------------------------------- */

export interface FastReadCursor {
  segmentIndex: number;
  wordIndex: number;
}

/**
 * The outcome of one forward step. `stop` is the case the whole feature exists
 * for: the next thing in the document is not reading material, so the caller
 * must pause and wait for the reader to continue.
 */
export type FastReadStep =
  | { type: 'word'; cursor: FastReadCursor }
  | { type: 'text'; cursor: FastReadCursor }
  | { type: 'stop'; cursor: FastReadCursor }
  | { type: 'end' };

/** Advance one word, reporting whether that crossed into a stop or ran out. */
export function stepForward(segments: FastReadSegment[], cursor: FastReadCursor): FastReadStep {
  const active = segments[cursor.segmentIndex];
  if (!active) return { type: 'end' };

  if (active.kind === 'text' && cursor.wordIndex + 1 < active.words.length) {
    return {
      type: 'word',
      cursor: { segmentIndex: cursor.segmentIndex, wordIndex: cursor.wordIndex + 1 },
    };
  }

  const next = cursor.segmentIndex + 1;
  if (next >= segments.length) return { type: 'end' };

  return {
    type: segments[next].kind === 'text' ? 'text' : 'stop',
    cursor: { segmentIndex: next, wordIndex: 0 },
  };
}

/** Step back one word, or `null` at the very start of the document. */
export function stepBackward(
  segments: FastReadSegment[],
  cursor: FastReadCursor,
): FastReadCursor | null {
  if (cursor.wordIndex > 0) {
    return { segmentIndex: cursor.segmentIndex, wordIndex: cursor.wordIndex - 1 };
  }

  const previous = cursor.segmentIndex - 1;
  const target = segments[previous];
  if (!target) return null;

  return {
    segmentIndex: previous,
    wordIndex: target.kind === 'text' ? Math.max(0, target.words.length - 1) : 0,
  };
}

/** Words completed before each segment, so progress spans the whole document. */
export function wordOffsets(segments: FastReadSegment[]): number[] {
  const offsets: number[] = [];
  let total = 0;
  for (const segment of segments) {
    offsets.push(total);
    if (segment.kind === 'text') total += segment.words.length;
  }
  return offsets;
}

/**
 * Resolve a note-relative asset path against the garden origin. Absolute URLs
 * and data URIs are left alone.
 */
export function resolveAssetUrl(src: string, baseUrl: string): string {
  const trimmed = (src ?? '').trim();
  if (!trimmed) return '';
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) return trimmed;
  if (!baseUrl) return trimmed;

  try {
    return new URL(trimmed.replace(/^\.\//, ''), `${baseUrl.replace(/\/+$/, '')}/`).toString();
  } catch {
    return trimmed;
  }
}
