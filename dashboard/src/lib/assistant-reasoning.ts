export const ASSISTANT_REASONING_EFFORTS = ['none', 'medium', 'high'] as const;

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
