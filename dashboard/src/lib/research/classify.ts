// Reading the request: what kind of research is this, and what may it spend?
//
// This runs before any search, deterministically, from the request text alone.
// It exists so that "who founded OpenAI?" and "find every student team the
// university ever had, with member counts and what happened to the dead ones"
// are not treated as the same job — the first should cost one search, the
// second earns an enumeration phase and a coverage ledger.
//
// Keyword lists appear below, but they are evidence rather than the rule. A
// request can demand completeness without containing the word "all" ("which
// teams are still running, and what happened to the rest"), so the factors are
// also driven by structural signals: plural targets, multiple requested fields,
// past-tense reach, comparison, and lifecycle vocabulary.

import type {
  RequestedField,
  ResearchBudget,
  ResearchFactors,
  ResearchIntent,
  ResearchPlan,
  TemporalScope,
} from "./types.ts";

const MAX_REQUEST_CHARS = 4_000;

/** Explicit demands for a complete answer. */
const COMPLETENESS_TERMS =
  /\b(?:all|every|each|complete list|full list|comprehensive|exhaustive|ever (?:created|made|existed|founded|been)|entire|the whole|every single|without exception|none missing)\b/i;

/** Weaker phrasing that still asks for a set rather than an example. */
const SET_REQUEST =
  /\b(?:list|enumerate|inventory|catalogue|catalog|which ones|how many .{0,40}(?:are|were) there|overview of (?:the )?(?:all )?)\b/i;

/** Reaching into the past rather than describing the present. */
const HISTORICAL_TERMS =
  /\b(?:histor(?:y|ical|ically)|former(?:ly)?|previous(?:ly)?|used to|originally|over time|since \d{4}|between \d{4}|defunct|discontinued|disbanded|dissolved|shut down|no longer|renamed|predecessor|successor|legacy|past|archive[sd]?|old(?:er)? names?|what happened to)\b/i;

/** Lifecycle vocabulary: the answer has to say what state each entity is in. */
const LIFECYCLE_TERMS =
  /\b(?:active|inactive|still (?:running|going|around|exists?|operating)|status|ongoing|current(?:ly)?|alive|dead|defunct|dormant|merged|spun off|split)\b/i;

/** Comparison across entities rather than description of one. */
const COMPARATIVE_TERMS =
  /\b(?:compare[ds]?|comparison|versus|vs\.?|difference between|better than|which (?:is|are) (?:the )?(?:best|biggest|largest|fastest|cheapest)|rank(?:ed|ing)?|pros and cons|trade-?offs?)\b/i;

/** Signals that published sources are likely to disagree. */
const CONFLICT_TERMS =
  /\b(?:how many|headcount|member count|members|employees|size of|population|revenue|price|market share|ranking|rated|score|statistics?|figures?|numbers?)\b/i;

/** Signals that the subject itself is under-specified. */
const AMBIGUITY_TERMS =
  /\b(?:something like|similar to|that kind of|whatever|any(?:thing)? (?:related|like)|i think it|not sure (?:what|which|if)|might be called|some sort of|roughly)\b/i;

/** A single fact about a single thing. */
const SIMPLE_LOOKUP =
  /^\s*(?:who|what|when|where|which|how much|how many|how old|is|are|was|were|does|did|can)\b[^?]{0,120}\?*\s*$/i;

/**
 * Field vocabulary. Each entry is one requested field the coverage ledger can
 * track. Deliberately generic — nothing here names a domain — and the model may
 * add its own fields on top through `research_begin`.
 */
const FIELD_PATTERNS: ReadonlyArray<{
  key: string;
  label: string;
  pattern: RegExp;
  priority: number;
  volatile: boolean;
}> = [
  {
    key: "status",
    label: "current status",
    pattern: LIFECYCLE_TERMS,
    priority: 1,
    volatile: true,
  },
  {
    key: "memberCount",
    label: "member or headcount",
    // Plurals are written out rather than left to `\b`: "their member counts"
    // is the natural phrasing for a multi-entity question, and `member count\b`
    // does not match it — which silently dropped the field from the ledger.
    pattern:
      /\b(?:member counts?|members?|headcounts?|team sizes?|how many people|staff|employees|sizes? of the team|numbers? of (?:people|members?|students?))\b/i,
    priority: 1,
    volatile: true,
  },
  {
    key: "foundedAt",
    label: "founding date",
    pattern:
      /\b(?:founded|established|started|created|inception|since when|when (?:did|was) .{0,40}(?:start|found|creat|establish))\b/i,
    priority: 2,
    volatile: false,
  },
  {
    key: "formerNames",
    label: "historical names",
    pattern:
      /\b(?:former(?:ly)? names?|old names?|previous names?|historical names?|renamed|used to be called|also known as)\b/i,
    priority: 1,
    volatile: false,
  },
  {
    key: "lineage",
    label: "what happened to it",
    pattern:
      /\b(?:what happened to|merged|spun off|split|successor|predecessor|became|absorbed|folded into|dissolved into)\b/i,
    priority: 1,
    volatile: false,
  },
  {
    key: "focus",
    label: "focus or purpose",
    pattern:
      /\b(?:focus|purpose|what (?:they|it) (?:do|does|did|build|builds)|area|discipline|field|speciali[sz]ation|mission)\b/i,
    priority: 2,
    volatile: false,
  },
  {
    key: "website",
    label: "official page",
    pattern: /\b(?:website|url|homepage|official (?:page|site)|link)\b/i,
    priority: 3,
    volatile: false,
  },
  {
    key: "achievements",
    label: "results or achievements",
    pattern:
      /\b(?:achievements?|awards?|prizes?|won|results?|records?|championships?|competitions?|placed|rankings?)\b/i,
    priority: 2,
    volatile: false,
  },
];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Plural targets suggest the answer is a set rather than one thing. */
function pluralTargetScore(text: string): number {
  const plurals = text.match(
    /\b[a-z]{4,}(?:s|es)\b(?!\s*(?:is|was|has|does))/gi,
  );
  if (!plurals) return 0;
  return clamp(new Set(plurals.map((word) => word.toLowerCase())).size / 12);
}

function detectFields(text: string): RequestedField[] {
  const fields = FIELD_PATTERNS.filter((field) => field.pattern.test(text)).map(
    ({ key, label, priority, volatile }) => ({ key, label, priority, volatile }),
  );
  // Identity is implicit in every multi-entity request: an answer that cannot
  // name the thing has nothing to hang the other fields on.
  return [
    { key: "name", label: "name", priority: 1, volatile: false },
    ...fields,
  ];
}

function detectTemporalScope(text: string): TemporalScope {
  const historical = HISTORICAL_TERMS.test(text);
  const current = LIFECYCLE_TERMS.test(text) || /\b(?:now|today|currently)\b/i.test(text);
  if (historical && current) return { kind: "full_history" };
  if (historical) return { kind: "historical" };
  return { kind: "current" };
}

export function computeFactors(text: string, fieldCount: number): ResearchFactors {
  const explicitCompleteness = COMPLETENESS_TERMS.test(text);
  const setRequest = SET_REQUEST.test(text);
  const plurals = pluralTargetScore(text);
  return {
    entityBreadth: clamp(
      (explicitCompleteness ? 0.5 : 0) + (setRequest ? 0.25 : 0) + plurals * 0.5,
    ),
    // One field is the baseline; six or more saturates.
    fieldBreadth: clamp((fieldCount - 1) / 5),
    historicalDepth: clamp(
      (HISTORICAL_TERMS.test(text) ? 0.6 : 0) +
        (/\b(?:ever|all time|since (?:the )?(?:beginning|start)|\d{4})\b/i.test(text)
          ? 0.4
          : 0),
    ),
    ambiguity: clamp(
      (AMBIGUITY_TERMS.test(text) ? 0.6 : 0) +
        // A very short request naming a set is under-specified by construction.
        (text.trim().length < 40 && (setRequest || explicitCompleteness) ? 0.4 : 0),
    ),
    completenessRequirement: clamp(
      (explicitCompleteness ? 0.7 : 0) + (setRequest ? 0.3 : 0) + plurals * 0.2,
    ),
    conflictLikelihood: clamp(
      (CONFLICT_TERMS.test(text) ? 0.5 : 0) +
        (LIFECYCLE_TERMS.test(text) ? 0.25 : 0) +
        (HISTORICAL_TERMS.test(text) ? 0.25 : 0),
    ),
  };
}

function detectIntent(text: string, factors: ResearchFactors): ResearchIntent {
  if (factors.completenessRequirement >= 0.6 && factors.entityBreadth >= 0.4) {
    return factors.historicalDepth >= 0.5
      ? "historical_reconstruction"
      : "exhaustive_enumeration";
  }
  if (factors.historicalDepth >= 0.6) return "historical_reconstruction";
  if (factors.entityBreadth >= 0.4 && factors.fieldBreadth >= 0.4) {
    return "multi_entity_enrichment";
  }
  if (COMPARATIVE_TERMS.test(text)) return "comparative_research";
  if (factors.ambiguity >= 0.6) return "ambiguity_resolution";
  // A single interrogative with no set, no history and no extra fields is the
  // cheap case, and keeping it cheap is half the point of this module.
  if (
    SIMPLE_LOOKUP.test(text) &&
    factors.entityBreadth < 0.25 &&
    factors.fieldBreadth < 0.25 &&
    factors.historicalDepth < 0.25
  ) {
    return "simple_lookup";
  }
  return "normal_research";
}

/**
 * The budget, derived from the factors rather than from the intent label, so a
 * borderline question gets a borderline budget instead of falling off a cliff
 * between two categories.
 */
export function computeBudget(
  intent: ResearchIntent,
  factors: ResearchFactors,
): ResearchBudget {
  if (intent === "simple_lookup") {
    return {
      maxSearches: 3,
      maxIterations: 1,
      maxEnumerationRounds: 0,
      maxEntities: 5,
      maxAttemptsPerGap: 1,
      enrichmentBatchSize: 1,
    };
  }
  const weight = clamp(
    factors.entityBreadth * 0.3 +
      factors.completenessRequirement * 0.25 +
      factors.fieldBreadth * 0.2 +
      factors.historicalDepth * 0.15 +
      factors.conflictLikelihood * 0.05 +
      factors.ambiguity * 0.05,
  );
  const scale = (base: number, top: number) =>
    Math.round(base + (top - base) * weight);
  return {
    maxSearches: scale(8, 90),
    // Iterations are `research_record` calls, not searches. The ceiling has to
    // leave room for the batch size to actually spend the search budget —
    // otherwise the run stops on iterations with a third of its searches unused,
    // which looks like exhaustion and is not.
    maxIterations: scale(4, 24),
    maxEnumerationRounds: scale(0, 5),
    maxEntities: scale(8, 120),
    maxAttemptsPerGap: scale(2, 6),
    enrichmentBatchSize: scale(2, 6),
  };
}

export interface ClassifyInput {
  question: string;
  /** Extra fields the caller knows are wanted; merged with the detected set. */
  requestedFields?: ReadonlyArray<{ key: string; label?: string; priority?: number }>;
  /** The caller's own description of the entities, when it has one. */
  targetEntityDescription?: string;
}

/**
 * The whole planning step: one pure function, no model call, no network.
 *
 * Being deterministic is what makes it safe to run on every super-agent turn —
 * including the trivial ones, which it is designed to cost nothing for.
 */
export function classifyResearch(input: ClassifyInput): ResearchPlan {
  const text = input.question.slice(0, MAX_REQUEST_CHARS);
  const detected = detectFields(text);
  const extra = (input.requestedFields ?? [])
    .filter(
      (field) =>
        field.key &&
        !detected.some((known) => known.key === field.key),
    )
    .map((field) => ({
      key: field.key,
      label: field.label ?? field.key,
      priority: Math.min(3, Math.max(1, field.priority ?? 2)),
      volatile: false,
    }));
  const requestedFields = [...detected, ...extra];
  const factors = computeFactors(text, requestedFields.length);
  const intent = detectIntent(text, factors);
  const budget = computeBudget(intent, factors);
  const completenessRequired =
    intent === "exhaustive_enumeration" ||
    intent === "historical_reconstruction" ||
    factors.completenessRequirement >= 0.6;
  return {
    intent,
    completenessRequired,
    targetEntityDescription:
      input.targetEntityDescription?.trim() || text.trim().slice(0, 240),
    requestedFields,
    temporalScope: detectTemporalScope(text),
    budget,
    factors,
    highPriorityFields: requestedFields
      .filter((field) => field.priority === 1)
      .map((field) => field.key),
    // Enumeration only pays for itself when the entity set is unknown. A deep
    // question about one named subject goes straight to depth.
    requiresEnumeration:
      budget.maxEnumerationRounds > 0 && factors.entityBreadth >= 0.35,
  };
}

/**
 * Whether a turn should carry the research protocol at all.
 *
 * Deliberately narrow. Super agent is on for plenty of turns that are not
 * research, and offering a research contract on "summarize this file" would
 * make an ordinary turn slower for nothing.
 */
export function researchPipelineApplies(plan: ResearchPlan): boolean {
  return plan.intent !== "simple_lookup" && plan.budget.maxSearches > 8;
}
