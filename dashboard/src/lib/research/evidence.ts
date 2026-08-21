// Ingesting observations, and refusing to let one overwrite another.
//
// The failure this module exists to prevent is quiet: two sources give a
// different member count, the later write wins, and the answer states a precise
// number with no hint that anything disagreed. Every observation is therefore
// kept, and a field with more than one distinct value becomes a first-class
// conflict rather than a resolved value.
//
// The second failure is subtler and more common in historical research: two
// sources that "disagree" about a headcount actually describe two different
// years. Treating that as a contradiction is wrong, and so is averaging it. The
// resolver separates the two cases explicitly — value changed over time, versus
// sources disagreeing about the same period — and only the second is a conflict.

import {
  evidenceAuthority,
  independentSourceCount,
  isExplicit,
} from "./authority.ts";
import type {
  ConflictObservation,
  Corroboration,
  ResearchConflict,
  ResearchEvidence,
} from "./types.ts";

/** Observations further apart than this describe different periods. */
const TEMPORAL_SEPARATION_DAYS = 180;

/**
 * How old a value may be before a volatile field should say so.
 *
 * Roughly a reporting cycle. The point is not that an eighteen-month-old
 * figure is wrong — it is that quoting it without its date makes it a claim
 * about today, which is a different and usually false statement.
 */
const STALE_AFTER_DAYS = 540;

export interface EvidenceInput {
  entityId?: string;
  field: string;
  value: unknown;
  sourceUrl: string;
  sourceTitle?: string;
  sourceClass?: ResearchEvidence["sourceClass"];
  publishedAt?: string;
  evidenceKind?: ResearchEvidence["evidenceKind"];
  confidence?: ResearchEvidence["confidence"];
  selfInterested?: boolean;
  note?: string;
}

function isoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * Normalize a recorded observation.
 *
 * `observedAt` is stamped by Breadboard rather than accepted from the caller:
 * it is the one date in the row that is a fact about this system, and a model
 * supplying it would make retrieval time as unreliable as everything else.
 */
export function normalizeEvidence(
  input: EvidenceInput,
  options: { id: string; now?: string },
): ResearchEvidence {
  return {
    id: options.id,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    field: input.field,
    value: input.value,
    sourceUrl: input.sourceUrl,
    ...(input.sourceTitle ? { sourceTitle: input.sourceTitle } : {}),
    sourceClass: input.sourceClass ?? "other",
    ...(isoOrUndefined(input.publishedAt)
      ? { publishedAt: isoOrUndefined(input.publishedAt) }
      : {}),
    observedAt: options.now ?? new Date().toISOString(),
    evidenceKind: input.evidenceKind ?? "explicit",
    confidence: input.confidence ?? (input.evidenceKind === "inference" ? "low" : "medium"),
    // A vendor's marketing page is interested in its own claims by
    // construction, so the class implies the flag and the caller does not have
    // to remember to set both.
    ...(input.selfInterested === true || input.sourceClass === "vendor_marketing"
      ? { selfInterested: true }
      : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

/** Values compared as strings, so 21 and "21" are one value rather than two. */
function valueKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim().toLowerCase();
}

function effectiveDate(evidence: ResearchEvidence): string {
  return evidence.publishedAt ?? evidence.observedAt;
}

function daysApart(left: string, right: string): number {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) / 86_400_000;
}

function toObservation(evidence: ResearchEvidence): ConflictObservation {
  return {
    evidenceId: evidence.id,
    value: evidence.value,
    ...(evidence.publishedAt ? { publishedAt: evidence.publishedAt } : {}),
    observedAt: evidence.observedAt,
    sourceClass: evidence.sourceClass,
    evidenceKind: evidence.evidenceKind,
    authority: evidenceAuthority(evidence),
  };
}

function daysSince(iso: string, now: string): number {
  return (new Date(now).getTime() - new Date(iso).getTime()) / 86_400_000;
}

export interface FieldResolution {
  /** The value a synthesis may state, when one can be stated at all. */
  value?: unknown;
  status: "verified" | "conflicting" | "inferred" | "unresolved";
  /** Present whenever the observations do not agree. */
  conflict?: ResearchConflict;
  supportingEvidenceIds: string[];
  /**
   * How well the stated value is actually supported — computed from the
   * observations that survived, not from the ones that were recorded.
   *
   * These three exist so the answer can qualify a figure instead of stating it
   * flatly. None of them blocks a value from being used: a single interested
   * source is worth reporting as long as the report says that is what it is,
   * and silently suppressing it would leave the user with nothing and no idea
   * why.
   */
  corroboration?: Corroboration;
  /** Every surviving source for the value has a stake in it. */
  selfInterestedOnly?: boolean;
  /** Volatile, and the newest supporting source is older than the horizon. */
  stale?: boolean;
  /** The date the stated value actually describes, when one is known. */
  asOf?: string;
}

/**
 * Resolve one entity-field cell from every observation recorded for it.
 *
 * Order matters and is deliberate: temporal separation is checked *before*
 * authority, because a newer number from a weaker source is still the newer
 * number, and reporting last year's figure as current because a better site
 * published it is the exact error the volatility flag exists to prevent.
 */
function resolveFieldCore(input: {
  field: string;
  entityId?: string;
  evidence: readonly ResearchEvidence[];
  volatile: boolean;
  conflictId: string;
}): FieldResolution {
  const relevant = input.evidence.filter(
    (item) =>
      item.field === input.field &&
      (input.entityId ? item.entityId === input.entityId : !item.entityId),
  );
  if (!relevant.length) {
    return { status: "unresolved", supportingEvidenceIds: [] };
  }

  const distinct = new Map<string, ResearchEvidence[]>();
  for (const item of relevant) {
    const key = valueKey(item.value);
    distinct.set(key, [...(distinct.get(key) ?? []), item]);
  }

  const explicit = relevant.filter((item) => isExplicit(item.evidenceKind));
  if (distinct.size === 1) {
    const only = relevant[0];
    return {
      value: only.value,
      // A single agreed value that nobody actually stated is still an
      // inference, and the answer has to say so.
      status: explicit.length ? "verified" : "inferred",
      supportingEvidenceIds: relevant.map((item) => item.id),
    };
  }

  const observations = relevant.map(toObservation);
  const sortedByDate = [...relevant].sort(
    (left, right) =>
      new Date(effectiveDate(right)).getTime() -
      new Date(effectiveDate(left)).getTime(),
  );
  const newest = sortedByDate[0];
  const oldest = sortedByDate[sortedByDate.length - 1];

  // Case 1: the value moved. Same claim, different periods — not a conflict.
  if (
    input.volatile &&
    daysApart(effectiveDate(newest), effectiveDate(oldest)) >=
      TEMPORAL_SEPARATION_DAYS &&
    valueKey(newest.value) !== valueKey(oldest.value)
  ) {
    return {
      value: newest.value,
      status: "verified",
      supportingEvidenceIds: [newest.id],
      conflict: {
        id: input.conflictId,
        ...(input.entityId ? { entityId: input.entityId } : {}),
        field: input.field,
        observations,
        resolution: {
          status: "temporal_change",
          value: newest.value,
          reason:
            "The observations describe different points in time, so the most recent one is reported as current rather than treated as a disagreement.",
        },
      },
    };
  }

  // Case 2: sources disagree about the same period. Authority decides only when
  // it decides clearly; a near-tie stays unresolved and both values survive.
  const ranked = [...observations].sort((left, right) => right.authority - left.authority);
  const [best, runnerUp] = ranked;
  const decisive =
    best.authority - (runnerUp?.authority ?? 0) >= 0.15 &&
    isExplicit(best.evidenceKind);
  const conflict: ResearchConflict = {
    id: input.conflictId,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    field: input.field,
    observations,
    resolution: decisive
      ? {
          status: "resolved",
          value: best.value,
          reason:
            "One source is materially more authoritative for this particular claim and states the value explicitly.",
        }
      : {
          status: "unresolved",
          reason:
            "The sources disagree and none is decisively more authoritative for this claim, so both values are reported.",
        },
  };
  return {
    ...(decisive ? { value: best.value } : {}),
    status: decisive ? "verified" : "conflicting",
    supportingEvidenceIds: decisive
      ? [best.evidenceId]
      : observations.map((item) => item.evidenceId),
    conflict,
  };
}

/**
 * Resolve one cell, then say how well the result is actually supported.
 *
 * The support judgement is kept out of `resolveFieldCore` on purpose. That
 * function answers "which value survives", which is a question about the
 * observations; this one answers "how firmly may it be stated", which is a
 * question about the sources behind the surviving value — and conflating them
 * is how a number backed by one interested page ends up indistinguishable in
 * the answer from one three independent sources agree on.
 */
export function resolveField(input: {
  field: string;
  entityId?: string;
  evidence: readonly ResearchEvidence[];
  /** True when the field's value legitimately changes over time. */
  volatile: boolean;
  conflictId: string;
  now?: string;
}): FieldResolution {
  const resolution = resolveFieldCore(input);
  if (!resolution.supportingEvidenceIds.length) return resolution;

  const supporting = input.evidence.filter((item) =>
    resolution.supportingEvidenceIds.includes(item.id),
  );
  if (!supporting.length) return resolution;

  // A disagreement that authority settled is still a disagreement. Reporting
  // it as `single_source` would be true — one observation does back the stated
  // value — and would hide the thing the reader most needs, which is that
  // another source said something else. A temporal change is exempt: those
  // sources never disagreed, they described different years.
  const disputed =
    resolution.conflict !== undefined &&
    resolution.conflict.resolution.status !== "temporal_change";
  const corroboration: Corroboration =
    resolution.status === "conflicting" || disputed
      ? "contested"
      : independentSourceCount(supporting) > 1
        ? "corroborated"
        : "single_source";

  // Undated evidence is not treated as stale. `observedAt` says when Breadboard
  // read the page, which is today by construction, and letting that stand in
  // for the publication date would mark every source fresh — the opposite of
  // the mistake this is here to catch.
  const dated = supporting
    .map((item) => item.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const asOf = dated.at(-1);
  const now = input.now ?? new Date().toISOString();
  const stale =
    input.volatile && asOf !== undefined && daysSince(asOf, now) > STALE_AFTER_DAYS;

  return {
    ...resolution,
    corroboration,
    ...(supporting.every((item) => item.selfInterested === true)
      ? { selfInterestedOnly: true }
      : {}),
    ...(stale ? { stale: true } : {}),
    ...(asOf ? { asOf } : {}),
  };
}
