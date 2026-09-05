import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantModelGroup,
  assistantModelVendor,
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
  formatAssistantModelName,
  groupAssistantModels,
  mergeAssistantModels,
} from '../src/lib/ai-models.ts';

test('GPT-5.6 Sol is the default for every assistant surface', () => {
  assert.equal(DEFAULT_MODEL, 'gpt-5.6-sol');
  assert.ok(DEFAULT_ASSISTANT_MODELS.includes(DEFAULT_MODEL));
});

test('assistant model lists put Astra first and remove duplicates', () => {
  assert.deepEqual(
    mergeAssistantModels(['gpt-5.4', 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna', ' custom-model ', '', null]),
    ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'custom-model'],
  );
});

test('assistant model names use a readable label in the composer', () => {
  assert.equal(formatAssistantModelName('gpt-6-astra'), 'GPT-6 Astra');
  assert.equal(formatAssistantModelName('chatgpt/gpt-6-astra'), 'GPT-6 Astra');
  assert.equal(formatAssistantModelName('gpt-5.6-sol'), 'GPT-5.6 Sol');
  assert.equal(formatAssistantModelName('gpt-5.6-terra'), 'GPT-5.6 Terra');
  assert.equal(formatAssistantModelName('gpt-5.6-luna'), 'GPT-5.6 Luna');
  assert.equal(formatAssistantModelName('gpt-5.5'), 'GPT-5.5');
  assert.equal(
    formatAssistantModelName('cliproxy/gemini-3.7-flash-high'),
    'Gemini 3.7 Flash High',
  );
  assert.equal(
    formatAssistantModelName('openrouter/google/gemini-2.5-pro'),
    'Gemini 2.5 Pro',
  );
});

test('model labels drop the release-date stamp and spell versions with a dot', () => {
  // The date is the longest part of the row and never the part being chosen
  // between; the dashes Anthropic uses for versions read as "Opus 4 1".
  assert.equal(
    formatAssistantModelName('cliproxy/claude-opus-4-1-20250805'),
    'Claude Opus 4.1',
  );
  assert.equal(formatAssistantModelName('cliproxy/claude-sonnet-5'), 'Claude Sonnet 5');
  assert.equal(formatAssistantModelName('cliproxy/claude-fable-5'), 'Claude Fable 5');
  assert.equal(
    formatAssistantModelName('cliproxy/claude-3-5-haiku-20241022'),
    'Claude 3.5 Haiku',
  );
  assert.equal(
    formatAssistantModelName('anthropic/claude-haiku-4-5-20251001'),
    'Claude Haiku 4.5',
  );
  // The pxpipe route is an aside about how the request travels, not a version:
  // spelled as a version it would read "Claude Fable 5 Efficient", which sounds
  // like a smaller model rather than the same one sent more cheaply.
  assert.equal(
    formatAssistantModelName('cliproxy/claude-fable-5-efficient'),
    'Claude Fable 5 (Efficient)',
  );
  assert.equal(
    assistantModelVendor('cliproxy/claude-fable-5-efficient').label,
    'Anthropic',
  );
  // Sibling models must stay distinguishable: stripping the date must never
  // collapse two ids onto one label.
  assert.notEqual(
    formatAssistantModelName('cliproxy/claude-opus-4-5-20251101'),
    formatAssistantModelName('cliproxy/claude-opus-4-20250514'),
  );
});

test('a model id names the vendor that made it', () => {
  // Grouping by the route named sections after plumbing ("ChatGPT",
  // "Subscriptions") when what tells the entries apart is who built them.
  assert.deepEqual(assistantModelVendor('gpt-5.6-sol'), {
    id: 'openai',
    label: 'OpenAI',
  });
  // The subscription proxy serves several vendors, so its id says nothing —
  // the model name decides.
  assert.deepEqual(assistantModelVendor('cliproxy/claude-opus-5'), {
    id: 'anthropic',
    label: 'Anthropic',
  });
  assert.deepEqual(assistantModelVendor('cliproxy/gemini-2.5-pro'), {
    id: 'google',
    label: 'Google',
  });
  assert.deepEqual(assistantModelVendor('cliproxy/kimi-k2'), {
    id: 'moonshot',
    label: 'Moonshot',
  });
  assert.deepEqual(assistantModelVendor('cliproxy/grok-4'), {
    id: 'xai',
    label: 'xAI',
  });
  // A provider that is itself a vendor settles it without reading the name.
  assert.deepEqual(assistantModelVendor('anthropic/claude-opus-4-5'), {
    id: 'anthropic',
    label: 'Anthropic',
  });
  // Vendor-scoped ids resolve through their middle segment.
  assert.deepEqual(assistantModelVendor('openrouter/meta-llama/llama-3.3-70b'), {
    id: 'meta',
    label: 'Meta',
  });
  // An unrecognised model keeps its route as the heading rather than being
  // filed under a vendor it may not belong to.
  assert.deepEqual(assistantModelVendor('bedrock/nova-pro'), {
    id: 'bedrock',
    label: 'Bedrock',
  });
});

test('the model picker groups by vendor in first-appearance order', () => {
  assert.deepEqual(
    groupAssistantModels([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'cliproxy/claude-opus-5',
      'gpt-5.5',
      'anthropic/claude-opus-4-5',
      'cliproxy/claude-sonnet-5',
      'cliproxy/gemini-2.5-pro',
    ]),
    [
      {
        vendorId: 'openai',
        vendorLabel: 'OpenAI',
        models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5'],
      },
      {
        // The vendor's own API and its subscription land in one section:
        // both are Anthropic's account, which is what the heading names.
        vendorId: 'anthropic',
        vendorLabel: 'Anthropic',
        models: [
          'cliproxy/claude-opus-5',
          'anthropic/claude-opus-4-5',
          'cliproxy/claude-sonnet-5',
        ],
      },
      {
        vendorId: 'google',
        vendorLabel: 'Google',
        models: ['cliproxy/gemini-2.5-pro'],
      },
    ],
  );
});

test('a model resold by a pay-per-token gateway is filed under the gateway', () => {
  // "Claude Sonnet 4.5 via OpenRouter" runs out of OpenRouter credits, not
  // Anthropic's, so the menu must say where it comes from.
  assert.deepEqual(assistantModelGroup('openrouter/anthropic/claude-sonnet-4.5'), {
    id: 'openrouter',
    label: 'OpenRouter',
  });
  assert.deepEqual(assistantModelGroup('groq/llama-3.3-70b-versatile'), {
    id: 'groq',
    label: 'Groq',
  });
  // The vendor helper is unchanged: it still names who built the model.
  assert.deepEqual(assistantModelVendor('openrouter/anthropic/claude-sonnet-4.5'), {
    id: 'anthropic',
    label: 'Anthropic',
  });
  assert.deepEqual(
    groupAssistantModels([
      'cliproxy/claude-opus-5',
      'openrouter/anthropic/claude-sonnet-4.5',
      'openrouter/google/gemini-2.5-pro',
      'cliproxy/gemini-2.5-pro',
    ]),
    [
      { vendorId: 'anthropic', vendorLabel: 'Anthropic', models: ['cliproxy/claude-opus-5'] },
      {
        vendorId: 'openrouter',
        vendorLabel: 'OpenRouter',
        models: ['openrouter/anthropic/claude-sonnet-4.5', 'openrouter/google/gemini-2.5-pro'],
      },
      { vendorId: 'google', vendorLabel: 'Google', models: ['cliproxy/gemini-2.5-pro'] },
    ],
  );
});

test('grouping keeps every model that was passed in', () => {
  // Sections reorder the flat list (an unprefixed id joins the OpenAI
  // section), but nothing may be dropped or duplicated — an id missing from
  // the picker is a model the user can no longer select.
  const models = mergeAssistantModels([
    'cliproxy/claude-opus-5',
    'anthropic/claude-opus-4-5',
    'custom-model',
  ]);
  assert.deepEqual(
    groupAssistantModels(models)
      .flatMap((group) => group.models)
      .sort(),
    [...models].sort(),
  );
});
