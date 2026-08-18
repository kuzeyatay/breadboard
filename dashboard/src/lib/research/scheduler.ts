// Choosing what to search next, and deciding when a gap is genuinely empty.
//
// The behaviour being replaced is a specific, common failure: one search for
// "<entity> member count" returns nothing useful, and the answer says the
// figure is not published. It usually is — on the entity's own site, in a PDF,
// in a partner directory, or under the name the entity had four years ago.
//
// So a gap is not empty until diversified strategies have been spent on it. The
// scheduler hands out those strategies in a sensible order, refuses to repeat a
// query it has already issued, prioritizes gaps that matter, and stops when the
// budget says so. It plans queries; it never runs them — the model still calls
// `web_search` and `web_extract`, which is what keeps this compatible with the
// existing turn, its streaming, and its cancellation.

import { claimShapeForField } from "./authority.ts";
import { searchableAliases } from "./entities.ts";
import type {
  ResearchEntity,
  ResearchGap,
  ResearchState,
  SearchStrategy,
  StrategyOutcome,
} from "./types.ts";

/** Field-name synonyms, so strategy 2 asks a genuinely different question. */
const FIELD_SYNONYMS: Record<string, string[]> = {
  memberCount: ["team size", "how many members", "number of people", "roster"],
  status: ["still active", "is it still running", "current status", "disbanded"],
  foundedAt: ["founded in", "established", "started in", "history"],
  formerNames: ["formerly known as", "renamed from", "previous name", "old name"],
  lineage: ["what happened to", "merged with", "successor", "shut down"],
  focus: ["what they do", "mission", "about"],
  website: ["official website", "homepage"],
  achievements: ["results", "awards", "won", "record"],
};

const STRATEGY_ORDER: readonly SearchStrategy[] = [
  "entity_field",
  "official_site",
  "field_synonym",
  "parent_institution",
  "alias_search",
  "document_search",
  "authoritative_database",
  "temporal_search",
  "secondary_ecosystem",
];

/**
 * Normalized query text used for the duplicate check.
 *
 * Word-set rather than string equality, because "<entity> member count 2024"
 * and "2024 member count <entity>" are the same search, and issuing both wastes
 * half a strategy on nothing.
 */
export function queryFingerprint(query: string): string {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    ),
  ]
    .sort()
    .join(" ");
}

export interface PlannedQuery {
  gapId: string;
  entityId?: string;
  field: string;
  strategy: SearchStrategy;
  query: string;
  /** Why this strategy is worth an attempt, for the model and for the log. */
  rationale: string;
}

function buildQuery(input: {
  strategy: SearchStrategy;
  entity: ResearchEntity | undefined;
  field: string;
  fieldLabel: string;
  subject: string;
  institutionHint?: string;
}): { query: string; rationale: string } | null {
  const name = input.entity?.canonicalName ?? input.subject;
  const synonym = FIELD_SYNONYMS[input.field]?.[0] ?? input.fieldLabel;
  switch (input.strategy) {
    case "entity_field":
      return {
        query: `${name} ${input.fieldLabel}`,
        rationale: "The direct question, asked plainly.",
      };
    case "field_synonym": {
      const alternate =
        FIELD_SYNONYMS[input.field]?.[1] ?? FIELD_SYNONYMS[input.field]?.[0];
      if (!alternate) return null;
      return {
        query: `${name} ${alternate}`,
        rationale: "The same fact under the wording a different source would use.",
      };
    }
    case "official_site":
      return {
        query: `${name} official site ${synonym}`,
        rationale: "The entity's own pages, which usually state this first.",
      };
    case "parent_institution":
      if (!input.institutionHint) return null;
      return {
        query: `${input.institutionHint} ${name} ${input.fieldLabel}`,
        rationale: "The parent body's directory or announcement pages.",
      };
    case "document_search":
      return {
        query: `${name} ${input.fieldLabel} filetype:pdf`,
        rationale: "Annual reports and technical documents, where figures live.",
      };
    case "authoritative_database":
      return {
        query: `${name} ${input.fieldLabel} database registry`,
        rationale: "External registries that track this class of entity.",
      };
    case "secondary_ecosystem":
      return {
        query: `${name} ${synonym} news`,
        rationale: "Reputable secondary coverage, when nothing primary exists.",
      };
    case "alias_search": {
      const alias = input.entity ? searchableAliases(input.entity)[0] : undefined;
      if (!alias) return null;
      return {
        query: `${alias} ${input.fieldLabel}`,
        rationale:
          "The former name, which is what contemporaneous sources actually used.",
      };
    }
    case "temporal_search":
      return {
        query: `${name} ${input.fieldLabel} archive history`,
        rationale: "Archived and dated pages, for a value that has since changed.",
      };
    default:
      return null;
  }
}

/**
 * Attempts a (claim shape, strategy) pair needs before its measured hit rate is
 * trusted over the default ordering. Low, because a session only has room for a
 * few dozen searches — but not one, which would let a single lucky result
 * reorder everything.
 */
const MIN_SAMPLES_TO_RERANK = 3;
/** The score an unmeasured strategy is assumed to have. */
const UNMEASURED_SCORE = 0.5;

export function strategyStatsKey(field: string, strategy: SearchStrategy): string {
  return `${claimShapeForField(field)}:${strategy}`;
}

/**
 * What this session has learned about which strategies pay off.
 *
 * Measured per claim shape, not globally, because the answer differs by claim:
 * an official site is the best source for a headcount and a poor one for a
 * competition result. Below the sample floor a strategy keeps the neutral prior
 * and stays in its default position, so early gaps are unaffected.
 */
export function strategyScore(
  stats: Record<string, StrategyOutcome> | undefined,
  field: string,
  strategy: SearchStrategy,
): number {
  const outcome = stats?.[strategyStatsKey(field, strategy)];
  if (!outcome || outcome.attempts < MIN_SAMPLES_TO_RERANK) return UNMEASURED_SCORE;
  return outcome.hits / outcome.attempts;
}

/**
 * Strategies this gap has not spent yet, best-first.
 *
 * The *set* is fixed by what the gap has already tried, so reordering can never
 * change when a gap becomes exhausted — only which attempts it spends first.
 * That separation is deliberate: effectiveness tracking is allowed to make the
 * search smarter, never to make exhaustion easier to reach.
 */
export function remainingStrategies(
  gap: ResearchGap,
  stats?: Record<string, StrategyOutcome>,
): SearchStrategy[] {
  const used = new Set(gap.attempts.map((attempt) => attempt.strategy));
  const remaining = STRATEGY_ORDER.filter((strategy) => !used.has(strategy));
  if (!stats) return remaining;
  return remaining
    .map((strategy, index) => ({ strategy, index }))
    .sort(
      (left, right) =>
        strategyScore(stats, gap.field, right.strategy) -
          strategyScore(stats, gap.field, left.strategy) ||
        left.index - right.index,
    )
    .map((entry) => entry.strategy);
}

/**
 * A gap is exhausted when its diversified strategies are spent — either the
 * budget's per-gap ceiling, or the strategy list itself.
 *
 * This is the single predicate that licenses an answer to say something could
 * not be found publicly. Nothing else in the system may make that claim.
 */
export function gapIsExhausted(gap: ResearchGap, maxAttempts: number): boolean {
  return (
    gap.attempts.length >= maxAttempts || remainingStrategies(gap).length === 0
  );
}

/**
 * The next batch of searches, highest value first.
 *
 * Ordering is priority, then how little the gap has already been worked, so a
 * high-priority field nobody has looked at outranks a high-priority field that
 * has already burned four strategies. The batch is capped by the enrichment
 * batch size — the bounded-concurrency knob — and by whatever budget remains.
 */
export function planNextQueries(input: {
  state: ResearchState;
  institutionHint?: string;
  limit?: number;
}): PlannedQuery[] {
  const { state } = input;
  const budget = state.plan.budget;
  const remainingBudget = Math.max(0, budget.maxSearches - state.searchCount);
  if (remainingBudget === 0) return [];
  const limit = Math.min(
    input.limit ?? budget.enrichmentBatchSize,
    budget.enrichmentBatchSize,
    remainingBudget,
  );
  const labels = new Map(
    state.plan.requestedFields.map((field) => [field.key, field.label]),
  );
  const issued = new Set(state.issuedQueries);
  const candidates = state.gaps
    .filter((gap) => gap.status === "unsearched" || gap.status === "searching")
    .filter((gap) => !gapIsExhausted(gap, budget.maxAttemptsPerGap))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.attempts.length - right.attempts.length,
    );

  const planned: PlannedQuery[] = [];
  for (const gap of candidates) {
    if (planned.length >= limit) break;
    const entity = state.entities.find((item) => item.id === gap.entityId);
    for (const strategy of remainingStrategies(gap, state.strategyStats)) {
      const built = buildQuery({
        strategy,
        entity,
        field: gap.field,
        fieldLabel: labels.get(gap.field) ?? gap.field,
        subject: state.plan.targetEntityDescription,
        ...(input.institutionHint ? { institutionHint: input.institutionHint } : {}),
      });
      if (!built) continue;
      const fingerprint = queryFingerprint(built.query);
      if (issued.has(fingerprint)) continue;
      issued.add(fingerprint);
      planned.push({
        gapId: gap.id,
        ...(gap.entityId ? { entityId: gap.entityId } : {}),
        field: gap.field,
        strategy,
        query: built.query,
        rationale: built.rationale,
      });
      break;
    }
  }
  return planned;
}

/**
 * Enumeration queries: what might exist at all.
 *
 * Source *categories* rather than named sources, because naming them would bake
 * one domain's directories into a general pipeline. Each round asks a
 * materially different question, so round three is not round one again.
 */
export function planEnumerationQueries(input: {
  state: ResearchState;
  limit?: number;
}): PlannedQuery[] {
  const subject = input.state.plan.targetEntityDescription;
  const historical =
    input.state.plan.temporalScope.kind !== "current";
  const angles: Array<{ suffix: string; rationale: string }> = [
    { suffix: "list", rationale: "The current official directory, if one exists." },
    { suffix: "overview all", rationale: "A published overview or index page." },
    ...(historical
      ? [
          {
            suffix: "former past discontinued",
            rationale: "Entities that no longer exist and left the current listing.",
          },
          {
            suffix: "archive history older",
            rationale: "Archived copies of directories that have since been pruned.",
          },
          {
            suffix: "annual report",
            rationale: "Periodic reports, which enumerate as of their own date.",
          },
        ]
      : []),
    {
      suffix: "competition participants",
      rationale: "Third-party listings that enumerate independently of the owner.",
    },
    { suffix: "news announcement new", rationale: "Announcements of entities too new to be listed." },
  ];
  const issued = new Set(input.state.issuedQueries);
  const limit = Math.min(input.limit ?? 4, Math.max(0, input.state.plan.budget.maxSearches - input.state.searchCount));
  const planned: PlannedQuery[] = [];
  for (const angle of angles) {
    if (planned.length >= limit) break;
    const query = `${subject} ${angle.suffix}`.trim();
    const fingerprint = queryFingerprint(query);
    if (issued.has(fingerprint)) continue;
    issued.add(fingerprint);
    planned.push({
      gapId: "enumeration",
      field: "name",
      strategy: "entity_field",
      query,
      rationale: angle.rationale,
    });
  }
  return planned;
}
