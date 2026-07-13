/** Browser-safe model defaults shared by every Breadboard AI surface. */
export const DEFAULT_MODEL = 'gpt-5.6-sol';

/** Models shown when ChatMock's model endpoint is unavailable or incomplete. */
export const DEFAULT_ASSISTANT_MODELS: readonly string[] = [
  DEFAULT_MODEL,
  'gpt-5.5',
  'gpt-5.4',
];

export function mergeAssistantModels(modelIds: readonly unknown[]): string[] {
  const validIds = modelIds.flatMap((modelId) => {
    if (typeof modelId !== 'string') return [];
    const normalized = modelId.trim();
    return normalized ? [normalized] : [];
  });
  return Array.from(new Set([...DEFAULT_ASSISTANT_MODELS, ...validIds]));
}

export function formatAssistantModelName(modelId: string): string {
  if (modelId === 'gpt-5.6-sol' || modelId === 'gpt-5.6') return 'GPT-5.6 Sol';
  return modelId.replace(/^gpt-/i, 'GPT-');
}
