// NEW for Breadboard (not vendored from sim): a regex-only PII detector/masker
// with the same shape sim's Presidio-backed `validate_pii.ts` exposes —
// `entityTypes` + `customPatterns` in, `<ENTITY_TYPE>`-style tokens out — so a
// future Presidio sidecar (see PLAN.md's guardrails note) can replace this
// module's internals without the caller (./service.ts, the outbound-message
// wrap points) changing at all.
//
// Coverage is deliberately narrow: the entities a regex + checksum can catch
// with low false-positive risk (email, phone, credit card + Luhn, IBAN + mod-97,
// IP address, US SSN) plus user-supplied custom patterns. Presidio's spaCy-NER
// entities (PERSON, LOCATION, ORGANIZATION, ...) need a real model and are out
// of scope here — see pii-entities.ts's `NER_PII_ENTITIES` for the boundary.
//
// Custom patterns compile through ./linear-regex.ts, which is a same-interface
// stand-in for sim's RE2-backed `compileLinearRegex` — see that file's header
// for why it is NOT a ReDoS guarantee on Breadboard.

import { compileLinearRegex } from "./linear-regex.ts";
import type { CustomPiiPattern } from "./pii-entities.ts";

/** The subset of `SUPPORTED_PII_ENTITIES` this module can actually detect. */
export type LocalPiiEntityType =
  | "EMAIL_ADDRESS"
  | "PHONE_NUMBER"
  | "CREDIT_CARD"
  | "IBAN_CODE"
  | "IP_ADDRESS"
  | "US_SSN";

export const LOCAL_PII_ENTITY_TYPES: readonly LocalPiiEntityType[] = [
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "CREDIT_CARD",
  "IBAN_CODE",
  "IP_ADDRESS",
  "US_SSN",
];

export interface PiiFinding {
  /** A `LocalPiiEntityType`, or a custom pattern's `replacement` (or `name`) when neither built-in type matched. */
  type: string;
  start: number;
  end: number;
  text: string;
}

export interface LocalPiiOptions {
  /** Which built-in entity types to look for. Omitted/empty = all of {@link LOCAL_PII_ENTITY_TYPES}. */
  entityTypes?: readonly LocalPiiEntityType[];
  /** Always applied in addition to `entityTypes` — never gated by it. */
  customPatterns?: readonly CustomPiiPattern[];
}

export interface MaskPiiResult {
  masked: string;
  findings: PiiFinding[];
}

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48; // '0'
    if (n < 0 || n > 9) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** ISO 7064 mod-97-10, the standard IBAN checksum. */
function ibanMod97Check(compactIban: string): boolean {
  const rearranged = compactIban.slice(4) + compactIban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    let value: number;
    if (ch >= "0" && ch <= "9") {
      value = ch.charCodeAt(0) - 48;
    } else if (ch >= "A" && ch <= "Z") {
      value = ch.charCodeAt(0) - 55; // 'A' -> 10 ... 'Z' -> 35
    } else {
      return false;
    }
    // Fold digit-by-digit (and two-digit letter values) to avoid bigint/overflow.
    for (const digitChar of String(value)) {
      remainder = (remainder * 10 + (digitChar.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

// ---------------------------------------------------------------------------
// Built-in detectors — each returns candidate spans; callers apply checksum
// filters and URL exclusion before treating a candidate as a real finding.
// ---------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
  text: string;
}

/** Run a regex to exhaustion, guarding against zero-length-match infinite loops. */
function findAll(source: RegExp, text: string): Span[] {
  const re = new RegExp(source.source, source.flags.includes("g") ? source.flags : `${source.flags}g`);
  const out: Span[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

// Word-boundary anchored; local part and each domain label must start and end
// on a word character, so trailing punctuation ("check me@x.com.") is not
// swallowed into the match.
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;

// Two shapes only, both requiring explicit grouping — a bare run of digits
// that happens to be 10 long (an order number, a tracking id) is deliberately
// NOT a match; only "+countrycode ..." or classic 3-3-4 / 3-4 groupings are.
const PHONE_INTL_RE = /(?<![\w+])\+\d{1,3}(?:[-.\s]?\(?\d{2,4}\)?){1,5}(?!\d)/g;
const PHONE_GROUPED_RE =
  /(?<![\w-])(?:\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4}|\d{3}[-.\s]\d{4})(?![\w-])/g;

// Leading/trailing exclusions keep this from matching a slice out of a longer
// numeric id or a decimal; 13-19 total digits is the ISO/IEC 7812 range,
// narrowed further by the Luhn check applied by the caller. The dot guards are
// deliberately paired with a digit — a bare `.` next to the number is sentence
// punctuation, and excluding that misses every card ending a sentence.
const CREDIT_CARD_RE = /(?<!\d)(?<!\d\.)\d(?:[ -]?\d){12,18}(?!\d)(?!\.\d)/g;

const IBAN_RE = /\b[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}\b/g;

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
const IPV6_RE = /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b/g;

// SSA-invalid area/group/serial values excluded up front, so a phone-shaped
// "555-01-2345" typed as an example doesn't read as a real SSN either — though
// the primary discipline here is simply requiring the dashes.
const SSN_RE = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;

function detectEmail(text: string): Span[] {
  return findAll(EMAIL_RE, text);
}

function detectPhone(text: string): Span[] {
  const urls = findAll(URL_RE, text);
  const candidates = [...findAll(PHONE_INTL_RE, text), ...findAll(PHONE_GROUPED_RE, text)];
  return candidates.filter((c) => !urls.some((u) => overlaps(c, u)));
}

function detectCreditCard(text: string): Span[] {
  return findAll(CREDIT_CARD_RE, text).filter((span) => {
    const cleaned = span.text.replace(/[ -]/g, "");
    return cleaned.length >= 13 && cleaned.length <= 19 && luhnCheck(cleaned);
  });
}

function detectIban(text: string): Span[] {
  return findAll(IBAN_RE, text).filter((span) => ibanMod97Check(span.text.toUpperCase()));
}

function detectIp(text: string): Span[] {
  return [...findAll(IPV4_RE, text), ...findAll(IPV6_RE, text)];
}

function detectSsn(text: string): Span[] {
  return findAll(SSN_RE, text);
}

const BUILTIN_DETECTORS: Record<LocalPiiEntityType, (text: string) => Span[]> = {
  EMAIL_ADDRESS: detectEmail,
  PHONE_NUMBER: detectPhone,
  CREDIT_CARD: detectCreditCard,
  IBAN_CODE: detectIban,
  IP_ADDRESS: detectIp,
  US_SSN: detectSsn,
};

// ---------------------------------------------------------------------------
// Custom patterns
// ---------------------------------------------------------------------------

/** Mirrors the chunkers agent's cap on user-supplied pattern length (defense in depth). */
const MAX_CUSTOM_PATTERN_LENGTH = 500;

function detectCustom(text: string, pattern: CustomPiiPattern): Span[] {
  if (!pattern.regex || pattern.regex.length > MAX_CUSTOM_PATTERN_LENGTH) return [];
  const compiled = compileLinearRegex(pattern.regex);
  if (!compiled) return [];
  // compileLinearRegex only exposes test/find/split, not exhaustive iteration —
  // reuse a raw global RegExp here (same source string, so any syntax error
  // would already have been caught above) purely to walk every match.
  let raw: RegExp;
  try {
    raw = new RegExp(pattern.regex, "g");
  } catch {
    return [];
  }
  return findAll(raw, text);
}

function customToken(pattern: CustomPiiPattern): string {
  return (pattern.replacement || pattern.name || "CUSTOM").trim() || "CUSTOM";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Detect PII spans in `text`. Overlapping candidates resolve to the earliest, then longest, match. */
export function detectPii(text: string, opts: LocalPiiOptions = {}): PiiFinding[] {
  if (!text) return [];
  const types = opts.entityTypes && opts.entityTypes.length > 0 ? opts.entityTypes : LOCAL_PII_ENTITY_TYPES;

  const candidates: PiiFinding[] = [];
  for (const type of types) {
    const detector = BUILTIN_DETECTORS[type];
    if (!detector) continue;
    for (const span of detector(text)) {
      candidates.push({ type, start: span.start, end: span.end, text: span.text });
    }
  }
  for (const pattern of opts.customPatterns ?? []) {
    const token = customToken(pattern);
    for (const span of detectCustom(text, pattern)) {
      candidates.push({ type: token, start: span.start, end: span.end, text: span.text });
    }
  }

  candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const resolved: PiiFinding[] = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue; // dropped: overlaps an earlier, already-kept match
    resolved.push(candidate);
    cursor = candidate.end;
  }
  return resolved;
}

/** Mask every detected span in `text` with a `<TOKEN>` replacement. */
export function maskPii(text: string, opts: LocalPiiOptions = {}): MaskPiiResult {
  const findings = detectPii(text, opts);
  if (findings.length === 0) return { masked: text, findings };

  let masked = "";
  let cursor = 0;
  for (const finding of findings) {
    masked += text.slice(cursor, finding.start);
    masked += `<${finding.type}>`;
    cursor = finding.end;
  }
  masked += text.slice(cursor);
  return { masked, findings };
}
