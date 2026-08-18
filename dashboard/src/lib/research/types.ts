// The research state a Super agent turn accumulates, as data rather than as
// remembered prose.
//
// Breadboard's research turns used to be shaped like this: search, read a few
// good sources, summarize carefully. That is excellent at not inventing things
// and bad at finishing — the model stops when it has enough material to write,
// which for "every X ever created" is nowhere near the requested search space.
//
// The fix is to stop asking the model to remember what it has covered. Every
// observation becomes a typed row here; coverage is computed from those rows;
// and the decision to synthesize is made against the coverage report instead of
// against the model's sense of having enough to say. Nothing in this file
// performs a search — it only records what was found and what is still missing.

/** What kind of research the request actually is. */
export type ResearchIntent =
  | "simple_lookup"
  | "normal_research"
  | "comparative_research"
  | "exhaustive_enumeration"
  | "historical_reconstruction"
  | "multi_entity_enrichment"
  | "ambiguity_resolution";

/**
 * The six factors the budget is derived from, each normalized to 0..1 so a
 * change to one of them cannot silently dominate the others.
 */
export interface ResearchFactors {
  /** How many distinct entities the answer is likely to be about. */
  entityBreadth: number;
  /** How many separate fields were requested per entity. */
  fieldBreadth: number;
  /** How far back the question reaches. */
  historicalDepth: number;
  /** How under-specified the subject is. */
  ambiguity: number;
  /** How strongly the question demands a complete answer. */
  completenessRequirement: number;
  /** How likely published sources are to disagree. */
  conflictLikelihood: number;
}

/**
 * Hard ceilings for one research session. Every one of these is enforced in
 * `coverage.ts`/`scheduler.ts` rather than described to the model, because a
 * budget the model can talk itself past is not a budget.
 */
export interface ResearchBudget {
  maxSearches: number;
  maxIterations: number;
  maxEnumerationRounds: number;
  maxEntities: number;
  /** Diversified strategies one gap may burn before it counts as exhausted. */
  maxAttemptsPerGap: number;
  /** Entities handed out per enrichment batch — the bounded-concurrency knob. */
  enrichmentBatchSize: number;
}

/** A field the answer has to carry for each entity. */
export interface RequestedField {
  /** Stable key used by the coverage ledger. */
  key: string;
  /** How the user said it, for prompts and the final answer. */
  label: string;
  /** 1 (highest) … 3. High-priority gaps are searched first and hardest. */
  priority: number;
  /**
   * True when the value legitimately changes over time — a headcount, a price,
   * a status. Volatile fields need a date on every observation, and two
   * different values from two different years are a change, not a conflict.
   */
  volatile: boolean;
}

export type TemporalScope =
  | { kind: "current" }
  | { kind: "historical" }
  /** Both the present state and how it got there — the hardest of the three. */
  | { kind: "full_history" };

/**
 * The structured reading of the request. Internal: it shapes the search, and
 * is never shown to the user verbatim.
 */
export interface ResearchPlan {
  intent: ResearchIntent;
  /** True when a partial answer is a wrong answer. */
  completenessRequired: boolean;
  /** What the entities are, in the user's own words. */
  targetEntityDescription: string;
  requestedFields: RequestedField[];
  temporalScope: TemporalScope;
  budget: ResearchBudget;
  factors: ResearchFactors;
  /** Field keys worth spending diversified searches on. */
  highPriorityFields: string[];
  /** Enumerate first, or go straight to depth on a known subject. */
  requiresEnumeration: boolean;
}

/** Where an observation came from, which decides how much it counts for. */
export type SourceClass =
  | "institution"
  | "official_entity"
  | "official_database"
  | "competition"
  | "partner"
  | "reputable_secondary"
  | "archive"
  | "social"
  | "other";

/**
 * How the value was obtained. The distinction that matters most is the first
 * one against the last two: a number stated on the page is not the same claim
 * as a number someone counted or guessed, and collapsing them is how a
 * confident wrong answer gets built.
 */
export type EvidenceKind =
  | "explicit"
  | "roster_count"
  | "derived"
  | "estimate"
  | "inference";

/**
 * Qualitative rather than a score. A 0.72 confidence would be invented
 * precision — nothing here can measure that — and it would then be compared,
 * averaged and thresholded as though it meant something.
 */
export type Confidence = "high" | "medium" | "low";

/** One entity's lifecycle, kept separate from what kind of thing it is. */
export type EntityLifecycle =
  | "active"
  | "inactive"
  | "dissolved"
  | "merged"
  | "renamed"
  | "unknown";

export interface ResearchEntity {
  /** Stable within a session; every other row refers to an entity by this. */
  id: string;
  canonicalName: string;
  /** Former names, abbreviations, spellings. Never counted as entities. */
  aliases: string[];
  /**
   * Whether the entity still exists, which is not the same question as what it
   * is. Keeping them apart stops "an inactive solar team" from being recorded
   * as the classification "inactive".
   */
  lifecycle: EntityLifecycle;
  /** What kind of thing it is, in the domain's own vocabulary. */
  classification?: string;
  /** Resolved field values, written only by conflict resolution. */
  attributes: Record<string, unknown>;
  /** The enumeration round that first produced it, for saturation. */
  discoveredInRound: number;
  createdAt: string;
}

export interface ResearchEvidence {
  id: string;
  /** Absent for evidence about the universe itself rather than one entity. */
  entityId?: string;
  field: string;
  value: unknown;
  sourceUrl: string;
  sourceTitle?: string;
  sourceClass: SourceClass;
  /** When the source says the fact was true. Absent is meaningful, not zero. */
  publishedAt?: string;
  /** When Breadboard saw it. Always present. */
  observedAt: string;
  evidenceKind: EvidenceKind;
  confidence: Confidence;
  note?: string;
}

export type EntityRelationKind =
  | "renamed_to"
  | "merged_into"
  | "successor_of"
  | "predecessor_of"
  | "spinout_of"
  | "split_from";

export interface EntityRelationship {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  kind: EntityRelationKind;
  evidenceIds: string[];
}

export interface ConflictObservation {
  evidenceId: string;
  value: unknown;
  publishedAt?: string;
  observedAt: string;
  sourceClass: SourceClass;
  evidenceKind: EvidenceKind;
  /** Authority for this specific claim, from `authority.ts`. */
  authority: number;
}

export type ConflictResolutionStatus =
  /** One observation wins on authority, recency and explicitness. */
  | "resolved"
  /** The values differ because they describe different points in time. */
  | "temporal_change"
  /** Nothing here can safely choose. Both survive into the answer. */
  | "unresolved";

export interface ResearchConflict {
  id: string;
  entityId?: string;
  field: string;
  observations: ConflictObservation[];
  resolution: {
    status: ConflictResolutionStatus;
    value?: unknown;
    /** Plain-language reason, safe to surface to the user. */
    reason: string;
  };
}

/** The diversified strategies a gap search may use, in default order. */
export type SearchStrategy =
  | "entity_field"
  | "field_synonym"
  | "official_site"
  | "parent_institution"
  | "document_search"
  | "authoritative_database"
  | "secondary_ecosystem"
  | "alias_search"
  | "temporal_search";

export interface SearchAttempt {
  strategy: SearchStrategy;
  /** Normalized query text, used to reject equivalent repeats. */
  query: string;
  at: string;
  /** Whether the attempt produced any evidence for this gap. */
  producedEvidence: boolean;
}

export type GapStatus =
  | "unsearched"
  | "searching"
  | "resolved"
  /**
   * Searched every strategy the budget allows and found nothing. This is the
   * only state from which an answer may say something is not published.
   */
  | "exhausted";

export interface ResearchGap {
  id: string;
  entityId?: string;
  field: string;
  /** 1 (highest) … 3, inherited from the requested field. */
  priority: number;
  status: GapStatus;
  attempts: SearchAttempt[];
}

export type CoverageCellStatus =
  | "verified"
  | "conflicting"
  | "inferred"
  | "unresolved"
  | "not_found_after_search"
  | "not_applicable";

export interface CoverageCell {
  entityId: string;
  field: string;
  status: CoverageCellStatus;
  evidenceCount: number;
}

export interface CoverageReport {
  cells: CoverageCell[];
  entityCount: number;
  fieldCount: number;
  totalCells: number;
  /** verified + inferred + not_found_after_search + not_applicable. */
  settledCells: number;
  /** verified only, over cells that could ever be verified. */
  verifiedCells: number;
  fillRate: number;
  /** Cells on a high-priority field that are neither settled nor conflicting. */
  highPriorityOpen: number;
  conflictingCells: number;
  /** True when the ledger, not the model, says there is enough. */
  sufficient: boolean;
}

export interface EnumerationRound {
  round: number;
  /** Canonical entities this round produced that no earlier round had. */
  newEntities: number;
  /** Candidates that merged into an entity already known. */
  mergedCandidates: number;
  at: string;
}

export type StopReason =
  | "coverage_sufficient"
  | "saturated_and_exhausted"
  | "budget_exhausted"
  | "not_stopping";

export type ResearchPhase = "enumeration" | "enrichment" | "reconciliation" | "synthesis";

/**
 * How often one search strategy has actually produced evidence for one kind of
 * claim, within this session.
 *
 * Kept at session level rather than on the gaps because gap rows are dropped
 * when their entity disappears, and the whole value of the record is that it
 * outlives individual gaps: by the twentieth entity the session should know
 * that, say, the official site answers headcounts and the parent institution
 * does not, and spend its remaining attempts accordingly.
 */
export interface StrategyOutcome {
  attempts: number;
  hits: number;
}

export interface ResearchState {
  sessionId: string;
  conversationId: number;
  question: string;
  plan: ResearchPlan;
  phase: ResearchPhase;
  entities: ResearchEntity[];
  evidence: ResearchEvidence[];
  relationships: EntityRelationship[];
  conflicts: ResearchConflict[];
  gaps: ResearchGap[];
  rounds: EnumerationRound[];
  /** Every distinct normalized query this session has issued. */
  issuedQueries: string[];
  /** Keyed `<claimShape>:<strategy>`. See StrategyOutcome above. */
  strategyStats: Record<string, StrategyOutcome>;
  searchCount: number;
  iterationCount: number;
  stopped?: { reason: StopReason; at: string };
  createdAt: string;
  updatedAt: string;
}
