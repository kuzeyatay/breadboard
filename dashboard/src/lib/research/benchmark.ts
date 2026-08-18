// Scoring an exhaustive research run against a reviewer's reference set.
//
// The QA scenario `super-agent-exhaustive-research-coverage` names twelve
// metrics. Naming them is not measuring them, so this module turns a finished
// `research_status` result plus a reference set into numbers a reviewer can
// compare between runs.
//
// The one rule the scorer enforces rather than merely reports: recall and the
// unsupported-claim rate are judged together. A run that finds more entities by
// inventing them is worse than the run it replaced, and a benchmark that
// rewards it would actively make the system dishonest. `verdict` is therefore
// gated on both, and no amount of recall passes a run that fabricated.
//
// Nothing here is domain-specific and nothing here is checked in as an answer.
// The reference set is supplied by whoever runs the benchmark, for whatever
// subject they chose.

import { identityKey } from "./entities.ts";
import { claimShapeForField } from "./authority.ts";
import type { StatusResult, SynthesisEntity } from "./session.ts";
import type { SourceClass } from "./types.ts";

/**
 * What a reviewer believes to be true about the subject, assembled by hand.
 * Every part is optional: a reviewer who only has a list of names still gets
 * entity recall, and gets nothing invented in place of the rest.
 */
export interface ResearchReference {
  /** Canonical names the run should have found. Aliases go in `aliases`. */
  entities: string[];
  /** Known alternative names per canonical name, for recall matching. */
  aliases?: Record<string, string[]>;
  /** Known lineage edges, as `[from, kind, to]`. */
  lineage?: Array<[string, string, string]>;
  /** Entity/field pairs where sources are known to disagree. */
  knownConflicts?: Array<{ entity: string; field: string }>;
}

/** The claim classes each source class is authoritative for, by shape. */
const PREFERRED_SOURCES: Record<string, ReadonlySet<SourceClass>> = {
  identity: new Set<SourceClass>(["official_entity", "institution", "official_database"]),
  membership: new Set<SourceClass>(["institution", "official_database"]),
  headcount: new Set<SourceClass>(["official_entity"]),
  lifecycle: new Set<SourceClass>(["official_entity", "institution", "official_database"]),
  result: new Set<SourceClass>(["competition", "official_database"]),
  date: new Set<SourceClass>(["archive", "official_entity", "official_database", "institution"]),
  general: new Set<SourceClass>(["official_entity", "institution", "official_database"]),
};

/**
 * A rate, or null when there was nothing to rate.
 *
 * Null rather than 1.0, because a benchmark that reports perfect lineage recall
 * for a reference set containing no lineage is telling the reviewer something
 * false about the run — and this module of all of them should not invent a
 * score it did not measure.
 */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

/** Every name one reference entity answers to. */
function referenceKeys(reference: ResearchReference, name: string): string[] {
  return [name, ...(reference.aliases?.[name] ?? [])].map(identityKey);
}

/** Every name one found entity answers to. */
function foundKeys(entity: SynthesisEntity): string[] {
  return [entity.name, ...entity.aliases].map(identityKey);
}

export interface ResearchBenchmarkInput {
  /** A finished `research_status` result — one whose `synthesis` is present. */
  status: StatusResult;
  reference: ResearchReference;
  /** The answer the user actually received, for transparency scoring. */
  answerText?: string;
  /** Unsupported claims from the turn's own verification summary. */
  unsupportedClaims?: string[];
}

/**
 * Every rate is `number | null`, and null always means the same thing: there
 * was nothing of that kind to measure. A reviewer comparing two runs needs to
 * be able to tell "scored perfectly" from "never tested".
 */
export interface ResearchBenchmarkResult {
  /** Reference entities the run found, over all reference entities. */
  entityRecall: number | null;
  /** Entities found that the reference does not list. Not a penalty. */
  unmatchedFound: string[];
  /** Reference entities never found. The list a reviewer acts on. */
  missed: string[];
  /** Settled cells over requested cells, straight from the ledger. */
  fieldFillRate: number;
  lineageRecall: number | null;
  /** Volatile values carrying the date their source stated. */
  temporalProvenance: number | null;
  /** Stated values that were read or counted rather than inferred. */
  evidenceQuality: number | null;
  /** Known disagreements the run preserved rather than collapsed. */
  conflictRecall: number | null;
  /** Stated values whose source class suits that particular claim. */
  sourceAuthority: number | null;
  /** Unresolved and exhausted fields the answer actually mentions. */
  coverageTransparency: number | null;
  unsupportedClaimCount: number;
  searches: number;
  stopReason: string;
  /** False whenever the run fabricated, whatever its recall. */
  verdict: { pass: boolean; reasons: string[] };
}

export interface ResearchBenchmarkThresholds {
  minEntityRecall?: number;
  minFieldFillRate?: number;
  maxUnsupportedClaims?: number;
}

const DEFAULT_THRESHOLDS: Required<ResearchBenchmarkThresholds> = {
  minEntityRecall: 0.8,
  minFieldFillRate: 0.7,
  // Zero, not "few". An unsupported claim is a fabricated fact reaching a user.
  maxUnsupportedClaims: 0,
};

export function scoreResearchRun(
  input: ResearchBenchmarkInput,
  thresholds: ResearchBenchmarkThresholds = {},
): ResearchBenchmarkResult {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const synthesis = input.status.synthesis;
  const found = synthesis?.entities ?? [];
  const volatileFields = new Set(
    input.status.requestedFields.filter((field) => field.volatile).map((f) => f.key),
  );

  // --- entity recall ----------------------------------------------------
  const matchedFound = new Set<string>();
  const missed: string[] = [];
  for (const name of input.reference.entities) {
    const keys = new Set(referenceKeys(input.reference, name));
    const hit = found.find((entity) =>
      foundKeys(entity).some((key) => keys.has(key)),
    );
    if (hit) matchedFound.add(hit.name);
    else missed.push(name);
  }
  const unmatchedFound = found
    .filter((entity) => !matchedFound.has(entity.name))
    .map((entity) => entity.name);

  // --- provenance quality over every value the answer may state ---------
  let statedValues = 0;
  let withDate = 0;
  let volatileValues = 0;
  let explicitValues = 0;
  let wellSourced = 0;
  for (const entity of found) {
    for (const [field, record] of Object.entries(entity.verified)) {
      statedValues += 1;
      if (record.evidenceKind === "explicit" || record.evidenceKind === "roster_count") {
        explicitValues += 1;
      }
      const shape = claimShapeForField(field);
      if (PREFERRED_SOURCES[shape]?.has(record.sourceClass)) wellSourced += 1;
      if (volatileFields.has(field)) {
        volatileValues += 1;
        if (record.publishedAt) withDate += 1;
      }
    }
  }

  // --- lineage ----------------------------------------------------------
  const lineageWanted = input.reference.lineage ?? [];
  const lineageFound = lineageWanted.filter(([from, kind, to]) => {
    const fromKeys = new Set(referenceKeys(input.reference, from));
    const toKeys = new Set(referenceKeys(input.reference, to));
    const entity = found.find((candidate) =>
      foundKeys(candidate).some((key) => fromKeys.has(key)),
    );
    return Boolean(
      entity?.lineage.some(
        (edge) => edge.kind === kind && toKeys.has(identityKey(edge.other)),
      ),
    );
  }).length;

  // --- conflicts --------------------------------------------------------
  // Both buckets count: a disagreement that was decided is preserved as long as
  // the decision is disclosed. Collapsing it into one number silently is the
  // only failure here.
  const conflictsWanted = input.reference.knownConflicts ?? [];
  const conflictsFound = conflictsWanted.filter((wanted) => {
    const keys = new Set(referenceKeys(input.reference, wanted.entity));
    const entity = found.find((candidate) =>
      foundKeys(candidate).some((key) => keys.has(key)),
    );
    if (!entity) return false;
    return (
      entity.conflicting.some((row) => row.field === wanted.field) ||
      entity.resolvedConflicts.some((row) => row.field === wanted.field)
    );
  }).length;

  // --- transparency -----------------------------------------------------
  // Whether the answer told the user about its own gaps. Null when no answer
  // text was supplied, rather than a fabricated 1.0.
  let coverageTransparency: number | null = null;
  if (input.answerText !== undefined) {
    const text = input.answerText.toLowerCase();
    const labels = new Map(
      input.status.requestedFields.map((field) => [field.key, field.label]),
    );
    const gaps: Array<{ entity: string; field: string }> = [];
    for (const entity of found) {
      for (const field of [...entity.unresolved, ...entity.notFoundAfterSearch]) {
        gaps.push({ entity: entity.name, field });
      }
    }
    // A gap counts as reported when the answer names both the entity and the
    // detail — either by field key or by the label the user would recognize.
    const mentioned = gaps.filter((gap) => {
      if (!text.includes(gap.entity.toLowerCase())) return false;
      const label = labels.get(gap.field);
      return (
        text.includes(gap.field.toLowerCase()) ||
        (label !== undefined && text.includes(label.toLowerCase()))
      );
    }).length;
    coverageTransparency = ratio(mentioned, gaps.length);
  }

  const entityRecall = ratio(matchedFound.size, input.reference.entities.length);
  const fieldFillRate = input.status.coverage.fillRate;
  const unsupportedClaimCount = input.unsupportedClaims?.length ?? 0;

  const reasons: string[] = [];
  if (entityRecall === null) {
    reasons.push("the reference set lists no entities, so recall was never tested");
  } else if (entityRecall < limits.minEntityRecall) {
    reasons.push(
      `entity recall ${entityRecall} is below ${limits.minEntityRecall}; missed: ${missed.join(", ") || "none"}`,
    );
  }
  if (fieldFillRate < limits.minFieldFillRate) {
    reasons.push(`field fill rate ${fieldFillRate} is below ${limits.minFieldFillRate}`);
  }
  if (unsupportedClaimCount > limits.maxUnsupportedClaims) {
    reasons.push(
      `${unsupportedClaimCount} unsupported claims — higher recall bought with invention is a regression, not an improvement`,
    );
  }
  if (!synthesis) {
    reasons.push("the run never reached a stopping point, so nothing was synthesized");
  }

  return {
    entityRecall,
    unmatchedFound,
    missed,
    fieldFillRate,
    lineageRecall: ratio(lineageFound, lineageWanted.length),
    temporalProvenance: ratio(withDate, volatileValues),
    evidenceQuality: ratio(explicitValues, statedValues),
    conflictRecall: ratio(conflictsFound, conflictsWanted.length),
    sourceAuthority: ratio(wellSourced, statedValues),
    coverageTransparency,
    unsupportedClaimCount,
    searches: input.status.searchesUsed,
    stopReason: input.status.stop.reason,
    verdict: { pass: reasons.length === 0, reasons },
  };
}
