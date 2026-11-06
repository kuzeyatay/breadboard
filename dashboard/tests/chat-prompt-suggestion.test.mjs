import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePromptSuggestion, promptSuggestionContext } from '../src/lib/chat-prompt-suggestion.ts';
import { generatePromptSuggestion } from '../src/lib/chat-prompt-suggestion-service.ts';

const messages = [
  { role: 'user', content: 'Explain RLC circuits', attachments: ['private.pdf'] },
  { role: 'assistant', content: 'An RLC circuit has a resistor, inductor and capacitor.', reasoning: 'private reasoning' },
];
const completion = text => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));

test('suggestions use bounded visible context after a completed assistant reply', () => {
  assert.deepEqual(promptSuggestionContext(messages), messages.map(({ role, content }) => ({ role, content })));
  for (const flag of ['pending', 'failed', 'interrupted']) {
    assert.deepEqual(promptSuggestionContext([messages[0], { ...messages[1], [flag]: true }]), []);
  }
  assert.deepEqual(promptSuggestionContext([]), []);
  assert.deepEqual(promptSuggestionContext([messages[0]]), []);
  assert.deepEqual(promptSuggestionContext([messages[1]]), []);
  assert.deepEqual(promptSuggestionContext([...messages, { role: 'assistant', content: '' }]), []);
  assert.deepEqual(promptSuggestionContext([...messages, { role: 'assistant', content: 'Model changed', modelChange: 'new' }]), promptSuggestionContext(messages));
  const bounded = promptSuggestionContext(Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(100_000) })));
  assert.equal(bounded.length, 6);
  assert.ok(bounded.every(message => message.content.length === 2_000));
});

test('only a short, single plain-text message becomes ghost text', () => {
  assert.equal(normalizePromptSuggestion('  "Show me a worked example"  '), 'Show me a worked example');
  assert.equal(normalizePromptSuggestion('Kun je een voorbeeld geven?'), 'Kun je een voorbeeld geven?');
  for (const text of [null, {}, '', 'NONE', 'null', 'N/A', 'x'.repeat(241), '- Explain more', '1. Explain more', 'Suggestion: Continue', 'First\nSecond', '<think>secret</think> Continue', '```Continue```']) {
    assert.equal(normalizePromptSuggestion(text), null, String(text));
  }
});

test('generation is tool-free, follows the selected model and excludes private message metadata', async () => {
  let captured;
  const result = await generatePromptSuggestion({ messages, model: 'selected/model', baseUrl: 'http://suggest.test/v1', fetcher: async (url, init) => {
    captured = { url, ...JSON.parse(init.body) };
    return completion('Show me a worked example');
  } });
  assert.equal(result, 'Show me a worked example');
  assert.equal(captured.url, 'http://suggest.test/v1/chat/completions');
  assert.equal(captured.model, 'selected/model');
  assert.equal(captured.stream, false);
  assert.equal('tools' in captured, false);
  assert.equal(captured.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(captured), /private\.pdf|private reasoning/);
  assert.match(captured.messages[1].content, /RLC/);
});

test('empty context, no-model and invalid model choices never request a completion', async () => {
  const fetcher = async () => { assert.fail('No request expected'); };
  for (const model of ['none', '', undefined, 'invalid model']) {
    assert.equal(await generatePromptSuggestion({ messages, model, fetcher }), null);
  }
  assert.equal(await generatePromptSuggestion({ messages: [], model: 'selected', fetcher }), null);
});

test('provider failure, no suggestion, malformed responses and repeated user messages are quiet', async () => {
  for (const fetcher of [
    async () => new Response('failure', { status: 503 }),
    async () => { throw new Error('offline'); },
    async () => new Response('not json'),
    async () => completion('NONE'),
    async () => completion('Explain RLC circuits'),
    async () => completion('Too\nmany\nlines'),
  ]) assert.equal(await generatePromptSuggestion({ messages, model: 'selected', fetcher }), null);
});

test('timeout and caller cancellation abort the upstream completion', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let signal;
    const pending = generatePromptSuggestion({ messages, model: 'selected', signal: controller.signal, timeoutMs: 20,
      fetcher: async (_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      },
    });
    if (cancel) controller.abort();
    // The service timer is deliberately unref'd; keep the test process alive.
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      assert.equal(await pending, null);
      assert.equal(signal.aborted, true);
    } finally { clearTimeout(keepAlive); }
  }
});
