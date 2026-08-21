// The coverage ledger, and the decision to stop.
//
// This is the module that changes Super agent's behaviour. Everything else here
// records things; this one answers the question the old pipeline answered with
// a feeling: is the requested search space adequately covered?
//
// The distinction it exists to enforce runs through the whole design. "I have
// enough to write an answer" is a property of the model's context. "The
// requested coverage is resolved" is a property of this table. They are not the
// same, and for an exhaustive question the first is reached long before the
// second — which is precisely why the old pipeline stopped early.
//
// The ledger is a matrix: one row per discovered entity, one column per
// requested field, one status per cell. Nothing is settled by omission. A cell
// only leaves `unresolved` by being answered, by being searched to exhaustion,
// or by being ruled inapplicable.

import { resolveField } from "./evidence.ts";
import type {
  CoverageCell,
  CoverageReport,
  ResearchConflict,
  ResearchGap,
  ResearchState,
  StopReason,
} from "./types.ts";

/** Rounds with no new canonical entity before enumeration counts as saturated. */
const SATURATION_DRY_ROUNDS = 2;
/** Fraction of high-priority cells that must be settled to call it sufficient. */
const SUFFICIENT_HIGH_PRIORITY_RATIO = 0.9;
/** Fraction of all cells that must be settled alongside it. */
const SUFFICIENT_OVERALL_RATIO = 0.75;

function cellIsSettled(status: CoverageCell["status"]): boolean {
  return (
    status === "verified" ||
    status === "inferred" ||
    status === "not_found_after_search" ||
    status === "not_applicable"
  );
}

export interface CoverageComputation {
  report: CoverageReport;
  /** Conflicts discovered while resolving cells, replacing the stored set. */
  conflicts: ResearchConflict[];
  /** Resolved values per entity, for the synthesis brief. */
  resolved: Map<string, Record<string, unknown>>;
}

/**
 * Recompute the whole matrix from evidence and gap state.
 *
 * Deliberately a pure recomputation rather than an incremental update: coverage
 * is read after every ingest, and a stale cell is worse than a slow one. The
 * matrix is bounded by the entity ceiling in the budget, so the cost is bounded
 * with it.
 */
export function computeCoverage(
  state: ResearchState,
  options: { now?: string } = {},
): CoverageComputation {
  const fields = state.plan.requestedFields;
  const highPriorityKeys = new Set(state.plan.highPriorityFields);
  const cells: CoverageCell[] = [];
  const conflicts: ResearchConflict[] = [];
  const resolved = new Map<string, Record<string, unknown>>();
  let conflictSeq = 0;

  for (const entity of state.entities) {
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      // The name is known the moment the entity exists — it is what made the
      // row — so charging a search for it would make every ledger permanently
      // incomplete.
      if (field.key === "name") {
        cells.push({
          entityId: entity.id,
          field: field.key,
          status: "verified",
          evidenceCount: 1,
        });
        values[field.key] = entity.canonicalName;
        continue;
      }
      const resolution = resolveField({
        field: field.key,
        entityId: entity.id,
        evidence: state.evidence,
        volatile: field.volatile,
        conflictId: `c${++conflictSeq}`,
        ...(options.now ? { now: options.now } : {}),
      });
      if (resolution.conflict) conflicts.push(resolution.conflict);
      if (resolution.value !== undefined) values[field.key] = resolution.value;

      const gap = state.gaps.find(
        (item) => item.entityId === entity.id && item.field === field.key,
      );
      let status: CoverageCell["status"];
      if (resolution.status === "verified") status = "verified";
      else if (resolution.status === "conflicting") status = "conflicting";
      else if (resolution.status === "inferred") status = "inferred";
      else if (gap?.status === "exhausted") status = "not_found_after_search";
      else status = "unresolved";

      cells.push({
        entityId: entity.id,
        field: field.key,
        status,
        evidenceCount: resolution.supportingEvidenceIds.length,
        ...(resolution.corroboration
          ? { corroboration: resolution.corroboration }
          : {}),
        ...(resolution.selfInterestedOnly ? { selfInterestedOnly: true } : {}),
        ...(resolution.stale ? { stale: true } : {}),
      });
    }
    resolved.set(entity.id, values);
  }

  const highPriorityCells = cells.filter((cell) => highPriorityKeys.has(cell.field));
  const settledCells = cells.filter((cell) => cellIsSettled(cell.status)).length;
  const verifiedCells = cells.filter((cell) => cell.status === "verified").length;
  const highPriorityOpen = highPriorityCells.filter(
    (cell) => !cellIsSettled(cell.status),
  ).length;
  const conflictingCells = cells.filter((cell) => cell.status === "conflicting").length;
  // Counted over settled cells only. An unresolved cell resting on one source
  // is not a disclosure problem — it is an open gap, already counted as one.
  const settled = cells.filter((cell) => cellIsSettled(cell.status));
  const singleSourceCells = settled.filter(
    (cell) => cell.corroboration === "single_source",
  ).length;
  const selfInterestedCells = settled.filter(
    (cell) => cell.selfInterestedOnly === true,
  ).length;
  const staleCells = settled.filter((cell) => cell.stale === true).length;
  const totalCells = cells.length;
  const highPrioritySettled = highPriorityCells.length - highPriorityOpen;

  // A conflict is a settled research outcome — both values are known and both
  // will be reported — so it does not block sufficiency. What blocks it is a
  // cell nobody has answered and nobody has finished searching for.
  const sufficient =
    totalCells > 0 &&
    (highPriorityCells.length === 0 ||
      highPrioritySettled / highPriorityCells.length >=
        SUFFICIENT_HIGH_PRIORITY_RATIO) &&
    (settledCells + conflictingCells) / totalCells >= SUFFICIENT_OVERALL_RATIO;

  return {
    report: {
      cells,
      entityCount: state.entities.length,
      fieldCount: fields.length,
      totalCells,
      settledCells,
      verifiedCells,
      fillRate: totalCells ? Number((settledCells / totalCells).toFixed(4)) : 0,
      highPriorityOpen,
      conflictingCells,
      singleSourceCells,
      selfInterestedCells,
      staleCells,
      sufficient,
    },
    conflicts,
    resolved,
  };
}

/**
 * Create the gaps the current entity set implies.
 *
 * Every unresolved cell is a gap, and a gap that already exists keeps its
 * attempt history — otherwise a re-enumeration round would silently reset the
 * exhaustion counters and the session could search forever.
 */
export function syncGaps(input: {
  state: ResearchState;
  coverage: CoverageReport;
}): ResearchGap[] {
  const existing = new Map(
    input.state.gaps.map((gap) => [`${gap.entityId ?? ""}::${gap.field}`, gap]),
  );
  const priorities = new Map(
    input.state.plan.requestedFields.map((field) => [field.key, field.priority]),
  );
  const gaps: ResearchGap[] = [];
  // Derived from the highest id ever issued, not from the list length. Gaps are
  // dropped when their entity disappears, so a length-based counter would reissue
  // an id that is still referenced by a planned query — and the attempt would be
  // recorded against the wrong gap, quietly exhausting a field nobody searched.
  let seq = input.state.gaps.reduce((highest, gap) => {
    const parsed = Number.parseInt(gap.id.slice(1), 10);
    return Number.isFinite(parsed) ? Math.max(highest, parsed) : highest;
  }, 0);
  for (const cell of input.coverage.cells) {
    const key = `${cell.entityId}::${cell.field}`;
    const prior = existing.get(key);
    if (cell.status === "verified" || cell.status === "not_applicable") {
      // Resolved cells keep their gap row so the attempt history survives, but
      // the row stops asking for work.
      if (prior) gaps.push({ ...prior, status: "resolved" });
      continue;
    }
    if (cell.status === "conflicting" || cell.status === "inferred") {
      // Worth one more look, but never blocking: the value is known.
      if (prior) gaps.push(prior);
      continue;
    }
    if (prior) {
      gaps.push(prior.status === "resolved" ? { ...prior, status: "unsearched" } : prior);
      continue;
    }
    gaps.push({
      id: `g${++seq}`,
      entityId: cell.entityId,
      field: cell.field,
      priority: priorities.get(cell.field) ?? 3,
      status: "unsearched",
      attempts: [],
    });
  }
  // Gaps for entities that no longer exist are dropped rather than carried.
  return gaps;
}

/** True once repeated enumeration rounds stop producing anything new. */
export function enumerationSaturated(state: ResearchState): boolean {
  if (state.rounds.length === 0) return false;
  if (state.rounds.length >= state.plan.budget.maxEnumerationRounds) return true;
  const tail = state.rounds.slice(-SATURATION_DRY_ROUNDS);
  return (
    tail.length >= SATURATION_DRY_ROUNDS &&
    tail.every((round) => round.newEntities === 0)
  );
}

export interface StopDecision {
  stop: boolean;
  reason: StopReason;
  /** Plain-language explanation, safe to log and to show the user. */
  detail: string;
}

/**
 * The stopping rule.
 *
 * Three ways to finish, checked in order of how good an outcome they are, and
 * no fourth. The model does not get a vote: it asks this function, and the
 * answer is computed from the ledger, the saturation history and the budget.
 */
export function decideStop(input: {
  state: ResearchState;
  coverage: CoverageReport;
}): StopDecision {
  const { state, coverage } = input;
  const budget = state.plan.budget;

  if (coverage.sufficient) {
    return {
      stop: true,
      reason: "coverage_sufficient",
      detail: `Requested coverage is resolved: ${coverage.settledCells} of ${coverage.totalCells} cells settled across ${coverage.entityCount} entities.`,
    };
  }

  const openGaps = state.gaps.filter(
    (gap) => gap.status === "unsearched" || gap.status === "searching",
  );
  const openHighPriority = openGaps.filter((gap) => gap.priority === 1);
  const saturated = !state.plan.requiresEnumeration || enumerationSaturated(state);
  // An empty ledger is not a covered one. Without this guard the branch below
  // is vacuously true before any work has happened — no entities means no
  // gaps, which reads as "every gap is closed" — and the session would bless
  // synthesis on its first call.
  const hasFindings = state.entities.length > 0 || state.evidence.length > 0;
  if (saturated && hasFindings && openHighPriority.length === 0) {
    return {
      stop: true,
      reason: "saturated_and_exhausted",
      detail:
        "Entity discovery has stopped producing new results and every high-priority gap has used its diversified search strategies.",
    };
  }

  if (
    state.searchCount >= budget.maxSearches ||
    state.iterationCount >= budget.maxIterations
  ) {
    return {
      stop: true,
      reason: "budget_exhausted",
      detail: `The research budget is spent (${state.searchCount}/${budget.maxSearches} searches, ${state.iterationCount}/${budget.maxIterations} iterations). Remaining gaps are reported as unresolved rather than as absent.`,
    };
  }

  return {
    stop: false,
    reason: "not_stopping",
    detail: saturated
      ? `${openHighPriority.length} high-priority gaps still have unused search strategies.`
      : `Entity discovery has not saturated yet (${state.rounds.length}/${budget.maxEnumerationRounds} rounds).`,
  };
}

/**
 * A compact rendering of the matrix for the model.
 *
 * The full cell list is far too long to hand back every call for a large
 * session, and the model does not need it: it needs to know which entities are
 * incomplete and in which fields. Rows are truncated, and the truncation is
 * stated rather than hidden — a silently clipped ledger reads as full coverage.
 */
export function renderCoverageDigest(input: {
  state: ResearchState;
  coverage: CoverageReport;
  maxRows?: number;
}): { rows: string[]; truncated: number } {
  const maxRows = input.maxRows ?? 40;
  const byEntity = new Map<string, CoverageCell[]>();
  for (const cell of input.coverage.cells) {
    byEntity.set(cell.entityId, [...(byEntity.get(cell.entityId) ?? []), cell]);
  }
  const incomplete = [...byEntity.entries()].filter(([, cells]) =>
    cells.some((cell) => !cellIsSettled(cell.status)),
  );
  const symbol: Record<CoverageCell["status"], string> = {
    verified: "ok",
    conflicting: "conflict",
    inferred: "inferred",
    unresolved: "open",
    not_found_after_search: "exhausted",
    not_applicable: "n/a",
  };
  const rows = incomplete.slice(0, maxRows).map(([entityId, cells]) => {
    const entity = input.state.entities.find((item) => item.id === entityId);
    const detail = cells
      .filter((cell) => !cellIsSettled(cell.status))
      .map((cell) => `${cell.field}=${symbol[cell.status]}`)
      .join(" ");
    return `${entity?.canonicalName ?? entityId}: ${detail}`;
  });
  return { rows, truncated: Math.max(0, incomplete.length - rows.length) };
}
