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
import { loadChatmockModelCatalog, type ChatmockModel } from "../chatmock-model-catalog.ts";
import { clampIntelligenceMode, toIntelligenceModes } from "../intelligence-modes.ts";

export const HERMES_CHATMOCK_PROVIDER_ID = "chatmock";
export const HERMES_MODEL_IDS: readonly string[] = DEFAULT_ASSISTANT_MODELS;

const MAX_REASONING_MODELS = new Set([
  "gpt-6.2-astra",
  "gpt-6.2-sol",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
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
 * Built-in and discovered ChatGPT models travel as concrete ids. External
 * provider choices retain the `chat` sentinel contract; the runtime pins that
 * turn to the concrete selectedModelID before submitting the prompt. Neither
 * path changes the profile fallback used for background work.
 */
function resolveModelId(value: unknown, catalog: readonly ChatmockModel[]): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_model", "The selected model is invalid.");
  }
  const modelId = value.trim();
  if (modelId === NO_MODEL_SENTINEL) {
    throw new ApiError(400, "default_model_required", NO_DEFAULT_MODEL_MESSAGE);
  }
  if (
    HERMES_MODEL_IDS.includes(modelId) ||
    catalog.some((model) => model.id === modelId && model.owned_by === "chatgpt") ||
    modelId === GLOBAL_MODEL_SENTINEL ||
    modelId === CHAT_MODEL_SENTINEL
  ) {
    return modelId;
  }

  // Only provider-prefixed ids take the indirection. They are the ones the
  // runtime can never register per-model. The runtime pins the chat sentinel
  // to the concrete selected model before starting the turn.
  //
  // New bare ids must be verified against ChatMock's catalog. Once verified,
  // they travel as concrete ids, preserving the model selected for this turn.
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
  catalog: readonly ChatmockModel[] = [],
): HermesEngineSelection {
  const requestedModel = modelValue === undefined || modelValue === null || modelValue === ""
    ? defaultModel : modelValue;
  const modelID = resolveModelId(requestedModel, catalog);
  const requestedReasoningEffort = resolveReasoningEffort(reasoningEffortValue);
  const discovered = catalog.find((model) => model.id === modelID && model.owned_by === "chatgpt");
  const variant = discovered
    ? clampIntelligenceMode(requestedReasoningEffort, toIntelligenceModes(discovered.reasoning_efforts)) ?? "none"
    : requestedReasoningEffort === "max" && !MAX_REASONING_MODELS.has(modelID)
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

/** Validate new native ids on the server before submitting them to Hermes. */
export async function resolveAvailableHermesEngine(
  modelValue: unknown,
  reasoningEffortValue: unknown,
  defaultModel = DEFAULT_MODEL,
): Promise<HermesEngineSelection> {
  try {
    return resolveHermesEngine(modelValue, reasoningEffortValue, defaultModel);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "unsupported_model") throw error;
    const id = normalizeAssistantModelId(modelValue || defaultModel);
    if (!id) throw error;
    // Validate the effort before doing I/O, even for an unrecognised model.
    resolveReasoningEffort(reasoningEffortValue);
    let catalog: ChatmockModel[];
    try {
      catalog = await loadChatmockModelCatalog();
    } catch {
      throw new ApiError(503, "model_catalog_unavailable", "Could not verify the selected model. Try again when ChatGPT is available.");
    }
    return resolveHermesEngine(id, reasoningEffortValue, defaultModel, catalog);
  }
}
