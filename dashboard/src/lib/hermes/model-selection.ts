import {
  CHAT_MODEL_SENTINEL,
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
  GLOBAL_MODEL_SENTINEL,
  NO_MODEL_SENTINEL,
  NO_DEFAULT_MODEL_MESSAGE,
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
  "gpt-5.6-luna-reserve",
  // A sentinel stands in for whatever model it resolves to, so it must not
  // be pre-emptively downgraded here. ChatMock clamps the effort against the
  // model it actually resolves to.
  GLOBAL_MODEL_SENTINEL,
  CHAT_MODEL_SENTINEL,
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
 * sent as the `chat` sentinel: ChatMock expands it to the chat model, and the
 * runtime pins that turn to exactly the model that was picked.
 * So the chat runs on the chosen model without the runtime needing to know
 * its name. The profile default remains the fallback for Learn and background
 * work such as Thought Topology; explicit turn and run picks leave it intact.
 */
function resolveModelId(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_model", "The selected model is invalid.");
  }
  const modelId = value.trim();
  if (modelId === NO_MODEL_SENTINEL) {
    throw new ApiError(400, "default_model_required", NO_DEFAULT_MODEL_MESSAGE);
  }
  if (
    HERMES_MODEL_IDS.includes(modelId) ||
    modelId === GLOBAL_MODEL_SENTINEL ||
    modelId === CHAT_MODEL_SENTINEL
  ) {
    return modelId;
  }

  // Only provider-prefixed ids take the indirection. They are the ones the
  // runtime can never register per-model. The runtime pins the chat sentinel
  // to the concrete selected model before starting the turn.
  //
  // A bare id like `gpt-5` is different: ChatMock serves it, but the runtime has
  // not registered it. Substituting the sentinel there would quietly answer with
  // some *other* model, so that stays an error the operator can see.
  if (modelId.includes("/") && normalizeAssistantModelId(modelId)) {
    return CHAT_MODEL_SENTINEL;
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
  defaultModel = DEFAULT_MODEL,
): HermesEngineSelection {
  const requestedModel = modelValue === undefined || modelValue === null || modelValue === ""
    ? defaultModel : modelValue;
  const modelID = resolveModelId(requestedModel);
  const requestedReasoningEffort = resolveReasoningEffort(reasoningEffortValue);
  const variant = requestedReasoningEffort === "max" && !MAX_REASONING_MODELS.has(modelID)
    ? "xhigh"
    : requestedReasoningEffort;

  return {
    model: { providerID: HERMES_CHATMOCK_PROVIDER_ID, modelID },
    selectedModelID:
      typeof requestedModel === "string" &&
      requestedModel.trim() &&
      requestedModel.trim() !== GLOBAL_MODEL_SENTINEL &&
      requestedModel.trim() !== CHAT_MODEL_SENTINEL
        ? requestedModel.trim()
        : modelID === GLOBAL_MODEL_SENTINEL || modelID === CHAT_MODEL_SENTINEL
          ? DEFAULT_MODEL
          : modelID,
    variant,
    requestedReasoningEffort,
    adjusted: variant !== requestedReasoningEffort,
  };
}
