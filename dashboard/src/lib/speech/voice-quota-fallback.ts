/**
 * Voice is a live conversation: when the voice model's plan window is spent,
 * answer through Claude (CLIProxy) instead of failing every spoken turn.
 * Chosen by the user 2026-11-17. Typed chats keep ChatMock's own fallback.
 */
interface ModelHealth {
  accounts?: { available?: boolean }[];
  cooldowns?: { key?: string }[];
}

/** Whether ChatMock already knows `model` cannot answer right now. */
export function modelIsOutOfQuota(model: string, health: ModelHealth): boolean {
  if ((health.cooldowns ?? []).some(cooldown => cooldown.key === model)) return true;
  // A bare id (no provider/ prefix) is served by the ChatGPT account pool.
  const accounts = health.accounts ?? [];
  return !model.includes('/') && accounts.length > 0 && accounts.every(account => account.available === false);
}

/** The newest Sonnet first: it answers fastest of the Claude models. */
export function pickClaudeStandIn(models: readonly string[]): string | null {
  // Newest first: the live catalog lists claude-sonnet-5 before claude-sonnet-5-5.
  const claude = models.filter(model => model.startsWith('cliproxy/claude-'))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return claude.find(model => model.includes('sonnet')) ?? claude[0] ?? null;
}

export async function voiceModelWithQuotaFallback(model: string, chatmockBaseUrl: string): Promise<string> {
  try {
    const get = (path: string) => fetch(`${chatmockBaseUrl}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(2_000) })
      .then(response => response.ok ? response.json() : null);
    const health = await get('/settings/model-health') as ModelHealth | null;
    if (!health || !modelIsOutOfQuota(model, health)) return model;
    const catalog = await get('/providers') as { externalModels?: unknown } | null;
    const models = Array.isArray(catalog?.externalModels) ? catalog.externalModels.filter((id): id is string => typeof id === 'string') : [];
    const standIn = pickClaudeStandIn(models);
    return standIn && !modelIsOutOfQuota(standIn, health) ? standIn : model;
  } catch {
    // An unreachable proxy is not evidence of a spent quota.
    return model;
  }
}
