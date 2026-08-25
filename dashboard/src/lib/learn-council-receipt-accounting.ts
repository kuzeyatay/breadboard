import { expectedStrictLearnModelRoute } from "./learn-planning-route-proof.ts";

export interface LearnCouncilReceiptAttemptUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  callCount: number;
  reportedCallCount: number;
}

export interface LearnCouncilReceiptAttempt {
  dispatchGeneration: 1 | 2;
  outcome: "completed" | "failed_no_final_answer" | "failed_terminal";
  councilRunId: string;
  finalAnswerPresent: boolean;
  usage: LearnCouncilReceiptAttemptUsage;
  usageEstimated: boolean;
  modelRouting: Array<Record<string, unknown>>;
  requestedModel?: string;
  resolvedModel?: string;
  createdAt?: string;
  updatedAt?: string;
  responseHash?: string;
  failureCode?: string;
}

export interface LearnCouncilOwnedAttemptAccounting {
  usage: Omit<LearnCouncilReceiptAttemptUsage, "callCount" | "reportedCallCount">;
  providerCallCount: 1 | 2;
  reportedCallCount: 0 | 1 | 2;
  estimatedCallCount: 0 | 1 | 2;
}

export function learnCouncilReceiptOwnerPrefixIsExact(
  ownerGenerations: readonly number[],
  attemptCount: number,
  allowClaimedNextGeneration: boolean,
): boolean {
  if (
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 0 ||
    attemptCount > 2 ||
    ownerGenerations.some((generation, index) => generation !== index + 1)
  ) {
    return false;
  }
  return ownerGenerations.length === attemptCount || Boolean(
    allowClaimedNextGeneration &&
    ownerGenerations.length === attemptCount + 1 &&
    ownerGenerations.at(-1) === attemptCount + 1,
  );
}

const ATTEMPT_KEYS = new Set([
  "dispatchGeneration",
  "outcome",
  "councilRunId",
  "finalAnswerPresent",
  "usage",
  "usageEstimated",
  "modelRouting",
  "requestedModel",
  "resolvedModel",
  "createdAt",
  "updatedAt",
  "responseHash",
  "failureCode",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseUsage(value: unknown): LearnCouncilReceiptAttemptUsage | null {
  const usage = record(value);
  if (!usage || Object.keys(usage).length !== 7) return null;
  const required = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "reasoningTokens",
    "callCount",
    "reportedCallCount",
  ] as const;
  if (
    required.some((key) => !nonnegativeSafeInteger(usage[key])) ||
    Number(usage.totalTokens) < Number(usage.inputTokens) + Number(usage.outputTokens) ||
    Number(usage.cachedInputTokens) > Number(usage.inputTokens) ||
    Number(usage.reasoningTokens) > Number(usage.outputTokens) ||
    Number(usage.reportedCallCount) > Number(usage.callCount)
  ) {
    return null;
  }
  return Object.fromEntries(
    required.map((key) => [key, Number(usage[key])]),
  ) as unknown as LearnCouncilReceiptAttemptUsage;
}

export function parseLearnCouncilReceiptAttempts(
  value: unknown,
  dispatchCount: 1 | 2,
  state: "started" | "failed" | "completed",
): LearnCouncilReceiptAttempt[] {
  if (!Array.isArray(value)) {
    throw new Error("Council receipt attempt history is missing.");
  }
  const expectedLength = state === "started" ? dispatchCount - 1 : dispatchCount;
  if (value.length !== expectedLength) {
    throw new Error("Council receipt attempt history is incomplete.");
  }
  const attempts = value.map((entry, index): LearnCouncilReceiptAttempt => {
    const attempt = record(entry);
    if (
      !attempt ||
      Object.keys(attempt).some((key) => !ATTEMPT_KEYS.has(key)) ||
      attempt.dispatchGeneration !== index + 1 ||
      (attempt.dispatchGeneration !== 1 && attempt.dispatchGeneration !== 2) ||
      typeof attempt.councilRunId !== "string" ||
      !attempt.councilRunId ||
      typeof attempt.finalAnswerPresent !== "boolean" ||
      typeof attempt.usageEstimated !== "boolean" ||
      !Array.isArray(attempt.modelRouting) ||
      attempt.modelRouting.some((route) => !record(route))
    ) {
      throw new Error("Council receipt attempt binding is invalid.");
    }
    const usage = parseUsage(attempt.usage);
    if (!usage) throw new Error("Council receipt attempt usage is invalid.");
    const outcome = attempt.outcome;
    const completed = outcome === "completed";
    const failed = outcome === "failed_no_final_answer" || outcome === "failed_terminal";
    if (
      (!completed && !failed) ||
      attempt.finalAnswerPresent !== completed ||
      (completed &&
        (typeof attempt.responseHash !== "string" ||
          !/^[0-9a-f]{64}$/.test(attempt.responseHash) ||
          "failureCode" in attempt)) ||
      (failed &&
        (typeof attempt.failureCode !== "string" ||
          !attempt.failureCode ||
          "responseHash" in attempt)) ||
      ("requestedModel" in attempt && typeof attempt.requestedModel !== "string") ||
      ("resolvedModel" in attempt && typeof attempt.resolvedModel !== "string") ||
      ("createdAt" in attempt &&
        (typeof attempt.createdAt !== "string" || !Number.isFinite(Date.parse(attempt.createdAt)))) ||
      ("updatedAt" in attempt &&
        (typeof attempt.updatedAt !== "string" || !Number.isFinite(Date.parse(attempt.updatedAt)))) ||
      (typeof attempt.createdAt === "string" &&
        typeof attempt.updatedAt === "string" &&
        Date.parse(attempt.createdAt) > Date.parse(attempt.updatedAt))
    ) {
      throw new Error("Council receipt attempt outcome is invalid.");
    }
    return {
      dispatchGeneration: attempt.dispatchGeneration,
      outcome,
      councilRunId: attempt.councilRunId,
      finalAnswerPresent: attempt.finalAnswerPresent,
      usage,
      usageEstimated: attempt.usageEstimated,
      modelRouting: attempt.modelRouting as Array<Record<string, unknown>>,
      ...(typeof attempt.requestedModel === "string"
        ? { requestedModel: attempt.requestedModel }
        : {}),
      ...(typeof attempt.resolvedModel === "string"
        ? { resolvedModel: attempt.resolvedModel }
        : {}),
      ...(typeof attempt.createdAt === "string" ? { createdAt: attempt.createdAt } : {}),
      ...(typeof attempt.updatedAt === "string" ? { updatedAt: attempt.updatedAt } : {}),
      ...(typeof attempt.responseHash === "string"
        ? { responseHash: attempt.responseHash }
        : {}),
      ...(typeof attempt.failureCode === "string"
        ? { failureCode: attempt.failureCode }
        : {}),
    };
  });
  if (
    attempts.some((attempt, index) =>
      index < attempts.length - 1 && attempt.outcome === "completed") ||
    (state === "completed" && attempts.at(-1)?.outcome !== "completed") ||
    (state === "failed" && attempts.at(-1)?.outcome === "completed")
  ) {
    throw new Error("Council receipt attempt terminal state conflicts.");
  }
  return attempts;
}

export function assertExactOrdinaryLearnCouncilReceiptAttempt(
  attempt: LearnCouncilReceiptAttempt,
  requestedModel: string,
): void {
  const expected = expectedStrictLearnModelRoute(requestedModel);
  const route = attempt.modelRouting[0];
  const succeeded = attempt.outcome === "completed";
  if (
    !expected ||
    attempt.requestedModel !== expected.requestedModel ||
    attempt.resolvedModel !== expected.resolvedModel ||
    attempt.usage.callCount !== 1 ||
    attempt.usage.reportedCallCount < 0 ||
    attempt.usage.reportedCallCount > 1 ||
    attempt.usageEstimated !== (attempt.usage.reportedCallCount === 0) ||
    (succeeded && attempt.usage.reportedCallCount !== 1) ||
    attempt.modelRouting.length !== 1 ||
    route?.endpoint !== "council" ||
    route?.requestedModel !== expected.requestedModel ||
    route?.resolvedModel !== expected.resolvedModel ||
    route?.provider !== expected.provider ||
    route?.upstreamModel !== expected.upstreamModel ||
    route?.fallback !== false ||
    route?.requestId !== attempt.councilRunId ||
    route?.outcome !== (succeeded ? "succeeded" : "failed")
  ) {
    throw new Error("Council receipt attempt does not prove one exact ordinary model call.");
  }
}

export function completedLearnCouncilReceiptAttemptMatchesResult(
  attempt: LearnCouncilReceiptAttempt | undefined,
  result: {
    councilRunId: string;
    responseHash: string;
    requestedModel?: string;
    resolvedModel?: string;
    createdAt: string;
    updatedAt: string;
    usageEstimated?: boolean;
    modelRouting: Array<Record<string, unknown>>;
    usage?: LearnCouncilReceiptAttemptUsage;
  },
): boolean {
  const usage = result.usage;
  return Boolean(
    attempt &&
    attempt.outcome === "completed" &&
    attempt.councilRunId === result.councilRunId &&
    attempt.responseHash === result.responseHash &&
    attempt.requestedModel === result.requestedModel &&
    attempt.resolvedModel === result.resolvedModel &&
    attempt.createdAt === result.createdAt &&
    attempt.updatedAt === result.updatedAt &&
    JSON.stringify(attempt.modelRouting) === JSON.stringify(result.modelRouting) &&
    result.usageEstimated !== undefined &&
    attempt.usageEstimated === result.usageEstimated &&
    usage &&
    attempt.usage.inputTokens === usage.inputTokens &&
    attempt.usage.outputTokens === usage.outputTokens &&
    attempt.usage.totalTokens === usage.totalTokens &&
    attempt.usage.cachedInputTokens === usage.cachedInputTokens &&
    attempt.usage.reasoningTokens === usage.reasoningTokens &&
    attempt.usage.callCount === usage.callCount &&
    attempt.usage.reportedCallCount === usage.reportedCallCount
  );
}

export function sumLearnCouncilReceiptAttemptUsage(
  attempts: readonly LearnCouncilReceiptAttempt[],
): LearnCouncilOwnedAttemptAccounting {
  if (attempts.length !== 1 && attempts.length !== 2) {
    throw new Error("Learn Council owned attempt set is invalid.");
  }
  const usage = attempts.reduce(
    (sum, attempt) => ({
      inputTokens: sum.inputTokens + attempt.usage.inputTokens,
      outputTokens: sum.outputTokens + attempt.usage.outputTokens,
      totalTokens: sum.totalTokens + attempt.usage.totalTokens,
      cachedInputTokens: sum.cachedInputTokens + attempt.usage.cachedInputTokens,
      reasoningTokens: sum.reasoningTokens + attempt.usage.reasoningTokens,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  );
  const providerCallCount = attempts.reduce(
    (sum, attempt) => sum + attempt.usage.callCount,
    0,
  );
  const reportedCallCount = attempts.reduce(
    (sum, attempt) => sum + attempt.usage.reportedCallCount,
    0,
  );
  const estimatedCallCount = attempts.filter((attempt) => attempt.usageEstimated).length;
  if (
    (providerCallCount !== 1 && providerCallCount !== 2) ||
    reportedCallCount < 0 ||
    reportedCallCount > providerCallCount ||
    estimatedCallCount < 0 ||
    estimatedCallCount > providerCallCount
  ) {
    throw new Error("Learn Council owned attempt accounting is invalid.");
  }
  return {
    usage,
    providerCallCount,
    reportedCallCount: reportedCallCount as 0 | 1 | 2,
    estimatedCallCount: estimatedCallCount as 0 | 1 | 2,
  };
}
