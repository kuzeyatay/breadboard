export interface LearningSpineFullRepairCandidate<TPayload> {
  payload: TPayload;
  /** Exact model response text supplied back to the next bounded repair. */
  invalidResponse: string;
  unitCount: number;
  validationProblems: string[];
}

export interface LearningSpineFullRepairHistoryEntry {
  semanticAttempt: number;
  unitCount: number;
  validationProblems: string[];
  promotedToIncumbent: boolean;
}

export interface LearningSpineFullRepairLineage<TPayload> {
  incumbent: LearningSpineFullRepairCandidate<TPayload>;
  history: LearningSpineFullRepairHistoryEntry[];
}

export interface LearningSpineFullRepairFeedback {
  repairAttempt: number;
  invalidResponse: string;
  validationProblems: string[];
  repairHistory: LearningSpineFullRepairHistoryEntry[];
}

function snapshotProblems(problems: readonly string[]): string[] {
  return [...problems];
}

function snapshotHistoryEntry(
  entry: LearningSpineFullRepairHistoryEntry,
): LearningSpineFullRepairHistoryEntry {
  return {
    ...entry,
    validationProblems: snapshotProblems(entry.validationProblems),
  };
}

function candidateHasUsableSpine(candidate: LearningSpineFullRepairCandidate<unknown>): boolean {
  return candidate.unitCount > 0;
}

/**
 * Rank rejected full-contract candidates for the next model repair. A parsed,
 * non-empty learning spine is more useful repair material than an empty
 * response even when strict validation exposes several residual problems.
 * Candidates at the same usability tier still improve only by reducing the
 * exact hard-check set.
 */
export function isStrongerLearningSpineFullRepairCandidate(
  challenger: LearningSpineFullRepairCandidate<unknown>,
  incumbent: LearningSpineFullRepairCandidate<unknown>,
): boolean {
  const challengerUsable = candidateHasUsableSpine(challenger);
  const incumbentUsable = candidateHasUsableSpine(incumbent);
  if (challengerUsable !== incumbentUsable) return challengerUsable;
  return challenger.validationProblems.length < incumbent.validationProblems.length;
}

export function startLearningSpineFullRepairLineage<TPayload>(
  initial: LearningSpineFullRepairCandidate<TPayload>,
): LearningSpineFullRepairLineage<TPayload> {
  const incumbent = {
    ...initial,
    validationProblems: snapshotProblems(initial.validationProblems),
  };
  return {
    incumbent,
    history: [{
      semanticAttempt: 1,
      unitCount: incumbent.unitCount,
      validationProblems: snapshotProblems(incumbent.validationProblems),
      promotedToIncumbent: true,
    }],
  };
}

export function recordLearningSpineFullRepairCandidate<TPayload>(input: {
  lineage: LearningSpineFullRepairLineage<TPayload>;
  candidate: LearningSpineFullRepairCandidate<TPayload>;
  semanticAttempt: number;
}): LearningSpineFullRepairLineage<TPayload> {
  const candidate = {
    ...input.candidate,
    validationProblems: snapshotProblems(input.candidate.validationProblems),
  };
  const promotedToIncumbent = isStrongerLearningSpineFullRepairCandidate(
    candidate,
    input.lineage.incumbent,
  );
  return {
    incumbent: promotedToIncumbent ? candidate : input.lineage.incumbent,
    history: [
      ...input.lineage.history.map(snapshotHistoryEntry),
      {
        semanticAttempt: input.semanticAttempt,
        unitCount: candidate.unitCount,
        validationProblems: snapshotProblems(candidate.validationProblems),
        promotedToIncumbent,
      },
    ],
  };
}

/** Build the next bounded repair packet from one internally consistent state. */
export function learningSpineFullRepairFeedback<TPayload>(
  lineage: LearningSpineFullRepairLineage<TPayload>,
  repairAttempt: number,
): LearningSpineFullRepairFeedback {
  return {
    repairAttempt,
    invalidResponse: lineage.incumbent.invalidResponse,
    validationProblems: snapshotProblems(lineage.incumbent.validationProblems),
    repairHistory: lineage.history.map(snapshotHistoryEntry),
  };
}

export function learningSpineFullRepairIsComplete<TPayload>(
  lineage: LearningSpineFullRepairLineage<TPayload>,
): boolean {
  return candidateHasUsableSpine(lineage.incumbent) &&
    lineage.incumbent.validationProblems.length === 0;
}

export function describeLearningSpineRepairAttempts(input: {
  fullContractAttempts: number;
  targetedCalls: number;
  targetedStatus: string;
}): string {
  const fullContractAttempts = Math.max(0, Math.trunc(input.fullContractAttempts));
  const targetedCalls = Math.max(0, Math.trunc(input.targetedCalls));
  const fullAttemptLabel = fullContractAttempts === 1 ? "attempt" : "attempts";
  const base = `after ${fullContractAttempts} bounded full-contract ${fullAttemptLabel}`;
  if (targetedCalls === 0) {
    const reason = input.targetedStatus === "unscoped"
      ? "the remaining failures were not safely scoped to complete learning-unit records"
      : `its status was ${input.targetedStatus}`;
    return `${base}; targeted model repair was skipped because ${reason}`;
  }
  const targetedAttemptLabel = targetedCalls === 1 ? "attempt" : "attempts";
  return `${base} plus ${targetedCalls} bounded targeted model repair ${targetedAttemptLabel} (${input.targetedStatus})`;
}
