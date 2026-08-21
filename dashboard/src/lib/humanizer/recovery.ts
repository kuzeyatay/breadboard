import type { HumanizerRewrite } from "./service.ts";
import {
  reviewRewriteIntegrity,
  scoreReview,
  type ReviewScores,
  type RewriteIntegrityReview,
} from "./review.ts";

export interface EvaluatedHumanizerCandidate {
  result: HumanizerRewrite;
  scores: ReviewScores;
  integrity: RewriteIntegrityReview;
}

export function evaluateHumanizerCandidate(
  result: HumanizerRewrite,
): EvaluatedHumanizerCandidate {
  return {
    result,
    scores: scoreReview(result.originalText, result.rewrittenText),
    integrity: reviewRewriteIntegrity(result.originalText, result.rewrittenText),
  };
}

export function humanizerCandidateIsImprovement(
  candidate: EvaluatedHumanizerCandidate,
): boolean {
  return (
    candidate.result.originalText !== candidate.result.rewrittenText &&
    candidate.integrity.passed &&
    !candidate.scores.tied &&
    !candidate.scores.worsened
  );
}

/** Prefer a safe measurable improvement, then the least-damaged fallback. */
export function chooseHumanizerCandidate(
  primary: EvaluatedHumanizerCandidate,
  recovery: EvaluatedHumanizerCandidate,
): EvaluatedHumanizerCandidate {
  const primaryImproves = humanizerCandidateIsImprovement(primary);
  const recoveryImproves = humanizerCandidateIsImprovement(recovery);
  if (primaryImproves !== recoveryImproves) return recoveryImproves ? recovery : primary;
  if (primary.integrity.passed !== recovery.integrity.passed) {
    return recovery.integrity.passed ? recovery : primary;
  }
  if (primary.scores.rewrite.score !== recovery.scores.rewrite.score) {
    return recovery.scores.rewrite.score < primary.scores.rewrite.score ? recovery : primary;
  }
  if (primary.result.chunks.reverted !== recovery.result.chunks.reverted) {
    return recovery.result.chunks.reverted < primary.result.chunks.reverted
      ? recovery
      : primary;
  }
  return primary;
}
