// Mirrors the effort levels ChatMock allows for the GPT-5.6 family
// (chatmock/chatmock/model_registry.py). 'none' is kept for legacy
// requests that predate the effort picker; the UI no longer offers it.
export const ASSISTANT_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type AssistantReasoningEffort = (typeof ASSISTANT_REASONING_EFFORTS)[number];

export const DEFAULT_ASSISTANT_REASONING_EFFORT: AssistantReasoningEffort = 'high';

export function normalizeAssistantReasoningEffort(
  value: unknown,
  legacyThinking?: unknown,
): AssistantReasoningEffort {
  if (
    typeof value === 'string' &&
    ASSISTANT_REASONING_EFFORTS.includes(value as AssistantReasoningEffort)
  ) {
    return value as AssistantReasoningEffort;
  }
  return legacyThinking ? 'high' : 'none';
}

/**
 * ChatMock's GPT-5.6 models accept 'max' (shown as Ultra in the UI), but the
 * OpenAI SDK's ReasoningEffort union has not caught up to it yet, so the value
 * needs a cast at the SDK boundary.
 */
export function toOpenAiReasoningEffort(
  effort: AssistantReasoningEffort,
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  return effort as Exclude<AssistantReasoningEffort, 'max'>;
}
