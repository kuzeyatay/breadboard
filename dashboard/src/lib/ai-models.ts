/** Browser-safe model defaults shared by every Breadboard AI surface. */
export const DEFAULT_MODEL = 'gpt-5.6-sol';

/** Models shown when ChatMock's model endpoint is unavailable or incomplete. */
export const DEFAULT_ASSISTANT_MODELS: readonly string[] = [
  DEFAULT_MODEL,
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
];

export function normalizeAssistantModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && /^[a-z0-9._:/-]+$/i.test(normalized)
    ? normalized
    : null;
}

export function mergeAssistantModels(modelIds: readonly unknown[]): string[] {
  const validIds = modelIds.flatMap((modelId) => {
    const normalized = normalizeAssistantModelId(modelId);
    return normalized ? [normalized] : [];
  });
  return Array.from(new Set([...DEFAULT_ASSISTANT_MODELS, ...validIds]));
}

export function formatAssistantModelName(modelId: string): string {
  if (modelId === 'gpt-5.6-sol' || modelId === 'gpt-5.6') return 'GPT-5.6 Sol';
  if (modelId === 'gpt-5.6-terra') return 'GPT-5.6 Terra';
  if (modelId === 'gpt-5.6-luna') return 'GPT-5.6 Luna';
  return modelId.replace(/^gpt-/i, 'GPT-');
}
