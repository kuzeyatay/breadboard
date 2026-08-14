// Layer A, in TypeScript, so it can run on every string Breadboard emits.
//
// This is a deliberate port of `text_unicode.py` from the vendored
// watermarks-remover checkout, not an approximation of it. The Python is the
// specification; `tests/scrub-parity.test.mjs` runs both over a corpus of
// awkward strings and asserts byte-identical output, so a drift between them is
// a failing test rather than a silent difference in what users receive.
//
// Why a port at all, when the scripts already exist: a subprocess costs several
// hundred milliseconds of interpreter startup, and this runs on every assistant
// message and every text artifact. Files keep using the Python — see
// `scrub-file.ts`, where the cost is paid once per file and the formats are
// ones no short port could handle honestly.
//
// The subtle half is what is *kept*. A zero-width joiner is an invisible
// carrier when it floats free and load-bearing when it sits between two emoji
// (👨‍👩‍👧) or inside Persian and Devanagari words. Stripping every invisible
// would visibly corrupt real writing, so the decision is contextual: it depends
// on the previous surviving character.

/**
 * Whether automatic scrubbing is on. `BREADBOARD_SCRUB_OUTPUT=0` turns it off
 * everywhere at once — the switch to reach for if a scrub is ever suspected of
 * damaging output, without having to unpick the call sites.
 *
 * It lives here rather than beside the file scrubber so the text paths can read
 * it without pulling `child_process` into their import graph.
 */
export function scrubEnabled(env?: NodeJS.ProcessEnv): boolean {
  // This module is imported by the browser bundle too, where `process` may not
  // exist and a non-public variable is never inlined. There the answer is
  // always "on", which matches the default and matches what the server stored.
  const source = env ?? (typeof process === "undefined" ? undefined : process.env);
  const configured = source?.BREADBOARD_SCRUB_OUTPUT?.trim().toLowerCase();
  return configured !== "0" && configured !== "false" && configured !== "off";
}

/** Format and invisible controls used as steganographic carriers. */
const STRIP_CODEPOINTS = new Set<number>([
  0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5,
  0x180b, 0x180c, 0x180d, 0x180e,
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
  0x2066, 0x2067, 0x2068, 0x2069,
  0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f,
  0xfeff,
  0xfe00, 0xfe01, 0xfe02, 0xfe03, 0xfe04, 0xfe05, 0xfe06, 0xfe07,
  0xfe08, 0xfe09, 0xfe0a, 0xfe0b, 0xfe0c, 0xfe0d, 0xfe0e, 0xfe0f,
  0xfff9, 0xfffa, 0xfffb,
]);

/** Spaces that look like, or stand in for, U+0020. */
const SPACE_HOMOGLYPHS = new Map<number, string>([
  [0x00a0, " "], [0x1680, " "], [0x2000, " "], [0x2001, " "], [0x2002, " "],
  [0x2003, " "], [0x2004, " "], [0x2005, " "], [0x2006, " "], [0x2007, " "],
  [0x2008, " "], [0x2009, " "], [0x200a, " "], [0x202f, " "], [0x205f, " "],
  [0x3000, " "],
]);

/** Variation selectors VS17–VS256. */
const VS_SUPPLEMENT_START = 0xe0100;
const VS_SUPPLEMENT_END = 0xe01f0; // exclusive, matching Python's range()

/** Tag characters, used by some stego schemes and by flag emoji. */
const TAG_START = 0xe0001;
const TAG_END = 0xe007f; // inclusive

/** The tag subrange that is part of a flag sequence rather than a carrier. */
const FLAG_TAG_START = 0xe0020;
const FLAG_TAG_END = 0xe0080; // exclusive, matching Python's range()

/** Zero-width joiner and the two presentation selectors. */
const EMOJI_GLUE = new Set<number>([0x200d, 0xfe0e, 0xfe0f]);

/** ZWNJ and ZWJ, which are orthographic inside complex scripts. */
const SCRIPT_JOINERS = new Set<number>([0x200c, 0x200d]);

/** Cf codepoints that are ordinary Arabic and Syriac orthography. */
const ORTHOGRAPHIC_CF = new Set<number>([
  0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605,
  0x06dd, 0x070f, 0x08e2, 0x110bd, 0x110cd,
]);

const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const FORMAT_CHAR = /\p{Cf}/u;

function isStripCodepoint(cp: number): boolean {
  if (STRIP_CODEPOINTS.has(cp)) return true;
  if (cp >= VS_SUPPLEMENT_START && cp < VS_SUPPLEMENT_END) return true;
  return cp >= TAG_START && cp <= TAG_END;
}

/** Characters that can start or continue an emoji sequence. */
function isEmojiBase(cp: number): boolean {
  if (cp >= 0x1f000 && cp <= 0x1faff) return true;
  if (cp >= 0x2600 && cp <= 0x27bf) return true;
  if (cp >= 0x2b00 && cp <= 0x2bff) return true;
  if (cp === 0x00a9 || cp === 0x00ae || cp === 0x2122) return true;
  if (cp === 0x3030 || cp === 0x303d || cp === 0x3297 || cp === 0x3299) return true;
  // Keycap bases: '#', '*' and the digits.
  return cp === 0x0023 || cp === 0x002a || (cp >= 0x0030 && cp <= 0x0039);
}

/** The neighbour that makes a joiner orthographic rather than a carrier. */
function isJoiningLetter(ch: string): boolean {
  return ch.codePointAt(0)! > 0x7f && LETTER_OR_MARK.test(ch);
}

/** Emoji glue, script joiner or flag tag: invisible, but load-bearing. */
function isGlue(cp: number): boolean {
  return (
    EMOJI_GLUE.has(cp) ||
    SCRIPT_JOINERS.has(cp) ||
    (cp >= FLAG_TAG_START && cp < FLAG_TAG_END)
  );
}

export interface ScrubTextOptions {
  /** Fold exotic spaces to U+0020. On by default, as upstream. */
  normalizeSpaces?: boolean;
  /**
   * Also fold Cyrillic and fullwidth lookalikes to ASCII. Off by default and
   * left off everywhere in the automatic paths: it rewrites *visible*
   * characters, so a Russian word would quietly become mojibake.
   */
  aggressiveHomoglyphs?: boolean;
  /** Strip emoji glue and script joiners too. Off; this corrupts real text. */
  stripEmojiGlue?: boolean;
}

export interface ScrubTextResult {
  text: string;
  removed: number;
  replaced: number;
  get changed(): boolean;
}

/**
 * Cyrillic and fullwidth Latin lookalikes. Only consulted under
 * `aggressiveHomoglyphs`, which nothing automatic turns on.
 */
const LATIN_CONFUSABLES = new Map<number, string>([
  [0x0410, "A"], [0x0412, "B"], [0x0415, "E"], [0x041a, "K"], [0x041c, "M"],
  [0x041d, "H"], [0x041e, "O"], [0x0420, "P"], [0x0421, "C"], [0x0422, "T"],
  [0x0425, "X"], [0x0430, "a"], [0x0435, "e"], [0x043e, "o"], [0x0440, "p"],
  [0x0441, "c"], [0x0443, "y"], [0x0445, "x"], [0x0456, "i"],
  ...Array.from({ length: 26 }, (_, index): [number, string] => [
    0xff21 + index,
    String.fromCharCode(0x41 + index),
  ]),
  ...Array.from({ length: 26 }, (_, index): [number, string] => [
    0xff41 + index,
    String.fromCharCode(0x61 + index),
  ]),
]);

/**
 * Remove invisible-Unicode marks from one string.
 *
 * Pure, synchronous and allocation-light: the common case is a string with
 * nothing to remove, and that path returns the original reference.
 */
export function scrubText(text: string, options: ScrubTextOptions = {}): ScrubTextResult {
  const normalizeSpaces = options.normalizeSpaces !== false;
  const aggressiveHomoglyphs = options.aggressiveHomoglyphs === true;
  const stripEmojiGlue = options.stripEmojiGlue === true;

  let out = "";
  let removed = 0;
  let replaced = 0;
  // The previous *surviving* character, which is what decides whether an
  // invisible is glue or a carrier. Glue does not advance it, so ZWJ chains
  // (❤️‍🔥) and flag runs stay bound to their base.
  let previousKept: string | null = null;

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;

    if (!stripEmojiGlue) {
      if (EMOJI_GLUE.has(cp) && previousKept !== null && isEmojiBase(previousKept.codePointAt(0)!)) {
        out += ch;
        continue;
      }
      if (SCRIPT_JOINERS.has(cp) && previousKept !== null && isJoiningLetter(previousKept)) {
        out += ch;
        continue;
      }
      if (cp >= FLAG_TAG_START && cp < FLAG_TAG_END && previousKept !== null && isEmojiBase(previousKept.codePointAt(0)!)) {
        out += ch;
        continue;
      }
      if (ORTHOGRAPHIC_CF.has(cp)) {
        out += ch;
        previousKept = isGlue(cp) ? previousKept : ch;
        continue;
      }
    }

    if (isStripCodepoint(cp)) {
      removed += 1;
      continue;
    }

    const space = normalizeSpaces ? SPACE_HOMOGLYPHS.get(cp) : undefined;
    if (space !== undefined) {
      out += space;
      replaced += 1;
      previousKept = space;
      continue;
    }

    const confusable = aggressiveHomoglyphs ? LATIN_CONFUSABLES.get(cp) : undefined;
    if (confusable !== undefined) {
      out += confusable;
      replaced += 1;
      previousKept = confusable;
      continue;
    }

    if (FORMAT_CHAR.test(ch) && !SPACE_HOMOGLYPHS.has(cp)) {
      removed += 1;
      continue;
    }

    out += ch;
    if (!isGlue(cp)) previousKept = ch;
  }

  return {
    text: removed === 0 && replaced === 0 ? text : out,
    removed,
    replaced,
    get changed() {
      return this.removed > 0 || this.replaced > 0;
    },
  };
}

/**
 * The form the output paths use: a string in, a clean string out.
 *
 * The kill switch is checked *here* rather than at each call site. Every
 * seam this is wired into was chosen because producers funnel through it
 * without knowing they do, and a switch each call site had to remember would
 * reintroduce exactly the per-producer forgetting the seams exist to prevent.
 *
 * A non-string degrades to a pass-through instead of throwing: this runs in the
 * middle of delivering an answer, and a type that slipped through a boundary
 * should not be what loses somebody their reply.
 */
export function scrubbed(text: string, options?: ScrubTextOptions): string {
  if (typeof text !== "string" || text.length === 0) return text;
  if (!scrubEnabled()) return text;
  return scrubText(text, options).text;
}
