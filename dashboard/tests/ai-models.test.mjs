import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
  formatAssistantModelName,
  mergeAssistantModels,
} from '../src/lib/ai-models.ts';

test('GPT-5.6 Sol is the default for every assistant surface', () => {
  assert.equal(DEFAULT_MODEL, 'gpt-5.6-sol');
  assert.equal(DEFAULT_ASSISTANT_MODELS[0], DEFAULT_MODEL);
});

test('assistant model lists keep all GPT-5.6 variants first and remove duplicates', () => {
  assert.deepEqual(
    mergeAssistantModels(['gpt-5.4', 'gpt-5.6-sol', 'gpt-5.6-luna', ' custom-model ', '', null]),
    ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'custom-model'],
  );
});

test('assistant model names use a readable label in the composer', () => {
  assert.equal(formatAssistantModelName('gpt-5.6-sol'), 'GPT-5.6 Sol');
  assert.equal(formatAssistantModelName('gpt-5.6-terra'), 'GPT-5.6 Terra');
  assert.equal(formatAssistantModelName('gpt-5.6-luna'), 'GPT-5.6 Luna');
  assert.equal(formatAssistantModelName('gpt-5.5'), 'GPT-5.5');
});
