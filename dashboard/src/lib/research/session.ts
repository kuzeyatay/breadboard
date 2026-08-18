// The three operations the model can perform on a research session.
//
// `begin` reads the request and returns a plan and a budget. `record` ingests
// what a round of searching found and returns what is still missing. `status`
// answers the only question that matters at the end: may this be synthesized
// yet, and if so, on what basis.
//
// The shape is intentional. The model does the searching — it has the web tools
// and the judgement about which page is worth opening — while Breadboard owns
// the bookkeeping and, critically, the stopping decision. That split is what
// makes the pipeline both better at exhaustive work and impossible to talk out
// of finishing the work.

import {
  addRelationship,
  findEntityByName,
  mergeEntityCandidates,
  type EntityCandidate,
} from "./entities.ts";
import { citableEvidence } from "./authority.ts";
import { classifyResearch, researchPipelineApplies } from "./classify.ts";
import {
  computeCoverage,
  decideStop,
  enumerationSaturated,
  renderCoverageDigest,
  syncGaps,
  type StopDecision,
} from "./coverage.ts";
import { normalizeEvidence, type EvidenceInput } from "./evidence.ts";
import {
  gapIsExhausted,
  planEnumerationQueries,
  planNextQueries,
  queryFingerprint,
  strategyStatsKey,
  type PlannedQuery,
} from "./scheduler.ts";
import {
  getResearchState,
  nextSessionId,
  putResearchState,
} from "./store.ts";
import type {
  EntityRelationKind,
  EvidenceKind,
  RequestedField,
  ResearchEvidence,
  ResearchGap,
  ResearchPhase,
  ResearchState,
  SearchStrategy,
  SourceClass,
  StopReason,
} from "./types.ts";

export class ResearchSessionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Hard input ceilings, so one malformed call cannot blow up the session. */
const MAX_CANDIDATES_PER_CALL = 200;
const MAX_EVIDENCE_PER_CALL = 200;
const MAX_SEARCHES_PER_CALL = 60;

export interface BeginInput {
  conversationId: number;
  question: string;
  requestedFields?: ReadonlyArray<{ key: string; label?: string; priority?: number }>;
  targetEntityDescription?: string;
  now?: string;
}

export interface BeginResult {
  sessionId: string;
  applies: boolean;
  intent: string;
  completenessRequired: boolean;
  phase: ResearchPhase;
  budget: ResearchState["plan"]["budget"];
  requestedFields: Array<{ key: string; label: string; priority: number }>;
  temporalScope: string;
  nextQueries: PlannedQuery[];
  guidance: string;
}

/**
 * Open (or reopen) the session for a conversation.
 *
 * Reopening deliberately replaces the state rather than extending it: a new
 * question has a new entity universe, and inheriting the previous question's
 * coverage matrix would report the wrong thing as already covered.
 */
export function beginResearch(input: BeginInput): BeginResult {
  const question = input.question.trim();
  if (!question) {
    throw new ResearchSessionError(
      "research_question_required",
      "A research session needs the question it is answering.",
    );
  }
  const now = input.now ?? new Date().toISOString();
  const plan = classifyResearch({
    question,
    ...(input.requestedFields ? { requestedFields: input.requestedFields } : {}),
    ...(input.targetEntityDescription
      ? { targetEntityDescription: input.targetEntityDescription }
      : {}),
  });
  const applies = researchPipelineApplies(plan);
  const state: ResearchState = {
    sessionId: nextSessionId(),
    conversationId: input.conversationId,
    question,
    plan,
    phase: plan.requiresEnumeration ? "enumeration" : "enrichment",
    entities: [],
    evidence: [],
    relationships: [],
    conflicts: [],
    gaps: [],
    rounds: [],
    issuedQueries: [],
    strategyStats: {},
    searchCount: 0,
    iterationCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  putResearchState(state);
  const nextQueries = plan.requiresEnumeration
    ? planEnumerationQueries({ state })
    : [];
  return {
    sessionId: state.sessionId,
    applies,
    intent: plan.intent,
    completenessRequired: plan.completenessRequired,
    phase: state.phase,
    budget: plan.budget,
    requestedFields: plan.requestedFields.map(({ key, label, priority }) => ({
      key,
      label,
      priority,
    })),
    temporalScope: plan.temporalScope.kind,
    nextQueries,
    guidance: applies
      ? plan.requiresEnumeration
        ? "Enumerate first: find what entities exist before researching any of them in depth. Report every candidate name you see, including ones you are unsure about — canonicalization happens here, not in your head."
        : "Go straight to depth: gather the requested fields for the subject, recording each observation with its source."
      : "This question does not need the exhaustive pipeline. Answer it directly.",
  };
}

export interface RecordSearchInput {
  query: string;
  strategy?: SearchStrategy;
  gapId?: string;
  resultCount?: number;
}

export interface RecordInput {
  conversationId: number;
  /** Candidate entity names found this round. Deduplicated here, not by the caller. */
  entities?: ReadonlyArray<EntityCandidate>;
  evidence?: ReadonlyArray<EvidenceInput & { entityName?: string }>;
  relationships?: ReadonlyArray<{
    from: string;
    to: string;
    kind: EntityRelationKind;
  }>;
  searches?: ReadonlyArray<RecordSearchInput>;
  /** True when this call closes an enumeration round. */
  completedEnumerationRound?: boolean;
  now?: string;
}

export interface RecordResult {
  sessionId: string;
  phase: ResearchPhase;
  newEntities: string[];
  mergedAliases: Array<{ candidate: string; into: string }>;
  rejectedEntities: string[];
  entityCount: number;
  evidenceRecorded: number;
  conflictsDetected: number;
  exhaustedGaps: number;
  coverage: {
    fillRate: number;
    settled: number;
    total: number;
    highPriorityOpen: number;
    conflicting: number;
  };
  saturated: boolean;
  searchesUsed: number;
  searchesRemaining: number;
  stop: StopDecision;
  nextQueries: PlannedQuery[];
  openRows: string[];
  openRowsTruncated: number;
}

/**
 * What to search next, given where the session is.
 *
 * Enumeration comes first and gap work second, but the phase is not allowed to
 * become a dead end: once every discovery angle has been issued, continuing to
 * offer discovery queries would hand back an empty list while the run is
 * unfinished, and a run with nothing to do and no permission to stop is how a
 * turn stalls. Falling through to gap work is both the useful answer and the
 * honest one — enumeration really has run out of ideas.
 */
function planQueriesForPhase(state: ResearchState): PlannedQuery[] {
  if (state.phase === "enumeration") {
    const discovery = planEnumerationQueries({ state });
    if (discovery.length) return discovery;
  }
  return planNextQueries({ state });
}

function requireState(conversationId: number): ResearchState {
  const state = getResearchState(conversationId);
  if (!state) {
    throw new ResearchSessionError(
      "research_session_missing",
      "No research session is open for this conversation. Call research_begin first.",
    );
  }
  return state;
}

/**
 * Fold one round of findings into the session.
 *
 * Everything here is additive except gap status: evidence is never replaced,
 * entities are never split, and a recorded search is never un-recorded. The one
 * thing that moves backwards is a gap returning to `unsearched` when new
 * entities appear, and that is handled in `syncGaps` so the attempt history
 * survives it.
 */
export function recordResearch(input: RecordInput): RecordResult {
  const state = requireState(input.conversationId);
  const now = input.now ?? new Date().toISOString();
  const budget = state.plan.budget;

  // --- searches ---------------------------------------------------------
  const searches = (input.searches ?? []).slice(0, MAX_SEARCHES_PER_CALL);
  const issued = new Set(state.issuedQueries);
  const attemptsByGap = new Map<string, RecordSearchInput[]>();
  for (const search of searches) {
    const fingerprint = queryFingerprint(search.query ?? "");
    if (!fingerprint) continue;
    // A repeat of an equivalent query costs nothing further: it is recorded
    // once, and the budget is not charged twice for the same question.
    if (!issued.has(fingerprint)) {
      issued.add(fingerprint);
      state.searchCount += 1;
    }
    if (search.gapId) {
      attemptsByGap.set(search.gapId, [
        ...(attemptsByGap.get(search.gapId) ?? []),
        search,
      ]);
    }
  }
  state.issuedQueries = [...issued];

  // --- entities ---------------------------------------------------------
  const round = state.rounds.length + 1;
  const outcome = mergeEntityCandidates({
    existing: state.entities,
    candidates: (input.entities ?? []).slice(0, MAX_CANDIDATES_PER_CALL),
    round,
    maxEntities: budget.maxEntities,
    now,
  });
  state.entities = outcome.entities;

  // --- evidence ---------------------------------------------------------
  const incoming = (input.evidence ?? []).slice(0, MAX_EVIDENCE_PER_CALL);
  const recorded: ResearchEvidence[] = [];
  for (const item of incoming) {
    if (!item?.field || !item.sourceUrl) continue;
    // An entity may be named rather than identified: resolving it here is what
    // lets a worker report findings without knowing internal ids.
    const entityId =
      item.entityId ??
      (item.entityName
        ? findEntityByName(state.entities, item.entityName)?.id
        : undefined);
    recorded.push(
      normalizeEvidence(
        {
          ...item,
          ...(entityId ? { entityId } : {}),
        },
        { id: `ev${state.evidence.length + recorded.length + 1}`, now },
      ),
    );
  }
  state.evidence = [...state.evidence, ...recorded];

  // --- relationships ----------------------------------------------------
  for (const relation of input.relationships ?? []) {
    const from = findEntityByName(state.entities, relation.from);
    const to = findEntityByName(state.entities, relation.to);
    if (!from || !to) continue;
    state.relationships = addRelationship({
      relationships: state.relationships,
      fromEntityId: from.id,
      toEntityId: to.id,
      kind: relation.kind,
    });
    // A renamed or merged entity is no longer independently alive, and saying
    // so here keeps lifecycle out of the model's memory.
    if (relation.kind === "renamed_to" && from.lifecycle === "unknown") {
      from.lifecycle = "renamed";
    }
    if (relation.kind === "merged_into" && from.lifecycle === "unknown") {
      from.lifecycle = "merged";
    }
  }

  // --- coverage, gaps, exhaustion --------------------------------------
  let computation = computeCoverage(state);
  state.conflicts = computation.conflicts;
  state.gaps = syncGaps({ state, coverage: computation.report });

  // Attempts are attached after the gaps exist, then exhaustion is evaluated,
  // then coverage is recomputed — because a gap that just became exhausted
  // turns an `unresolved` cell into `not_found_after_search`.
  const gaps: ResearchGap[] = state.gaps.map((gap) => {
    const attempts = attemptsByGap.get(gap.id);
    if (!attempts?.length) return gap;
    const produced = recorded.some(
      (item) => item.field === gap.field && item.entityId === gap.entityId,
    );
    return {
      ...gap,
      status: gap.status === "resolved" ? gap.status : "searching",
      attempts: [
        ...gap.attempts,
        ...attempts.map((attempt) => {
          const strategy = attempt.strategy ?? ("entity_field" as SearchStrategy);
          // Recorded at session level so the lesson outlives the gap row: by the
          // twentieth entity the scheduler should already know which strategies
          // answer this kind of claim. See scheduler.ts.
          const key = strategyStatsKey(gap.field, strategy);
          const prior = state.strategyStats[key] ?? { attempts: 0, hits: 0 };
          state.strategyStats[key] = {
            attempts: prior.attempts + 1,
            hits: prior.hits + (produced ? 1 : 0),
          };
          return {
            strategy,
            query: queryFingerprint(attempt.query),
            at: now,
            producedEvidence: produced,
          };
        }),
      ],
    };
  });
  let exhaustedGaps = 0;
  state.gaps = gaps.map((gap) => {
    if (gap.status === "resolved") return gap;
    if (gapIsExhausted(gap, budget.maxAttemptsPerGap)) {
      exhaustedGaps += 1;
      return { ...gap, status: "exhausted" as const };
    }
    return gap;
  });
  computation = computeCoverage(state);
  state.conflicts = computation.conflicts;

  // --- rounds and phase -------------------------------------------------
  if (input.completedEnumerationRound) {
    state.rounds = [
      ...state.rounds,
      {
        round,
        newEntities: outcome.created.length,
        mergedCandidates: outcome.merged.length,
        at: now,
      },
    ];
  }
  state.iterationCount += 1;
  const saturated = enumerationSaturated(state);
  if (state.phase === "enumeration" && saturated) state.phase = "enrichment";
  if (state.phase === "enrichment" && computation.report.conflictingCells > 0) {
    state.phase = "reconciliation";
  }

  const stop = decideStop({ state, coverage: computation.report });
  if (stop.stop) {
    state.phase = "synthesis";
    state.stopped = { reason: stop.reason, at: now };
  }
  state.updatedAt = now;
  putResearchState(state);

  const nextQueries = stop.stop ? [] : planQueriesForPhase(state);
  const digest = renderCoverageDigest({ state, coverage: computation.report });

  return {
    sessionId: state.sessionId,
    phase: state.phase,
    newEntities: outcome.created.map((entity) => entity.canonicalName),
    mergedAliases: outcome.merged,
    rejectedEntities: outcome.rejected,
    entityCount: state.entities.length,
    evidenceRecorded: recorded.length,
    conflictsDetected: state.conflicts.length,
    exhaustedGaps,
    coverage: {
      fillRate: computation.report.fillRate,
      settled: computation.report.settledCells,
      total: computation.report.totalCells,
      highPriorityOpen: computation.report.highPriorityOpen,
      conflicting: computation.report.conflictingCells,
    },
    saturated,
    searchesUsed: state.searchCount,
    searchesRemaining: Math.max(0, budget.maxSearches - state.searchCount),
    stop,
    nextQueries,
    openRows: digest.rows,
    openRowsTruncated: digest.truncated,
  };
}

export interface SynthesisEntity {
  name: string;
  aliases: string[];
  lifecycle: string;
  classification?: string;
  /**
   * Field values safe to state, each with the provenance the answer needs to
   * attribute and date it. `publishedAt` is what lets a volatile figure be
   * written as "as of <date>" instead of as a timeless fact, and `evidenceKind`
   * is what stops a counted or derived number being presented as a stated one.
   */
  verified: Record<
    string,
    {
      value: unknown;
      sourceUrl: string;
      sourceTitle?: string;
      sourceClass: SourceClass;
      evidenceKind: EvidenceKind;
      publishedAt?: string;
      observedAt: string;
    }
  >;
  /** Values that exist but were reconstructed rather than stated. */
  inferred: Record<string, unknown>;
  /** Fields with more than one surviving value. */
  conflicting: Array<{ field: string; values: unknown[]; reason: string }>;
  /**
   * Fields where sources disagreed and the disagreement *was* settled — by
   * authority, or because the value simply changed over time. Reported so the
   * choice is disclosed rather than made silently behind a single number.
   */
  resolvedConflicts: Array<{
    field: string;
    chosen: unknown;
    otherValues: unknown[];
    reason: string;
  }>;
  /** Searched to exhaustion and genuinely not found. */
  notFoundAfterSearch: string[];
  /** Not searched to exhaustion — missing, which is a different claim. */
  unresolved: string[];
  lineage: Array<{ kind: string; other: string }>;
}

export interface StatusResult {
  sessionId: string;
  phase: ResearchPhase;
  stop: StopDecision;
  coverage: {
    fillRate: number;
    settled: number;
    total: number;
    verified: number;
    conflicting: number;
    highPriorityOpen: number;
    entities: number;
    fields: number;
  };
  searchesUsed: number;
  rounds: number;
  saturated: boolean;
  nextQueries: PlannedQuery[];
  /**
   * The fields the ledger is tracking, carried on every status read so a
   * consumer — the answer, the evidence panel, the benchmark scorer — can tell
   * which values legitimately change over time without re-deriving the plan.
   */
  requestedFields: RequestedField[];
  /** Present only once stopping is allowed. */
  synthesis?: {
    question: string;
    entities: SynthesisEntity[];
    /** Fields the whole session never resolved for anyone. */
    globalUnresolved: string[];
    sources: Array<{ url: string; title?: string; sourceClass: string }>;
    stopReason: string;
  };
}

/**
 * Where the session stands, and — once it may stop — the normalized state the
 * answer should be written from.
 *
 * The synthesis block is the point of the whole module: it hands the model a
 * per-entity breakdown already separated into verified, inferred, conflicting,
 * exhausted and unresolved, so the answer is written from typed state rather
 * than from whatever search snippets are still in context. In particular the
 * last two are kept apart, because collapsing them is what turns "I did not
 * find this" into the much stronger, usually false "this is not published".
 */
export function researchStatus(input: {
  conversationId: number;
  now?: string;
}): StatusResult {
  const state = requireState(input.conversationId);
  const computation = computeCoverage(state);
  const stop = decideStop({ state, coverage: computation.report });
  const base: StatusResult = {
    sessionId: state.sessionId,
    phase: state.phase,
    stop,
    coverage: {
      fillRate: computation.report.fillRate,
      settled: computation.report.settledCells,
      total: computation.report.totalCells,
      verified: computation.report.verifiedCells,
      conflicting: computation.report.conflictingCells,
      highPriorityOpen: computation.report.highPriorityOpen,
      entities: computation.report.entityCount,
      fields: computation.report.fieldCount,
    },
    searchesUsed: state.searchCount,
    rounds: state.rounds.length,
    saturated: enumerationSaturated(state),
    nextQueries: stop.stop ? [] : planQueriesForPhase(state),
    requestedFields: state.plan.requestedFields,
  };
  if (!stop.stop) return base;

  const entities: SynthesisEntity[] = state.entities.map((entity) => {
    const cells = computation.report.cells.filter(
      (cell) => cell.entityId === entity.id,
    );
    const values = computation.resolved.get(entity.id) ?? {};
    const verified: SynthesisEntity["verified"] = {};
    const inferred: Record<string, unknown> = {};
    const conflicting: SynthesisEntity["conflicting"] = [];
    const resolvedConflicts: SynthesisEntity["resolvedConflicts"] = [];
    const notFound: string[] = [];
    const unresolved: string[] = [];
    for (const cell of cells) {
      if (cell.field === "name") continue;
      const settledConflict = state.conflicts.find(
        (item) =>
          item.entityId === entity.id &&
          item.field === cell.field &&
          item.resolution.status !== "unresolved",
      );
      if (settledConflict) {
        const chosen = settledConflict.resolution.value;
        resolvedConflicts.push({
          field: cell.field,
          chosen,
          otherValues: settledConflict.observations
            .map((observation) => observation.value)
            .filter((value) => value !== chosen),
          reason: settledConflict.resolution.reason,
        });
      }
      if (cell.status === "verified" && values[cell.field] !== undefined) {
        const support = citableEvidence(
          state.evidence.filter(
            (item) => item.entityId === entity.id && item.field === cell.field,
          ),
        )[0];
        verified[cell.field] = {
          value: values[cell.field],
          sourceUrl: support?.sourceUrl ?? "",
          ...(support?.sourceTitle ? { sourceTitle: support.sourceTitle } : {}),
          sourceClass: support?.sourceClass ?? "other",
          evidenceKind: support?.evidenceKind ?? "explicit",
          ...(support?.publishedAt ? { publishedAt: support.publishedAt } : {}),
          observedAt: support?.observedAt ?? entity.createdAt,
        };
      } else if (cell.status === "inferred") {
        inferred[cell.field] = values[cell.field];
      } else if (cell.status === "conflicting") {
        const conflict = state.conflicts.find(
          (item) => item.entityId === entity.id && item.field === cell.field,
        );
        conflicting.push({
          field: cell.field,
          values: conflict?.observations.map((observation) => observation.value) ?? [],
          reason: conflict?.resolution.reason ?? "Sources disagree.",
        });
      } else if (cell.status === "not_found_after_search") {
        notFound.push(cell.field);
      } else if (cell.status === "unresolved") {
        unresolved.push(cell.field);
      }
    }
    return {
      name: entity.canonicalName,
      aliases: entity.aliases,
      lifecycle: entity.lifecycle,
      ...(entity.classification ? { classification: entity.classification } : {}),
      verified,
      inferred,
      conflicting,
      resolvedConflicts,
      notFoundAfterSearch: notFound,
      unresolved,
      lineage: state.relationships
        .filter((edge) => edge.fromEntityId === entity.id)
        .map((edge) => ({
          kind: edge.kind,
          other:
            state.entities.find((item) => item.id === edge.toEntityId)
              ?.canonicalName ?? edge.toEntityId,
        })),
    };
  });

  const seen = new Set<string>();
  const sources = state.evidence
    .filter((item) => {
      if (seen.has(item.sourceUrl)) return false;
      seen.add(item.sourceUrl);
      return true;
    })
    .map((item) => ({
      url: item.sourceUrl,
      ...(item.sourceTitle ? { title: item.sourceTitle } : {}),
      sourceClass: item.sourceClass,
    }));

  return {
    ...base,
    synthesis: {
      question: state.question,
      entities,
      globalUnresolved: state.plan.requestedFields
        .filter(
          (field) =>
            field.key !== "name" &&
            entities.length > 0 &&
            entities.every((entity) => entity.unresolved.includes(field.key)),
        )
        .map((field) => field.key),
      sources,
      stopReason: stop.detail,
    },
  };
}

/**
 * What the research turn covered, small enough to travel with the answer.
 *
 * The evidence panel already answers "what did this turn actually do". Without
 * this it cannot answer the question an exhaustive research answer really
 * raises — how much of what was asked for is actually settled — and the user is
 * left taking the prose's word for its own completeness. Deliberately a summary
 * rather than the matrix: counts, a stop reason, and a few of the incomplete
 * rows, because the full ledger is hundreds of cells and dumping it would bury
 * the one number that matters.
 */
export interface ResearchCoverageSummary {
  entities: number;
  fields: number;
  settled: number;
  total: number;
  verified: number;
  conflicting: number;
  /** Cells searched every way the budget allowed and genuinely empty. */
  exhausted: number;
  /** Cells nobody has finished looking for. The honest remainder. */
  open: number;
  searches: number;
  /** Null while the session is unfinished — which is itself worth showing. */
  stopReason: StopReason | null;
  /** A few incomplete rows, in `<entity>: <field>=<status>` form. */
  openRows: string[];
  openRowsTruncated: number;
}

/** The coverage summary for a conversation, or null when no session ran. */
export function researchCoverageSummary(
  conversationId: number,
): ResearchCoverageSummary | null {
  const state = getResearchState(conversationId);
  if (!state) return null;
  const computation = computeCoverage(state);
  const report = computation.report;
  const digest = renderCoverageDigest({ state, coverage: report, maxRows: 6 });
  const count = (status: string) =>
    report.cells.filter((cell) => cell.status === status).length;
  return {
    entities: report.entityCount,
    fields: report.fieldCount,
    settled: report.settledCells,
    total: report.totalCells,
    verified: report.verifiedCells,
    conflicting: report.conflictingCells,
    exhausted: count("not_found_after_search"),
    open: count("unresolved"),
    searches: state.searchCount,
    stopReason: state.stopped?.reason ?? null,
    openRows: digest.rows,
    openRowsTruncated: digest.truncated,
  };
}

/**
 * Fields an answer may describe as genuinely absent from the public record.
 *
 * Used by the turn's honesty gate: a claim of non-publication about anything
 * not in this set is a claim the research state does not support.
 */
export function exhaustedFieldLabels(conversationId: number): string[] {
  const state = getResearchState(conversationId);
  if (!state) return [];
  const labels = new Map(
    state.plan.requestedFields.map((field) => [field.key, field.label]),
  );
  return [
    ...new Set(
      state.gaps
        .filter((gap) => gap.status === "exhausted")
        .map((gap) => labels.get(gap.field) ?? gap.field),
    ),
  ];
}
