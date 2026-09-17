import assert from 'node:assert/strict';
import test from 'node:test';
import { writingSignal, writingTimeoutMs } from './writing-budget';

test('long writing has its own bounded budget without ignoring cancellation', () => {
  assert.equal(writingTimeoutMs({}), 900_000);
  assert.equal(writingTimeoutMs({ DEEP_RESEARCH_STEP_TIMEOUT_MS: '60000' }), 900_000);
  assert.equal(writingTimeoutMs({ DEEP_RESEARCH_WRITING_TIMEOUT_MS: '120000' }), 120_000);
  assert.equal(writingTimeoutMs({ DEEP_RESEARCH_WRITING_TIMEOUT_MS: '120000.5' }), 120_000);
  assert.equal(writingTimeoutMs({ DEEP_RESEARCH_WRITING_TIMEOUT_MS: 'Infinity' }), 900_000);
  assert.equal(writingTimeoutMs({ DEEP_RESEARCH_WRITING_TIMEOUT_MS: '99999999' }), 1_800_000);
  const controller = new AbortController();
  const signal = writingSignal(controller.signal);
  const reason = new Error('User stopped the run');
  controller.abort(reason);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, reason);
});
