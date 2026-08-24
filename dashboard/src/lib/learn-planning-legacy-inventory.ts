import {
  type LegacyPlanningWaiverBinding,
  type LegacyPlanningWaiverResult,
} from "./learn-planning-legacy-waiver.ts";
import { planningReceiptProvesOneExactModelCall } from "./learn-planning-route-proof.ts";

const SHA256_RE = /^[0-9a-f]{64}$/;
const ALLOWED_RESULT_FIELDS = new Set([
  "sequence",
  "requestHash",
  "councilRunId",
  "responseHash",
  "createdAt",
  "updatedAt",
  "councilMode",
  "requestedModel",
  "resolvedModel",
  "usage",
  "modelRouting",
]);
const ALLOWED_PAYLOAD_FIELDS = new Set(["state", "legacy", "results"]);
const ALLOWED_USAGE_FIELDS = new Set([
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "reasoningTokens",
  "callCount",
  "reportedCallCount",
]);
const ALLOWED_ROUTING_FIELDS = new Set([
  "schemaVersion",
  "at",
  "requestId",
  "endpoint",
  "requestedModel",
  "resolvedModel",
  "upstreamModel",
  "provider",
  "outcome",
  "fallback",
]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Validate the promptless ChatMock inventory before it may become an
 * operator waiver. The receipt writer repeats the canonical/time checks; this
 * boundary additionally proves one exact non-fallback model call per result. */
export function auditedLegacyPlanningInventory(input: {
  value: unknown;
  binding: LegacyPlanningWaiverBinding;
  model: string;
}): LegacyPlanningWaiverResult[] {
  const payload = recordValue(input.value);
  if (
    !payload ||
    Object.keys(payload).some((field) => !ALLOWED_PAYLOAD_FIELDS.has(field)) ||
    payload.state !== "completed" ||
    payload.legacy !== true ||
    !Array.isArray(payload.results)
  ) {
    throw new Error("Legacy Council inventory response is invalid.");
  }
  if (payload.results.length !== input.binding.completedRequests) {
    throw new Error("Legacy Council inventory count does not match the recovered job ledger.");
  }
  return payload.results.map((raw, index) => {
    const result = recordValue(raw);
    if (!result) throw new Error("Legacy Council inventory result is invalid.");
    if (Object.keys(result).some((field) => !ALLOWED_RESULT_FIELDS.has(field))) {
      throw new Error("Legacy Council inventory exposed a non-allowlisted field.");
    }
    const usage = recordValue(result.usage);
    const callCount = usage?.callCount;
    const reportedCallCount = usage?.reportedCallCount;
    const rawRouting = result.modelRouting;
    const routing = Array.isArray(rawRouting) && rawRouting.length === 1
      ? recordValue(rawRouting[0])
      : null;
    if (
      !usage ||
      typeof callCount !== "number" ||
      !Number.isSafeInteger(callCount) ||
      callCount !== 1 ||
      typeof reportedCallCount !== "number" ||
      !Number.isSafeInteger(reportedCallCount) ||
      reportedCallCount !== 1 ||
      !routing ||
      Object.keys(usage).some((field) => !ALLOWED_USAGE_FIELDS.has(field)) ||
      Object.keys(routing).some((field) => !ALLOWED_ROUTING_FIELDS.has(field))
    ) {
      throw new Error("Legacy Council inventory call evidence is invalid.");
    }
    const routeProof = {
      councilRunId: typeof result.councilRunId === "string" ? result.councilRunId : "",
      councilMode: typeof result.councilMode === "string" ? result.councilMode : undefined,
      requestedModel:
        typeof result.requestedModel === "string" ? result.requestedModel : undefined,
      resolvedModel:
        typeof result.resolvedModel === "string" ? result.resolvedModel : undefined,
      modelRouting: [routing],
      usage: {
        callCount,
        reportedCallCount,
      },
    };
    if (!planningReceiptProvesOneExactModelCall(routeProof, input.model)) {
      throw new Error("Legacy Council inventory does not prove one exact model call.");
    }
    if (
      result.sequence !== index ||
      typeof result.requestHash !== "string" ||
      !SHA256_RE.test(result.requestHash) ||
      typeof result.councilRunId !== "string" ||
      !result.councilRunId ||
      typeof result.responseHash !== "string" ||
      !SHA256_RE.test(result.responseHash) ||
      typeof result.createdAt !== "string" ||
      !Number.isFinite(Date.parse(result.createdAt)) ||
      typeof result.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(result.updatedAt))
    ) {
      throw new Error("Legacy Council inventory identity is invalid.");
    }
    return {
      sequence: index,
      requestHash: result.requestHash,
      councilRunId: result.councilRunId,
      responseHash: result.responseHash,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  });
}
