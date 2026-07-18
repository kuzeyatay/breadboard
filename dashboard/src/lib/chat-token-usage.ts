export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
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

  const normalizedInput = inputTokens ?? 0;
  const normalizedOutput = outputTokens ?? 0;

  const estimated = record.estimated === true || record.usageEstimated === true;
  const responseDurationMs = firstTokenCount(record, [
    'responseDurationMs',
    'response_duration_ms',
  ]);
  return {
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    totalTokens: totalTokens ?? normalizedInput + normalizedOutput,
    cachedInputTokens:
      firstTokenCount(record, ['cachedInputTokens', 'cachedTokens']) ??
      (inputDetails ? firstTokenCount(inputDetails, ['cached_tokens']) : undefined) ??
      (cacheDetails ? firstTokenCount(cacheDetails, ['read']) : undefined) ??
      0,
    reasoningTokens:
      firstTokenCount(record, ['reasoningTokens', 'reasoning']) ??
      (outputDetails ? firstTokenCount(outputDetails, ['reasoning_tokens']) : undefined) ??
      0,
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
