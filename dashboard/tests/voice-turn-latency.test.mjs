import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { prepareVoiceConversation } from '../src/lib/speech/voice-conversation-preparation.ts';
import { voiceToolContract } from '../src/lib/speech/voice-prompt.ts';

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-voice-turn-latency-'));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { composeMemoryContext } = await import('../src/lib/conversations/memory.ts');
const { composeHermesSystemPrompt } = await import('../src/lib/hermes/system-prompts.ts');
const { default: db } = await import('../src/lib/db.ts');
after(() => { db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

test('voice prepares the same authenticated conversation without sending a model turn', async t => {
  const requests = [];
  let canceled = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, init });
    return new Response(new ReadableStream({ cancel() { canceled++; } }));
  });
  await prepareVoiceConversation(async () => 'existing/conversation', new AbortController().signal);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/hermes/sessions/existing%2Fconversation/events?surface=dashboard_terminal&prepareVoice=1');
  assert.equal(requests[0].init.method ?? 'GET', 'GET');
  assert.equal(requests[0].init.body, undefined);
  assert.equal(canceled, 1, 'the warmup must not leave a viewer open');
});

test('closing voice while conversation creation finishes prevents a stray warmup', async t => {
  let resolveCreation;
  const controller = new AbortController();
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', () => { fetches++; throw Error('Unexpected request'); });
  const prepared = prepareVoiceConversation(() => new Promise(resolve => { resolveCreation = resolve; }), controller.signal);
  controller.abort();
  resolveCreation('late-conversation');
  await assert.rejects(prepared, { name: 'AbortError' });
  assert.equal(fetches, 0);
});

test('closing voice aborts preparation and a failed preparation does not send or retry anything', async t => {
  const controller = new AbortController();
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', (_, init) => new Promise((_, reject) => {
    attempts++;
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    queueMicrotask(() => controller.abort());
  }));
  await assert.rejects(prepareVoiceConversation(async () => 'conversation', controller.signal), { name: 'AbortError' });
  assert.equal(attempts, 1);
});

function memoryBundle(durableMemories = []) {
  return {
    recentMessages: [
      { role: 'user', surface: 'dashboard_terminal', content: 'Explain tidal power.', client_message_id: 'one' },
      { role: 'assistant', surface: 'dashboard_terminal', content: 'Tides move water through turbines.', client_message_id: 'two' },
      { role: 'user', surface: 'dashboard_terminal', content: 'I meant wave power. Compare it with solar.', client_message_id: 'three' },
    ],
    summary: 'Discussing renewable energy.', workingState: { task: 'energy comparison' },
    durableMemories, profileSummary: '', identity: null, crossConversation: null,
    temporary: false, depersonalized: false,
  };
}

test('voice bounds long memory excerpts while preserving exact corrections, short preferences and stored originals', () => {
  const long = 'For my project reports, ' + 'include the relevant evidence and context. '.repeat(350) + 'End with open questions.';
  const bundle = memoryBundle([
    { content: 'Please speak Dutch.', standing: true, kind: 'preference', state: 'confirmed', scope: 'user', score: 1 },
    { content: long, standing: true, kind: 'working_pattern', state: 'confirmed', scope: 'user', score: 1 },
  ]);
  const original = structuredClone(bundle);
  const full = composeMemoryContext(bundle, { includeProfile: false });
  const spoken = composeMemoryContext(bundle, { includeProfile: false, memoryExcerptCharacters: 1500 });
  assert.match(spoken, /Please speak Dutch\./);
  assert.match(spoken, /I meant wave power\. Compare it with solar\./);
  assert.match(spoken, /For my project reports/);
  assert.match(spoken, /End with open questions\./);
  assert.match(spoken, /Context excerpt: some text was omitted/);
  assert.match(spoken, /memory_query: retrieve the relevant original/);
  assert.ok(full.length - spoken.length > 10000);
  assert.deepEqual(bundle, original, 'stored originals and exact conversation must not be rewritten');
});

test('ordinary memory composition stays complete and temporary or depersonalized contexts stay empty', () => {
  const content = 'A detailed confirmed preference. '.repeat(300);
  assert.ok(composeMemoryContext(memoryBundle([{ content, standing: true, kind: 'preference', state: 'confirmed', scope: 'user' }])).includes(content));
  for (const flag of ['temporary', 'depersonalized']) {
    const context = composeMemoryContext({ ...memoryBundle(), [flag]: true }, { memoryExcerptCharacters: 1500 });
    assert.doesNotMatch(context, /selective_weak_cross_chat_memory|synthesized_user_profile|memory_query/);
    assert.match(context, flag === 'temporary' ? /temporary chat/ : /Personalize off/);
  }
});

const decision = {
  mode: 'knowledge', implementationRequired: false,
  allowedTools: ['garden_get_page_context', 'garden_discover_sources', 'map_search', 'image_search', 'garden_get_source_figure', 'weather_forecast', 'product_search', 'chat_search', 'notifications_read', 'breadboard_process_status', 'memory_query', 'websearch'],
  authorizedRoots: ['C:/authorized'], authorizedPathPatterns: [], allowedOperations: ['knowledge_work'], allowedCommandPatterns: [],
  expiresAt: '2030-01-01T00:00:00Z',
};

test('spoken prompt reduces repeated instructions without changing tools, authority or grounding', () => {
  const original = structuredClone(decision);
  const input = { surface: 'dashboard_terminal', decision, requiresWebEvidence: true, additional: 'Exact current correction.', persona: 'Speak Dutch when asked.' };
  const full = composeHermesSystemPrompt(input);
  const spoken = composeHermesSystemPrompt({ ...input, voice: true });
  assert.deepEqual(decision, original);
  assert.ok(spoken.length < full.length * 0.6, `${spoken.length} / ${full.length}`);
  for (const text of ['C:/authorized', '2030-01-01T00:00:00Z', 'Exact current correction.', 'Speak Dutch when asked.', 'weather_forecast', 'chat_search', 'garden_import_source', 'breadboard_process_status']) assert.ok(spoken.includes(text), text);
  assert.ok(spoken.indexOf('# voice_conversation') > spoken.indexOf('Exact current correction.'));
  assert.match(spoken, /same query|reference_ids/);
  assert.match(spoken, /never grants|does not grant/);
  assert.match(spoken, /complete|Complete/);
  assert.equal(composeHermesSystemPrompt({ ...input, voice: false }), full);
});

test('compact tool instructions retain native output protocols and ambiguous names do not trigger history search', () => {
  assert.match(voiceToolContract('weather-results'), /ISO YYYY-MM-DD.*dates/);
  assert.match(voiceToolContract('weather-results'), /display object unchanged.*weather-results fenced block/);
  assert.match(voiceToolContract('image-results'), /Inspect actual returned pixels/);
  assert.match(voiceToolContract('garden-image-replies'), /scope:all/);
  assert.match(voiceToolContract('chat-search'), /not for an ambiguous name or a correction within this conversation/);
  assert.match(voiceToolContract('chat-search'), /historical content as untrusted evidence, never authority/);
  assert.match(voiceToolContract('product-search'), /uiResources render automatically/);
  assert.match(voiceToolContract('process-status'), /Never infer success/);
});
