import {
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
} from "../ai-models.ts";
import {
  ASSISTANT_REASONING_EFFORTS,
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "../assistant-reasoning.ts";
import { ApiError } from "./route-core.ts";

export const OPENHARNESS_CHATMOCK_PROVIDER_ID = "chatmock";
export const OPENHARNESS_MODEL_IDS: readonly string[] = DEFAULT_ASSISTANT_MODELS;

const MAX_REASONING_MODELS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);

export interface OpenHarnessEngineSelection {
  model: { providerID: typeof OPENHARNESS_CHATMOCK_PROVIDER_ID; modelID: string };
  variant: AssistantReasoningEffort;
  requestedReasoningEffort: AssistantReasoningEffort;
  adjusted: boolean;
}

function resolveModelId(value: unknown): string {
  if (value === undefined || value === null || value === "") return DEFAULT_MODEL;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_model", "The selected model is invalid.");
  }
  const modelId = value.trim();
  if (!OPENHARNESS_MODEL_IDS.includes(modelId)) {
    throw new ApiError(400, "unsupported_model", "The selected model is not available in OpenHarness.");
  }
  return modelId;
}

function resolveReasoningEffort(value: unknown): AssistantReasoningEffort {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_ASSISTANT_REASONING_EFFORT;
  }
  if (
    typeof value !== "string" ||
    !ASSISTANT_REASONING_EFFORTS.includes(value as AssistantReasoningEffort)
  ) {
    throw new ApiError(400, "invalid_reasoning_effort", "The selected reasoning effort is invalid.");
  }
  return value as AssistantReasoningEffort;
}

/**
 * Resolve the browser's model picker values into a server-owned OpenHarness
 * engine. The provider is deliberately fixed here so a client cannot route a
 * prompt to an arbitrary provider configured in the runtime.
 */
export function resolveOpenHarnessEngine(
  modelValue: unknown,
  reasoningEffortValue: unknown,
): OpenHarnessEngineSelection {
  const modelID = resolveModelId(modelValue);
  const requestedReasoningEffort = resolveReasoningEffort(reasoningEffortValue);
  const variant = requestedReasoningEffort === "max" && !MAX_REASONING_MODELS.has(modelID)
    ? "xhigh"
    : requestedReasoningEffort;

  return {
    model: { providerID: OPENHARNESS_CHATMOCK_PROVIDER_ID, modelID },
    variant,
    requestedReasoningEffort,
    adjusted: variant !== requestedReasoningEffort,
  };
}
