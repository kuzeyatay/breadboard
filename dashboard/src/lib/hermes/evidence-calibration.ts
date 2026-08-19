// Evidence calibration, engaged per turn.
//
// Bread was good at extraction and bad at restraint. It would read a supplied
// report correctly, then write a conclusion two steps stronger than the report
// carried: "compatible with" became "you have", "above this source's cutoff"
// became "abnormal", and a value sitting comfortably inside the range printed
// beside it was described as raised because a quantity *derived* from it was
// out of range. Every one of those is the same failure, which is that the
// wording of a claim stopped tracking the evidence behind it.
//
// Two halves fix it, in the shape `meta-prompting.ts` and `cognivia/index.ts`
// already established here:
//   1. `hermes-config/system/evidence-calibration.md` carries the durable
//      contract: the evidence classes, the rule that claim strength tracks
//      class, the cross-check against a supplied bound, the ban on unearned
//      absolutes, the source-first order, differential reasoning, and the
//      explicit instruction that none of it licenses hedging.
//   2. This module decides whether a turn is about interpreting evidence at
//      all, and does the one check a model should never be trusted to do from
//      memory: reading each measured value in the supplied material against
//      the bound the material itself printed next to it.
//
// The second half is deliberately deterministic and deliberately domain free.
// It knows nothing about medicine, finance, or engineering; it knows that a
// label followed by a number followed by an interval or a comparator is a
// measurement with a bound, and it can do the comparison in arithmetic rather
// than in prose. A laboratory panel, a budget variance table, a benchmark run,
// a tolerance sheet, and a test-score report all parse through the same code.
//
// A turn that supplies nothing to interpret and asks nothing consequential
// gets no section at all, so ordinary chat pays nothing for any of this.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import type { ChatAttachment } from "../chat-attachments.ts";
import type { CapabilityDecision } from "./capability-policy.ts";

export type EvidenceRegister =
  | "none"
  /** Supplied material carries values with the bounds they are read against. */
  | "measurement_review"
  /** Supplied material, and a question about what it means. */
  | "source_interpretation"
  /** No supplied material, but a consequential interpretive question. */
  | "high_stakes_interpretation";

export interface EvidenceClassification {
  register: EvidenceRegister;
  /** Why it engaged. Diagnostic only; never rendered into the prompt. */
  signals: string[];
  /** The turn asks for a consequential judgement rather than a fact lookup. */
  highStakes: boolean;
  /** Material was supplied for this turn rather than only asked about. */
  suppliedEvidence: boolean;
  measurements: SuppliedMeasurement[];
  /** Measurements found beyond the rendering cap. */
  omittedMeasurements: number;
}

export interface EvidenceCalibrationInput {
  userText: string | undefined | null;
  /**
   * Text the user supplied for this turn that is not their own sentence:
   * extracted attachment text, a selected source, a pasted report. Both this
   * and `userText` are scanned, because a report arrives either way.
   */
  suppliedEvidence?: string | undefined | null;
  decision?: Pick<CapabilityDecision, "allowedTools"> | null;
}

/**
 * The text a turn actually supplied, from the attachments that travel to the
 * model verbatim. A distilled document is deliberately excluded: what reaches
 * the model there is an index rather than the rows, so there is nothing to
 * compare against a bound.
 */
export function suppliedEvidenceText(
  attachments: readonly ChatAttachment[] | undefined,
  limit = 80_000,
): string {
  const blocks: string[] = [];
  let size = 0;
  for (const attachment of attachments ?? []) {
    if (attachment.type !== "text" && attachment.type !== "document") continue;
    const text = attachment.text?.trim();
    if (!text) continue;
    const block = `${attachment.name}\n${text}`;
    if (size + block.length > limit) {
      blocks.push(block.slice(0, Math.max(0, limit - size)));
      break;
    }
    blocks.push(block);
    size += block.length;
  }
  return blocks.join("\n\n");
}

export function evidenceCalibrationEnabled(): boolean {
  const raw = process.env.ENABLE_EVIDENCE_CALIBRATION?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

// --- reading a measurement out of supplied material -------------------------

export type MeasurementVerdict =
  | "within"
  | "above"
  | "below"
  | "at_bound"
  | "undetermined";

export type MeasurementBound =
  | { kind: "interval"; low: number; high: number }
  | { kind: "comparator"; operator: "<" | "<=" | ">" | ">="; limit: number };

export interface SuppliedMeasurement {
  /** The row's own name for the thing measured, as the source wrote it. */
  label: string;
  value: number;
  valueText: string;
  unit?: string;
  bound: MeasurementBound;
  /** The bound exactly as the source printed it. */
  boundText: string;
  verdict: MeasurementVerdict;
}

/**
 * The words a source uses to say "this column is what the value is read
 * against". They name the *role* of a bound, never a subject: `reference` and
 * `target` mean the same thing on a blood panel, a budget, and an SLO report,
 * which is the whole reason the check can be domain free.
 */
const BOUND_ROLE =
  /\b(ref(?:erence)?|range|normal|expected|target|threshold|limit|limits|spec(?:ification)?|tolerance|interval|acceptable|desirable|optimal|baseline|budget|slo|sla|cutoff|standard|guideline|allowed|permitted|band)\b/i;

const NUMBER = String.raw`-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:[.,]\d+)?`;

/** Unicode a source uses that means something this parser already understands. */
function normalizeLine(raw: string): string {
  return raw
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[−]/g, "-")
    // An en or em dash between two digits is a range, everywhere.
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 - $2")
    .replace(/ /g, " ");
}

/**
 * "1,234.5" is one thousand two hundred; "3,5" is three and a half. Both
 * conventions turn up in supplied material, and guessing wrong turns a value
 * into a different number rather than into no number, so the two shapes are
 * separated rather than one being assumed.
 */
export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  let normalized = text;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    normalized = text.replace(/,/g, "");
  } else if (/^-?\d+,\d{1,3}$/.test(text)) {
    normalized = text.replace(",", ".");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

interface BoundMatch {
  bound: MeasurementBound;
  text: string;
  start: number;
  end: number;
}

/** A pair of integers that both look like calendar years, with nothing saying otherwise. */
function looksLikeYearSpan(low: number, high: number, qualified: boolean): boolean {
  if (qualified) return false;
  return (
    Number.isInteger(low) &&
    Number.isInteger(high) &&
    low >= 1900 &&
    high <= 2199 &&
    low >= 1000
  );
}

/**
 * Finds the bound in one line: an interval (`70 - 99`, `70 to 99`) or a
 * comparator (`< 2.0`, `>= 90`). A bare pair of numbers in running prose is
 * not a bound, so a match counts only when the source marked it as one: by
 * bracketing it, by naming its role beside it, or by giving it its own cell in
 * a table row.
 */
export function findBound(line: string, alwaysQualified = false): BoundMatch | null {
  const text = normalizeLine(line);
  const candidates: BoundMatch[] = [];

  const interval = new RegExp(
    String.raw`(${NUMBER})\s*(?:-|to|\.\.\.?)\s*(${NUMBER})`,
    "gi",
  );
  for (const match of text.matchAll(interval)) {
    const low = parseNumber(match[1]);
    const high = parseNumber(match[2]);
    if (low === null || high === null || high < low) continue;
    const start = match.index ?? 0;
    const qualified = alwaysQualified || boundIsMarked(text, start, start + match[0].length);
    if (!qualified) continue;
    if (looksLikeYearSpan(low, high, false)) continue;
    candidates.push({
      bound: { kind: "interval", low, high },
      text: match[0].trim(),
      start,
      end: start + match[0].length,
    });
  }

  const comparator = new RegExp(String.raw`(<=|>=|<|>)\s*(${NUMBER})`, "g");
  for (const match of text.matchAll(comparator)) {
    const limit = parseNumber(match[2]);
    if (limit === null) continue;
    const start = match.index ?? 0;
    const qualified = alwaysQualified || boundIsMarked(text, start, start + match[0].length);
    if (!qualified) continue;
    candidates.push({
      bound: {
        kind: "comparator",
        operator: match[1] as "<" | "<=" | ">" | ">=",
        limit,
      },
      text: match[0].replace(/\s+/g, " ").trim(),
      start,
      end: start + match[0].length,
    });
  }

  if (!candidates.length) return null;
  // The last bound on the line is the one a table row puts in its reference
  // column; an earlier one would be part of the label or of the value.
  candidates.sort((a, b) => a.start - b.start);
  return candidates[candidates.length - 1];
}

/**
 * Whether the source marked this span as a bound rather than leaving two
 * numbers next to each other. Brackets around it, or a role word immediately
 * before it, are the two ways written material says so.
 */
function boundIsMarked(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 40), start);
  const after = text.slice(end, end + 4);
  if (/[([{]\s*[^)\]}]{0,20}$/.test(before) && /^[^([{]{0,20}[)\]}]/.test(after)) {
    return true;
  }
  if (BOUND_ROLE.test(before)) return true;
  return false;
}

const UNIT = String.raw`%|[A-Za-zµμ°Ω][A-Za-zµμ°Ω/·^\-\d]{0,14}`;

interface ValueMatch {
  value: number;
  valueText: string;
  unit?: string;
  start: number;
  end: number;
}

/** The measured value on a line: the number that is not part of the bound. */
function findValue(line: string, bound: BoundMatch | null): ValueMatch | null {
  const text = normalizeLine(line);
  const pattern = new RegExp(String.raw`(${NUMBER})\s*(${UNIT})?`, "g");
  const before: ValueMatch[] = [];
  const after: ValueMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[1].length;
    if (bound && start >= bound.start && start < bound.end) continue;
    const value = parseNumber(match[1]);
    if (value === null) continue;
    let unit: string | undefined = match[2]?.trim();
    // A role word or a bare connective directly after the number is not a unit.
    if (unit && (BOUND_ROLE.test(unit) || /^(to|and|or|of|in|at|vs)$/i.test(unit))) {
      unit = undefined;
    }
    const entry: ValueMatch = { value, valueText: match[1], unit, start, end };
    if (!bound || start < bound.start) before.push(entry);
    else after.push(entry);
  }
  // A row reads "name, value, bound", so the value is the last number before
  // the bound. Material that prints the bound first falls back to the first
  // number after it.
  if (before.length) return before[before.length - 1];
  if (after.length) return after[0];
  return null;
}

function labelFor(line: string, valueStart: number): string {
  const head = normalizeLine(line).slice(0, valueStart);
  const cleaned = head
    .replace(/^[\s|>*\-•\d.)]+/, "")
    .replace(/[\s:=|,;([{]+$/, "")
    .trim();
  return cleaned;
}

export function verdictFor(value: number, bound: MeasurementBound): MeasurementVerdict {
  if (bound.kind === "interval") {
    if (value < bound.low) return "below";
    if (value > bound.high) return "above";
    if (value === bound.low || value === bound.high) return "at_bound";
    return "within";
  }
  const { operator, limit } = bound;
  if (operator === "<") {
    if (value < limit) return "within";
    return value === limit ? "at_bound" : "above";
  }
  if (operator === "<=") {
    if (value <= limit) return "within";
    return "above";
  }
  if (operator === ">") {
    if (value > limit) return "within";
    return value === limit ? "at_bound" : "below";
  }
  if (value >= limit) return "within";
  return "below";
}

export function describeBound(bound: MeasurementBound): string {
  if (bound.kind === "interval") return `${bound.low} to ${bound.high}`;
  return `${bound.operator} ${bound.limit}`;
}

/**
 * The cells of a row, from either kind of table. Returns null when the line is
 * not laid out in columns at all, which is when a bound has to be marked by
 * bracketing or by a role word before it counts.
 */
function splitColumns(line: string): string[] | null {
  if (line.includes("|")) {
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    return cells.length >= 3 ? cells : null;
  }
  const cells = normalizeLine(line)
    .split(/\s{2,}|\t+/)
    .map((cell) => cell.trim())
    .filter(Boolean);
  return cells.length >= 3 ? cells : null;
}

const TABLE_SEPARATOR = /^[\s|:+-]+$/;
const MAX_SCANNED_LINES = 600;

/**
 * Every value in the supplied material that the material itself printed a
 * bound for, with the comparison already done.
 *
 * Table rows are split on their cells first, because a pipe table gives the
 * bound its own column and therefore needs no bracketing to be unambiguous.
 * Everything else is read a line at a time.
 */
export function extractSuppliedMeasurements(
  material: string,
  limit = 40,
): { measurements: SuppliedMeasurement[]; omitted: number } {
  const measurements: SuppliedMeasurement[] = [];
  let omitted = 0;
  const lines = material.split(/\r?\n/).slice(0, MAX_SCANNED_LINES);
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length > 400) continue;
    if (TABLE_SEPARATOR.test(line)) continue;

    // Columns, however the source drew them. A pipe table is explicit; a fixed
    // width report separates its columns with runs of spaces and is otherwise
    // the same shape, and refusing to read the second is refusing to read most
    // printed reports.
    const cells = splitColumns(line);

    let bound: BoundMatch | null = null;
    let valueSource = line;
    let label = "";

    if (cells) {
      // A cell that is nothing but a bound needs no marking: the column is the
      // marking. The last such cell is the reference column.
      let boundCell = -1;
      let cellBound: BoundMatch | null = null;
      for (let index = cells.length - 1; index >= 1; index -= 1) {
        const candidate = findBound(cells[index], true);
        if (!candidate) continue;
        const residue = normalizeLine(cells[index])
          .slice(0, candidate.start)
          .replace(/[^A-Za-z]/g, "");
        // "Reference 70 - 99" is a bound cell; "Result 92 for 70 - 99" is not.
        if (residue && !BOUND_ROLE.test(residue)) continue;
        boundCell = index;
        cellBound = candidate;
        break;
      }
      if (boundCell > 0 && cellBound) {
        bound = cellBound;
        valueSource = cells.slice(1, boundCell).join(" ") || cells[0];
        label = cells[0];
      }
    }

    if (!bound) {
      bound = findBound(line);
      if (!bound) continue;
      valueSource = line;
    }

    const value = findValue(valueSource, valueSource === line ? bound : null);
    if (!value) continue;
    if (!label) label = labelFor(line, value.start);
    label = label.replace(/\s+/g, " ").trim();
    if (!label || !/[A-Za-z]/.test(label) || label.length > 90) continue;

    const key = `${label.toLowerCase()}|${value.valueText}|${describeBound(bound.bound)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (measurements.length >= limit) {
      omitted += 1;
      continue;
    }
    measurements.push({
      label,
      value: value.value,
      valueText: value.valueText,
      unit: value.unit,
      bound: bound.bound,
      boundText: bound.text,
      verdict: verdictFor(value.value, bound.bound),
    });
  }

  return { measurements, omitted };
}

// --- classification ---------------------------------------------------------

/**
 * A question about what supplied material means, or about the cause, status,
 * or seriousness of something. Deliberately about the *shape* of the ask, not
 * about any subject: it is the same question in a clinic, a code review, and
 * an audit.
 */
const INTERPRETIVE_ASK =
  /\b(what (?:does|do) (?:this|that|it|these|they|the (?:results?|report|numbers?|figures?|readings?|data|logs?|statement|scan|file)) (?:mean|say|indicate|show|tell)|what'?s (?:this|it) (?:mean|saying)|how (?:should|do|would) i (?:read|interpret|understand)|is (?:this|that|it|any of (?:this|it)|my \w+) (?:bad|good|normal|abnormal|ok|okay|fine|concerning|serious|dangerous|a problem|healthy|safe)|should i (?:be )?(?:worry|worried|be concerned|be worried)|anything (?:concerning|abnormal|unusual|wrong|worrying|off)|interpret|make sense of|walk me through (?:this|these|my|the)|explain (?:this|these|the|my) (?:results?|report|numbers?|figures?|readings?|data|logs?|statement|scan|chart|file)|review (?:this|these|my|the)|assess|evaluate|diagnos|root cause|what (?:could|might|would) (?:be )?(?:caus|explain|account for)|why (?:is|are|does|do|did|would|isn'?t|aren'?t|doesn'?t|don'?t|won'?t|can'?t)|what'?s (?:wrong|going on|causing)|do i have|does (?:this|that|it) mean i)/i;

/**
 * Families where a confidently wrong interpretation costs the reader something
 * they cannot easily undo. Kept at family level on purpose: no condition, no
 * instrument, no named metric, nothing that ties the gate to one example.
 */
const STAKES_RULES: readonly { signal: string; pattern: RegExp }[] = [
  {
    signal: "health",
    pattern:
      /\b(symptoms?|diagnos\w+|prognosis|treatment|therapy|medication|dosage|dose|prescri\w+|clinical|patient|disease|illness|infection|screening|biopsy|blood work|lab (?:results?|report|work)|test results?|vital signs?|side effects?|contraindicat\w+|my (?:doctor|gp|physician|results?|scan|labs?))\b/i,
  },
  {
    signal: "legal",
    pattern:
      /\b(contract|clause|liability|liable|breach|statute|statutory|regulation|regulatory|compliance|jurisdiction|court|lawsuit|litigation|plaintiff|defendant|tenant|landlord|licen[cs]e agreement|terms of service|nda|gdpr|copyright|patent|trademark|legally)\b/i,
  },
  {
    signal: "financial",
    pattern:
      /\b(balance sheet|cash ?flow|income statement|earnings|revenue|profit margin|leverage|solvency|insolven\w+|liquidity|covenant|default risk|credit rating|valuation|portfolio|investment|tax(?:es|able)?|audit|financial (?:health|distress|statements?)|runway|burn rate|debt)\b/i,
  },
  {
    signal: "safety",
    pattern:
      /\b(safety|safe to \w+|unsafe|hazard(?:ous)?|toxic|exposure limit|structural\w*|load[- ]bearing|acceptance criteri\w+|defect|corrosion|failure mode|fatigue (?:limit|life|loading)|pressure (?:rating|vessel)|electrical fault|fire risk|security (?:incident|breach|vulnerability)|exploit|malware|breach of|incident report|outage|data loss)\b/i,
  },
  {
    signal: "scientific",
    pattern:
      /\b(hypothesis|statistically significant|p[- ]value|confidence interval|effect size|sample size|control group|peer[- ]reviewed|replicat\w+|calibration|measurement (?:error|uncertainty)|tolerance|specification|benchmark|regression (?:analysis|model))\b/i,
  },
];

/** Material that is plainly a record rather than a sentence someone wrote. */
function pastedMaterial(text: string): boolean {
  if (text.length < 200) return false;
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length >= 6) {
    const numeric = lines.filter((line) => /\d/.test(line)).length;
    if (numeric >= 4) return true;
  }
  // A single dense paragraph of figures counts too, since a pasted statement
  // or result block often arrives with its newlines eaten.
  const numbers = text.match(/\d+(?:[.,]\d+)?/g)?.length ?? 0;
  return numbers >= 12;
}

const TRIVIAL =
  /^(hi|hey|hello|yo|thanks|thank you|ok|okay|sure|cool|nice|got it|yes|no|nope|yep|good morning|good evening)[\s!.?]*$/i;

export function classifyEvidenceTurn(
  input: EvidenceCalibrationInput,
): EvidenceClassification {
  const userText = (input.userText ?? "").trim();
  const supplied = (input.suppliedEvidence ?? "").trim();
  const empty: EvidenceClassification = {
    register: "none",
    signals: [],
    highStakes: false,
    suppliedEvidence: false,
    measurements: [],
    omittedMeasurements: 0,
  };
  if (!userText && !supplied) return empty;
  if (!supplied && TRIVIAL.test(userText)) return empty;

  const signals: string[] = [];
  const hasSupplied = supplied.length >= 40 || pastedMaterial(userText);
  if (supplied.length >= 40) signals.push("attached_material");
  else if (hasSupplied) signals.push("pasted_material");

  const material = [supplied, userText].filter(Boolean).join("\n");
  const { measurements, omitted } = hasSupplied
    ? extractSuppliedMeasurements(material)
    : { measurements: [], omitted: 0 };
  if (measurements.length) signals.push("bounded_measurements");

  const interpretive = INTERPRETIVE_ASK.test(userText);
  if (interpretive) signals.push("interpretive_ask");

  let highStakes = false;
  for (const rule of STAKES_RULES) {
    if (!rule.pattern.test(userText) && !rule.pattern.test(supplied.slice(0, 8000))) {
      continue;
    }
    highStakes = true;
    signals.push(rule.signal);
  }

  const base = {
    signals,
    highStakes,
    suppliedEvidence: hasSupplied,
    measurements,
    omittedMeasurements: omitted,
  };

  // A bounded measurement is worth the check whatever was asked about it: the
  // failure this exists to stop is describing an in-range value as abnormal,
  // and that happens in a summary as readily as in a diagnosis.
  if (measurements.length) return { register: "measurement_review", ...base };
  if (hasSupplied && (interpretive || highStakes)) {
    return { register: "source_interpretation", ...base };
  }
  if (highStakes && interpretive) {
    return { register: "high_stakes_interpretation", ...base };
  }
  return empty;
}

// --- the section ------------------------------------------------------------

function contract(): string {
  const file = path.join(
    repositoryRoot(),
    "hermes-config",
    "system",
    "evidence-calibration.md",
  );
  return fs.readFileSync(file, "utf8").trim();
}

function verdictPhrase(measurement: SuppliedMeasurement): string {
  // The source's own printing of the bound, not a reformatted one: a model
  // that can see "0.70 - 1.30" in the material and "0.7 to 1.3" here has been
  // given a reason to wonder which of the two it is being told about.
  const stated =
    measurement.bound.kind === "interval"
      ? `the range the source states for it, ${measurement.boundText}`
      : `the bound the source states for it, ${measurement.boundText}`;
  switch (measurement.verdict) {
    case "within":
      return `inside ${stated}`;
    case "above":
      return `above ${stated}`;
    case "below":
      return `below ${stated}`;
    case "at_bound":
      return `exactly on the edge of ${stated}`;
    default:
      return `not comparable with ${stated}`;
  }
}

function renderMeasurements(classification: EvidenceClassification): string[] {
  const { measurements } = classification;
  if (!measurements.length) return [];
  const outside = measurements.filter(
    (measurement) => measurement.verdict === "above" || measurement.verdict === "below",
  ).length;
  const within = measurements.filter(
    (measurement) => measurement.verdict === "within",
  ).length;
  const lines = [
    "",
    "Every value in the supplied material that the material itself printed a bound for, compared with that bound arithmetically rather than from memory:",
  ];
  for (const measurement of measurements) {
    const unit = measurement.unit ? ` ${measurement.unit}` : "";
    lines.push(
      `- ${measurement.label}: ${measurement.valueText}${unit} is ${verdictPhrase(measurement)}.`,
    );
  }
  if (classification.omittedMeasurements > 0) {
    lines.push(
      `- ${classification.omittedMeasurements} further bounded values were not listed here; read those from the source the same way.`,
    );
  }
  lines.push(
    "",
    "These verdicts come from the source's own numbers. Describe each value by the verdict beside it, and never by the impression the group gives: a value listed as inside its range is not raised, reduced, borderline, or abnormal in your answer, whatever else in the material is out of range and whatever quantity was derived from it.",
  );
  if (within > 0 && outside > 0) {
    lines.push(
      `${outside} of these ${measurements.length} values ${outside === 1 ? "falls" : "fall"} outside the bound stated for it and ${within} ${within === 1 ? "sits" : "sit"} inside. A mixed picture is normal and is usually the finding: say which values carry the concern and which do not, rather than letting the outliers colour the whole set.`,
    );
  }
  lines.push(
    "If a bound you need is missing from the material, say that it is missing rather than supplying a remembered one silently; if you read a bound differently from the comparison above, say so and show both readings.",
  );
  return lines;
}

/**
 * The per-turn half: the durable contract plus what this turn actually
 * supplied, or null when the turn has nothing to calibrate.
 */
export function evidenceCalibrationSection(
  input: EvidenceCalibrationInput,
): string | null {
  if (!evidenceCalibrationEnabled()) return null;
  const classification = classifyEvidenceTurn(input);
  if (classification.register === "none") return null;

  const lines = [
    contract(),
    "",
    "# evidence_turn",
    `Register: ${classification.register}`,
  ];

  if (classification.suppliedEvidence) {
    lines.push(
      "The person supplied the material this answer is about. It is the authority on what was actually measured, recorded, or written; your own knowledge interprets it and never overrules an explicit value, bound, date, or statement inside it.",
    );
  } else {
    lines.push(
      "Nothing was supplied to read, so every claim rests on general knowledge. Say which parts of the answer would change once the actual document, data, or measurement is in front of you.",
    );
  }

  lines.push(...renderMeasurements(classification));

  if (classification.highStakes) {
    const canSearch = Boolean(input.decision?.allowedTools?.includes("websearch"));
    lines.push(
      "",
      canSearch
        ? "A wrong confident answer here is expensive to undo. Where the interpretation turns on a current criterion, threshold, convention, regulation, or published specification, verify that criterion against a primary or official source and cite it next to the claim it supports. Keep it distinguishable from the supplied material, and where the two use different conventions, say so. Do not search to decorate a conclusion the supplied material already settles."
        : "A wrong confident answer here is expensive to undo, and no live sources are available on this turn. Where the interpretation turns on a current criterion, threshold, convention, or regulation, say that it could not be verified rather than asserting a remembered value as current.",
    );
  }

  lines.push(
    "",
    // Read last, because the failure it prevents is the one this whole section
    // invites: a model told to be careful answers with a level list of
    // possibilities and no recommendation, which is useless in a different way
    // from an overconfident answer rather than better than one.
    "Then commit. Where the evidence supports a leading answer or explanation, give it as the leading one rather than spreading equal weight across possibilities, and say what would change it. Where it genuinely does not, say what would settle it. Either way, end with something the person can actually do next.",
    "",
    "None of this is visible to the user. Do not name the register, the evidence classes, or this check, do not restructure the reply around them, and do not let them turn a well evidenced answer into a hedged one. Answer the actual question first and keep it as short as the evidence allows.",
  );
  return lines.join("\n");
}

export function evidenceCalibrationDiagnostics(): {
  contract: string;
  live: boolean;
  enabled: boolean;
} {
  const file = path.join(
    repositoryRoot(),
    "hermes-config",
    "system",
    "evidence-calibration.md",
  );
  return {
    contract: file,
    live: fs.existsSync(file),
    enabled: evidenceCalibrationEnabled(),
  };
}
