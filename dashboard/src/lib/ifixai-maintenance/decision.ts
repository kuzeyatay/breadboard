import type { IfixAiRunResult } from "./runner.ts";

export interface CandidateDecision {
  accepted: boolean;
  scoreDelta: number | null;
  reasons: string[];
}

const STATUS_RANK: Record<string, number> = {
  error: 0,
  fail: 1,
  inconclusive: 2,
  pass: 3,
};

export function decideIfixAiCandidate(input: {
  baseline: IfixAiRunResult;
  candidate: IfixAiRunResult;
  minimumImprovement: number;
  maximumCategoryRegression: number;
}): CandidateDecision {
  const reasons: string[] = [];
  const { baseline, candidate } = input;
  if (baseline.partial || candidate.partial) reasons.push("partial evaluations are not comparable");
  if (baseline.selfJudged || candidate.selfJudged) reasons.push("self-judged evaluations cannot approve repairs");
  if (baseline.judgeRelation !== "cross-vendor" || candidate.judgeRelation !== "cross-vendor") {
    reasons.push("repair approval requires the same independent cross-vendor judge");
  }
  if (typeof baseline.score !== "number" || typeof candidate.score !== "number") {
    reasons.push("both evaluations must contain an overall score");
  }

  const scoreDelta =
    typeof baseline.score === "number" && typeof candidate.score === "number"
      ? candidate.score - baseline.score
      : null;
  if (scoreDelta === null || scoreDelta < input.minimumImprovement) {
    reasons.push(
      `score improvement must be at least ${input.minimumImprovement.toFixed(2)}`,
    );
  }

  for (const [category, baselineScore] of Object.entries(baseline.categories)) {
    const candidateScore = candidate.categories[category];
    if (typeof candidateScore !== "number") {
      reasons.push(`candidate did not score baseline category ${category}`);
      continue;
    }
    if (baselineScore - candidateScore > input.maximumCategoryRegression) {
      reasons.push(`category ${category} regressed beyond the allowed bound`);
    }
  }

  for (const [testId, baselineTest] of Object.entries(baseline.tests)) {
    const candidateTest = candidate.tests[testId];
    if (!candidateTest) {
      reasons.push(`candidate did not run baseline inspection ${testId}`);
      continue;
    }
    const before = STATUS_RANK[baselineTest.status] ?? 0;
    const after = STATUS_RANK[candidateTest.status] ?? 0;
    if (after < before) reasons.push(`inspection ${testId} regressed`);
    if (baselineTest.score - candidateTest.score > input.maximumCategoryRegression) {
      reasons.push(`inspection ${testId} score regressed beyond the allowed bound`);
    }
    if (candidateTest.status === "error") reasons.push(`inspection ${testId} errored`);
  }

  return { accepted: reasons.length === 0, scoreDelta, reasons: [...new Set(reasons)] };
}
