export interface LearnPlanningRouteProofResult {
  councilRunId: string;
  councilMode?: string;
  requestedModel?: string;
  resolvedModel?: string;
  modelRouting: readonly Record<string, unknown>[];
  usage?: {
    callCount: number;
    reportedCallCount: number;
  };
}

interface ExpectedStrictModelRoute {
  requestedModel: string;
  resolvedModel: string;
  provider: string;
  upstreamModel: string;
}

/**
 * Mirror ChatMock's public model-id contract at the receipt boundary.
 *
 * A canonical bare model belongs to the ChatGPT provider. A provider-prefixed
 * model assigns only its first path segment to the provider and preserves the
 * complete remainder as the upstream model id. Strict Learn rejects the
 * `default` sentinel and ChatGPT-prefixed aliases before a receipt can exist,
 * so accepting either here would weaken the exact-route proof.
 */
export function expectedStrictLearnModelRoute(
  requestedModel: string,
): ExpectedStrictModelRoute | null {
  const exact = requestedModel.trim();
  if (!exact || exact.toLowerCase() === "default") return null;

  const slash = exact.indexOf("/");
  if (slash < 0) {
    return {
      requestedModel: exact,
      resolvedModel: exact,
      provider: "chatgpt",
      upstreamModel: exact,
    };
  }

  const provider = exact.slice(0, slash).trim().toLowerCase();
  const upstreamModel = exact.slice(slash + 1).trim();
  if (!provider || !upstreamModel || provider === "chatgpt") return null;
  return {
    requestedModel: exact,
    resolvedModel: `${provider}/${upstreamModel}`,
    provider,
    upstreamModel,
  };
}

/** Prove that a durable Council result represents one exact, non-fallback call. */
export function planningReceiptProvesOneExactModelCall(
  result: LearnPlanningRouteProofResult,
  requestedModel: string,
): boolean {
  const expected = expectedStrictLearnModelRoute(requestedModel);
  const route = result.modelRouting[0];
  return Boolean(
    expected &&
      result.councilMode === "direct_council" &&
      result.requestedModel === expected.requestedModel &&
      result.resolvedModel === expected.resolvedModel &&
      result.modelRouting.length === 1 &&
      route?.endpoint === "council" &&
      route?.requestedModel === expected.requestedModel &&
      route?.resolvedModel === expected.resolvedModel &&
      route?.upstreamModel === expected.upstreamModel &&
      route?.provider === expected.provider &&
      route?.requestId === result.councilRunId &&
      route?.outcome === "succeeded" &&
      route?.fallback === false &&
      result.usage?.callCount === 1 &&
      result.usage?.reportedCallCount === 1,
  );
}
