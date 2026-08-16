// Invisible-Unicode detection, ported from `scripts/scan.py` in
// wppoland/hidden-text-detector (MIT). The Python is the specification: the
// character sets, the run thresholds, the severity of each rule and the
// Unicode-tag decoder are transcribed from it rather than reinvented, and
// `tests/document-safety.test.mjs` pins the thresholds so a future edit that
// loosens one is a failing test.
//
// Two deliberate deviations from upstream:
//
//  1. Characters are written as codepoints, not literals. Upstream's tables
//     contain the invisible characters themselves, which is unreadable in a
//     diff and lost the moment an editor normalises the file.
//  2. Iteration is by codepoint (`for…of`), not by UTF-16 unit. The Unicode
//     Tags block lives above the BMP, so a `charCodeAt` loop would see two
//     surrogates and match nothing — the single most important range would
//     silently never fire.
//
// This is detection only. `lib/watermarks/scrub-text.ts` is the *removal* side
// of the same problem and shares none of this code on purpose: it decides
// contextually whether an invisible is a carrier or load-bearing orthography,
// because it rewrites text people will read. Here nothing is rewritten, so the
// question is only "is a payload plausibly present", and the answer is allowed
// to be blunter.

import type { SafetyFinding } from "./types.ts";

/**
 * Characters that occupy no visible space, or none of their own. A few appear
 * legitimately (a soft hyphen in justified text, a stray BOM), so upstream
 * reports a *run* rather than any single occurrence.
 */
const INVISIBLE_CHARS = new Map<number, string>([
  [0x200b, "ZERO WIDTH SPACE"],
  [0x200c, "ZERO WIDTH NON-JOINER"],
  [0x200d, "ZERO WIDTH JOINER"],
  [0x2060, "WORD JOINER"],
  [0xfeff, "ZERO WIDTH NO-BREAK SPACE (BOM)"],
  [0x00ad, "SOFT HYPHEN"],
  [0x034f, "COMBINING GRAPHEME JOINER"],
  [0x180e, "MONGOLIAN VOWEL SEPARATOR"],
  [0x2061, "FUNCTION APPLICATION"],
  [0x2062, "INVISIBLE TIMES"],
  [0x2063, "INVISIBLE SEPARATOR"],
  [0x2064, "INVISIBLE PLUS"],
  [0x2800, "BRAILLE PATTERN BLANK"],
  [0x3164, "HANGUL FILLER"],
  [0x115f, "HANGUL CHOSEONG FILLER"],
  [0x1160, "HANGUL JUNGSEONG FILLER"],
  [0xffa0, "HALFWIDTH HANGUL FILLER"],
  [0x17b4, "KHMER VOWEL INHERENT AQ"],
  [0x17b5, "KHMER VOWEL INHERENT AA"],
]);

/** The run length at which an invisible character stops looking accidental. */
const INVISIBLE_RUN_THRESHOLD = 8;

/**
 * Bidirectional controls can reverse the displayed order of characters, so
 * what is read is not what the file stores.
 */
const BIDI_CHARS = new Map<number, string>([
  [0x200e, "LEFT-TO-RIGHT MARK"],
  [0x200f, "RIGHT-TO-LEFT MARK"],
  [0x202a, "LEFT-TO-RIGHT EMBEDDING"],
  [0x202b, "RIGHT-TO-LEFT EMBEDDING"],
  [0x202c, "POP DIRECTIONAL FORMATTING"],
  [0x202d, "LEFT-TO-RIGHT OVERRIDE"],
  [0x202e, "RIGHT-TO-LEFT OVERRIDE"],
  [0x2066, "LEFT-TO-RIGHT ISOLATE"],
  [0x2067, "RIGHT-TO-LEFT ISOLATE"],
  [0x2068, "FIRST STRONG ISOLATE"],
  [0x2069, "POP DIRECTIONAL ISOLATE"],
]);

/** Deprecated format characters have no legitimate modern use at all. */
const DEPRECATED_FORMAT = new Map<number, string>([
  [0x206a, "INHIBIT SYMMETRIC SWAPPING"],
  [0x206b, "ACTIVATE SYMMETRIC SWAPPING"],
  [0x206c, "INHIBIT ARABIC FORM SHAPING"],
  [0x206d, "ACTIVATE ARABIC FORM SHAPING"],
  [0x206e, "NATIONAL DIGIT SHAPES"],
  [0x206f, "NOMINAL DIGIT SHAPES"],
]);

interface InvisibleRange {
  first: number;
  last: number;
  label: string;
  /** How many characters from the range it takes before this is reported. */
  threshold: number;
}

/**
 * Ranges whose members carry no glyph of their own and can therefore encode a
 * payload.
 *
 * Variation selectors are the notable one. They exist to pick between glyph
 * forms, so a lone selector after an emoji is ordinary — a run of them is a
 * known smuggling channel, and each selector can carry a byte.
 */
const INVISIBLE_RANGES: InvisibleRange[] = [
  { first: 0xe0000, last: 0xe007f, label: "Unicode tag characters", threshold: 1 },
  { first: 0xfe00, last: 0xfe0f, label: "variation selectors", threshold: 8 },
  {
    first: 0xe0100,
    last: 0xe01ef,
    label: "variation selectors supplement",
    threshold: 8,
  },
  { first: 0x180b, last: 0x180d, label: "Mongolian variation selectors", threshold: 4 },
  { first: 0x206a, last: 0x206f, label: "deprecated format characters", threshold: 1 },
];

function hex(codepoint: number): string {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Python's `repr` of a string, near enough for quoting evidence in a report. */
export function quote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Decode the Unicode Tags block (U+E0000–U+E007F) back to ASCII.
 *
 * This block renders as nothing at all in every viewer, yet language models
 * routinely read it. It is the classic carrier for hidden instructions, and
 * decoding it is what turns "there are 47 invisible characters" into a
 * sentence somebody can act on.
 */
export function decodeUnicodeTags(text: string): string {
  let decoded = "";
  for (const character of text) {
    const codepoint = character.codePointAt(0)!;
    if (codepoint >= 0xe0020 && codepoint <= 0xe007e) {
      decoded += String.fromCodePoint(codepoint - 0xe0000);
    }
  }
  return decoded;
}

/** Count codepoints, so characters above the BMP are counted once, not twice. */
function countCodepoints(text: string, predicate: (codepoint: number) => boolean): number {
  let count = 0;
  for (const character of text) {
    if (predicate(character.codePointAt(0)!)) count += 1;
  }
  return count;
}

/**
 * Scan one string for invisible-Unicode carriers.
 *
 * `where` is echoed into every finding, so the caller decides the granularity:
 * a PDF passes "page 4", a .docx passes both "document body" and each raw XML
 * part, because headers, footers, fields and comments never reach the document
 * model that produced the body text.
 */
export function scanUnicode(text: string, where: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  if (!text) return findings;

  for (const range of INVISIBLE_RANGES) {
    const hits = countCodepoints(
      text,
      (codepoint) => codepoint >= range.first && codepoint <= range.last,
    );
    if (hits < range.threshold) continue;

    let detail =
      `${hits} character${hits === 1 ? "" : "s"} from ${hex(range.first)}-${hex(range.last)}. ` +
      "These carry no glyph of their own, survive copy-paste, and are read by language models.";
    const decoded = decodeUnicodeTags(text);
    if (decoded) detail += ` Decoded content: ${quote(decoded.slice(0, 400))}`;

    findings.push({
      severity: "critical",
      type: `Invisible ${range.label}`,
      where,
      detail,
    });
  }

  for (const [codepoint, name] of INVISIBLE_CHARS) {
    const count = countCodepoints(text, (candidate) => candidate === codepoint);
    // A stray BOM or a soft hyphen in justified text is normal. A run is not.
    if (count < INVISIBLE_RUN_THRESHOLD) continue;
    findings.push({
      severity: "warning",
      type: `Concentration of invisible characters (${name})`,
      where,
      detail: `${count} occurrences. May encode hidden content or defeat text filters.`,
    });
  }

  for (const [codepoint, name] of BIDI_CHARS) {
    const count = countCodepoints(text, (candidate) => candidate === codepoint);
    if (count === 0) continue;
    findings.push({
      severity: "warning",
      type: `Bidirectional control character (${name})`,
      where,
      detail:
        `${count} occurrences. Can reverse the displayed order of text relative ` +
        "to what the file stores.",
    });
  }

  for (const [codepoint, name] of DEPRECATED_FORMAT) {
    const count = countCodepoints(text, (candidate) => candidate === codepoint);
    if (count === 0) continue;
    findings.push({
      severity: "warning",
      type: `Deprecated format character (${name})`,
      where,
      detail: `${count} occurrences. No legitimate modern use.`,
    });
  }

  return findings;
}

/**
 * The invisible text itself, recovered so the injection layer can read it.
 *
 * Only the Tags block decodes back to something meaningful — the other ranges
 * carry bits, not characters, and guessing at their encoding would invent
 * content. So this returns the decoded tag payload and nothing else.
 */
export function recoverHiddenUnicodeText(text: string): string {
  return decodeUnicodeTags(text);
}
