import { createHash } from "node:crypto";

import {
  canonicalSourceMaterialBody,
  canonicalSourceRawPageBlocks,
  hydrateSelectedCanonicalSourceRawPages,
  projectModelAuthoredSyllabusCoverage,
  syllabusCoverageDecisionProblems,
  type ModelAuthoredSyllabusCoverageDecision,
  type SyllabusCoverage,
  type SyllabusPlan,
} from "./learn-syllabus.ts";
import { parseJsonCandidate } from "./learn-utils.ts";
import type { ModelSourcePageAnchorRecord } from "./model-source-anchor-ledger.ts";

export const SYLLABUS_COVERAGE_RECOVERY_SCHEMA_VERSION = 2 as const;
export const SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT_VERSION =
  "syllabus-coverage-page-selector-v5" as const;
export const SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT_VERSION =
  "syllabus-coverage-independent-review-v3" as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES = 3 as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_REVIEW_CANDIDATES = 3 as const;
// Live 2026-09-25 (telecom-1): a whole-course syllabus reading (28 units) spread
// 32 pages about one per unit, so M1 units with a dedicated lecture (Spread
// Spectrum, BER) stayed unteachable on a single partial page.
export const SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES = 48 as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_CHARS = 180_000 as const;
/**
 * A ceiling on selectable page identities, not on payload: the transport bound
 * is MAX_CATALOG_CHARS below, and `recoveryCatalogTransport` already shrinks
 * every navigation excerpt (320 chars, then 40, then 0) to stay under it.
 *
 * 2000 was too low for a whole-module course. Live 2026-09-21 (telecom-1 M1):
 * the eleven course documents plus Couch, Molisch, Sauter, Dahlman and Keiser
 * carry ~4300 canonical page identities, so recovery failed closed before the
 * selector could see any of them - while the same catalog at zero excerpt is
 * only ~86 KB against the 500 KB transport cap. Raising this keeps the
 * documented intent above ("keep every canonical page identity selectable")
 * true for large source sets; the char cap remains the real limit.
 */
export const SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES = 8_000 as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS = 500_000 as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_RAW_RESPONSE_CHARS = 512_000 as const;

const SHA256 = /^[0-9a-f]{64}$/;

export interface SyllabusCoverageRecoverySource {
  sourceId: string;
  relPath: string;
  body?: string;
}

export interface SyllabusCoverageRecoverySelection {
  anchorId: string;
  sourceId: string;
  pageNumber: number;
  selectionReason: string;
}

export interface SyllabusCoverageRecoverySelectedPage
  extends SyllabusCoverageRecoverySelection {
  exactText: string;
  exactTextSha256: string;
  canonicalRawSourceSha256: string;
}

export interface SyllabusCoverageRecoveryAttempt {
  phase: "page_selection" | "coverage_rereview";
  /** The candidate that produced this answer, 1-based and within its cap. */
  ordinal: number;
  requestSha256: string;
  rawResponse: string;
  rawResponseSha256: string;
  validationProblems: string[];
  councilRunId?: string;
  model: string;
}

export interface SyllabusCoverageEvidenceRecoveryReceipt {
  schemaVersion: typeof SYLLABUS_COVERAGE_RECOVERY_SCHEMA_VERSION;
  protocol: "syllabus_coverage_evidence_recovery";
  selectorPromptVersion: typeof SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT_VERSION;
  coverageReviewPromptVersion: typeof SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT_VERSION;
  caps: {
    maximumSelectorCandidates: typeof SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES;
    maximumCoverageReviewCandidates: typeof SYLLABUS_COVERAGE_RECOVERY_MAX_REVIEW_CANDIDATES;
    maximumSelectedPages: typeof SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES;
    maximumSelectedChars: typeof SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_CHARS;
    maximumCatalogEntries: typeof SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES;
    maximumCatalogChars: typeof SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS;
    maximumRawResponseChars: typeof SYLLABUS_COVERAGE_RECOVERY_MAX_RAW_RESPONSE_CHARS;
  };
  model: string;
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  syllabusPlan: SyllabusPlan;
  syllabusPlanSha256: string;
  initialCoverageRaw: string;
  initialCoverageRawSha256: string;
  initialCoverageDecisionSha256: string;
  sourceBindings: Array<{
    sourceId: string;
    relPath: string;
    canonicalRawSourceSha256: string;
  }>;
  selectorAttempts: [SyllabusCoverageRecoveryAttempt];
  selectedPages: SyllabusCoverageRecoverySelectedPage[];
  coverageReviewAttempts: [SyllabusCoverageRecoveryAttempt];
  finalCoverageRaw: string;
  finalCoverageDecisionSha256: string;
  /** Syllabus unit ids the initial review judged unteachable, in plan order.
   *  Non-empty: it is what authorised this recovery to run. */
  unteachableUnitIdsBefore: string[];
  /** Syllabus unit ids still unteachable after the independent rereview, in
   *  plan order. Empty means every initially-failed unit was recovered. */
  unteachableUnitIdsAfter: string[];
  outcome: "recovered" | "unchanged" | "regressed" | "zero_teachable";
  integritySha256: string;
}

export interface SyllabusCoverageRecoveryProviderRequest {
  phase: "page_selection" | "coverage_rereview";
  /** 1-based candidate ordinal. Each re-ask must carry its own ordinal: the
   *  planning checkpoint is keyed by (job, stage, semanticAttempt), so reusing
   *  it makes the second candidate collide on that unique index. */
  attempt: number;
  system: string;
  user: string;
  sourceContext: Record<string, unknown>;
}

export interface SyllabusCoverageRecoveryProviderResult {
  rawResponse: string;
  councilRunId?: string;
  model?: string;
}

export interface SyllabusCoverageRecoveryRunResult {
  decision: ModelAuthoredSyllabusCoverageDecision;
  coverage: SyllabusCoverage;
  receipt: SyllabusCoverageEvidenceRecoveryReceipt;
  recovered: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Recovery provenance contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Match JSON object semantics for optional projected fields: an absent
    // optional property and an in-memory `undefined` property serialize to the
    // same durable object. Arrays and required-field validation remain strict.
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("Recovery provenance contains a non-JSON value.");
}

function hashJson(value: unknown): string {
  return sha256(canonicalJson(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function nonEmptyExactString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sourceBindings(sources: readonly SyllabusCoverageRecoverySource[]) {
  const seen = new Set<string>();
  const seenPaths = new Set<string>();
  return sources.map((source, index) => {
    if (!nonEmptyExactString(source.sourceId)) {
      throw new Error(`Recovery source ${index + 1} has an invalid source id.`);
    }
    if (seen.has(source.sourceId)) {
      throw new Error(`Recovery source id "${source.sourceId}" appears more than once.`);
    }
    seen.add(source.sourceId);
    if (!nonEmptyExactString(source.relPath)) {
      throw new Error(`Recovery source "${source.sourceId}" has an invalid relative path.`);
    }
    const pathSegments = source.relPath.split("/");
    if (source.relPath.includes("\\") || source.relPath.startsWith("/") ||
        /^[A-Za-z]:/.test(source.relPath) ||
        pathSegments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`Recovery source "${source.sourceId}" has a non-canonical or unsafe relative path.`);
    }
    if (seenPaths.has(source.relPath)) {
      throw new Error(`Recovery source path "${source.relPath}" is assigned to more than one source id.`);
    }
    seenPaths.add(source.relPath);
    return {
      sourceId: source.sourceId,
      relPath: source.relPath,
      canonicalRawSourceSha256: sha256(canonicalSourceMaterialBody(source.body)),
    };
  });
}

interface RecoveryCatalogEntry {
  anchorId: string;
  sourceId: string;
  pageNumber: number;
  title: string;
  excerpt: string;
  navigationTextSha256: string;
}

// The selector only needs a bounded navigation preview and an exact way to
// identify the source/page pair. Repeating the long source ids and anchor ids
// in every object made a legitimate multi-book catalog exceed the transport
// cap before the model could select anything. Keep the canonical entries in
// memory for validation, but send compact source-indexed tuples over the model
// boundary. The alias is resolved back to the canonical anchor before any
// evidence is hydrated or persisted.
type RecoveryCatalogTransportEntry = readonly [
  alias: string,
  sourceIndex: number,
  pageNumber: number,
  excerpt: string,
];

interface RecoveryCatalogTransport {
  sourceIds: string[];
  pageCatalog: RecoveryCatalogTransportEntry[];
}

function recoveryCatalogTransport(
  catalog: readonly RecoveryCatalogEntry[],
): RecoveryCatalogTransport {
  const sourceIds = [...new Set(catalog.map((entry) => entry.sourceId))];
  const sourceIndexes = new Map(sourceIds.map((sourceId, index) => [sourceId, index]));
  const catalogAtExcerptLimit = (excerptLimit: number): RecoveryCatalogTransport => ({
    sourceIds,
    pageCatalog: catalog.map((entry, index) => [
      `p${index}`,
      sourceIndexes.get(entry.sourceId)!,
      entry.pageNumber,
      entry.excerpt.slice(0, excerptLimit),
    ]),
  });
  const chars = (candidate: RecoveryCatalogTransport): number =>
    JSON.stringify(candidate).length;
  let transport = catalogAtExcerptLimit(40);
  if (chars(transport) <= SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS) {
    return transport;
  }
  transport = catalogAtExcerptLimit(0);
  if (chars(transport) > SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS) {
    throw new Error(
      `Syllabus coverage recovery page catalog exceeds the ${SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS}-character cap.`,
    );
  }
  let lower = 1;
  let upper = 39;
  while (lower <= upper) {
    const candidateLimit = Math.floor((lower + upper) / 2);
    const candidate = catalogAtExcerptLimit(candidateLimit);
    if (chars(candidate) <= SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS) {
      transport = candidate;
      lower = candidateLimit + 1;
    } else {
      upper = candidateLimit - 1;
    }
  }
  return transport;
}

function recoveryCatalog(input: {
  sources: readonly SyllabusCoverageRecoverySource[];
  anchors: readonly ModelSourcePageAnchorRecord[];
}): RecoveryCatalogEntry[] {
  const knownSources = new Set(input.sources.map((source) => source.sourceId));
  const rawPageIdentities = new Set(input.sources.flatMap((source) =>
    canonicalSourceRawPageBlocks(source.sourceId, source.body)
      .map((page) => `${page.sourceId}\0${page.pageNumber}`)));
  // Structural anchors are navigation-only and can include internal headings
  // or headings withheld by the raw parser as fence-tainted. Filter those out
  // before applying catalog identity/collision checks: an untrusted anchor is
  // neither selector-visible authority nor a reason to reject otherwise valid
  // canonical evidence.
  const authoritativeAnchors = input.anchors.filter((anchor) =>
    knownSources.has(anchor.sourceId) &&
    Number.isSafeInteger(anchor.page) &&
    anchor.page > 0 &&
    rawPageIdentities.has(`${anchor.sourceId}\0${anchor.page}`));
  if (authoritativeAnchors.length === 0) {
    throw new Error("Syllabus coverage recovery has no canonical source-material page identities to select.");
  }
  if (authoritativeAnchors.length > SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES) {
    throw new Error(
      `Syllabus coverage recovery page catalog exceeds the ${SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES}-entry cap.`,
    );
  }
  const seenAnchors = new Set<string>();
  const seenPages = new Set<string>();
  const preparedCatalog = authoritativeAnchors.map((anchor, index) => {
    if (!nonEmptyExactString(anchor.id) || seenAnchors.has(anchor.id)) {
      throw new Error(`Syllabus coverage recovery page catalog has a duplicate or invalid anchor id at ${index + 1}.`);
    }
    seenAnchors.add(anchor.id);
    const pageIdentity = `${anchor.sourceId}\0${anchor.page}`;
    if (seenPages.has(pageIdentity)) {
      throw new Error(
        `Syllabus coverage recovery page catalog maps more than one anchor to ${anchor.sourceId} Page ${anchor.page}.`,
      );
    }
    seenPages.add(pageIdentity);
    if (!anchor.exactText) {
      throw new Error(`Syllabus coverage recovery anchor "${anchor.id}" has no navigation text.`);
    }
    return {
      anchorId: anchor.id,
      sourceId: anchor.sourceId,
      pageNumber: anchor.page,
      title: anchor.title,
      navigationText: anchor.exactText.replace(/\s+/gu, " ").trim(),
      navigationTextSha256: sha256(anchor.exactText),
    };
  });

  // Keep every canonical page identity selectable. Large multi-source courses
  // can exceed the transport cap solely because every navigation excerpt used
  // its individual 320-character maximum. Shrink that non-authoritative
  // preview uniformly and deterministically; the chosen page is still hydrated
  // from its complete canonical bytes for the independent review.
  const catalogAtExcerptLimit = (excerptLimit: number): RecoveryCatalogEntry[] =>
    preparedCatalog.map((entry) => ({
      anchorId: entry.anchorId,
      sourceId: entry.sourceId,
      pageNumber: entry.pageNumber,
      title: entry.title,
      excerpt: entry.navigationText.slice(0, excerptLimit),
      navigationTextSha256: entry.navigationTextSha256,
    }));
  // Measure what actually crosses the model boundary. The canonical entry
  // keeps a full source slug, title and 64-character digest for validation,
  // none of which is transmitted: `recoveryCatalogTransport` sends compact
  // source-indexed tuples instead. Sizing the canonical form against the
  // transport cap made a whole-module course fail closed at ~860 KB while its
  // real request was ~86 KB (telecom-1 M1, 2026-09-21, sixteen sources).
  const catalogChars = (catalog: readonly RecoveryCatalogEntry[]): number =>
    JSON.stringify(recoveryCatalogTransport(catalog)).length;

  let catalog = catalogAtExcerptLimit(320);
  if (catalogChars(catalog) <= SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS) {
    return catalog;
  }
  catalog = catalogAtExcerptLimit(0);
  if (catalogChars(catalog) > SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS) {
    throw new Error(
      `Syllabus coverage recovery page catalog exceeds the ${SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS}-character cap.`,
    );
  }
  let lower = 1;
  let upper = 319;
  while (lower <= upper) {
    const candidateLimit = Math.floor((lower + upper) / 2);
    const candidate = catalogAtExcerptLimit(candidateLimit);
    if (catalogChars(candidate) <= SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS) {
      catalog = candidate;
      lower = candidateLimit + 1;
    } else {
      upper = candidateLimit - 1;
    }
  }
  return catalog;
}

export const SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT = `You select exact canonical source pages for an independent syllabus-coverage rereview.
Return ONLY JSON with exactly this shape:
{"selectedPages":[{"anchorId":"exact supplied compact page alias","selectionReason":"why this complete page can resolve an evidence gap"}],"selectionReason":"why this bounded set is sufficient"}
Hard rules:
- Selection is semantic and model-authored. Choose only exact aliases from pageCatalog; code will never match a syllabus locator, title, author, or topic to a page for you.
- Select at least one and no more than the supplied maximumSelectedPages. Do not repeat a page.
- Spend the page budget first on the units whose prior verdict is teachable=false: those are the
  verdicts this rereview exists to test, and each one's coverageReason names what the prior
  reviewer could not see. A unit already judged teachable needs a page only when the same page
  also serves an untaught unit.
- Skip an untaught unit that no catalog source plausibly covers (for example a module the
  selected documents never treat): no page can change its verdict. Give each remaining untaught
  unit enough complete pages to test its whole topic (every mechanism its coverageReason says
  is unseen), not one page per unit.
- Prefer the smallest set that can test both cited-work identity and unit-level support. Bibliographic/front-matter pages may establish exact title/author/edition/publisher or locator identity, but cannot alone establish unit teachability; pair them with substantive teaching pages where needed.
- Return only the chosen compact alias and your reason. The alias already binds the canonical source and page number; do not repeat, invent, expand, or renumber either identity.
- The next reviewer receives each selected page in full. Do not quote or rewrite page content in this response.`;

export const SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT = `You independently re-author the complete syllabus material-resolution and unit-coverage decision from canonical source evidence.
Return ONLY JSON with exactly two top-level arrays: resolutions and units, using the same complete shape and order as initialCoverageDecision.
Hard rules:
- Return exactly one resolution for every syllabusPlan.referencedMaterials entry and one unit record for every syllabusPlan.units entry, in supplied order. Copy IDs and citations exactly.
- The fixed source prefix and recoveredPages are verbatim evidence. Navigation metadata, filenames, locators, page excerpts, the prior verdict, and selection reasons are context only and never prove content.
- Judge every resolution and teachable verdict yourself from the complete raw evidence. Do not preserve or flip a verdict merely to satisfy the planner. A valid all-false result is allowed and terminates planning before a Learning Unit Contract call.
- available requires direct canonical evidence for the cited work/assigned part; missing uses no sourceIds; generic is only an uncheckable reference.
- A unit is teachable when the evidence teaches its core: the central idea or mechanism its objectives and topics name, explained rather than merely mentioned. Missing evidence for some listed subtopics does not make it unteachable; name each unsupported subtopic in coverageReason ("not evidenced: ...") so lessons omit it. Only a unit whose core is not taught is unteachable.
- An unteachable unit may retain partial supporting source IDs. A teachable unit must select at least one exact supporting source ID.
- If an assigned material is available, the unit's availableSourceIds must include at least one source selected for that material, whether or not the unit is teachable.
- missingCitations must exactly project assigned materials resolved missing, including intentional repeated citations.
- Do not return a patch, explanation, score, or prose outside the JSON object.`;

function selectorRequest(input: {
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  syllabusPlan: SyllabusPlan;
  initialDecision: ModelAuthoredSyllabusCoverageDecision;
  catalog: RecoveryCatalogTransport;
}): SyllabusCoverageRecoveryProviderRequest {
  const user = JSON.stringify({
    protocolVersion: SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT_VERSION,
    sourceSetHash: input.sourceSetHash,
    sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
    syllabusPlan: input.syllabusPlan,
    initialCoverageDecision: input.initialDecision,
    sourceIds: input.catalog.sourceIds,
    // Each tuple is [compact anchor alias, source index, page number,
    // bounded navigation excerpt]. The source index resolves through
    // sourceIds above; canonical anchor ids remain internal validation data.
    pageCatalog: input.catalog.pageCatalog,
    caps: {
      maximumSelectedPages: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES,
      maximumSelectedChars: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_CHARS,
    },
  });
  return {
    phase: "page_selection",
    attempt: 1,
    system: SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT,
    user,
    sourceContext: {
      taskType: "syllabus_coverage_page_selection",
      sourceSetHash: input.sourceSetHash,
      sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
      protocolVersion: SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT_VERSION,
    },
  };
}

function pageSelectionProblems(
  value: unknown,
  catalog: readonly RecoveryCatalogEntry[],
  transport: RecoveryCatalogTransport,
): string[] {
  const problems: string[] = [];
  const root = record(value);
  if (!root || !exactKeys(root, ["selectedPages", "selectionReason"])) {
    return ["page-selection response must contain exactly selectedPages and selectionReason"];
  }
  if (!nonEmptyExactString(root.selectionReason)) {
    problems.push("page-selection selectionReason must be a non-empty exact string");
  }
  if (!Array.isArray(root.selectedPages)) {
    return [...problems, "page-selection selectedPages must be an array"];
  }
  if (root.selectedPages.length === 0) {
    problems.push("page-selection selectedPages must contain at least one page");
  }
  if (root.selectedPages.length > SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES) {
    problems.push(
      `page-selection selectedPages exceeds the ${SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES}-page cap`,
    );
  }
  const byId = new Map(transport.pageCatalog.map((entry, index) => [
    entry[0],
    catalog[index],
  ]));
  const seen = new Set<string>();
  root.selectedPages.forEach((raw, index) => {
    const at = `page-selection selectedPages[${index}]`;
    const selection = record(raw);
    if (!selection || !exactKeys(selection, ["anchorId", "selectionReason"])) {
      problems.push(`${at} must contain exactly anchorId and selectionReason`);
      return;
    }
    if (!nonEmptyExactString(selection.anchorId)) {
      problems.push(`${at}.anchorId must be an exact non-empty string`);
      return;
    }
    if (seen.has(selection.anchorId)) problems.push(`${at}.anchorId repeats "${selection.anchorId}"`);
    seen.add(selection.anchorId);
    const expected = byId.get(selection.anchorId);
    if (!expected) {
      problems.push(`${at}.anchorId is not in the canonical page catalog`);
      return;
    }
    if (!expected) {
      problems.push(`${at}.anchorId does not resolve to a valid canonical source page`);
      return;
    }
    if (!nonEmptyExactString(selection.selectionReason)) {
      problems.push(`${at}.selectionReason must be a non-empty exact string`);
    }
  });
  return unique(problems);
}

function canonicalSelections(
  value: unknown,
  catalog: readonly RecoveryCatalogEntry[],
): SyllabusCoverageRecoverySelection[] {
  const root = value as {
    selectedPages: Array<{ anchorId: string; selectionReason: string }>;
  };
  return root.selectedPages.map((selection) => {
    const aliasIndex = Number.parseInt(selection.anchorId.slice(1), 10);
    const canonical = catalog[aliasIndex];
    if (!canonical) {
      throw new Error("Syllabus coverage recovery selected an unknown compact page alias.");
    }
    return {
      anchorId: canonical.anchorId,
      sourceId: canonical.sourceId,
      pageNumber: canonical.pageNumber,
      selectionReason: selection.selectionReason,
    };
  });
}

function reviewRequest(input: {
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  syllabusPlan: SyllabusPlan;
  initialDecision: ModelAuthoredSyllabusCoverageDecision;
  sourceBindings: SyllabusCoverageEvidenceRecoveryReceipt["sourceBindings"];
  selectedPages: readonly SyllabusCoverageRecoverySelectedPage[];
  selectorAttempt: SyllabusCoverageRecoveryAttempt;
}): SyllabusCoverageRecoveryProviderRequest {
  const user = JSON.stringify({
    protocolVersion: SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT_VERSION,
    sourceSetHash: input.sourceSetHash,
    sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
    syllabusPlan: input.syllabusPlan,
    initialCoverageDecision: input.initialDecision,
    sourceBindings: input.sourceBindings,
    selectorReceipt: {
      requestSha256: input.selectorAttempt.requestSha256,
      rawResponseSha256: input.selectorAttempt.rawResponseSha256,
    },
    recoveredPages: input.selectedPages,
  });
  return {
    phase: "coverage_rereview",
    attempt: 1,
    system: SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT,
    user,
    sourceContext: {
      taskType: "syllabus_coverage_recovery_review",
      sourceSetHash: input.sourceSetHash,
      sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
      protocolVersion: SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT_VERSION,
      selectedPageCount: input.selectedPages.length,
      selectedPageEvidenceHash: hashJson(input.selectedPages),
    },
  };
}

function requestSha256(request: SyllabusCoverageRecoveryProviderRequest): string {
  return hashJson({
    phase: request.phase,
    attempt: request.attempt,
    system: request.system,
    user: request.user,
    sourceContext: request.sourceContext,
  });
}

function attemptRecord(input: {
  request: SyllabusCoverageRecoveryProviderRequest;
  result: SyllabusCoverageRecoveryProviderResult;
  validationProblems: readonly string[];
  fallbackModel: string;
}): SyllabusCoverageRecoveryAttempt {
  if (typeof input.result.rawResponse !== "string") {
    throw new Error("Syllabus coverage recovery provider returned no exact raw response text.");
  }
  if (input.result.rawResponse.length > SYLLABUS_COVERAGE_RECOVERY_MAX_RAW_RESPONSE_CHARS) {
    throw new Error(
      `Syllabus coverage recovery raw response exceeds the ${SYLLABUS_COVERAGE_RECOVERY_MAX_RAW_RESPONSE_CHARS}-character cap.`,
    );
  }
  return {
    phase: input.request.phase,
    // The candidate that actually produced this answer. A re-ask changes the
    // request (attempt is part of its hashed identity), so pinning this to 1
    // would record a request that never ran.
    ordinal: input.request.attempt,
    requestSha256: requestSha256(input.request),
    rawResponse: input.result.rawResponse,
    rawResponseSha256: sha256(input.result.rawResponse),
    validationProblems: unique(input.validationProblems),
    ...(nonEmptyExactString(input.result.councilRunId)
      ? { councilRunId: input.result.councilRunId }
      : {}),
    model: nonEmptyExactString(input.result.model) ? input.result.model : input.fallbackModel,
  };
}

function receiptWithoutIntegrity(
  receipt: Omit<SyllabusCoverageEvidenceRecoveryReceipt, "integritySha256">,
): Omit<SyllabusCoverageEvidenceRecoveryReceipt, "integritySha256"> {
  return receipt;
}

export function syllabusCoverageRecoveryReceiptIntegrity(
  receipt: Omit<SyllabusCoverageEvidenceRecoveryReceipt, "integritySha256">,
): string {
  return hashJson(receiptWithoutIntegrity(receipt));
}

function coverageWithoutReceipt(coverage: SyllabusCoverage): Omit<SyllabusCoverage, "evidenceRecovery"> {
  const { evidenceRecovery: _ignored, ...rest } = coverage;
  return rest;
}

/** Coverage persisted before `assignedMaterials` existed still projects the
 * same semantic decision; compare it without the field it could not have. */
function comparableToPersistedCoverage(
  projected: SyllabusCoverage,
  persisted: SyllabusCoverage,
): Omit<SyllabusCoverage, "evidenceRecovery"> {
  const persistedHasMaterials = persisted.units.some((unit) => unit.assignedMaterials !== undefined);
  if (persistedHasMaterials) return projected;
  return {
    ...projected,
    units: projected.units.map(({ assignedMaterials: _dropped, ...unit }) => unit),
  };
}

export function syllabusCoverageHasTeachableUnits(
  coverage: Pick<SyllabusCoverage, "units"> | null | undefined,
): boolean {
  return Boolean(coverage?.units.some((unit) => unit.teachable));
}

/**
 * The syllabus units a coverage decision refuses to teach, in plan order.
 *
 * Evidence recovery used to run only on an all-false verdict, because that was
 * the case that made the downstream Learning Unit Contract impossible. But the
 * coverage reviewer reaches `teachable: false` whenever the bounded evidence
 * transport did not carry the pages that would have proved support, and that
 * happens per unit. A partial false negative was therefore unrecoverable: the
 * item was dropped, recorded as an uncoverable syllabus warning, and no later
 * stage could revisit it (telecom-1, 2026-09-19: "fixed network architectures"
 * was declared uncoverable while Keiser section 12.1.1 covers it). Recovery is
 * gated on this list instead, so any refused unit gets the one bounded
 * page-selection + rereview pass before the plan is built around its absence.
 */
export function syllabusCoverageUnteachableUnitIds(
  coverage: Pick<SyllabusCoverage, "units"> | null | undefined,
): string[] {
  return (coverage?.units ?? []).filter((unit) => !unit.teachable).map((unit) => unit.unitId);
}

/**
 * The rereview's verdict for the units recovery targeted, over the initial
 * verdict for every other unit.
 *
 * The rereview is handed the fixed source prefix plus recoveredPages, and
 * recoveredPages are selected only for the units the first pass refused. A
 * unit the first pass proved teachable from pages outside that transport has
 * no evidence in front of the rereviewer, which then correctly obeys its
 * instructions - a prior verdict "never proves content" - and returns
 * teachable: false. Comparing that against the initial verdict compares two
 * different evidence sets, so every such unit reads as a regression and the
 * run dies before a Learning Unit Contract (telecom-1, 2026-09-21: 12 of 13
 * units flipped this way). It is the same bounded-transport false negative
 * documented on `syllabusCoverageUnteachableUnitIds`, one stage later.
 *
 * Recovery's contract is to flip refused units to teachable, and the
 * independent rereview exists to prove that flip, so the rereview keeps full
 * authority over the units it was given pages for and none over the units it
 * was not. Resolutions move only for materials cited exclusively by targeted
 * units and only toward `available`, so no untargeted unit's invariants shift
 * underneath it; a material shared with an untargeted unit keeps its initial
 * verdict. `missingCitations` is recomputed for every unit because the
 * decision validator requires it to project the resolutions exactly.
 *
 * The merge is a pure function of the receipt's own fields, so
 * `syllabusCoverageRecoveryReceiptProblems` reproduces it from
 * `initialCoverageRaw` + `finalCoverageRaw` and the receipt stays
 * independently verifiable.
 */
export function mergeSyllabusCoverageRecoveryDecision(input: {
  syllabusPlan: SyllabusPlan;
  initial: ModelAuthoredSyllabusCoverageDecision;
  rereview: ModelAuthoredSyllabusCoverageDecision;
  targetUnitIds: readonly string[];
}): ModelAuthoredSyllabusCoverageDecision {
  const targets = new Set(input.targetUnitIds);
  const targetOnlyMaterialIds = new Set<string>();
  for (const unit of input.syllabusPlan.units) {
    if (!targets.has(unit.id)) continue;
    for (const materialId of unit.materialIds) targetOnlyMaterialIds.add(materialId);
  }
  for (const unit of input.syllabusPlan.units) {
    if (targets.has(unit.id)) continue;
    for (const materialId of unit.materialIds) targetOnlyMaterialIds.delete(materialId);
  }

  const rereviewResolutions = new Map(
    input.rereview.resolutions.map((resolution) => [resolution.materialId, resolution]),
  );
  const resolutions = input.initial.resolutions.map((resolution) => {
    if (resolution.status === "available") return resolution;
    if (!targetOnlyMaterialIds.has(resolution.materialId)) return resolution;
    const candidate = rereviewResolutions.get(resolution.materialId);
    return candidate?.status === "available" ? candidate : resolution;
  });

  const resolutionById = new Map(resolutions.map((resolution) => [resolution.materialId, resolution]));
  const materialIdsByUnitId = new Map(input.syllabusPlan.units.map((unit) => [unit.id, unit.materialIds]));
  const rereviewUnits = new Map(input.rereview.units.map((unit) => [unit.unitId, unit]));
  const units = input.initial.units.map((unit) => {
    const recovered = targets.has(unit.unitId) ? rereviewUnits.get(unit.unitId) : undefined;
    const chosen = recovered ?? unit;
    // A recovered unit is judged from recoveredPages, so it names the sources
    // those pages came from and can omit an assigned work the first pass
    // already tied it to - the merged resolutions still carry that work, and
    // the decision validator requires a unit to name at least one source
    // selected for its available assigned material (telecom-1, 2026-09-21:
    // SU2 came back on deck pages while R1 stayed available as Couch). A
    // refused unit may keep partial supporting source ids, so the initial
    // list is model-authored support for this same unit, not an assumption:
    // carrying it alongside the recovered sources keeps the union honest and
    // preserves the invariant the initial decision already satisfied.
    const availableSourceIds = recovered
      ? [...new Set([...(recovered.availableSourceIds ?? []), ...(unit.availableSourceIds ?? [])])]
      : unit.availableSourceIds;
    return {
      ...chosen,
      availableSourceIds,
      missingCitations: (materialIdsByUnitId.get(unit.unitId) ?? []).flatMap((materialId) => {
        const resolution = resolutionById.get(materialId);
        return resolution?.status === "missing" ? [resolution.citation] : [];
      }),
    };
  });

  return { resolutions, units };
}

export function syllabusCoverageRecoveryOutcome(
  before: Pick<SyllabusCoverage, "units">,
  after: Pick<SyllabusCoverage, "units">,
): SyllabusCoverageEvidenceRecoveryReceipt["outcome"] {
  if (!syllabusCoverageHasTeachableUnits(after)) return "zero_teachable";
  const finalUnits = new Map(after.units.map((unit) => [unit.unitId, unit.teachable]));
  if (before.units.some((unit) => unit.teachable && !finalUnits.get(unit.unitId))) return "regressed";
  return before.units.some((unit) => !unit.teachable && finalUnits.get(unit.unitId)) ? "recovered" : "unchanged";
}

export async function runSyllabusCoverageEvidenceRecovery(input: {
  syllabusPlan: SyllabusPlan;
  initialCoverageRaw: string;
  initialCoverageDecision: unknown;
  sources: readonly SyllabusCoverageRecoverySource[];
  anchors: readonly ModelSourcePageAnchorRecord[];
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  model: string;
  checkpoint?: () => void;
  provider: (
    request: SyllabusCoverageRecoveryProviderRequest,
  ) => Promise<SyllabusCoverageRecoveryProviderResult>;
}): Promise<SyllabusCoverageRecoveryRunResult> {
  const knownSourceIds = input.sources.map((source) => source.sourceId);
  const initialProblems = syllabusCoverageDecisionProblems(
    input.initialCoverageDecision,
    input.syllabusPlan,
    knownSourceIds,
  );
  if (initialProblems.length > 0) {
    throw new Error(`Syllabus coverage recovery received an invalid initial decision: ${initialProblems.join("; ")}`);
  }
  if (typeof input.initialCoverageRaw !== "string" ||
      input.initialCoverageRaw.length > SYLLABUS_COVERAGE_RECOVERY_MAX_RAW_RESPONSE_CHARS) {
    throw new Error("Syllabus coverage recovery initial raw decision is missing or exceeds its fixed cap.");
  }
  const parsedInitialRaw = parseJsonCandidate(input.initialCoverageRaw);
  if (!parsedInitialRaw || hashJson(parsedInitialRaw) !== hashJson(input.initialCoverageDecision)) {
    throw new Error("Syllabus coverage recovery initial raw decision does not project to the accepted decision.");
  }
  const initialCoverage = projectModelAuthoredSyllabusCoverage(
    input.syllabusPlan,
    input.initialCoverageDecision,
    knownSourceIds,
  );
  const unteachableUnitIdsBefore = syllabusCoverageUnteachableUnitIds(initialCoverage);
  if (unteachableUnitIdsBefore.length === 0) {
    throw new Error("Syllabus coverage recovery may run only after a coverage decision that refuses at least one unit.");
  }
  if (!SHA256.test(input.sourceSetHash) || !SHA256.test(input.sourceArtifactInventoryHash)) {
    throw new Error("Syllabus coverage recovery requires valid source-set and source-artifact inventory hashes.");
  }
  if (!nonEmptyExactString(input.model)) {
    throw new Error("Syllabus coverage recovery requires an exact model identity.");
  }

  const bindings = sourceBindings(input.sources);
  const catalog = recoveryCatalog({ sources: input.sources, anchors: input.anchors });
  const transportCatalog = recoveryCatalogTransport(catalog);
  input.checkpoint?.();
  const selectionRequest = selectorRequest({
    sourceSetHash: input.sourceSetHash,
    sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
    syllabusPlan: input.syllabusPlan,
    initialDecision: input.initialCoverageDecision as ModelAuthoredSyllabusCoverageDecision,
    catalog: transportCatalog,
  });
  // The receipt has always carried an attempts array and a declared candidate
  // bound, but only one candidate was ever requested, so a single malformed
  // field ended the run (telecom-1, 2026-09-21: "selectionReason must be a
  // non-empty exact string" after the catalog had already been built). Spend
  // the declared budget: re-ask on a schema-invalid answer, keep every attempt
  // in the receipt, and fail closed only when the budget is exhausted.
  let selectionResult = await input.provider(selectionRequest);
  input.checkpoint?.();
  let selectionParsed = parseJsonCandidate(selectionResult.rawResponse);
  let selectionProblems = pageSelectionProblems(selectionParsed, catalog, transportCatalog);
  let selectionAttempt = attemptRecord({
    request: selectionRequest,
    result: selectionResult,
    validationProblems: selectionProblems,
    fallbackModel: input.model,
  });
  for (
    let candidate = 2;
    selectionProblems.length > 0 &&
    candidate <= SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES;
    candidate += 1
  ) {
    // Only the ordinal the provider sees changes: the planning checkpoint is
    // keyed by (job, stage, semanticAttempt), so a re-ask needs its own slot.
    // The candidate request is what gets recorded, because attempt is part of
    // the hashed request identity.
    const candidateRequest = { ...selectionRequest, attempt: candidate };
    selectionResult = await input.provider(candidateRequest);
    input.checkpoint?.();
    selectionParsed = parseJsonCandidate(selectionResult.rawResponse);
    selectionProblems = pageSelectionProblems(selectionParsed, catalog, transportCatalog);
    selectionAttempt = attemptRecord({
      request: candidateRequest,
      result: selectionResult,
      validationProblems: selectionProblems,
      fallbackModel: input.model,
    });
  }
  if (selectionProblems.length > 0) {
    throw new Error(
      `Syllabus coverage page selection failed its ${SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES} bounded model candidate(s): ${selectionProblems.join("; ")}`,
    );
  }
  const selections = canonicalSelections(selectionParsed, catalog);
  const rawPages = hydrateSelectedCanonicalSourceRawPages({
    sources: input.sources.map((source) => ({ sourceId: source.sourceId, body: source.body })),
    selections,
    maxPages: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES,
    maxChars: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_CHARS,
  });
  const bindingBySource = new Map(bindings.map((binding) => [binding.sourceId, binding]));
  const selectedPages = selections.map((selection, index) => {
    const rawPage = rawPages[index]!;
    return {
      ...selection,
      exactText: rawPage.exactText,
      exactTextSha256: sha256(rawPage.exactText),
      canonicalRawSourceSha256: bindingBySource.get(selection.sourceId)!.canonicalRawSourceSha256,
    };
  });

  input.checkpoint?.();
  const coverageRequest = reviewRequest({
    sourceSetHash: input.sourceSetHash,
    sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
    syllabusPlan: input.syllabusPlan,
    initialDecision: input.initialCoverageDecision as ModelAuthoredSyllabusCoverageDecision,
    sourceBindings: bindings,
    selectedPages,
    selectorAttempt: selectionAttempt,
  });
  // Same bounded re-ask as the selector above: a schema-invalid rereview is a
  // malformed answer, not a verdict, and the candidate budget exists to absorb
  // it without discarding the page selection that preceded it.
  let coverageResult = await input.provider(coverageRequest);
  input.checkpoint?.();
  let finalDecision = parseJsonCandidate(coverageResult.rawResponse);
  let finalProblems = syllabusCoverageDecisionProblems(
    finalDecision,
    input.syllabusPlan,
    knownSourceIds,
  );
  let coverageAttempt = attemptRecord({
    request: coverageRequest,
    result: coverageResult,
    validationProblems: finalProblems,
    fallbackModel: input.model,
  });
  for (
    let candidate = 2;
    finalProblems.length > 0 &&
    candidate <= SYLLABUS_COVERAGE_RECOVERY_MAX_REVIEW_CANDIDATES;
    candidate += 1
  ) {
    const candidateRequest = { ...coverageRequest, attempt: candidate };
    coverageResult = await input.provider(candidateRequest);
    input.checkpoint?.();
    finalDecision = parseJsonCandidate(coverageResult.rawResponse);
    finalProblems = syllabusCoverageDecisionProblems(
      finalDecision,
      input.syllabusPlan,
      knownSourceIds,
    );
    coverageAttempt = attemptRecord({
      request: candidateRequest,
      result: coverageResult,
      validationProblems: finalProblems,
      fallbackModel: input.model,
    });
  }
  if (finalProblems.length > 0) {
    throw new Error(
      `Independent syllabus coverage rereview failed its ${SYLLABUS_COVERAGE_RECOVERY_MAX_REVIEW_CANDIDATES} bounded model candidate(s): ${finalProblems.join("; ")}`,
    );
  }
  const decision = mergeSyllabusCoverageRecoveryDecision({
    syllabusPlan: input.syllabusPlan,
    initial: input.initialCoverageDecision as ModelAuthoredSyllabusCoverageDecision,
    rereview: finalDecision as ModelAuthoredSyllabusCoverageDecision,
    targetUnitIds: unteachableUnitIdsBefore,
  });
  const mergeProblems = syllabusCoverageDecisionProblems(decision, input.syllabusPlan, knownSourceIds);
  if (mergeProblems.length > 0) {
    // Both inputs validated on their own, so a broken merge is a real
    // contradiction between them, never something to project onward.
    throw new Error(
      `Syllabus coverage recovery merge produced an invalid decision: ${mergeProblems.join("; ")}`,
    );
  }
  const projected = projectModelAuthoredSyllabusCoverage(input.syllabusPlan, decision, knownSourceIds);
  const outcome = syllabusCoverageRecoveryOutcome(initialCoverage, projected);
  const recovered = outcome === "recovered";
  const withoutIntegrity: Omit<SyllabusCoverageEvidenceRecoveryReceipt, "integritySha256"> = {
    schemaVersion: SYLLABUS_COVERAGE_RECOVERY_SCHEMA_VERSION,
    protocol: "syllabus_coverage_evidence_recovery",
    selectorPromptVersion: SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT_VERSION,
    coverageReviewPromptVersion: SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT_VERSION,
    caps: {
      maximumSelectorCandidates: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES,
      maximumCoverageReviewCandidates: SYLLABUS_COVERAGE_RECOVERY_MAX_REVIEW_CANDIDATES,
      maximumSelectedPages: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES,
      maximumSelectedChars: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_CHARS,
      maximumCatalogEntries: SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES,
      maximumCatalogChars: SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS,
      maximumRawResponseChars: SYLLABUS_COVERAGE_RECOVERY_MAX_RAW_RESPONSE_CHARS,
    },
    model: input.model,
    sourceSetHash: input.sourceSetHash,
    sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
    syllabusPlan: input.syllabusPlan,
    syllabusPlanSha256: hashJson(input.syllabusPlan),
    initialCoverageRaw: input.initialCoverageRaw,
    initialCoverageRawSha256: sha256(input.initialCoverageRaw),
    initialCoverageDecisionSha256: hashJson(input.initialCoverageDecision),
    sourceBindings: bindings,
    selectorAttempts: [selectionAttempt],
    selectedPages,
    coverageReviewAttempts: [coverageAttempt],
    finalCoverageRaw: coverageResult.rawResponse,
    finalCoverageDecisionSha256: hashJson(decision),
    unteachableUnitIdsBefore,
    unteachableUnitIdsAfter: syllabusCoverageUnteachableUnitIds(projected),
    outcome,
  };
  const receipt: SyllabusCoverageEvidenceRecoveryReceipt = {
    ...withoutIntegrity,
    integritySha256: syllabusCoverageRecoveryReceiptIntegrity(withoutIntegrity),
  };
  const coverage: SyllabusCoverage = { ...projected, evidenceRecovery: receipt };
  const receiptProblems = syllabusCoverageRecoveryReceiptProblems({
    receipt,
    sources: input.sources,
    anchors: input.anchors,
    coverage,
    expectedSourceSetHash: input.sourceSetHash,
    expectedSourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
  });
  if (receiptProblems.length > 0) {
    throw new Error(`Syllabus coverage recovery produced invalid provenance: ${receiptProblems.join("; ")}`);
  }
  return { decision, coverage, receipt, recovered };
}

function exactAttemptProblems(
  attempt: SyllabusCoverageRecoveryAttempt,
  expectedPhase: SyllabusCoverageRecoveryAttempt["phase"],
): string[] {
  const problems: string[] = [];
  if (!attempt || !exactKeys(attempt as unknown as Record<string, unknown>, [
    "phase", "ordinal", "requestSha256", "rawResponse", "rawResponseSha256",
    "validationProblems", "model", ...(attempt.councilRunId !== undefined ? ["councilRunId"] : []),
  ])) problems.push(`${expectedPhase} attempt has unexpected or missing fields`);
  const maximumOrdinal = expectedPhase === "page_selection"
    ? SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES
    : SYLLABUS_COVERAGE_RECOVERY_MAX_REVIEW_CANDIDATES;
  if (
    attempt?.phase !== expectedPhase ||
    !Number.isInteger(attempt?.ordinal) ||
    attempt.ordinal < 1 ||
    attempt.ordinal > maximumOrdinal
  ) {
    problems.push(`${expectedPhase} attempt identity is invalid`);
  }
  if (!SHA256.test(attempt?.requestSha256 ?? "")) problems.push(`${expectedPhase} request hash is invalid`);
  if (typeof attempt?.rawResponse !== "string" ||
      attempt.rawResponse.length > SYLLABUS_COVERAGE_RECOVERY_MAX_RAW_RESPONSE_CHARS) {
    problems.push(`${expectedPhase} raw response is invalid or exceeds its cap`);
  } else if (sha256(attempt.rawResponse) !== attempt.rawResponseSha256) {
    problems.push(`${expectedPhase} raw response hash does not match`);
  }
  if (!Array.isArray(attempt?.validationProblems) ||
      attempt.validationProblems.some((problem) => typeof problem !== "string")) {
    problems.push(`${expectedPhase} validation problems are invalid`);
  }
  if (!nonEmptyExactString(attempt?.model)) problems.push(`${expectedPhase} model is invalid`);
  if (attempt?.councilRunId !== undefined && !nonEmptyExactString(attempt.councilRunId)) {
    problems.push(`${expectedPhase} Council run id is invalid`);
  }
  return problems;
}

export function syllabusCoverageRecoveryReceiptProblems(input: {
  receipt: unknown;
  sources: readonly SyllabusCoverageRecoverySource[];
  anchors: readonly ModelSourcePageAnchorRecord[];
  coverage?: SyllabusCoverage;
  expectedSourceSetHash?: string;
  expectedSourceArtifactInventoryHash?: string;
}): string[] {
  const problems: string[] = [];
  const receipt = record(input.receipt) as unknown as SyllabusCoverageEvidenceRecoveryReceipt | null;
  if (!receipt) return ["syllabus coverage evidence-recovery receipt is not an object"];
  const requiredKeys = [
    "schemaVersion", "protocol", "selectorPromptVersion", "coverageReviewPromptVersion", "caps", "model",
    "sourceSetHash", "sourceArtifactInventoryHash", "syllabusPlan", "syllabusPlanSha256",
    "initialCoverageRaw", "initialCoverageRawSha256", "initialCoverageDecisionSha256", "sourceBindings",
    "selectorAttempts", "selectedPages", "coverageReviewAttempts", "finalCoverageRaw",
    "finalCoverageDecisionSha256", "unteachableUnitIdsBefore", "unteachableUnitIdsAfter",
    "outcome", "integritySha256",
  ];
  if (!exactKeys(receipt as unknown as Record<string, unknown>, requiredKeys)) {
    problems.push("syllabus coverage evidence-recovery receipt has unexpected or missing fields");
  }
  if (receipt.schemaVersion !== SYLLABUS_COVERAGE_RECOVERY_SCHEMA_VERSION ||
      receipt.protocol !== "syllabus_coverage_evidence_recovery" ||
      receipt.selectorPromptVersion !== SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT_VERSION ||
      receipt.coverageReviewPromptVersion !== SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT_VERSION) {
    problems.push("syllabus coverage evidence-recovery protocol version is stale or invalid");
  }
  const expectedCaps = {
    maximumSelectorCandidates: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES,
    maximumCoverageReviewCandidates: SYLLABUS_COVERAGE_RECOVERY_MAX_REVIEW_CANDIDATES,
    maximumSelectedPages: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES,
    maximumSelectedChars: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_CHARS,
    maximumCatalogEntries: SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES,
    maximumCatalogChars: SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_CHARS,
    maximumRawResponseChars: SYLLABUS_COVERAGE_RECOVERY_MAX_RAW_RESPONSE_CHARS,
  };
  if (canonicalJson(receipt.caps) !== canonicalJson(expectedCaps)) {
    problems.push("syllabus coverage evidence-recovery caps do not match the active protocol");
  }
  if (!nonEmptyExactString(receipt.model)) problems.push("syllabus coverage evidence-recovery model is invalid");
  if (!SHA256.test(receipt.sourceSetHash) ||
      (input.expectedSourceSetHash !== undefined && receipt.sourceSetHash !== input.expectedSourceSetHash)) {
    problems.push("syllabus coverage evidence-recovery source-set hash does not match");
  }
  if (!SHA256.test(receipt.sourceArtifactInventoryHash) ||
      (input.expectedSourceArtifactInventoryHash !== undefined &&
       receipt.sourceArtifactInventoryHash !== input.expectedSourceArtifactInventoryHash)) {
    problems.push("syllabus coverage evidence-recovery artifact-inventory hash does not match");
  }
  if (hashJson(receipt.syllabusPlan) !== receipt.syllabusPlanSha256) {
    problems.push("syllabus coverage evidence-recovery syllabus-plan hash does not match");
  }
  const knownSourceIds = input.sources.map((source) => source.sourceId);
  let initialDecision: unknown = null;
  let initialCoverage: SyllabusCoverage | undefined;
  if (typeof receipt.initialCoverageRaw !== "string" ||
      sha256(receipt.initialCoverageRaw ?? "") !== receipt.initialCoverageRawSha256) {
    problems.push("syllabus coverage evidence-recovery initial raw decision hash does not match");
  } else {
    initialDecision = parseJsonCandidate(receipt.initialCoverageRaw);
    if (!initialDecision || hashJson(initialDecision) !== receipt.initialCoverageDecisionSha256) {
      problems.push("syllabus coverage evidence-recovery initial decision projection does not match");
    } else {
      const initialProblems = syllabusCoverageDecisionProblems(
        initialDecision,
        receipt.syllabusPlan,
        knownSourceIds,
      );
      if (initialProblems.length > 0) {
        problems.push(`syllabus coverage evidence-recovery initial decision is invalid: ${initialProblems.join("; ")}`);
      } else {
        initialCoverage = projectModelAuthoredSyllabusCoverage(receipt.syllabusPlan, initialDecision, knownSourceIds);
        const initialUnteachable = syllabusCoverageUnteachableUnitIds(initialCoverage);
        if (initialUnteachable.length === 0) {
          problems.push("syllabus coverage evidence-recovery initial decision refused no unit, so recovery was not authorised");
        }
        if (canonicalJson(receipt.unteachableUnitIdsBefore) !== canonicalJson(initialUnteachable)) {
          problems.push("syllabus coverage evidence-recovery refused-unit list does not match the initial decision");
        }
      }
    }
  }

  let bindings: ReturnType<typeof sourceBindings> = [];
  let catalog: RecoveryCatalogEntry[] = [];
  try {
    bindings = sourceBindings(input.sources);
    catalog = recoveryCatalog({ sources: input.sources, anchors: input.anchors });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (canonicalJson(receipt.sourceBindings) !== canonicalJson(bindings)) {
    problems.push("syllabus coverage evidence-recovery live source bindings do not match");
  }

  const selectorAttempt = Array.isArray(receipt.selectorAttempts) && receipt.selectorAttempts.length === 1
    ? receipt.selectorAttempts[0]
    : undefined;
  if (!selectorAttempt) {
    problems.push("syllabus coverage evidence-recovery must contain exactly one selector attempt");
  } else {
    problems.push(...exactAttemptProblems(selectorAttempt, "page_selection"));
    if (selectorAttempt.model !== receipt.model) {
      problems.push("syllabus coverage evidence-recovery selector model does not match the receipt model");
    }
    if (initialDecision) {
      const transportCatalog = recoveryCatalogTransport(catalog);
      const expectedRequest = selectorRequest({
        sourceSetHash: receipt.sourceSetHash,
        sourceArtifactInventoryHash: receipt.sourceArtifactInventoryHash,
        syllabusPlan: receipt.syllabusPlan,
        initialDecision: initialDecision as ModelAuthoredSyllabusCoverageDecision,
        catalog: transportCatalog,
      });
      expectedRequest.attempt = selectorAttempt.ordinal;
      if (requestSha256(expectedRequest) !== selectorAttempt.requestSha256) {
        problems.push("syllabus coverage evidence-recovery selector request hash does not match");
      }
      const parsedSelection = parseJsonCandidate(selectorAttempt.rawResponse);
      const expectedSelectionProblems = pageSelectionProblems(
        parsedSelection,
        catalog,
        transportCatalog,
      );
      if (canonicalJson(expectedSelectionProblems) !== canonicalJson(selectorAttempt.validationProblems)) {
        problems.push("syllabus coverage evidence-recovery selector diagnostics do not match exact raw response");
      }
      if (expectedSelectionProblems.length > 0) {
        problems.push("syllabus coverage evidence-recovery selector attempt was not accepted");
      }
    }
  }

  let expectedSelectedPages: SyllabusCoverageRecoverySelectedPage[] = [];
  if (selectorAttempt && selectorAttempt.validationProblems.length === 0) {
    try {
      const selections = canonicalSelections(
        parseJsonCandidate(selectorAttempt.rawResponse),
        catalog,
      );
      const rawPages = hydrateSelectedCanonicalSourceRawPages({
        sources: input.sources.map((source) => ({ sourceId: source.sourceId, body: source.body })),
        selections,
        maxPages: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES,
        maxChars: SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_CHARS,
      });
      const bindingBySource = new Map(bindings.map((binding) => [binding.sourceId, binding]));
      expectedSelectedPages = selections.map((selection, index) => ({
        ...selection,
        exactText: rawPages[index]!.exactText,
        exactTextSha256: sha256(rawPages[index]!.exactText),
        canonicalRawSourceSha256: bindingBySource.get(selection.sourceId)!.canonicalRawSourceSha256,
      }));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (canonicalJson(receipt.selectedPages) !== canonicalJson(expectedSelectedPages)) {
    problems.push("syllabus coverage evidence-recovery selected page projection does not match live canonical bytes");
  }

  const reviewAttempt = Array.isArray(receipt.coverageReviewAttempts) && receipt.coverageReviewAttempts.length === 1
    ? receipt.coverageReviewAttempts[0]
    : undefined;
  let finalDecision: unknown = null;
  if (!reviewAttempt) {
    problems.push("syllabus coverage evidence-recovery must contain exactly one coverage rereview attempt");
  } else {
    problems.push(...exactAttemptProblems(reviewAttempt, "coverage_rereview"));
    if (reviewAttempt.model !== receipt.model) {
      problems.push("syllabus coverage evidence-recovery rereview model does not match the receipt model");
    }
    if (initialDecision && selectorAttempt) {
      const expectedRequest = reviewRequest({
        sourceSetHash: receipt.sourceSetHash,
        sourceArtifactInventoryHash: receipt.sourceArtifactInventoryHash,
        syllabusPlan: receipt.syllabusPlan,
        initialDecision: initialDecision as ModelAuthoredSyllabusCoverageDecision,
        sourceBindings: bindings,
        selectedPages: expectedSelectedPages,
        selectorAttempt,
      });
      expectedRequest.attempt = reviewAttempt.ordinal;
      if (requestSha256(expectedRequest) !== reviewAttempt.requestSha256) {
        problems.push("syllabus coverage evidence-recovery rereview request hash does not match");
      }
    }
    if (reviewAttempt.rawResponse !== receipt.finalCoverageRaw ||
        sha256(receipt.finalCoverageRaw ?? "") !== reviewAttempt.rawResponseSha256) {
      problems.push("syllabus coverage evidence-recovery terminal raw decision does not match its attempt");
    }
    finalDecision = parseJsonCandidate(reviewAttempt.rawResponse);
    const finalProblems = syllabusCoverageDecisionProblems(
      finalDecision,
      receipt.syllabusPlan,
      knownSourceIds,
    );
    if (canonicalJson(finalProblems) !== canonicalJson(reviewAttempt.validationProblems)) {
      problems.push("syllabus coverage evidence-recovery rereview diagnostics do not match exact raw response");
    }
    // The rereview only ever holds evidence for the units recovery targeted,
    // so what flows onward is its verdict merged over the initial one. Rebuild
    // that merge here from the receipt's own raw decisions rather than trusting
    // the stored hash, so the receipt stays checkable end to end.
    const mergedDecision = initialDecision && finalDecision && finalProblems.length === 0
      ? mergeSyllabusCoverageRecoveryDecision({
          syllabusPlan: receipt.syllabusPlan,
          initial: initialDecision as ModelAuthoredSyllabusCoverageDecision,
          rereview: finalDecision as ModelAuthoredSyllabusCoverageDecision,
          targetUnitIds: receipt.unteachableUnitIdsBefore ?? [],
        })
      : null;
    if (finalProblems.length > 0) {
      problems.push("syllabus coverage evidence-recovery terminal rereview was not accepted");
    } else if (!mergedDecision || hashJson(mergedDecision) !== receipt.finalCoverageDecisionSha256) {
      problems.push("syllabus coverage evidence-recovery final decision hash does not match");
    } else if (
      syllabusCoverageDecisionProblems(mergedDecision, receipt.syllabusPlan, knownSourceIds).length > 0
    ) {
      problems.push("syllabus coverage evidence-recovery merged decision is invalid");
    } else {
      const projected = projectModelAuthoredSyllabusCoverage(
        receipt.syllabusPlan,
        mergedDecision,
        knownSourceIds,
      );
      const expectedOutcome = initialCoverage && syllabusCoverageRecoveryOutcome(initialCoverage, projected);
      if (expectedOutcome && receipt.outcome !== expectedOutcome) {
        problems.push("syllabus coverage evidence-recovery outcome does not match the final decision");
      }
      if (canonicalJson(receipt.unteachableUnitIdsAfter) !==
          canonicalJson(syllabusCoverageUnteachableUnitIds(projected))) {
        problems.push("syllabus coverage evidence-recovery post-review refused-unit list does not match the final decision");
      }
      if (input.coverage &&
          canonicalJson(coverageWithoutReceipt(input.coverage)) !==
            canonicalJson(comparableToPersistedCoverage(projected, input.coverage))) {
        problems.push("persisted syllabus coverage does not exactly project the recovered final decision");
      }
    }
  }

  if (!SHA256.test(receipt.integritySha256 ?? "")) {
    problems.push("syllabus coverage evidence-recovery integrity hash is invalid");
  } else {
    const { integritySha256: _ignored, ...withoutIntegrity } = receipt;
    if (syllabusCoverageRecoveryReceiptIntegrity(withoutIntegrity) !== receipt.integritySha256) {
      problems.push("syllabus coverage evidence-recovery integrity hash does not match");
    }
  }
  return unique(problems);
}
