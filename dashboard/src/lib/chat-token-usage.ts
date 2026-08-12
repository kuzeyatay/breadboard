export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  /** Whether counters describe one response, one agent turn, or a session snapshot. */
  scope?: 'request' | 'turn' | 'session';
  apiCalls?: number;
  contextUsedTokens?: number;
  contextLimitTokens?: number;
  responseDurationMs?: number;
  estimated?: boolean;
}

export interface ChatTokenUsageSummary {
  latest: ChatTokenUsage | null;
  cumulative: ChatTokenUsage;
  trackedResponses: number;
  unreportedResponses: number;
}

export interface ChatTokenUsageStreamEvent {
  type: 'usage';
  usage: ChatTokenUsage;
}

type UnknownRecord = Record<string, unknown>;

const EMPTY_USAGE: ChatTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

function recordFrom(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object'
    ? (value as UnknownRecord)
    : null;
}

function tokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function firstTokenCount(
  record: UnknownRecord,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = tokenCount(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function hasInvalidTokenCount(
  record: UnknownRecord,
  keys: readonly string[],
): boolean {
  return keys.some(
    (key) =>
      Object.prototype.hasOwnProperty.call(record, key) &&
      tokenCount(record[key]) === undefined,
  );
}

/**
 * Normalize token accounting returned by either the Responses API, Chat
 * Completions, or a previously persisted Breadboard chat message.
 */
export function normalizeChatTokenUsage(value: unknown): ChatTokenUsage | null {
  const record = recordFrom(value);
  if (!record) return null;

  const inputKeys = [
    'inputTokens',
    'input_tokens',
    'prompt_tokens',
    'input',
  ] as const;
  const outputKeys = [
    'outputTokens',
    'output_tokens',
    'completion_tokens',
    'output',
  ] as const;
  const totalKeys = ['totalTokens', 'total_tokens', 'total'] as const;
  if (
    hasInvalidTokenCount(record, inputKeys) ||
    hasInvalidTokenCount(record, outputKeys) ||
    hasInvalidTokenCount(record, totalKeys)
  ) {
    return null;
  }

  const inputTokens = firstTokenCount(record, inputKeys);
  const outputTokens = firstTokenCount(record, outputKeys);
  const totalTokens = firstTokenCount(record, totalKeys);
  const anthropicCacheRead = firstTokenCount(record, [
    'cache_read_input_tokens',
  ]);
  const anthropicCacheCreation = firstTokenCount(record, [
    'cache_creation_input_tokens',
  ]);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return null;
  }

  const inputDetails =
    recordFrom(record.input_tokens_details) ??
    recordFrom(record.prompt_tokens_details);
  const outputDetails =
    recordFrom(record.output_tokens_details) ??
    recordFrom(record.completion_tokens_details);
  const cacheDetails = recordFrom(record.cache);

  // Anthropic's native usage object splits uncached input, cache writes, and
  // cache reads into separate fields. Its `input_tokens` is therefore not the
  // complete input count, unlike the Responses API field with the same name.
  const normalizedInput =
    (inputTokens ?? 0) +
    (anthropicCacheRead ?? 0) +
    (anthropicCacheCreation ?? 0);
  const normalizedOutput = outputTokens ?? 0;

  const estimated = record.estimated === true || record.usageEstimated === true;
  const responseDurationMs = firstTokenCount(record, [
    'responseDurationMs',
    'response_duration_ms',
  ]);
  const explicitScope =
    record.scope === 'request' ||
    record.scope === 'turn' ||
    record.scope === 'session'
      ? record.scope
      : undefined;
  // Hermes releases before the turn-delta contract attached a cumulative
  // session snapshot (distinguished by its model + calls fields) to each row.
  // Keep those rows honest in the UI instead of relabeling them as one answer.
  const scope =
    explicitScope ??
    (typeof record.model === 'string' &&
    firstTokenCount(record, ['calls']) !== undefined &&
    Object.prototype.hasOwnProperty.call(record, 'total')
      ? 'session'
      : undefined);
  const apiCalls = firstTokenCount(record, ['apiCalls', 'api_calls', 'calls']);
  const contextUsedTokens = firstTokenCount(record, [
    'contextUsedTokens',
    'context_used',
  ]);
  const contextLimitTokens = firstTokenCount(record, [
    'contextLimitTokens',
    'context_max',
  ]);
  return {
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    totalTokens: totalTokens ?? normalizedInput + normalizedOutput,
    cachedInputTokens:
      firstTokenCount(record, ['cachedInputTokens', 'cachedTokens']) ??
      (inputDetails ? firstTokenCount(inputDetails, ['cached_tokens']) : undefined) ??
      (cacheDetails ? firstTokenCount(cacheDetails, ['read']) : undefined) ??
      firstTokenCount(record, ['cache_read', 'cache_read_tokens']) ??
      anthropicCacheRead ??
      0,
    reasoningTokens:
      firstTokenCount(record, ['reasoningTokens', 'reasoning']) ??
      (outputDetails ? firstTokenCount(outputDetails, ['reasoning_tokens']) : undefined) ??
      0,
    ...(scope ? { scope } : {}),
    ...(apiCalls !== undefined ? { apiCalls } : {}),
    ...(contextUsedTokens !== undefined ? { contextUsedTokens } : {}),
    ...(contextLimitTokens !== undefined ? { contextLimitTokens } : {}),
    ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
    ...(estimated ? { estimated: true } : {}),
  };
}

export function chatTokenUsageFromResponse(value: unknown): ChatTokenUsage | null {
  const response = recordFrom(value);
  if (!response) return null;
  const usage = normalizeChatTokenUsage(response.usage);
  if (!usage) return null;
  return response.usageEstimated === true
    ? { ...usage, estimated: true }
    : usage;
}

export function chatTokenUsageEventFromResponse(
  value: unknown,
): ChatTokenUsageStreamEvent | null {
  const usage = chatTokenUsageFromResponse(value);
  return usage ? { type: 'usage', usage } : null;
}

export function sumChatTokenUsage(
  usages: Iterable<ChatTokenUsage | null | undefined>,
): ChatTokenUsage {
  const total = { ...EMPTY_USAGE };
  for (const usage of usages) {
    if (!usage) continue;
    // A legacy session snapshot overlaps earlier rows and cannot be summed
    // without a migration baseline. Excluding it avoids double-counting.
    if (usage.scope === 'session') continue;
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.totalTokens += usage.totalTokens;
    total.cachedInputTokens += usage.cachedInputTokens;
    total.reasoningTokens += usage.reasoningTokens;
    if (usage.estimated) total.estimated = true;
  }
  return total;
}

export function summarizeChatTokenUsage(
  messages: Iterable<{ role?: unknown; usage?: unknown }>,
): ChatTokenUsageSummary {
  const reported: ChatTokenUsage[] = [];
  let latest: ChatTokenUsage | null = null;
  let unreportedResponses = 0;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const usage = normalizeChatTokenUsage(message.usage);
    latest = usage;
    if (usage) {
      reported.push(usage);
    } else {
      unreportedResponses += 1;
    }
  }

  return {
    latest,
    cumulative: sumChatTokenUsage(reported),
    trackedResponses: reported.length,
    unreportedResponses,
  };
}

export function formatTokenCount(value: number): string {
  const count = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (count < 1_000) return String(count);

  const units = [
    { value: 1_000_000_000, suffix: 'B' },
    { value: 1_000_000, suffix: 'M' },
    { value: 1_000, suffix: 'K' },
  ];
  const unit = units.find((candidate) => count >= candidate.value)!;
  const compact = count / unit.value;
  const digits = compact < 100 && !Number.isInteger(compact) ? 1 : 0;
  return `${compact.toFixed(digits).replace(/\.0$/, '')}${unit.suffix}`;
}

export function formatExactTokenCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.trunc(value)));
}

export function formatResponseDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
