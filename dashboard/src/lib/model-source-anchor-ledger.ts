import { createHash } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

import { isPlausibleSourceAnchorId } from "./final-garden-state.ts";
import type { LearnSourceSummary } from "./learn-utils.ts";

export const MODEL_SOURCE_ANCHOR_LEDGER_REL_PATH = ".breadboard/source-anchors.json";

export interface ModelAuthoredSourceAnchorInput {
  id: string;
  sourceId: string;
  title: string;
  summary: string;
  exactText: string;
}

export interface ModelAuthoredSourceMap {
  sourceAnchors: ModelAuthoredSourceAnchorInput[];
}

/**
 * A canonical text-ledger record whose source provenance was established only
 * by exact source ownership and an exact quote check. The model owns the title
 * and summary; code deliberately does not derive keywords, page numbers,
 * concepts, relevance scores, or replacement anchors.
 */
export interface VerifiedModelSourceAnchorRecord {
  id: string;
  kind: "text_concept";
  sourceId: string;
  title: string;
  semanticSummary: string;
  exactText: string;
  confidence: "high";
  evidence: {
    method: "exact_whitespace_normalized_substring";
    exactQuoteVerified: true;
    sourceBodyHash: string;
    exactTextHash: string;
  };
  relevance: {
    decision: "model_authored_exact_quote";
  };
  provenance: {
    origin: "model_source_map";
    sourceRelPath: string;
    verification: "exact_whitespace_normalized_substring";
  };
}

export interface PersistModelSourceAnchorLedgerResult {
  ledgerPath: string;
  records: VerifiedModelSourceAnchorRecord[];
  ledger: Record<string, unknown>;
  changed: boolean;
}

export interface ModelSourcePageAnchorRecord {
  id: string;
  kind: "guidance";
  sourceId: string;
  page: number;
  title: string;
  exactText: string;
  provenance: {
    origin: "selected_source_markdown_page";
    sourceRelPath: string;
    extraction: "exact_markdown_page_block";
  };
}

/**
 * A concrete PDF page selected by the Source Map through an exact structural
 * anchor id. This is a transport hint only: it carries no inferred visual id,
 * caption, kind, or semantic relevance.
 */
export interface SelectedStructuralSourcePageHint {
  anchorId: string;
  sourceId: string;
  /** One-based position in the exact selected-source array. */
  sourceIndex: number;
  /** One-based page number copied from the structural anchor catalog. */
  pageNumber: number;
}

export class ModelSourceAnchorLedgerValidationError extends Error {
  readonly problems: string[];

  constructor(problems: readonly string[]) {
    const unique = [...new Set(problems)];
    super(`Model-authored source-anchor ledger validation failed: ${unique.join("; ")}`);
    this.name = "ModelSourceAnchorLedgerValidationError";
    this.problems = unique;
  }
}

/** Collapse whitespace only. Case, punctuation, spelling, and Unicode remain exact. */
export function normalizeSourceAnchorQuoteWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Build a structural page-text catalog directly from exact `## Page N`
 * Markdown blocks. Source order supplies the stable one-based `S` index. This
 * is a pure structural projection: it creates no semantic slug, summary,
 * keyword, relevance score, or inferred page association.
 */
export function modelSourcePageAnchors(
  selectedSources: readonly LearnSourceSummary[],
): ModelSourcePageAnchorRecord[] {
  const records: ModelSourcePageAnchorRecord[] = [];
  selectedSources.forEach((source) => {
    if (typeof source.body !== "string" || !source.body) return;
    const body = source.body.replace(/\r\n/g, "\n");
    const headings = [...body.matchAll(/^## Page ([1-9]\d*)[ \t]*$/gm)];
    const seenPages = new Set<number>();
    headings.forEach((heading, headingIndex) => {
      const page = Number(heading[1]);
      if (seenPages.has(page)) {
        throw new ModelSourceAnchorLedgerValidationError([
          `selected source "${source.slug}" contains duplicate exact Markdown heading "## Page ${page}"`,
        ]);
      }
      seenPages.add(page);
      const blockStart = (heading.index ?? 0) + heading[0].length;
      const blockEnd = headings[headingIndex + 1]?.index ?? body.length;
      const exactText = body
        .slice(blockStart, blockEnd)
        .replace(/^\r?\n/, "")
        .replace(/\s+$/u, "");
      if (!exactText) return;
      records.push({
        id: `text-${source.slug.replace(/[^A-Za-z0-9_.-]+/g, "-")}-page-${page}`,
        kind: "guidance",
        sourceId: source.slug,
        page,
        title: `Page ${page}`,
        exactText,
        provenance: {
          origin: "selected_source_markdown_page",
          sourceRelPath: source.relPath,
          extraction: "exact_markdown_page_block",
        },
      });
    });
  });
  return records;
}

/**
 * Project the Source Map's exact structural-anchor choices into PDF page
 * requests. Only catalog ids copied verbatim by the model are considered, and
 * only selected sources that retain their original PDF produce a hint. Page
 * coalescing is mechanical; it does not choose additional or nearby pages.
 */
export function selectedStructuralSourcePageHints(input: {
  sourceMap: unknown;
  catalog: readonly ModelSourcePageAnchorRecord[];
  selectedSources: readonly LearnSourceSummary[];
}): SelectedStructuralSourcePageHint[] {
  const rawAnchors = sourceAnchorList(input.sourceMap);
  if (!rawAnchors) return [];

  const catalogById = new Map(input.catalog.map((anchor) => [anchor.id, anchor]));
  const sourcePositionById = new Map(
    input.selectedSources.map((source, index) => [source.slug, {
      source,
      sourceIndex: index + 1,
    }]),
  );
  const seenPages = new Set<string>();
  const pageHints: SelectedStructuralSourcePageHint[] = [];

  for (const rawAnchor of rawAnchors) {
    const selected = sourceRecord(rawAnchor);
    const anchorId = selected?.id;
    const selectedSourceId = selected?.sourceId;
    if (typeof anchorId !== "string" || typeof selectedSourceId !== "string") continue;

    // Do not trim, normalize, fuzzy-match, or synthesize either identity.
    const structuralAnchor = catalogById.get(anchorId);
    if (!structuralAnchor || structuralAnchor.sourceId !== selectedSourceId) continue;
    const sourcePosition = sourcePositionById.get(structuralAnchor.sourceId);
    if (!sourcePosition?.source.sourcePdf) continue;
    if (!Number.isSafeInteger(structuralAnchor.page) || structuralAnchor.page < 1) continue;

    const pageIdentity = `${sourcePosition.sourceIndex}:${structuralAnchor.page}`;
    if (seenPages.has(pageIdentity)) continue;
    seenPages.add(pageIdentity);
    pageHints.push({
      anchorId,
      sourceId: structuralAnchor.sourceId,
      sourceIndex: sourcePosition.sourceIndex,
      pageNumber: structuralAnchor.page,
    });
  }

  return pageHints;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceAnchorList(sourceMap: unknown): unknown[] | null {
  if (!sourceMap || typeof sourceMap !== "object" || Array.isArray(sourceMap)) return null;
  const value = (sourceMap as Record<string, unknown>).sourceAnchors;
  return Array.isArray(value) ? value : null;
}

function sourceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate and project source-map anchors without repairing them. `sourceId`
 * must equal a selected source's `slug`, which is the exact ID exposed to the
 * Source Map model. A quote found in another source never satisfies the check.
 */
export function verifyModelAuthoredSourceAnchors(input: {
  sourceMap: unknown;
  selectedSources: readonly LearnSourceSummary[];
}): VerifiedModelSourceAnchorRecord[] {
  const problems: string[] = [];
  const sourceById = new Map<string, LearnSourceSummary>();
  for (const [index, source] of input.selectedSources.entries()) {
    if (!source.slug || source.slug !== source.slug.trim()) {
      problems.push(`selectedSources[${index}].slug must be a non-empty exact source id`);
      continue;
    }
    if (sourceById.has(source.slug)) {
      problems.push(`selected source id "${source.slug}" appears more than once`);
      continue;
    }
    sourceById.set(source.slug, source);
  }

  const rawAnchors = sourceAnchorList(input.sourceMap);
  if (!rawAnchors) {
    problems.push("sourceMap.sourceAnchors must be an array");
    throw new ModelSourceAnchorLedgerValidationError(problems);
  }

  const seenIds = new Set<string>();
  const records: VerifiedModelSourceAnchorRecord[] = [];
  rawAnchors.forEach((rawAnchor, index) => {
    const at = `sourceMap.sourceAnchors[${index}]`;
    const anchor = sourceRecord(rawAnchor);
    if (!anchor) {
      problems.push(`${at} must be an object`);
      return;
    }
    const id = anchor.id;
    const sourceId = anchor.sourceId;
    const title = anchor.title;
    const summary = anchor.summary;
    const exactText = anchor.exactText;

    if (!nonEmptyString(id) || id !== id.trim() || !isPlausibleSourceAnchorId(id)) {
      problems.push(`${at}.id must be a plausible canonical source-anchor id with no surrounding whitespace`);
    } else {
      const identity = id.toLowerCase();
      if (seenIds.has(identity)) problems.push(`${at}.id duplicates source-anchor id "${id}"`);
      seenIds.add(identity);
    }
    if (!nonEmptyString(sourceId) || !sourceById.has(sourceId)) {
      problems.push(`${at}.sourceId must exactly equal a selected source id`);
    }
    if (!nonEmptyString(title)) problems.push(`${at}.title must be a non-empty string`);
    if (!nonEmptyString(summary)) problems.push(`${at}.summary must be a non-empty string`);
    if (!nonEmptyString(exactText)) {
      problems.push(`${at}.exactText must be a non-empty verbatim source quote`);
    }

    const source = typeof sourceId === "string" ? sourceById.get(sourceId) : undefined;
    const normalizedQuote = typeof exactText === "string"
      ? normalizeSourceAnchorQuoteWhitespace(exactText)
      : "";
    const normalizedBody = typeof source?.body === "string"
      ? normalizeSourceAnchorQuoteWhitespace(source.body)
      : "";
    if (source && typeof source.body !== "string") {
      problems.push(`${at}: selected source "${sourceId}" has no body for exact quote verification`);
    } else if (source && normalizedQuote && !normalizedBody.includes(normalizedQuote)) {
      problems.push(
        `${at}.exactText is not an exact whitespace-normalized quote from selected source "${sourceId}"`,
      );
    }

    if (
      nonEmptyString(id) && id === id.trim() && isPlausibleSourceAnchorId(id) &&
      nonEmptyString(sourceId) && source && typeof source.body === "string" &&
      nonEmptyString(title) && nonEmptyString(summary) && nonEmptyString(exactText) &&
      normalizedBody.includes(normalizedQuote)
    ) {
      records.push({
        id,
        kind: "text_concept",
        sourceId,
        title,
        semanticSummary: summary,
        exactText,
        confidence: "high",
        evidence: {
          method: "exact_whitespace_normalized_substring",
          exactQuoteVerified: true,
          sourceBodyHash: sha256(source.body),
          exactTextHash: sha256(exactText),
        },
        relevance: { decision: "model_authored_exact_quote" },
        provenance: {
          origin: "model_source_map",
          sourceRelPath: source.relPath,
          verification: "exact_whitespace_normalized_substring",
        },
      });
    }
  });

  if (problems.length > 0) throw new ModelSourceAnchorLedgerValidationError(problems);
  return records;
}

function readExistingLedger(ledgerPath: string): Record<string, unknown> {
  if (!fs.existsSync(ledgerPath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot update source-anchor ledger because ${ledgerPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Cannot update source-anchor ledger because ${ledgerPath} is not a JSON object`);
  }
  const ledger = parsed as Record<string, unknown>;
  if (
    ledger.sourceTextConceptAnchors !== undefined &&
    !Array.isArray(ledger.sourceTextConceptAnchors)
  ) {
    throw new Error(
      `Cannot update source-anchor ledger because sourceTextConceptAnchors is not an array`,
    );
  }
  return ledger;
}

/**
 * Verify the model response and persist its selected-source slice. Existing
 * text records for selected source slugs are replaced; records for every other
 * source, structural anchors, and unknown ledger keys are retained verbatim.
 */
export function persistModelAuthoredSourceAnchors(input: {
  gardenDir: string;
  sourceMap: unknown;
  selectedSources: readonly LearnSourceSummary[];
}): PersistModelSourceAnchorLedgerResult {
  const records = verifyModelAuthoredSourceAnchors({
    sourceMap: input.sourceMap,
    selectedSources: input.selectedSources,
  });
  const ledgerPath = path.join(input.gardenDir, ...MODEL_SOURCE_ANCHOR_LEDGER_REL_PATH.split("/"));
  const existing = readExistingLedger(ledgerPath);
  const existingText = (existing.sourceTextConceptAnchors ?? []) as unknown[];
  const selectedSourceIds = new Set(input.selectedSources.map((source) => source.slug));
  const retained = existingText.filter((value) => {
    const record = sourceRecord(value);
    return !record || typeof record.sourceId !== "string" || !selectedSourceIds.has(record.sourceId);
  });
  const retainedIds = new Set(
    retained.flatMap((value) => {
      const record = sourceRecord(value);
      return nonEmptyString(record?.id) ? [record.id.toLowerCase()] : [];
    }),
  );
  const collisions = records
    .filter((record) => retainedIds.has(record.id.toLowerCase()))
    .map((record) => `source-anchor id "${record.id}" collides with a record owned by an unselected source`);
  if (collisions.length > 0) throw new ModelSourceAnchorLedgerValidationError(collisions);

  const ledger: Record<string, unknown> = {
    ...existing,
    sourceTextConceptAnchors: [...retained, ...records],
  };
  const content = `${JSON.stringify(ledger, null, 2)}\n`;
  const previous = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8") : null;
  const changed = previous !== content;
  if (changed) {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, content, "utf8");
  }
  return { ledgerPath, records, ledger, changed };
}
