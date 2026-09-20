// Reading signals in aggregate, and the one place the loop is allowed to close.
//
// Everything here is a pure function over recorded signals. It writes nothing,
// and in particular it never writes a memory: `proposeStandingPreferences`
// returns proposals, and a proposal only becomes a durable preference when a
// human accepts it through `answer-signal-proposals.ts`.
//
// That gate is the whole design, and it is worth stating why it is not
// timidity. A confirmed global preference rides along on *every* personalized
// turn, capped at three slots, displacing genuinely relevant memory from the
// tail of the budget. A wrong row there is not a bad suggestion that gets
// ignored — it is a standing instruction that changes every answer and that
// nobody will think to look for, because nobody wrote it. The cost of asking
// is one confirmation. The cost of not asking is a behaviour change with no
// author.
//
// Three further restraints, each of which exists because the obvious version
// is wrong:
//
//   * Only *explicit* ratings can produce a proposal. A regenerate is strong
//     evidence of dissatisfaction and no evidence at all of what was wanted,
//     so implicit signals shape the report and never a preference.
//
//   * Only two of the four reasons are proposable. `too_long` and
//     `missed_point` each name a concrete thing to do differently, so they can
//     be written as a preference the user can read and agree with. `wrong` is
//     a grounding failure, not a preference — a memory saying "be correct"
//     changes nothing — and `style` has no direction: it says the register was
//     off without saying what it should have been. Both are surfaced as
//     findings and routed to the benchmark instead.
//
//   * A pattern must both clear a support floor and concentrate. Five
//     downvotes spread evenly across every condition mean the answers were bad;
//     five that land on one condition mean something about that condition is
//     bad, and only the second is actionable.

import { CONDITIONS_VERSION } from "./answer-conditions.ts";
import type { AnswerSignal, SignalReason } from "./answer-signals.ts";

/**
 * How many ratings a group needs before it is reported at all.
 *
 * Below this a group is noise: with two ratings any condition can look like a
 * perfect predictor, and acting on it is how a feedback loop starts chasing
 * whichever answer happened to be rated first.
 */
export const MIN_SUPPORT = 5;

/**
 * How much of a reason's downvotes must land on one condition before that
 * condition is named as the cause.
 */
export const MIN_CONCENTRATION = 0.6;

/**
 * How far a condition's share of the complaints must exceed its share of
 * everything, before the concentration means anything.
 *
 * Without this the analysis reliably discovers that every complaint came from
 * the surface the user actually uses, the model they actually run and the
 * capability mode they are always in — each at 100% concentration, each
 * explaining nothing. A condition only implicates itself when complaints pick
 * it out *more often than ordinary use does*. On a single-surface, single-model
 * install those dimensions now correctly produce nothing at all, which is the
 * honest result: they never varied, so they cannot be the variable.
 */
export const MIN_LIFT = 0.15;

/** Reasons that can be written as a preference somebody could agree with. */
export const PROPOSABLE_REASONS: readonly SignalReason[] = ["too_long", "missed_point"];

export type SignalDimension =
  | "questionScope"
  | "metaTask"
  | "model"
  | "surface"
  | "reason";

export interface ConditionGroup {
  dimension: SignalDimension;
  value: string;
  ratedUp: number;
  ratedDown: number;
  /** Regenerated, edited, retried — the answer was not taken as given. */
  dissatisfaction: number;
  /** Copied or spoken — the answer was carried somewhere else. */
  approval: number;
  /** Ratings only. Implicit signals do not buy a group its way past the floor. */
  support: number;
  net: number;
}

export interface ContractFinding {
  kind: "contract_finding";
  reason: SignalReason;
  dimension: SignalDimension;
  value: string;
  downvotes: number;
  concentration: number;
  /** This condition's share of all signals, whatever their verdict. */
  baseline: number;
  /** concentration - baseline. How much the complaints single this condition out. */
  lift: number;
  summary: string;
}

export interface PreferenceProposal {
  id: string;
  kind: "preference" | "working_pattern";
  reason: SignalReason;
  dimension: SignalDimension;
  value: string;
  /** The exact sentence that would be written to memory if accepted. */
  content: string;
  downvotes: number;
  concentration: number;
  baseline: number;
  lift: number;
  evidence: string;
}

export interface SignalAnalysis {
  groups: ConditionGroup[];
  findings: ContractFinding[];
  proposals: PreferenceProposal[];
  /** Signals that counted. */
  considered: number;
  /** Why the rest did not, so nothing disappears without a reason. */
  excluded: Record<string, number>;
}

const DIMENSIONS: readonly SignalDimension[] = [
  "questionScope",
  "metaTask",
  "model",
  "surface",
  "reason",
];

function conditionValue(
  signal: AnswerSignal,
  dimension: SignalDimension,
): string | null {
  const conditions = signal.conditions as {
    surface?: unknown;
    model?: unknown;
    contracts?: { metaTask?: unknown; questionScope?: unknown };
  };
  switch (dimension) {
    case "questionScope":
      return typeof conditions.contracts?.questionScope === "string"
        ? conditions.contracts.questionScope
        : null;
    case "metaTask":
      return typeof conditions.contracts?.metaTask === "string"
        ? conditions.contracts.metaTask
        : null;
    case "model":
      return typeof conditions.model === "string" ? conditions.model : null;
    case "surface":
      return typeof conditions.surface === "string" ? conditions.surface : null;
    case "reason":
      return signal.reason;
    default:
      return null;
  }
}

/**
 * Which signals are allowed to inform anything, and why the others are not.
 *
 * A rating of a failed or aborted turn is a rating of the failure: the answer
 * was cut off, and counting it as evidence about length or register would
 * blame a contract for a transport problem. A snapshot from an older capture
 * groups on fields that may have meant something else. A derived answer — a
 * branch, an adopted rewrite, an agent delivery — was not written under the
 * conditions the snapshot describes.
 */
export function eligibleForAnalysis(signal: AnswerSignal): string | null {
  const conditions = signal.conditions as {
    version?: unknown;
    status?: unknown;
    derived?: unknown;
  };
  if (conditions.version !== CONDITIONS_VERSION) return "stale_conditions";
  if (conditions.status !== "complete") return "incomplete_turn";
  if (conditions.derived === true) return "derived_answer";
  return null;
}

export function summarizeSignalsByCondition(
  signals: readonly AnswerSignal[],
  options: { minSupport?: number } = {},
): ConditionGroup[] {
  const minSupport = options.minSupport ?? MIN_SUPPORT;
  const groups = new Map<string, ConditionGroup>();

  for (const signal of signals) {
    for (const dimension of DIMENSIONS) {
      const value = conditionValue(signal, dimension);
      if (!value) continue;
      const key = `${dimension}:${value}`;
      const group = groups.get(key) ?? {
        dimension,
        value,
        ratedUp: 0,
        ratedDown: 0,
        dissatisfaction: 0,
        approval: 0,
        support: 0,
        net: 0,
      };
      if (signal.kind === "rated_up") group.ratedUp += 1;
      else if (signal.kind === "rated_down") group.ratedDown += 1;
      else if (signal.kind === "copied" || signal.kind === "spoken") group.approval += 1;
      else group.dissatisfaction += 1;
      group.support = group.ratedUp + group.ratedDown;
      group.net = group.ratedUp - group.ratedDown;
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .filter((group) => group.support >= minSupport)
    .sort((a, b) => b.support - a.support || a.dimension.localeCompare(b.dimension));
}

/** A stable id, so accepting or dismissing a proposal survives it being recomputed. */
export function proposalId(
  reason: SignalReason,
  dimension: SignalDimension,
  value: string,
): string {
  return `${reason}:${dimension}:${value}`.toLowerCase().replace(/[^a-z0-9:_-]/g, "_");
}

function preferenceSentence(
  reason: SignalReason,
  dimension: SignalDimension,
  value: string,
): { kind: "preference" | "working_pattern"; content: string } | null {
  // Named conditions read better than raw enum values in a sentence that the
  // user has to agree with, and a memory is read months later with none of this
  // context around it.
  const where =
    dimension === "questionScope" && value === "general"
      ? "when I ask a broad question"
      : dimension === "questionScope" && value === "scoped"
        ? "when I ask a narrow, specific question"
        : dimension === "metaTask"
          ? `on ${value.replace(/_/g, " ")} questions`
          : dimension === "surface"
            ? `in ${value.replace(/_/g, " ")}`
            : dimension === "model"
              ? ""
              : "";

  switch (reason) {
    case "too_long":
      return {
        kind: "preference",
        content: `Prefers shorter answers${where ? ` ${where}` : ""}: lead with the conclusion and cut the preamble.`,
      };
    case "missed_point":
      return {
        kind: "working_pattern",
        content: `Answer the literal question asked first${where ? ` ${where}` : ""}, then add context — do not reframe the question before answering it.`,
      };
    default:
      // `wrong` and `style` are deliberately unproposable; see the header.
      return null;
  }
}

/**
 * Turn concentrated downvote patterns into findings, and the actionable subset
 * of those into proposals.
 *
 * Model is excluded as a proposal dimension on purpose: "answers from model X
 * are too long" is a routing fact, not a preference about the user, and writing
 * it into global memory would apply it to every model.
 */
export function proposeStandingPreferences(
  signals: readonly AnswerSignal[],
  options: { minSupport?: number; minConcentration?: number; minLift?: number } = {},
): { findings: ContractFinding[]; proposals: PreferenceProposal[] } {
  const minSupport = options.minSupport ?? MIN_SUPPORT;
  const minConcentration = options.minConcentration ?? MIN_CONCENTRATION;
  const minLift = options.minLift ?? MIN_LIFT;
  const findings: ContractFinding[] = [];
  const proposals: PreferenceProposal[] = [];

  /**
   * This condition's share of the whole population — every signal, whatever
   * its verdict. The comparison the lift is taken against.
   */
  const baselineShare = (dimension: SignalDimension, value: string): number => {
    let total = 0;
    let matching = 0;
    for (const signal of signals) {
      const candidate = conditionValue(signal, dimension);
      if (!candidate) continue;
      total += 1;
      if (candidate === value) matching += 1;
    }
    return total ? matching / total : 0;
  };

  const downvotes = signals.filter(
    (signal) => signal.kind === "rated_down" && signal.reason,
  );

  for (const reason of new Set(downvotes.map((signal) => signal.reason as SignalReason))) {
    const forReason = downvotes.filter((signal) => signal.reason === reason);
    if (forReason.length < minSupport) continue;

    for (const dimension of DIMENSIONS) {
      if (dimension === "reason") continue;
      const counts = new Map<string, number>();
      for (const signal of forReason) {
        const value = conditionValue(signal, dimension);
        if (!value) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const [value, count] =
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
      if (!value || !count) continue;
      const concentration = count / forReason.length;
      if (concentration < minConcentration) continue;
      // A condition that every turn shares cannot be what distinguishes the
      // bad ones, however cleanly the complaints pile onto it.
      const baseline = baselineShare(dimension, value);
      const lift = concentration - baseline;
      if (lift < minLift) continue;

      findings.push({
        kind: "contract_finding",
        reason,
        dimension,
        value,
        downvotes: count,
        concentration,
        baseline,
        lift,
        summary:
          `${count} of ${forReason.length} "${reason}" ratings land on ${dimension} = ${value}` +
          ` (${Math.round(concentration * 100)}% of the complaints against ${Math.round(baseline * 100)}% of all turns).`,
      });

      if (!PROPOSABLE_REASONS.includes(reason) || dimension === "model") continue;
      const sentence = preferenceSentence(reason, dimension, value);
      if (!sentence) continue;
      proposals.push({
        id: proposalId(reason, dimension, value),
        kind: sentence.kind,
        reason,
        dimension,
        value,
        content: sentence.content,
        downvotes: count,
        concentration,
        baseline,
        lift,
        evidence:
          `${count} of ${forReason.length} "${reason}" ratings land on ${dimension} = ${value},` +
          ` which is ${Math.round(baseline * 100)}% of turns overall.`,
      });
    }
  }

  return { findings, proposals };
}

export function analyzeAnswerSignals(
  signals: readonly AnswerSignal[],
  options: { minSupport?: number; minConcentration?: number; minLift?: number } = {},
): SignalAnalysis {
  const excluded: Record<string, number> = {};
  const eligible: AnswerSignal[] = [];
  for (const signal of signals) {
    const reason = eligibleForAnalysis(signal);
    if (reason) {
      excluded[reason] = (excluded[reason] ?? 0) + 1;
      continue;
    }
    eligible.push(signal);
  }

  const { findings, proposals } = proposeStandingPreferences(eligible, options);
  return {
    groups: summarizeSignalsByCondition(eligible, options),
    findings,
    proposals,
    considered: eligible.length,
    excluded,
  };
}
