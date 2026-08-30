import assert from 'node:assert/strict';
import test from 'node:test';
import { NoObjectGeneratedError, type LanguageModelUsage } from 'ai';

import { runStructuredOutputAttempts } from './structured-output';

const usage = (
  promptTokens: number,
  completionTokens: number,
): LanguageModelUsage => ({
  promptTokens,
  completionTokens,
  totalTokens: promptTokens + completionTokens,
});

test('a missed tool call retries in JSON mode and counts both attempts', async () => {
  const modes: string[] = [];
  const usages: LanguageModelUsage[] = [];
  const result = await runStructuredOutputAttempts({
    initialMode: 'tool',
    onUsage: value => usages.push(value),
    attempt: async mode => {
      modes.push(mode);
      if (mode === 'tool') {
        throw new NoObjectGeneratedError({
          message: 'No object generated: the tool was not called.',
          response: {
            id: 'first',
            timestamp: new Date(0),
            modelId: 'test-model',
          },
          usage: usage(10, 2),
        });
      }
      return { object: { findings: ['grounded'] }, usage: usage(8, 3) };
    },
  });

  assert.deepEqual(modes, ['tool', 'json']);
  assert.deepEqual(result, { findings: ['grounded'] });
  assert.deepEqual(
    usages.map(value => value.totalTokens),
    [12, 11],
  );
});

test('ordinary failures are not disguised as structured-output fallbacks', async () => {
  const expected = new Error('gateway unavailable');
  await assert.rejects(
    runStructuredOutputAttempts({
      initialMode: 'tool',
      attempt: async () => {
        throw expected;
      },
    }),
    error => error === expected,
  );
});
