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

export const SYLLABUS_COVERAGE_RECOVERY_SCHEMA_VERSION = 1 as const;
export const SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT_VERSION =
  "syllabus-coverage-page-selector-v1" as const;
export const SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT_VERSION =
  "syllabus-coverage-independent-review-v1" as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTOR_CANDIDATES = 1 as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_REVIEW_CANDIDATES = 1 as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_PAGES = 32 as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_SELECTED_CHARS = 120_000 as const;
export const SYLLABUS_COVERAGE_RECOVERY_MAX_CATALOG_ENTRIES = 2_000 as const;
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
  ordinal: 1;
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
  outcome: "recovered" | "zero_teachable";
  integritySha256: string;
}

export interface SyllabusCoverageRecoveryProviderRequest {
  phase: "page_selection" | "coverage_rereview";
  attempt: 1;
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
  const catalogChars = (catalog: readonly RecoveryCatalogEntry[]): number =>
    JSON.stringify(catalog).length;

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
{"selectedPages":[{"anchorId":"exact supplied page anchor id","sourceId":"exact supplied source id","pageNumber":1,"selectionReason":"why this complete page can resolve an evidence gap"}],"selectionReason":"why this bounded set is sufficient"}
Hard rules:
- Selection is semantic and model-authored. Choose only exact page identities from pageCatalog; code will never match a syllabus locator, title, author, or topic to a page for you.
- Select at least one and no more than the supplied maximumSelectedPages. Do not repeat a page.
- Prefer the smallest set that can test both cited-work identity and unit-level support. Bibliographic/front-matter pages may establish exact title/author/edition/publisher or locator identity, but cannot alone establish unit teachability; pair them with substantive teaching pages where needed.
- sourceId and pageNumber must exactly match the chosen anchorId record. Do not invent, repair, expand, or renumber identities.
- The next reviewer receives each selected page in full. Do not quote or rewrite page content in this response.`;

export const SYLLABUS_COVERAGE_RECOVERY_REVIEW_PROMPT = `You independently re-author the complete syllabus material-resolution and unit-coverage decision from canonical source evidence.
Return ONLY JSON with exactly two top-level arrays: resolutions and units, using the same complete shape and order as initialCoverageDecision.
Hard rules:
- Return exactly one resolution for every syllabusPlan.referencedMaterials entry and one unit record for every syllabusPlan.units entry, in supplied order. Copy IDs and citations exactly.
- The fixed source prefix and recoveredPages are verbatim evidence. Navigation metadata, filenames, locators, page excerpts, the prior verdict, and selection reasons are context only and never prove content.
- Judge every resolution and teachable verdict yourself from the complete raw evidence. Do not preserve or flip a verdict merely to satisfy the planner. A valid all-false result is allowed and terminates planning before a Learning Unit Contract call.
- available requires direct canonical evidence for the cited work/assigned part; missing uses no sourceIds; generic is only an uncheckable reference.
- An unteachable unit may retain partial supporting source IDs. A teachable unit must select at least one exact supporting source ID.
- missingCitations must exactly project assigned materials resolved missing, including intentional repeated citations.
- Do not return a patch, explanation, score, or prose outside the JSON object.`;

function selectorRequest(input: {
  sourceSetHash: string;
  sourceArtifactInventoryHash: string;
  syllabusPlan: SyllabusPlan;
  initialDecision: ModelAuthoredSyllabusCoverageDecision;
  catalog: readonly RecoveryCatalogEntry[];
}): SyllabusCoverageRecoveryProviderRequest {
  const user = JSON.stringify({
    protocolVersion: SYLLABUS_COVERAGE_PAGE_SELECTOR_PROMPT_VERSION,
    sourceSetHash: input.sourceSetHash,
    sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
    syllabusPlan: input.syllabusPlan,
    initialCoverageDecision: input.initialDecision,
    pageCatalog: input.catalog,
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
  const byId = new Map(catalog.map((entry) => [entry.anchorId, entry]));
  const seen = new Set<string>();
  root.selectedPages.forEach((raw, index) => {
    const at = `page-selection selectedPages[${index}]`;
    const selection = record(raw);
    if (!selection || !exactKeys(selection, ["anchorId", "sourceId", "pageNumber", "selectionReason"])) {
      problems.push(`${at} must contain exactly anchorId, sourceId, pageNumber, and selectionReason`);
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
    if (selection.sourceId !== expected.sourceId) {
      problems.push(`${at}.sourceId does not match anchorId "${selection.anchorId}"`);
    }
    if (selection.pageNumber !== expected.pageNumber) {
      problems.push(`${at}.pageNumber does not match anchorId "${selection.anchorId}"`);
    }
    if (!nonEmptyExactString(selection.selectionReason)) {
      problems.push(`${at}.selectionReason must be a non-empty exact string`);
    }
  });
  return unique(problems);
}

function projectedSelections(value: unknown): SyllabusCoverageRecoverySelection[] {
  const root = value as { selectedPages: SyllabusCoverageRecoverySelection[] };
  return root.selectedPages.map((selection) => ({ ...selection }));
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
    ordinal: 1,
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

export function syllabusCoverageHasTeachableUnits(
  coverage: Pick<SyllabusCoverage, "units"> | null | undefined,
): boolean {
  return Boolean(coverage?.units.some((unit) => unit.teachable));
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
  if (syllabusCoverageHasTeachableUnits(initialCoverage)) {
    throw new Error("Syllabus coverage recovery may run only after a valid zero-teachable coverage decision.");
  }
  if (!SHA256.test(input.sourceSetHash) || !SHA256.test(input.sourceArtifactInventoryHash)) {
    throw new Error("Syllabus coverage recovery requires valid source-set and source-artifact inventory hashes.");
  }
  if (!nonEmptyExactString(input.model)) {
    throw new Error("Syllabus coverage recovery requires an exact model identity.");
  }

  const bindings = sourceBindings(input.sources);
  const catalog = recoveryCatalog({ sources: input.sources, anchors: input.anchors });
  input.checkpoint?.();
  const selectionRequest = selectorRequest({
    sourceSetHash: input.sourceSetHash,
    sourceArtifactInventoryHash: input.sourceArtifactInventoryHash,
    syllabusPlan: input.syllabusPlan,
    initialDecision: input.initialCoverageDecision as ModelAuthoredSyllabusCoverageDecision,
    catalog,
  });
  const selectionResult = await input.provider(selectionRequest);
  input.checkpoint?.();
  const selectionParsed = parseJsonCandidate(selectionResult.rawResponse);
  const selectionProblems = pageSelectionProblems(selectionParsed, catalog);
  const selectionAttempt = attemptRecord({
    request: selectionRequest,
    result: selectionResult,
    validationProblems: selectionProblems,
    fallbackModel: input.model,
  });
  if (selectionProblems.length > 0) {
    throw new Error(
      `Syllabus coverage page selection failed its single bounded model candidate: ${selectionProblems.join("; ")}`,
    );
  }
  const selections = projectedSelections(selectionParsed);
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
  const coverageResult = await input.provider(coverageRequest);
  input.checkpoint?.();
  const finalDecision = parseJsonCandidate(coverageResult.rawResponse);
  const finalProblems = syllabusCoverageDecisionProblems(
    finalDecision,
    input.syllabusPlan,
    knownSourceIds,
  );
  const coverageAttempt = attemptRecord({
    request: coverageRequest,
    result: coverageResult,
    validationProblems: finalProblems,
    fallbackModel: input.model,
  });
  if (finalProblems.length > 0) {
    throw new Error(
      `Independent syllabus coverage rereview failed its single bounded model candidate: ${finalProblems.join("; ")}`,
    );
  }
  const decision = finalDecision as ModelAuthoredSyllabusCoverageDecision;
  const projected = projectModelAuthoredSyllabusCoverage(input.syllabusPlan, decision, knownSourceIds);
  const recovered = syllabusCoverageHasTeachableUnits(projected);
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
    outcome: recovered ? "recovered" : "zero_teachable",
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
  if (attempt?.phase !== expectedPhase || attempt?.ordinal !== 1) {
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
    "finalCoverageDecisionSha256", "outcome", "integritySha256",
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
      } else if (syllabusCoverageHasTeachableUnits(
        projectModelAuthoredSyllabusCoverage(receipt.syllabusPlan, initialDecision, knownSourceIds),
      )) {
        problems.push("syllabus coverage evidence-recovery initial decision was not zero-teachable");
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
      const expectedRequest = selectorRequest({
        sourceSetHash: receipt.sourceSetHash,
        sourceArtifactInventoryHash: receipt.sourceArtifactInventoryHash,
        syllabusPlan: receipt.syllabusPlan,
        initialDecision: initialDecision as ModelAuthoredSyllabusCoverageDecision,
        catalog,
      });
      if (requestSha256(expectedRequest) !== selectorAttempt.requestSha256) {
        problems.push("syllabus coverage evidence-recovery selector request hash does not match");
      }
      const parsedSelection = parseJsonCandidate(selectorAttempt.rawResponse);
      const expectedSelectionProblems = pageSelectionProblems(parsedSelection, catalog);
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
      const selections = projectedSelections(parseJsonCandidate(selectorAttempt.rawResponse));
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
    if (finalProblems.length > 0) {
      problems.push("syllabus coverage evidence-recovery terminal rereview was not accepted");
    } else if (!finalDecision || hashJson(finalDecision) !== receipt.finalCoverageDecisionSha256) {
      problems.push("syllabus coverage evidence-recovery final decision hash does not match");
    } else {
      const projected = projectModelAuthoredSyllabusCoverage(
        receipt.syllabusPlan,
        finalDecision,
        knownSourceIds,
      );
      const expectedOutcome = syllabusCoverageHasTeachableUnits(projected)
        ? "recovered"
        : "zero_teachable";
      if (receipt.outcome !== expectedOutcome) {
        problems.push("syllabus coverage evidence-recovery outcome does not match the final decision");
      }
      if (input.coverage &&
          canonicalJson(coverageWithoutReceipt(input.coverage)) !== canonicalJson(projected)) {
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
