import assert from 'node:assert/strict';
import test from 'node:test';
import { canCompleteSentence, normalizeSentenceCompletion, sentenceCompletionContext } from '../src/lib/sentence-completion.ts';
import { generateSentenceCompletion } from './helpers/recommendation-model-fixture.mjs';

const completion = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const messages = [
  { role: 'user', content: 'Explain RLC circuits', attachments: ['private.pdf'] },
  { role: 'assistant', content: 'A resistor, inductor and capacitor.', reasoning: 'private reasoning' },
];

test('a continuation preserves spaces, partial words and the original draft', () => {
  assert.equal(normalizeSentenceCompletion(' an RLC circuit?', 'Can you explain'), ' an RLC circuit?');
  assert.equal(normalizeSentenceCompletion(' an RLC circuit?', 'Can you explain '), 'an RLC circuit?');
  assert.equal(normalizeSentenceCompletion('lain an RLC circuit?', 'Can you exp'), 'lain an RLC circuit?');
  assert.equal(normalizeSentenceCompletion('Can you explain an RLC circuit?', 'Can you explain'), ' an RLC circuit?');
  assert.equal(normalizeSentenceCompletion(' dit uitleggen?', 'Kun je'), ' dit uitleggen?');
  for (const text of ['', null, {}, 'NONE', 'null', 'N/A', 'x'.repeat(241), ' first\nsecond', '<think>reasoning</think>', '```text```', 'Completion: next', '- next']) {
    assert.equal(normalizeSentenceCompletion(text, 'Can you explain'), null, String(text));
  }
  for (const draft of ['', '  ', 'hey', '/cal', '@name', 'x'.repeat(4001)]) assert.equal(canCompleteSentence(draft), false);
  assert.equal(canCompleteSentence('Can you exp'), true);
});

test('context is bounded visible text, including drafts in a new chat', () => {
  assert.deepEqual(sentenceCompletionContext([]), []);
  assert.deepEqual(sentenceCompletionContext(messages), messages.map(({ role, content }) => ({ role, content })));
  for (const flag of ['modelChange', 'internalAgentContinuation', 'pending', 'failed', 'interrupted']) {
    assert.deepEqual(sentenceCompletionContext([{ ...messages[0], [flag]: true }]), []);
  }
  const bounded = sentenceCompletionContext(Array.from({ length: 20 }, () => ({ role: 'user', content: 'x'.repeat(9000) })));
  assert.equal(bounded.length, 4);
  assert.ok(bounded.every(message => message.content.length === 1000));
});

test('completion always uses the configured background model, without tools or private metadata', async () => {
  let captured;
  const result = await generateSentenceCompletion({ userId: 1, draft: 'Can you explain', messages,
    model: 'chat-selected-model', baseUrl: 'http://completion.test/v1', fetcher: async (url, init) => {
      captured = { url, ...JSON.parse(init.body) };
      return completion(JSON.stringify({ completion: ' an RLC circuit?' }));
    },
  });
  assert.equal(result, ' an RLC circuit?');
  assert.equal(captured.url, 'http://completion.test/v1/chat/completions');
  assert.equal(captured.model, 'default');
  assert.equal(captured.stream, false);
  assert.equal(captured.max_completion_tokens, 128);
  assert.equal('tools' in captured, false);
  assert.deepEqual(JSON.parse(captured.messages[1].content).draft, 'Can you explain');
  assert.doesNotMatch(JSON.stringify(captured), /private\.pdf|private reasoning|chat-selected-model/);
  assert.equal(await generateSentenceCompletion({ userId: 1, draft: 'Help me write', messages: [],
    fetcher: async () => completion('{"completion":" a short thank-you note."}'),
  }), ' a short thank-you note.');
});

test('bad output, unavailable providers and disabled or tiny drafts quietly yield no completion', async () => {
  for (const fetcher of [
    async () => new Response('unavailable', { status: 503 }),
    async () => { throw new Error('offline'); },
    async () => completion('Answer instead of a continuation'),
    async () => completion('null'),
    async () => completion('{"completion":"<think>private</think>"}'),
  ]) assert.equal(await generateSentenceCompletion({ userId: 1, draft: 'Can you explain', messages, fetcher }), null);
  assert.equal(await generateSentenceCompletion({ userId: 1, draft: '/cal', messages,
    fetcher: async () => assert.fail('No generation for a command query'),
  }), null);
});

test('timeout, request cancellation and a late provider response never return stale text', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let signal;
    const pending = generateSentenceCompletion({ userId: 1, draft: 'Can you explain', messages,
      signal: controller.signal, timeoutMs: 20,
      fetcher: async (_url, init) => {
        signal = init.signal;
        return new Promise(resolve => signal.addEventListener('abort', () => resolve(completion('{"completion":" stale text"}')), { once: true }));
      },
    });
    if (cancel) controller.abort();
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      assert.equal(await pending, null);
      assert.equal(signal.aborted, true);
    } finally { clearTimeout(keepAlive); }
  }
  assert.equal(await generateSentenceCompletion({ userId: 1, draft: 'Can you explain', messages,
    signal: AbortSignal.abort(), fetcher: async () => assert.fail('Already cancelled'),
  }), null);
});
