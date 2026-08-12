/**
 * Syllabus reading, material resolution, and the anti-hallucination gate.
 *
 * A syllabus names the materials a course teaches from — "Smith, *Introduction
 * to Spiking Networks*, ch. 3", "Nature 2019 neuromorphic survey", "Lecture 4
 * slides". Some of those are uploaded into the garden; some are not. This module
 * turns that list into a decision the pipeline can act on:
 *
 *   1. `normalizeSyllabusPlan` parses the model's reading of the syllabus into
 *      units (weeks/modules) and the materials each one references.
 *   2. `resolveSyllabusMaterials` deterministically matches each referenced
 *      material against the documents actually in the garden.
 *   3. `unavailableCitationProbes` + `detectUnavailableCitations` catch a page
 *      that writes about a material the garden does not have.
 *
 * Step 3 is the point. Without it, a syllabus reliably induces hallucination:
 * the model sees "ch. 3 covers refractory dynamics", has no ch. 3, and writes a
 * plausible summary of it anyway.
 */

import type { LearnSourceSummary } from "./learn-utils.ts";

export type SyllabusMaterialKind =
  | "textbook"
  | "chapter"
  | "paper"
  | "reading"
  | "lecture"
  | "slides"
  | "dataset"
  | "video"
  | "other";

export interface SyllabusReferencedMaterial {
  id: string;
  /** The reference exactly as the syllabus writes it. */
  citation: string;
  title?: string;
  authors?: string[];
  kind: SyllabusMaterialKind;
  /** "ch. 3", "pp. 40-58", "Week 2" — the part of the work being assigned. */
  locator?: string;
  required: boolean;
}

export interface SyllabusUnit {
  id: string;
  /** "Week 1", "Module 2", "Session 3" — the syllabus's own numbering. */
  label?: string;
  title: string;
  objectives: string[];
  topics: string[];
  /** Ids from `referencedMaterials`. */
  materialIds: string[];
}

export interface SyllabusPlan {
  courseTitle?: string;
  units: SyllabusUnit[];
  referencedMaterials: SyllabusReferencedMaterial[];
}

/**
 * - `available`: at least one garden document satisfies the citation.
 * - `missing`: the citation is specific enough to look for and nothing matches.
 * - `generic`: the citation names no identifiable work ("Lecture 3", "Readings
 *   TBD"). Never gated on — there is nothing to hallucinate *about*.
 */
export type SyllabusMaterialStatus = "available" | "missing" | "generic";

export interface SyllabusMaterialResolution {
  materialId: string;
  citation: string;
  status: SyllabusMaterialStatus;
  /** Garden documents that satisfy the citation, strongest match first. */
  sourceIds: string[];
  matchReason: string;
  score: number;
}

export interface SyllabusUnitCoverage {
  unitId: string;
  label?: string;
  title: string;
  objectives: string[];
  topics: string[];
  /** Documents this unit should be taught from, heavily. */
  availableSourceIds: string[];
  /** Citations this unit assigns that the garden does not contain. */
  missingCitations: string[];
  /** False when every material this unit references is missing. */
  teachable: boolean;
}

export interface SyllabusCoverage {
  courseTitle?: string;
  plan: SyllabusPlan;
  resolutions: SyllabusMaterialResolution[];
  units: SyllabusUnitCoverage[];
  /** Every garden document a syllabus unit points at. */
  availableSourceIds: string[];
  missingCitations: string[];
  /** Units with no available material at all — planning must not invent these. */
  untaughtUnitTitles: string[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const MATERIAL_KINDS = new Set<SyllabusMaterialKind>([
  "textbook",
  "chapter",
  "paper",
  "reading",
  "lecture",
  "slides",
  "dataset",
  "video",
  "other",
]);

function asText(value: unknown, maxLength = 400): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function asTextList(value: unknown, maxItems = 20, maxLength = 400): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = asText(entry, maxLength);
    if (text) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Parse the syllabus-reading response. Everything is optional and defensively
 * typed: a malformed reading degrades to "no syllabus structure", which the
 * caller treats exactly like having no syllabus at all.
 */
export function normalizeSyllabusPlan(raw: unknown): SyllabusPlan {
  const root = asRecord(raw);
  if (!root) return { units: [], referencedMaterials: [] };

  const materials: SyllabusReferencedMaterial[] = [];
  const seenMaterialIds = new Set<string>();
  const rawMaterials = Array.isArray(root.referencedMaterials)
    ? root.referencedMaterials
    : [];
  for (const entry of rawMaterials) {
    const record = asRecord(entry);
    if (!record) continue;
    const citation = asText(record.citation) || asText(record.title);
    if (!citation) continue;
    let id = asText(record.id, 40) || `R${materials.length + 1}`;
    while (seenMaterialIds.has(id)) id = `${id}_${materials.length + 1}`;
    seenMaterialIds.add(id);
    const kindText = asText(record.kind, 40).toLowerCase() as SyllabusMaterialKind;
    materials.push({
      id,
      citation,
      title: asText(record.title) || undefined,
      authors: asTextList(record.authors, 10, 120),
      kind: MATERIAL_KINDS.has(kindText) ? kindText : "other",
      locator: asText(record.locator, 120) || undefined,
      required: record.required !== false,
    });
    if (materials.length >= 200) break;
  }

  const knownMaterialIds = new Set(materials.map((material) => material.id));
  const units: SyllabusUnit[] = [];
  const rawUnits = Array.isArray(root.units) ? root.units : [];
  for (const entry of rawUnits) {
    const record = asRecord(entry);
    if (!record) continue;
    const title = asText(record.title);
    if (!title) continue;
    units.push({
      id: asText(record.id, 40) || `SU${units.length + 1}`,
      label: asText(record.label, 80) || undefined,
      title,
      objectives: asTextList(record.objectives, 15, 400),
      topics: asTextList(record.topics, 25, 200),
      materialIds: asTextList(record.materialIds, 25, 40).filter((id) =>
        knownMaterialIds.has(id),
      ),
    });
    if (units.length >= 100) break;
  }

  return {
    courseTitle: asText(root.courseTitle, 200) || undefined,
    units,
    referencedMaterials: materials,
  };
}

// ---------------------------------------------------------------------------
// Matching a citation to a garden document
// ---------------------------------------------------------------------------

/** Words that carry no identifying power in a citation, so they can never be
 * the reason a document is considered a match. */
const CITATION_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "from",
  "into", "over", "under", "part", "vol", "volume", "no", "pp", "page", "pages",
  "chapter", "chapters", "chap", "ch", "section", "sections", "sec", "week",
  "weeks", "module", "modules", "unit", "units", "session", "sessions", "class",
  "classes", "lecture", "lectures", "lesson", "lessons", "reading", "readings",
  "slides", "slide", "notes", "note", "handout", "handouts", "textbook", "book",
  "paper", "papers", "article", "articles", "course", "syllabus", "topic",
  "topics", "introduction", "intro", "overview", "review", "summary", "basics",
  "fundamentals", "principles", "tbd", "tba", "optional", "required", "further",
  "supplementary", "additional", "recommended", "et", "al", "eds", "ed",
  "edition", "press", "university", "journal", "proceedings", "conference",
]);

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words in a citation that could actually identify a work. */
function distinctiveTokens(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of normalizeForMatch(value).split(" ")) {
    if (word.length < 4) continue;
    if (CITATION_STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** A 4-digit year in the citation, used with an author surname as a probe. */
function citationYear(value: string): string | null {
  const match = value.match(/\b(1[89]\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function authorSurnames(material: SyllabusReferencedMaterial): string[] {
  const out: string[] = [];
  for (const author of material.authors ?? []) {
    // "Smith, J." / "J. Smith" / "Smith" — take the longest word as the surname.
    const words = normalizeForMatch(author)
      .split(" ")
      .filter((word) => word.length >= 3 && !CITATION_STOPWORDS.has(word));
    if (words.length === 0) continue;
    const surname = words.reduce((a, b) => (b.length > a.length ? b : a));
    if (surname) out.push(surname);
  }
  return Array.from(new Set(out));
}

/** The identifying text of a citation: its title if given, else the citation. */
function materialIdentity(material: SyllabusReferencedMaterial): string {
  return material.title?.trim() || material.citation;
}

interface SourceHaystack {
  slug: string;
  /** Title, filename, and description — where a real title match should land. */
  label: string;
  /** The opening of the document body, for weaker corroboration. */
  body: string;
}

function sourceHaystacks(sources: LearnSourceSummary[]): SourceHaystack[] {
  return sources.map((source) => ({
    slug: source.slug,
    label: normalizeForMatch(
      [source.title, source.sourceFile ?? "", source.description ?? ""].join(" "),
    ),
    body: normalizeForMatch((source.body ?? source.excerpt ?? "").slice(0, 4000)),
  }));
}

/** Score in 0-100 for how well one garden document satisfies one citation. */
function scoreMaterialAgainstSource(
  material: SyllabusReferencedMaterial,
  tokens: string[],
  surnames: string[],
  haystack: SourceHaystack,
): { score: number; reason: string } {
  const identity = normalizeForMatch(materialIdentity(material));

  if (identity.length >= 10 && haystack.label.includes(identity)) {
    return { score: 100, reason: "title matches the document title or filename" };
  }

  const labelHits = tokens.filter((token) => haystack.label.includes(token));
  const bodyHits = tokens.filter((token) => haystack.body.includes(token));
  const surnameInLabel = surnames.some((surname) => haystack.label.includes(surname));
  const surnameInBody = surnames.some((surname) => haystack.body.includes(surname));

  const labelRatio = tokens.length ? labelHits.length / tokens.length : 0;
  const bodyRatio = tokens.length ? bodyHits.length / tokens.length : 0;

  if (surnameInLabel && labelHits.length >= 2) {
    return { score: 90, reason: "author and title words match the document title" };
  }
  if (labelRatio >= 0.6 && labelHits.length >= 2) {
    return { score: 75, reason: `title words match the document title (${labelHits.join(", ")})` };
  }
  if (surnameInBody && bodyHits.length >= 2) {
    return { score: 60, reason: "author and title words appear in the document text" };
  }
  if (bodyRatio >= 0.7 && bodyHits.length >= 3) {
    return { score: 55, reason: `title words appear in the document text (${bodyHits.join(", ")})` };
  }
  if (labelHits.length >= 1 && bodyRatio >= 0.5 && bodyHits.length >= 2) {
    return { score: 50, reason: "title words match partly in the title and partly in the text" };
  }
  return { score: 0, reason: "no distinctive overlap" };
}

/** At or above this, a citation counts as present in the garden. */
const AVAILABILITY_THRESHOLD = 50;
/** Fewer distinctive words than this and a citation identifies no real work. */
const MIN_DISTINCTIVE_TOKENS = 2;

/**
 * Decide, for every material the syllabus references, whether the garden
 * actually contains it. Deterministic — no model call, so the answer cannot be
 * argued with by a confident-sounding generation.
 */
export function resolveSyllabusMaterials(
  plan: SyllabusPlan,
  sources: LearnSourceSummary[],
): SyllabusMaterialResolution[] {
  const haystacks = sourceHaystacks(sources);

  return plan.referencedMaterials.map((material) => {
    const tokens = distinctiveTokens(materialIdentity(material));
    const surnames = authorSurnames(material);

    if (tokens.length < MIN_DISTINCTIVE_TOKENS && surnames.length === 0) {
      return {
        materialId: material.id,
        citation: material.citation,
        status: "generic" as const,
        sourceIds: [],
        matchReason:
          "the citation names no identifiable work, so it cannot be matched or missed",
        score: 0,
      };
    }

    const scored = haystacks
      .map((haystack) => ({
        slug: haystack.slug,
        ...scoreMaterialAgainstSource(material, tokens, surnames, haystack),
      }))
      .filter((entry) => entry.score >= AVAILABILITY_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return {
        materialId: material.id,
        citation: material.citation,
        status: "missing" as const,
        sourceIds: [],
        matchReason: "no document in this garden matches the citation",
        score: 0,
      };
    }

    return {
      materialId: material.id,
      citation: material.citation,
      status: "available" as const,
      sourceIds: scored.map((entry) => entry.slug),
      matchReason: scored[0].reason,
      score: scored[0].score,
    };
  });
}

/** Fold the plan and its resolutions into the shape planning and page writing
 * consume. */
export function buildSyllabusCoverage(
  plan: SyllabusPlan,
  resolutions: SyllabusMaterialResolution[],
): SyllabusCoverage {
  const byId = new Map(resolutions.map((entry) => [entry.materialId, entry]));

  const units: SyllabusUnitCoverage[] = plan.units.map((unit) => {
    const availableSourceIds: string[] = [];
    const missingCitations: string[] = [];
    let referencedAnything = false;
    for (const materialId of unit.materialIds) {
      const resolution = byId.get(materialId);
      if (!resolution) continue;
      if (resolution.status === "available") {
        referencedAnything = true;
        for (const sourceId of resolution.sourceIds) {
          if (!availableSourceIds.includes(sourceId)) availableSourceIds.push(sourceId);
        }
      } else if (resolution.status === "missing") {
        missingCitations.push(resolution.citation);
      }
    }
    return {
      unitId: unit.id,
      label: unit.label,
      title: unit.title,
      objectives: unit.objectives,
      topics: unit.topics,
      availableSourceIds,
      missingCitations,
      // A unit that assigns no material at all is still teachable from the
      // garden at large; only one whose every named material is absent is not.
      teachable: referencedAnything || missingCitations.length === 0,
    };
  });

  const availableSourceIds: string[] = [];
  for (const unit of units) {
    for (const sourceId of unit.availableSourceIds) {
      if (!availableSourceIds.includes(sourceId)) availableSourceIds.push(sourceId);
    }
  }

  return {
    courseTitle: plan.courseTitle,
    plan,
    resolutions,
    units,
    availableSourceIds,
    missingCitations: resolutions
      .filter((entry) => entry.status === "missing")
      .map((entry) => entry.citation),
    untaughtUnitTitles: units
      .filter((unit) => !unit.teachable)
      .map((unit) => `${unit.label ? `${unit.label}: ` : ""}${unit.title}`),
  };
}

/**
 * Which syllabus unit a generated page serves, by word overlap against the
 * unit's title, topics, and objectives.
 *
 * The learning-unit plan is built from the sources, not from the syllabus, so
 * there is no id to join on — this is a best-effort match used to pick which
 * assigned reading a page should lean on. No match simply means the page is
 * grounded on the garden at large, which is the pre-syllabus behavior.
 */
export function matchSyllabusUnitForPage(
  coverage: SyllabusCoverage | null,
  pageText: string,
): SyllabusUnitCoverage | null {
  if (!coverage || coverage.units.length === 0) return null;
  const pageTokens = new Set(distinctiveTokens(pageText));
  if (pageTokens.size === 0) return null;

  let best: { unit: SyllabusUnitCoverage; score: number } | null = null;
  for (const unit of coverage.units) {
    const unitTokens = distinctiveTokens(
      [unit.title, ...unit.topics, ...unit.objectives].join(" "),
    );
    if (unitTokens.length === 0) continue;
    const hits = unitTokens.filter((token) => pageTokens.has(token)).length;
    if (hits === 0) continue;
    // Normalized so a long objective list cannot outrank a precise title match.
    const score = hits / Math.sqrt(unitTokens.length);
    if (!best || score > best.score) best = { unit, score };
  }
  // Two shared distinctive words on a short unit, or proportionally more on a
  // long one. Below that the "match" is coincidence.
  return best && best.score >= 0.8 ? best.unit : null;
}

// ---------------------------------------------------------------------------
// The anti-hallucination gate
// ---------------------------------------------------------------------------

export interface UnavailableCitationProbe {
  citation: string;
  pattern: RegExp;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A phrase probe that tolerates any whitespace/punctuation between words, so
 * "Spiking Networks in Practice" still matches "Spiking  Networks, in Practice". */
function phrasePattern(tokens: string[]): RegExp {
  return new RegExp(
    tokens.map(escapeRegExp).join("[^a-z0-9]{1,4}"),
    "i",
  );
}

/**
 * Build the probes that decide whether a page wrote about material the garden
 * does not have.
 *
 * Deliberately conservative — a false positive hard-fails a page that may be
 * perfectly good, so a probe is only built when the citation is distinctive
 * enough that its appearance cannot be coincidence: a multi-word title, or an
 * author surname next to a year.
 */
export function unavailableCitationProbes(
  coverage: SyllabusCoverage | null,
): UnavailableCitationProbe[] {
  if (!coverage) return [];
  const missingIds = new Set(
    coverage.resolutions
      .filter((entry) => entry.status === "missing")
      .map((entry) => entry.materialId),
  );
  const probes: UnavailableCitationProbe[] = [];

  for (const material of coverage.plan.referencedMaterials) {
    if (!missingIds.has(material.id)) continue;
    const identity = materialIdentity(material);
    const tokens = distinctiveTokens(identity);

    // A distinctive multi-word title.
    if (tokens.length >= 2 && tokens.join("").length >= 12) {
      probes.push({ citation: material.citation, pattern: phrasePattern(tokens) });
    }

    // Author + year. Built alongside the title probe, not instead of it: a page
    // can name a work either way, and catching only one leaves the other open.
    const year = citationYear(material.citation);
    const surnames = authorSurnames(material);
    if (year && surnames.length > 0) {
      probes.push({
        citation: material.citation,
        pattern: new RegExp(
          `${escapeRegExp(surnames[0])}[^.\\n]{0,30}${escapeRegExp(year)}`,
          "i",
        ),
      });
    }
  }

  return probes;
}

/**
 * The citations a page names that the garden cannot support. A non-empty result
 * means the page is teaching from material nobody uploaded.
 */
export function detectUnavailableCitations(
  prose: string,
  probes: UnavailableCitationProbe[],
): string[] {
  if (probes.length === 0) return [];
  const normalized = prose.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const hits: string[] = [];
  for (const probe of probes) {
    if (probe.pattern.test(normalized) && !hits.includes(probe.citation)) {
      hits.push(probe.citation);
    }
  }
  return hits;
}

/** One-line summary for the Learn panel and the run event log. */
export function summarizeSyllabusCoverage(coverage: SyllabusCoverage): {
  unitCount: number;
  materialCount: number;
  availableCount: number;
  missingCount: number;
  genericCount: number;
} {
  return {
    unitCount: coverage.units.length,
    materialCount: coverage.resolutions.length,
    availableCount: coverage.resolutions.filter((entry) => entry.status === "available").length,
    missingCount: coverage.resolutions.filter((entry) => entry.status === "missing").length,
    genericCount: coverage.resolutions.filter((entry) => entry.status === "generic").length,
  };
}
