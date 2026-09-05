import {
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
  GLOBAL_MODEL_SENTINEL,
  normalizeAssistantModelId,
} from "../ai-models.ts";
import {
  ASSISTANT_REASONING_EFFORTS,
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "../assistant-reasoning.ts";
import { ApiError } from "./route-core.ts";

export const HERMES_CHATMOCK_PROVIDER_ID = "chatmock";
export const HERMES_MODEL_IDS: readonly string[] = DEFAULT_ASSISTANT_MODELS;

const MAX_REASONING_MODELS = new Set([
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  // The sentinel stands in for whatever the background model is, so it must not
  // be pre-emptively downgraded here. ChatMock clamps the effort against the
  // model it actually resolves to.
  GLOBAL_MODEL_SENTINEL,
]);

export interface HermesEngineSelection {
  model: { providerID: typeof HERMES_CHATMOCK_PROVIDER_ID; modelID: string };
  selectedModelID: string;
  variant: AssistantReasoningEffort;
  requestedReasoningEffort: AssistantReasoningEffort;
  adjusted: boolean;
}

/**
 * Map the browser's model choice onto an id the runtime can actually name.
 *
 * The runtime addresses models declared in its provider config, which covers
 * the ChatGPT ids. A provider model (`anthropic/claude-opus-4-5`) is not
 * declared there — declaring every model of every provider would mean
 * regenerating that config whenever a key is added. Instead such a choice is
 * sent as the `default` sentinel, which *is* declared: ChatMock expands it to
 * the background model, and the Intelligence menu sets the background model to
 * exactly the model that was picked. So the chat runs on the chosen model
 * without the runtime needing to know its name.
 */
function resolveModelId(value: unknown): string {
  if (value === undefined || value === null || value === "") return DEFAULT_MODEL;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_model", "The selected model is invalid.");
  }
  const modelId = value.trim();
  if (HERMES_MODEL_IDS.includes(modelId) || modelId === GLOBAL_MODEL_SENTINEL) {
    return modelId;
  }

  // Only provider-prefixed ids take the indirection. They are the ones the
  // runtime can never register per-model, and they only reach here after the
  // Intelligence menu made them the background model — so the sentinel resolves
  // to exactly the model that was asked for.
  //
  // A bare id like `gpt-5` is different: ChatMock serves it, but the runtime has
  // not registered it. Substituting the sentinel there would quietly answer with
  // some *other* model, so that stays an error the operator can see.
  if (modelId.includes("/") && normalizeAssistantModelId(modelId)) {
    return GLOBAL_MODEL_SENTINEL;
  }

  throw new ApiError(
    400,
    "unsupported_model",
    "The selected model is not available in Hermes.",
  );
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
 * Resolve the browser's model picker values into a server-owned Hermes
 * engine. The provider is deliberately fixed here so a client cannot route a
 * prompt to an arbitrary provider configured in the runtime.
 */
export function resolveHermesEngine(
  modelValue: unknown,
  reasoningEffortValue: unknown,
): HermesEngineSelection {
  const modelID = resolveModelId(modelValue);
  const requestedReasoningEffort = resolveReasoningEffort(reasoningEffortValue);
  const variant = requestedReasoningEffort === "max" && !MAX_REASONING_MODELS.has(modelID)
    ? "xhigh"
    : requestedReasoningEffort;

  return {
    model: { providerID: HERMES_CHATMOCK_PROVIDER_ID, modelID },
    selectedModelID:
      typeof modelValue === "string" &&
      modelValue.trim() &&
      modelValue.trim() !== GLOBAL_MODEL_SENTINEL
        ? modelValue.trim()
        : modelID === GLOBAL_MODEL_SENTINEL
          ? DEFAULT_MODEL
          : modelID,
    variant,
    requestedReasoningEffort,
    adjusted: variant !== requestedReasoningEffort,
  };
}
