import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  normalizeAssistantReasoningEffort,
} from '../src/lib/assistant-reasoning.ts';

test('assistant reasoning defaults to high effort', () => {
  assert.equal(DEFAULT_ASSISTANT_REASONING_EFFORT, 'high');
});

test('assistant reasoning accepts every composer effort option', () => {
  assert.equal(normalizeAssistantReasoningEffort('none'), 'none');
  assert.equal(normalizeAssistantReasoningEffort('medium'), 'medium');
  assert.equal(normalizeAssistantReasoningEffort('high'), 'high');
});

test('assistant reasoning keeps compatibility with the legacy thinking flag', () => {
  assert.equal(normalizeAssistantReasoningEffort(undefined, true), 'high');
  assert.equal(normalizeAssistantReasoningEffort(undefined, false), 'none');
  assert.equal(normalizeAssistantReasoningEffort('invalid', true), 'high');
});
