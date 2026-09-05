import { createHash } from "node:crypto";
import type { SyllabusCoverageEvidenceRecoveryReceipt } from "./learn-syllabus-coverage-recovery.ts";

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
 *   2. A source-grounded model authors material availability and unit coverage.
 *      `syllabusCoverageDecisionProblems` verifies that decision mechanically,
 *      and `projectModelAuthoredSyllabusCoverage` persists it without guessing.
 *   3. `unavailableCitationProbes` + `detectUnavailableCitations` catch a page
 *      that writes about a material the garden does not have.
 *
 * Step 3 is the point. Without it, a syllabus reliably induces hallucination:
 * the model sees "ch. 3 covers refractory dynamics", has no ch. 3, and writes a
 * plausible summary of it anyway.
 */

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
  /** Exact problem/question/exercise identifiers explicitly assigned here. */
  questionReferences: string[];
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
  /** The model's source-grounded explanation for this exact verdict. */
  matchReason: string;
}

export interface SyllabusUnitCoverage {
  unitId: string;
  label?: string;
  title: string;
  objectives: string[];
  topics: string[];
  questionReferences: string[];
  /**
   * Exact selected documents that directly support this unit. This may record
   * partial support even when the model judges the full unit unteachable.
   */
  availableSourceIds: string[];
  /**
   * Exact citations of this unit's missing assigned material records, in
   * syllabus material order. Repeats are intentional when distinct material
   * ids share the same citation.
   */
  missingCitations: string[];
  /** Model-authored verdict after reviewing this unit and the selected sources. */
  teachable: boolean;
  /** The model's explanation of what the selected sources can or cannot teach. */
  coverageReason: string;
}

/**
 * The complete semantic decision authored by the syllabus-coverage model.
 * Text copied from the syllabus and all IDs are subsequently checked exactly;
 * code does not rank documents, decide availability, or infer teachability.
 */
export interface ModelAuthoredSyllabusCoverageDecision {
  resolutions: SyllabusMaterialResolution[];
  units: Array<{
    unitId: string;
    availableSourceIds: string[];
    missingCitations: string[];
    teachable: boolean;
    coverageReason: string;
  }>;
}

export interface SyllabusCoverage {
  courseTitle?: string;
  plan: SyllabusPlan;
  resolutions: SyllabusMaterialResolution[];
  units: SyllabusUnitCoverage[];
  /** Every garden document a syllabus unit points at. */
  availableSourceIds: string[];
  missingCitations: string[];
  /**
   * Units the model judges cannot be taught in full — planning must not
   * invent lessons for these, even if partial source support is recorded.
   */
  untaughtUnitTitles: string[];
  /** Present only when an initially valid all-false coverage decision required
   * a bounded model-selected exact-page rereview before planning could proceed. */
  evidenceRecovery?: SyllabusCoverageEvidenceRecoveryReceipt;
}

// ---------------------------------------------------------------------------
// Bounded source-catalog transport
// ---------------------------------------------------------------------------

/**
 * The coverage model receives a source catalog before it decides whether a
 * syllabus citation is present.  This transport budget applies only to source
 * text; source metadata is intentionally small and remains outside it.
 */
const SYLLABUS_COVERAGE_CATALOG_TOTAL_SOURCE_CHARS = 120_000;
const SYLLABUS_COVERAGE_RAW_PAGE_MIN_CHARS_PER_SOURCE = 2_000;
const SYLLABUS_COVERAGE_RAW_PAGE_MAX_CHARS_PER_SOURCE = 24_000;
export const SYLLABUS_COVERAGE_RAW_PAGE_MAX_PAGES_PER_SOURCE = 8;
const SYLLABUS_COVERAGE_IDENTITY_PAGE_PREFIX = 8;

export interface SyllabusCoverageCatalogSource {
  /** Exact selected-source identity exposed to the coverage model. */
  slug: string;
  title: string;
  description?: string;
  relPath: string;
  sourceType?: string;
  sourceFile?: string;
  excerpt?: string;
  /** Source-note body with local frontmatter already removed. */
  body?: string;
}

export interface CanonicalSourcePageEvidence {
  /** Complete, verbatim document pages in original document order. */
  pages: Array<{
    sourceId: string;
    pageNumber: number;
    exactText: string;
    complete: true;
  }>;
  /** Verbatim fallback for a source that does not declare canonical pages. */
  unpagedEvidence?: {
    sourceId: string;
    exactText: string;
    complete: boolean;
  };
  /** Number of whole canonical pages deliberately omitted by transport bounds. */
  omittedPageCount: number;
  /** True when a transport bound omitted raw bytes or complete pages. */
  truncated: boolean;
}

/** A complete canonical Markdown page block, including its exact `## Page N`
 * heading and every source byte up to the next canonical page heading.  This
 * is intentionally distinct from the normalized structural-anchor catalog:
 * models may use that compact catalog to choose identities, but provenance
 * and rereview bind these original bytes. */
export interface CanonicalSourceRawPageBlock {
  sourceId: string;
  pageNumber: number;
  exactText: string;
  complete: true;
}

export interface CanonicalSourceRawPageInput {
  sourceId: string;
  body?: string;
}

export interface CanonicalSourceRawPageSelection {
  sourceId: string;
  pageNumber: number;
}

export interface CanonicalSourceRawPageParseResult {
  pages: CanonicalSourceRawPageBlock[];
  /** Exact page-looking identities withheld because they occurred inside a
   * fenced region or their page block would span one. They are diagnostic only
   * and are never selector authority. */
  ambiguousPageNumbers: number[];
}

interface MarkdownLineRecord {
  start: number;
  end: number;
  content: string;
  insideFence: boolean;
}

/** Return byte-offset-preserving Markdown lines while identifying fenced code.
 * Canonical source headings are authority only outside a Markdown fence. */
function markdownLineRecords(text: string): MarkdownLineRecord[] {
  const records: MarkdownLineRecord[] = [];
  let offset = 0;
  let fence: { marker: "`" | "~"; length: number } | undefined;
  for (const rawLine of text.match(/.*(?:\r\n|\n|$)/g) ?? []) {
    if (rawLine === "") continue;
    const content = rawLine.replace(/\r?\n$/, "");
    const opening = /^(?: {0,3})(`{3,}|~{3,})/.exec(content);
    const insideFence = fence !== undefined;
    records.push({
      start: offset,
      end: offset + rawLine.length,
      content,
      insideFence,
    });
    if (fence) {
      const closing = new RegExp(`^(?: {0,3})${fence.marker}{${fence.length},}[ \\t]*$`);
      if (closing.test(content)) fence = undefined;
    } else if (opening) {
      fence = {
        marker: opening[1]![0] as "`" | "~",
        length: opening[1]!.length,
      };
    }
    offset += rawLine.length;
  }
  return records;
}

export function canonicalSourceMaterialBody(body: string | undefined): string {
  const text = String(body ?? "");
  const exactMarkers = markdownLineRecords(text).filter(
    (line) => /^## Source material[ \t]*$/.test(line.content),
  );
  const markers = exactMarkers.filter((line) => !line.insideFence);
  if (exactMarkers.length !== markers.length) {
    throw new Error("Canonical Source material marker occurs inside an ambiguous fenced region.");
  }
  if (markers.length > 1) {
    throw new Error("Canonical source material contains duplicate Source material sections.");
  }
  const material = markers[0] ? text.slice(markers[0].end) : text;
  // Dual-parser PDF ingestion appends AnyDoc's supplemental transcript after
  // the canonical VLM page sequence. It deliberately repeats `## Page N`
  // headings for the same physical pages, so it must not be interpreted as a
  // second canonical sequence. Only an exact, outside-fence section delimiter
  // ends the canonical material; malformed or quoted markers remain evidence
  // and continue through the parser's normal fail-closed checks.
  const anyDocCrossCheck = markdownLineRecords(material).find(
    (line) => !line.insideFence && /^## AnyDoc cross-check[ \t]*$/.test(line.content),
  );
  return anyDocCrossCheck ? material.slice(0, anyDocCrossCheck.start) : material;
}

/** Parse every canonical source page without changing CRLF/LF bytes, trimming
 * whitespace, guessing a page number, or accepting a near-miss heading. */
export function parseCanonicalSourceRawPages(
  sourceId: string,
  body: string | undefined,
): CanonicalSourceRawPageParseResult {
  if (!sourceId || sourceId.trim() !== sourceId) {
    throw new Error("Canonical source-page evidence requires an exact non-empty source id.");
  }
  const material = canonicalSourceMaterialBody(body);
  const lines = markdownLineRecords(material);
  const visiblePageHeadingCandidates = lines.filter(
    (line) => !line.insideFence && /^#{2,6}[ \t]*Page(?:[ \t]*\d|[ \t]+|$)/i.test(line.content),
  );
  for (const line of visiblePageHeadingCandidates) {
    if (!/^## Page ([1-9]\d*)[ \t]*$/.test(line.content)) {
      throw new Error("Canonical source-page evidence contains an unknown page identity.");
    }
  }

  // A page-looking line inside a fence is ambiguous: it can be an example or a
  // source-note exporter can have failed to close a page-local LaTeX fence.
  // Continuity is not proof because an example can use consecutive numbers.
  // Never promote such a line. Also withhold the preceding outside-fence page
  // whose raw block would otherwise span the ambiguous boundary; resume only
  // at a later unambiguous outside-fence delimiter.
  const exactCandidates = lines.flatMap((line) => {
    const match = /^## Page ([1-9]\d*)[ \t]*$/.exec(line.content);
    if (!match) return [];
    const pageNumber = Number(match[1]);
    if (!Number.isSafeInteger(pageNumber)) {
      throw new Error("Canonical source-page evidence contains a page identity outside the safe integer range.");
    }
    return [{ line, pageNumber }];
  });
  const allSeenPages = new Set<number>();
  for (const candidate of exactCandidates) {
    if (allSeenPages.has(candidate.pageNumber)) {
      throw new Error(`Canonical source-page evidence contains duplicate Page ${candidate.pageNumber}.`);
    }
    allSeenPages.add(candidate.pageNumber);
  }
  const outsideCandidates = exactCandidates.filter((candidate) => !candidate.line.insideFence);
  const pageHeadings = outsideCandidates.filter((candidate, index) => {
    const nextOutsideStart = outsideCandidates[index + 1]?.line.start ?? material.length;
    return !exactCandidates.some((possibleAmbiguous) =>
      possibleAmbiguous.line.insideFence &&
      possibleAmbiguous.line.start > candidate.line.start &&
      possibleAmbiguous.line.start < nextOutsideStart);
  });
  const acceptedHeadingSet = new Set(pageHeadings);
  const ambiguousPageNumbers = exactCandidates
    .filter((candidate) => !acceptedHeadingSet.has(candidate))
    .map((candidate) => candidate.pageNumber);
  if (pageHeadings.length === 0) return { pages: [], ambiguousPageNumbers };

  const seenPages = new Set<number>();
  const pages = pageHeadings.map((heading) => {
    const pageNumber = heading.pageNumber;
    if (seenPages.has(pageNumber)) {
      throw new Error(`Canonical source-page evidence contains duplicate Page ${pageNumber}.`);
    }
    seenPages.add(pageNumber);
    const start = heading.line.start;
    const exactIndex = exactCandidates.indexOf(heading);
    const end = exactCandidates[exactIndex + 1]?.line.start ?? material.length;
    return {
      sourceId,
      pageNumber,
      exactText: material.slice(start, end),
      complete: true as const,
    };
  });
  return { pages, ambiguousPageNumbers };
}

export function canonicalSourceRawPageBlocks(
  sourceId: string,
  body: string | undefined,
): CanonicalSourceRawPageBlock[] {
  return parseCanonicalSourceRawPages(sourceId, body).pages;
}

/** Mechanically hydrate model-selected source/page identities to complete raw
 * page blocks.  Selection order is retained exactly; duplicates, unknown
 * sources/pages, and any page/character cap violation fail closed. */
export function hydrateSelectedCanonicalSourceRawPages(input: {
  sources: readonly CanonicalSourceRawPageInput[];
  selections: readonly CanonicalSourceRawPageSelection[];
  maxPages: number;
  maxChars: number;
}): CanonicalSourceRawPageBlock[] {
  if (!Number.isSafeInteger(input.maxPages) || input.maxPages <= 0) {
    throw new Error("Selected canonical source-page evidence requires a positive integer page cap.");
  }
  if (!Number.isSafeInteger(input.maxChars) || input.maxChars <= 0) {
    throw new Error("Selected canonical source-page evidence requires a positive integer character cap.");
  }
  if (input.selections.length === 0) {
    throw new Error("Selected canonical source-page evidence requires at least one model-selected page.");
  }
  if (input.selections.length > input.maxPages) {
    throw new Error(
      `Selected canonical source-page evidence exceeds the ${input.maxPages}-page recovery cap.`,
    );
  }

  const sourceIds = new Set<string>();
  const pagesBySource = new Map<string, Map<number, CanonicalSourceRawPageBlock>>();
  for (const source of input.sources) {
    if (!source.sourceId || source.sourceId.trim() !== source.sourceId) {
      throw new Error("Selected canonical source-page evidence contains an invalid source id.");
    }
    if (sourceIds.has(source.sourceId)) {
      throw new Error(`Selected canonical source-page evidence contains duplicate source "${source.sourceId}".`);
    }
    sourceIds.add(source.sourceId);
    pagesBySource.set(
      source.sourceId,
      new Map(
        canonicalSourceRawPageBlocks(source.sourceId, source.body)
          .map((page) => [page.pageNumber, page]),
      ),
    );
  }

  const seen = new Set<string>();
  const hydrated: CanonicalSourceRawPageBlock[] = [];
  let totalChars = 0;
  for (const [index, selection] of input.selections.entries()) {
    if (!selection.sourceId || selection.sourceId.trim() !== selection.sourceId) {
      throw new Error(`Selected canonical source-page evidence selection ${index + 1} has an invalid source id.`);
    }
    if (!Number.isSafeInteger(selection.pageNumber) || selection.pageNumber < 1) {
      throw new Error(`Selected canonical source-page evidence selection ${index + 1} has an invalid page number.`);
    }
    const identity = `${selection.sourceId}\0${selection.pageNumber}`;
    if (seen.has(identity)) {
      throw new Error(
        `Selected canonical source-page evidence repeats ${selection.sourceId} Page ${selection.pageNumber}.`,
      );
    }
    seen.add(identity);
    const page = pagesBySource.get(selection.sourceId)?.get(selection.pageNumber);
    if (!page) {
      throw new Error(
        `Selected canonical source-page evidence references unknown ${selection.sourceId} Page ${selection.pageNumber}.`,
      );
    }
    totalChars += page.exactText.length;
    if (totalChars > input.maxChars) {
      throw new Error(
        `Selected canonical source-page evidence exceeds the ${input.maxChars}-character recovery cap; complete pages cannot be truncated.`,
      );
    }
    hydrated.push(page);
  }
  return hydrated;
}

function sourcePlanningIndexForCoverage(
  body: string | undefined,
  maxChars: number,
): { text: string; truncated: boolean } {
  const text = String(body ?? "");
  const boundary = text.search(/^## Internal planning[ \t]*\r?$/m);
  const index = boundary >= 0 ? text.slice(0, boundary) : text;
  if (maxChars <= 0) return { text: "", truncated: index.length > 0 };
  return {
    text: index.slice(0, maxChars),
    truncated: index.length > maxChars,
  };
}

/**
 * Copy a bounded set of canonical source pages without summarizing, matching,
 * or repairing them.  A source note that claims page structure must use unique
 * positive integer `## Page N` headings: an ambiguous page identity is unsafe
 * evidence for a citation decision and therefore fails closed before a model
 * call.  Unpaged source material remains valid and is copied verbatim up to
 * the caller's bounded transport budget.
 */
export function boundedCanonicalSourcePageEvidence(
  sourceId: string,
  body: string | undefined,
  maxChars: number,
  options: { maxPages?: number } = {},
): CanonicalSourcePageEvidence {
  const maxPages = options.maxPages ?? SYLLABUS_COVERAGE_RAW_PAGE_MAX_PAGES_PER_SOURCE;
  if (!sourceId || sourceId.trim() !== sourceId) {
    throw new Error("Canonical source-page evidence requires an exact non-empty source id.");
  }
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new Error("Canonical source-page evidence requires a positive integer character budget.");
  }
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
    throw new Error("Canonical source-page evidence requires a positive integer page budget.");
  }

  const material = canonicalSourceMaterialBody(body);
  const parsedPages = parseCanonicalSourceRawPages(sourceId, body);
  const allPages = parsedPages.pages;
  if (allPages.length === 0) {
    if (parsedPages.ambiguousPageNumbers.length > 0) {
      return {
        pages: [],
        omittedPageCount: parsedPages.ambiguousPageNumbers.length,
        truncated: true,
      };
    }
    const complete = material.length <= maxChars;
    return {
      pages: [],
      ...(material ? {
        unpagedEvidence: {
          sourceId,
          exactText: material.slice(0, maxChars),
          complete,
        },
      } : {}),
      omittedPageCount: 0,
      truncated: !complete,
    };
  }

  const requiredRecords = allPages.slice(0, SYLLABUS_COVERAGE_IDENTITY_PAGE_PREFIX);
  const lastRequiredPageNumber = requiredRecords.at(-1)?.pageNumber ?? 0;
  if (parsedPages.ambiguousPageNumbers.some((pageNumber) => pageNumber <= lastRequiredPageNumber)) {
    throw new Error(
      `Canonical source-page evidence has an ambiguous fenced page boundary inside its fixed identity prefix for source "${sourceId}".`,
    );
  }
  const requiredChars = requiredRecords.reduce((sum, page) => sum + page.exactText.length, 0);
  if (requiredRecords.length > maxPages || requiredChars > maxChars) {
    throw new Error(
      `Canonical source-page evidence cannot carry its complete fixed identity prefix for source "${sourceId}" within its bounded transport budget.`,
    );
  }

  const pages = requiredRecords.map((page) => ({
    sourceId,
    pageNumber: page.pageNumber,
    exactText: page.exactText,
    complete: true as const,
  }));

  return {
    pages,
    omittedPageCount:
      allPages.length - pages.length + parsedPages.ambiguousPageNumbers.length,
    truncated:
      pages.length !== allPages.length || parsedPages.ambiguousPageNumbers.length > 0,
  };
}

/**
 * Copy exact authored locators into the coverage packet. They remain syllabus
 * input, not source evidence: code never turns one into a source-page choice
 * or a title/author/source match.
 */
export function authoredSyllabusLocatorCatalog(
  materials: readonly Pick<SyllabusReferencedMaterial, "id" | "locator">[],
): Array<{ materialId: string; locator: string }> {
  return materials.flatMap((material) =>
    typeof material.locator === "string"
      ? [{ materialId: material.id, locator: material.locator }]
      : [],
  );
}

/**
 * Build the coverage model's selected-source catalog.  The planning index is
 * useful context but may be generated internal planning text; title, author,
 * and locator evidence is deliberately carried separately as verbatim source
 * pages.  The transport never decides whether either establishes a citation.
 */
export function buildSyllabusCoverageSourceCatalog(
  sources: readonly SyllabusCoverageCatalogSource[],
): Array<{
  id: string;
  relPath: string;
  sourceType?: string;
  sourceFile?: string;
  navigationMetadata: {
    title: string;
    description?: string;
    excerpt?: string;
    planningIndex: string;
    planningIndexTruncated: boolean;
  };
  canonicalRawSourceSha256: string;
  canonicalRawPageEvidence: CanonicalSourcePageEvidence;
}> {
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (!source.slug || source.slug.trim() !== source.slug) {
      throw new Error("Syllabus coverage source catalog contains an invalid source id.");
    }
    if (sourceIds.has(source.slug)) {
      throw new Error(`Syllabus coverage source catalog contains duplicate source "${source.slug}".`);
    }
    sourceIds.add(source.slug);
  }
  const baselineRawChars = Math.max(
    1,
    Math.min(
      SYLLABUS_COVERAGE_RAW_PAGE_MIN_CHARS_PER_SOURCE,
      Math.floor(SYLLABUS_COVERAGE_CATALOG_TOTAL_SOURCE_CHARS / Math.max(1, sources.length)),
    ),
  );
  // Reserve each source's complete canonical identity prefix before allocating
  // generated planning context. Equal per-source slices are unsafe here: one
  // textbook's first eight complete pages can be larger than another source's
  // entire note even though both prefixes fit comfortably in the catalog-wide
  // transport bound.
  const preparedSources = sources.map((source) => {
    const rawMaterial = canonicalSourceMaterialBody(source.body);
    const requiredRawPageChars = parseCanonicalSourceRawPages(source.slug, source.body)
      .pages
      .slice(0, SYLLABUS_COVERAGE_IDENTITY_PAGE_PREFIX)
      .reduce((sum, page) => sum + page.exactText.length, 0);
    if (requiredRawPageChars > SYLLABUS_COVERAGE_RAW_PAGE_MAX_CHARS_PER_SOURCE) {
      throw new Error(
        `Canonical source-page evidence cannot carry its complete fixed identity prefix for source "${source.slug}" within its bounded transport budget.`,
      );
    }
    return {
      source,
      rawMaterial,
      rawPageChars: Math.max(baselineRawChars, requiredRawPageChars),
    };
  });
  const totalRawPageChars = preparedSources.reduce(
    (sum, source) => sum + source.rawPageChars,
    0,
  );
  if (totalRawPageChars > SYLLABUS_COVERAGE_CATALOG_TOTAL_SOURCE_CHARS) {
    throw new Error(
      "Canonical source-page evidence cannot carry every complete fixed identity prefix within the bounded catalog transport budget.",
    );
  }
  const planningIndexChars = Math.floor(
    (SYLLABUS_COVERAGE_CATALOG_TOTAL_SOURCE_CHARS - totalRawPageChars)
      / Math.max(1, sources.length),
  );
  return preparedSources.map(({ source, rawMaterial, rawPageChars }) => {
    const planningIndex = sourcePlanningIndexForCoverage(source.body, planningIndexChars);
    return {
      id: source.slug,
      relPath: source.relPath,
      ...(source.sourceType !== undefined ? { sourceType: source.sourceType } : {}),
      ...(source.sourceFile !== undefined ? { sourceFile: source.sourceFile } : {}),
      navigationMetadata: {
        title: source.title,
        ...(source.description !== undefined ? { description: source.description } : {}),
        ...(source.excerpt !== undefined ? { excerpt: source.excerpt } : {}),
        planningIndex: planningIndex.text,
        planningIndexTruncated: planningIndex.truncated,
      },
      canonicalRawSourceSha256: createHash("sha256").update(rawMaterial).digest("hex"),
      canonicalRawPageEvidence: boundedCanonicalSourcePageEvidence(source.slug, source.body, rawPageChars),
    };
  });
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
      questionReferences: asTextList(record.questionReferences, 100, 160),
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

function exactAuthoredString(value: unknown, path: string, problems: string[]): value is string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    problems.push(`${path} must be a non-empty exact string`);
    return false;
  }
  return true;
}

function exactAuthoredStringArray(value: unknown, path: string, problems: string[]): value is string[] {
  if (!Array.isArray(value)) {
    problems.push(`${path} must be an array of exact strings`);
    return false;
  }
  let valid = true;
  value.forEach((entry, index) => {
    if (!exactAuthoredString(entry, `${path}[${index}]`, problems)) valid = false;
  });
  if (value.every((entry) => typeof entry === "string") && new Set(value).size !== value.length) {
    problems.push(`${path} must not contain duplicates`);
    valid = false;
  }
  return valid;
}

/** Strict active-Learn parser boundary. It reports malformed model output but
 * never trims, truncates, drops, defaults, renames, or de-duplicates semantic
 * fields before the model receives a repair attempt. */
export function modelAuthoredSyllabusPlanProblems(value: unknown): string[] {
  const root = asRecord(value);
  if (!root) return ["syllabus plan must be a JSON object"];
  const problems: string[] = [];
  if (root.courseTitle !== undefined) {
    exactAuthoredString(root.courseTitle, "courseTitle", problems);
  }
  if (!Array.isArray(root.referencedMaterials)) {
    problems.push("referencedMaterials must be an array");
  }
  if (!Array.isArray(root.units)) problems.push("units must be an array");

  const materialIds = new Set<string>();
  const materials = Array.isArray(root.referencedMaterials) ? root.referencedMaterials : [];
  materials.forEach((entry, index) => {
    const material = asRecord(entry);
    const prefix = `referencedMaterials[${index}]`;
    if (!material) {
      problems.push(`${prefix} must be an object`);
      return;
    }
    if (exactAuthoredString(material.id, `${prefix}.id`, problems)) {
      if (materialIds.has(material.id)) problems.push(`${prefix}.id duplicates ${material.id}`);
      materialIds.add(material.id);
    }
    exactAuthoredString(material.citation, `${prefix}.citation`, problems);
    if (material.title !== undefined) exactAuthoredString(material.title, `${prefix}.title`, problems);
    if (material.locator !== undefined) exactAuthoredString(material.locator, `${prefix}.locator`, problems);
    exactAuthoredStringArray(material.authors, `${prefix}.authors`, problems);
    if (typeof material.kind !== "string" || !MATERIAL_KINDS.has(material.kind as SyllabusMaterialKind)) {
      problems.push(`${prefix}.kind is invalid`);
    }
    if (typeof material.required !== "boolean") problems.push(`${prefix}.required must be boolean`);
  });

  const unitIds = new Set<string>();
  const units = Array.isArray(root.units) ? root.units : [];
  units.forEach((entry, index) => {
    const unit = asRecord(entry);
    const prefix = `units[${index}]`;
    if (!unit) {
      problems.push(`${prefix} must be an object`);
      return;
    }
    if (exactAuthoredString(unit.id, `${prefix}.id`, problems)) {
      if (unitIds.has(unit.id)) problems.push(`${prefix}.id duplicates ${unit.id}`);
      unitIds.add(unit.id);
    }
    if (unit.label !== undefined) exactAuthoredString(unit.label, `${prefix}.label`, problems);
    exactAuthoredString(unit.title, `${prefix}.title`, problems);
    exactAuthoredStringArray(unit.objectives, `${prefix}.objectives`, problems);
    exactAuthoredStringArray(unit.topics, `${prefix}.topics`, problems);
    exactAuthoredStringArray(unit.questionReferences, `${prefix}.questionReferences`, problems);
    if (exactAuthoredStringArray(unit.materialIds, `${prefix}.materialIds`, problems)) {
      for (const materialId of unit.materialIds) {
        if (!materialIds.has(materialId)) problems.push(`${prefix}.materialIds references unknown ${materialId}`);
      }
    }
  });
  return [...new Set(problems)];
}

/** Exact projection of a response that passed modelAuthoredSyllabusPlanProblems. */
export function projectModelAuthoredSyllabusPlan(value: unknown): SyllabusPlan {
  const problems = modelAuthoredSyllabusPlanProblems(value);
  if (problems.length > 0) {
    throw new Error(`Invalid model-authored syllabus plan: ${problems.join("; ")}`);
  }
  const root = value as Record<string, unknown>;
  return {
    ...(root.courseTitle !== undefined ? { courseTitle: root.courseTitle as string } : {}),
    referencedMaterials: (root.referencedMaterials as Array<Record<string, unknown>>).map((material) => ({
      id: material.id as string,
      citation: material.citation as string,
      ...(material.title !== undefined ? { title: material.title as string } : {}),
      authors: [...(material.authors as string[])],
      kind: material.kind as SyllabusMaterialKind,
      ...(material.locator !== undefined ? { locator: material.locator as string } : {}),
      required: material.required as boolean,
    })),
    units: (root.units as Array<Record<string, unknown>>).map((unit) => ({
      id: unit.id as string,
      ...(unit.label !== undefined ? { label: unit.label as string } : {}),
      title: unit.title as string,
      objectives: [...(unit.objectives as string[])],
      topics: [...(unit.topics as string[])],
      questionReferences: [...(unit.questionReferences as string[])],
      materialIds: [...(unit.materialIds as string[])],
    })),
  };
}

// ---------------------------------------------------------------------------
// Validating the model-authored syllabus decision
// ---------------------------------------------------------------------------

const MATERIAL_STATUSES = new Set<SyllabusMaterialStatus>([
  "available",
  "missing",
  "generic",
]);

function exactStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function duplicateStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function sameStringsInOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Mechanically validate a complete model-authored availability/coverage
 * decision. This intentionally contains no title matching, token scoring,
 * chapter inference, or teachability rule.
 */
export function syllabusCoverageDecisionProblems(
  value: unknown,
  plan: SyllabusPlan,
  knownSourceIds: readonly string[],
): string[] {
  const root = asRecord(value);
  if (!root) return ["coverage decision must be a JSON object"];

  const problems: string[] = [];
  const rawResolutions = Array.isArray(root.resolutions) ? root.resolutions : [];
  const rawUnits = Array.isArray(root.units) ? root.units : [];
  if (!Array.isArray(root.resolutions)) problems.push("resolutions must be an array");
  if (!Array.isArray(root.units)) problems.push("units must be an array");
  if (rawResolutions.length !== plan.referencedMaterials.length) {
    problems.push(
      `resolutions must contain exactly ${plan.referencedMaterials.length} entries, one for every referenced material`,
    );
  }
  if (rawUnits.length !== plan.units.length) {
    problems.push(`units must contain exactly ${plan.units.length} entries, one for every syllabus unit`);
  }

  const knownSources = new Set(knownSourceIds);
  const knownMaterials = new Map(plan.referencedMaterials.map((material) => [material.id, material]));
  const resolutionById = new Map<string, SyllabusMaterialResolution>();

  rawResolutions.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      problems.push(`resolutions[${index}] must be an object`);
      return;
    }
    const expected = plan.referencedMaterials[index];
    const materialId = typeof record.materialId === "string" ? record.materialId : "";
    if (!materialId) problems.push(`resolutions[${index}].materialId is required`);
    if (expected && materialId !== expected.id) {
      problems.push(`resolutions[${index}].materialId must be exact plan id ${expected.id}`);
    }
    const material = knownMaterials.get(materialId);
    if (!material) problems.push(`resolutions[${index}] references unknown material id ${materialId || "(empty)"}`);
    if (resolutionById.has(materialId)) problems.push(`material resolution ${materialId} is duplicated`);

    const citation = typeof record.citation === "string" ? record.citation : "";
    if (material && citation !== material.citation) {
      problems.push(`resolution ${materialId}.citation must exactly equal the extracted syllabus citation`);
    }
    const status = typeof record.status === "string" ? record.status : "";
    if (!MATERIAL_STATUSES.has(status as SyllabusMaterialStatus)) {
      problems.push(`resolution ${materialId || index}.status must be available, missing, or generic`);
    }
    if (!exactStringArray(record.sourceIds)) {
      problems.push(`resolution ${materialId || index}.sourceIds must be an array of exact source ids`);
    }
    const sourceIds = exactStringArray(record.sourceIds) ? record.sourceIds : [];
    for (const duplicate of duplicateStrings(sourceIds)) {
      problems.push(`resolution ${materialId || index}.sourceIds duplicates ${duplicate}`);
    }
    for (const sourceId of sourceIds) {
      if (!knownSources.has(sourceId)) {
        problems.push(`resolution ${materialId || index} references unknown source id ${sourceId}`);
      }
    }
    if (status === "available" && sourceIds.length === 0) {
      problems.push(`available material ${materialId || index} must select at least one exact source id`);
    }
    if ((status === "missing" || status === "generic") && sourceIds.length > 0) {
      problems.push(`${status} material ${materialId || index} must not select source ids`);
    }
    const matchReason = typeof record.matchReason === "string" ? record.matchReason : "";
    if (!matchReason.trim()) problems.push(`resolution ${materialId || index}.matchReason is required`);

    if (
      material &&
      MATERIAL_STATUSES.has(status as SyllabusMaterialStatus) &&
      exactStringArray(record.sourceIds) &&
      matchReason.trim()
    ) {
      resolutionById.set(materialId, {
        materialId,
        citation,
        status: status as SyllabusMaterialStatus,
        sourceIds: [...sourceIds],
        matchReason,
      });
    }
  });

  const seenUnitIds = new Set<string>();
  rawUnits.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      problems.push(`units[${index}] must be an object`);
      return;
    }
    const expected = plan.units[index];
    const unitId = typeof record.unitId === "string" ? record.unitId : "";
    if (!unitId) problems.push(`units[${index}].unitId is required`);
    if (expected && unitId !== expected.id) {
      problems.push(`units[${index}].unitId must be exact plan id ${expected.id}`);
    }
    const unit = plan.units.find((candidate) => candidate.id === unitId);
    if (!unit) problems.push(`units[${index}] references unknown syllabus unit id ${unitId || "(empty)"}`);
    if (seenUnitIds.has(unitId)) problems.push(`syllabus unit coverage ${unitId} is duplicated`);
    seenUnitIds.add(unitId);

    if (!exactStringArray(record.availableSourceIds)) {
      problems.push(`unit ${unitId || index}.availableSourceIds must be an array of exact source ids`);
    }
    const availableSourceIds = exactStringArray(record.availableSourceIds)
      ? record.availableSourceIds
      : [];
    for (const duplicate of duplicateStrings(availableSourceIds)) {
      problems.push(`unit ${unitId || index}.availableSourceIds duplicates ${duplicate}`);
    }
    for (const sourceId of availableSourceIds) {
      if (!knownSources.has(sourceId)) {
        problems.push(`unit ${unitId || index} references unknown source id ${sourceId}`);
      }
    }

    if (!exactStringArray(record.missingCitations)) {
      problems.push(`unit ${unitId || index}.missingCitations must be an array of exact citations`);
    }
    const missingCitations = exactStringArray(record.missingCitations)
      ? record.missingCitations
      : [];
    if (unit) {
      // Citations are display strings, not material identities. Distinct
      // model-authored material ids may legitimately copy the same exact
      // citation, so the ordered equality below is deliberately the sole
      // multiplicity check for this array.
      const expectedMissing = unit.materialIds.flatMap((materialId) => {
        const resolution = resolutionById.get(materialId);
        return resolution?.status === "missing" ? [resolution.citation] : [];
      });
      if (!sameStringsInOrder(missingCitations, expectedMissing)) {
        problems.push(
          `unit ${unitId}.missingCitations must exactly list, in syllabus order, its materials resolved as missing`,
        );
      }

      const assignedAvailableSources = new Set(unit.materialIds.flatMap((materialId) => {
        const resolution = resolutionById.get(materialId);
        return resolution?.status === "available" ? resolution.sourceIds : [];
      }));
      if (
        assignedAvailableSources.size > 0 &&
        !availableSourceIds.some((sourceId) => assignedAvailableSources.has(sourceId))
      ) {
        problems.push(
          `unit ${unitId}.availableSourceIds must include at least one source selected for its available assigned material`,
        );
      }
    }

    // Teachability is a model-authored full-unit verdict. A false verdict may
    // retain exact partial support above; this validator never promotes it or
    // removes its source provenance to satisfy a mechanical array rule.
    if (typeof record.teachable !== "boolean") {
      problems.push(`unit ${unitId || index}.teachable must be boolean`);
    } else if (record.teachable && availableSourceIds.length === 0) {
      problems.push(`teachable unit ${unitId || index} must select at least one exact supporting source id`);
    }
    if (typeof record.coverageReason !== "string" || !record.coverageReason.trim()) {
      problems.push(`unit ${unitId || index}.coverageReason is required`);
    }
  });

  return [...new Set(problems)];
}

/** Project a validated model decision into the persisted coverage shape. */
export function projectModelAuthoredSyllabusCoverage(
  plan: SyllabusPlan,
  value: unknown,
  knownSourceIds: readonly string[],
): SyllabusCoverage {
  const problems = syllabusCoverageDecisionProblems(value, plan, knownSourceIds);
  if (problems.length > 0) {
    throw new Error(`Invalid model-authored syllabus coverage: ${problems.join("; ")}`);
  }
  const decision = value as ModelAuthoredSyllabusCoverageDecision;
  const authoredUnits = new Map(decision.units.map((unit) => [unit.unitId, unit]));
  const units: SyllabusUnitCoverage[] = plan.units.map((unit) => {
    const authored = authoredUnits.get(unit.id)!;
    return {
      unitId: unit.id,
      label: unit.label,
      title: unit.title,
      objectives: [...unit.objectives],
      topics: [...unit.topics],
      // Older persisted syllabus plans predate explicit question references.
      // Treat the absent field as an empty assignment instead of failing a
      // recovery/finalization pass while the plan is being upgraded.
      questionReferences: [...(unit.questionReferences ?? [])],
      availableSourceIds: [...authored.availableSourceIds],
      missingCitations: [...authored.missingCitations],
      teachable: authored.teachable,
      coverageReason: authored.coverageReason,
    };
  });
  const availableSourceIds = [...new Set(units.flatMap((unit) => unit.availableSourceIds))];
  return {
    courseTitle: plan.courseTitle,
    plan,
    resolutions: decision.resolutions.map((resolution) => ({
      materialId: resolution.materialId,
      citation: resolution.citation,
      status: resolution.status,
      sourceIds: [...resolution.sourceIds],
      matchReason: resolution.matchReason,
    })),
    units,
    availableSourceIds,
    missingCitations: decision.resolutions
      .filter((resolution) => resolution.status === "missing")
      .map((resolution) => resolution.citation),
    untaughtUnitTitles: units
      .filter((unit) => !unit.teachable)
      .map((unit) => `${unit.label ? `${unit.label}: ` : ""}${unit.title}`),
  };
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

/** Exact model-authored citation/title matcher. Layout whitespace may differ,
 * but punctuation and every authored word must remain present in order. */
function exactAuthoredPhrasePattern(value: string): RegExp {
  return new RegExp(
    value.trim().split(/\s+/).map(escapeRegExp).join("\\s+"),
    "i",
  );
}

/**
 * Build the probes that decide whether a page wrote about material the garden
 * does not have.
 *
 * This is an exact mechanical guard, not another material resolver. It checks
 * only the full citation and full optional title authored in the syllabus
 * contract. It never infers equivalence from keywords, authors, or years.
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
    probes.push({
      citation: material.citation,
      pattern: exactAuthoredPhrasePattern(material.citation),
    });

    // The exact optional title is also a verbatim authored identifier.
    if (material.title && material.title !== material.citation) {
      probes.push({ citation: material.citation, pattern: exactAuthoredPhrasePattern(material.title) });
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
