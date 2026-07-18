import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chatTokenUsageEventFromResponse,
  chatTokenUsageFromResponse,
  formatExactTokenCount,
  formatResponseDuration,
  formatTokenCount,
  normalizeChatTokenUsage,
  sumChatTokenUsage,
  summarizeChatTokenUsage,
} from '../src/lib/chat-token-usage.ts';

test('maps a completed provider response to the shared SSE usage event', () => {
  assert.deepEqual(
    chatTokenUsageEventFromResponse({
      usage: {
        input_tokens: 25,
        output_tokens: 5,
        total_tokens: 30,
      },
    }),
    {
      type: 'usage',
      usage: {
        inputTokens: 25,
        outputTokens: 5,
        totalTokens: 30,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    },
  );
  assert.equal(chatTokenUsageEventFromResponse({ usage: null }), null);
});

test('preserves ChatMock fallback-estimate metadata from the response wrapper', () => {
  assert.deepEqual(
    chatTokenUsageFromResponse({
      usageEstimated: true,
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
    }),
    {
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimated: true,
    },
  );
});

test('normalizes Responses API token usage and its detail fields', () => {
  assert.deepEqual(
    normalizeChatTokenUsage({
      input_tokens: 1_200,
      output_tokens: 300,
      total_tokens: 1_500,
      input_tokens_details: { cached_tokens: 800 },
      output_tokens_details: { reasoning_tokens: 125 },
    }),
    {
      inputTokens: 1_200,
      outputTokens: 300,
      totalTokens: 1_500,
      cachedInputTokens: 800,
      reasoningTokens: 125,
    },
  );
});

test('normalizes Chat Completions and persisted camel-case usage', () => {
  assert.deepEqual(
    normalizeChatTokenUsage({
      prompt_tokens: 90,
      completion_tokens: 30,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 40 },
      completion_tokens_details: { reasoning_tokens: 10 },
    }),
    {
      inputTokens: 90,
      outputTokens: 30,
      totalTokens: 120,
      cachedInputTokens: 40,
      reasoningTokens: 10,
    },
  );

  assert.deepEqual(
    normalizeChatTokenUsage({
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      cachedInputTokens: 3,
      reasoningTokens: 2,
      responseDurationMs: 72_400,
    }),
    {
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      cachedInputTokens: 3,
      reasoningTokens: 2,
      responseDurationMs: 72_400,
    },
  );
});

test('supports providers that omit optional usage details', () => {
  assert.deepEqual(
    normalizeChatTokenUsage({
      input_tokens: 40,
      output_tokens: 10,
      total_tokens: 50,
    }),
    {
      inputTokens: 40,
      outputTokens: 10,
      totalTokens: 50,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  );
});

test('normalizes OpenHarness completion token usage', () => {
  assert.deepEqual(
    normalizeChatTokenUsage({
      total: 11_537,
      input: 11_530,
      output: 7,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    }),
    {
      inputTokens: 11_530,
      outputTokens: 7,
      totalTokens: 11_537,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  );
});

test('rejects missing, negative, and non-finite token totals', () => {
  assert.equal(normalizeChatTokenUsage(null), null);
  assert.equal(normalizeChatTokenUsage({}), null);
  assert.equal(
    normalizeChatTokenUsage({ input_tokens: -1, output_tokens: 2 }),
    null,
  );
  assert.equal(
    normalizeChatTokenUsage({ input_tokens: 1, total_tokens: Number.NaN }),
    null,
  );
  assert.deepEqual(
    normalizeChatTokenUsage({
      input_tokens: 4,
      output_tokens: 2,
      total_tokens: 6,
      responseDurationMs: -1,
    }),
    {
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  );
});

test('sums reported usage without changing latest-request semantics', () => {
  const first = normalizeChatTokenUsage({
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
  });
  const second = normalizeChatTokenUsage({
    input_tokens: 220,
    output_tokens: 40,
    total_tokens: 260,
  });

  assert.deepEqual(sumChatTokenUsage([{ ...first, responseDurationMs: 500 }, null, second]), {
    inputTokens: 320,
    outputTokens: 60,
    totalTokens: 380,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  });

  const summary = summarizeChatTokenUsage([
    { role: 'user' },
    { role: 'assistant', usage: first },
    { role: 'assistant' },
    { role: 'assistant', usage: second },
  ]);
  assert.deepEqual(summary.latest, second);
  assert.equal(summary.cumulative.totalTokens, 380);
  assert.equal(summary.trackedResponses, 2);
  assert.equal(summary.unreportedResponses, 1);
  const latestUnreported = summarizeChatTokenUsage([
    { role: 'assistant', usage: second },
    { role: 'assistant' },
    { role: 'user' },
  ]);
  assert.equal(latestUnreported.latest, null);
  assert.equal(latestUnreported.cumulative.totalTokens, 260);
  assert.equal(latestUnreported.trackedResponses, 1);
  assert.equal(latestUnreported.unreportedResponses, 1);
  assert.equal(
    sumChatTokenUsage([{ ...first, estimated: true }, second]).estimated,
    true,
  );
});

test('formats compact and exact token counts deterministically', () => {
  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(undefined), '0');
  assert.equal(formatTokenCount(Number.NaN), '0');
  assert.equal(formatTokenCount(Number.POSITIVE_INFINITY), '0');
  assert.equal(formatTokenCount(999), '999');
  assert.equal(formatTokenCount(1_000), '1K');
  assert.equal(formatTokenCount(1_200), '1.2K');
  assert.equal(formatTokenCount(12_400), '12.4K');
  assert.equal(formatTokenCount(1_250_000), '1.3M');
  assert.equal(formatExactTokenCount(12_345), '12,345');
  assert.equal(formatResponseDuration(900), '0s');
  assert.equal(formatResponseDuration(12_900), '12s');
  assert.equal(formatResponseDuration(72_400), '1m 12s');
  assert.equal(formatResponseDuration(3_672_400), '1h 1m 12s');
});
