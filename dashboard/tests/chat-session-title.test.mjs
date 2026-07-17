import assert from 'node:assert/strict';
import test from 'node:test';

import { chatTitleFromFirstMessage } from '../src/lib/chat-session-title.ts';

function wordCount(title) {
  return title.trim().split(/\s+/).length;
}

test('chat titles describe the first prompt in three to five words', () => {
  const title = chatTitleFromFirstMessage(
    'Can you please explain surrogate gradients for SNNs in simple terms?',
  );

  assert.equal(title, 'Surrogate Gradients for SNNs');
  assert.ok(wordCount(title) >= 3 && wordCount(title) <= 5);
});

test('chat titles discard low-information request filler', () => {
  assert.equal(
    chatTitleFromFirstMessage('Please fix the timeout errors in ChatMock'),
    'Fix Timeout Errors in ChatMock',
  );
  assert.equal(
    chatTitleFromFirstMessage('What is the capital of France?'),
    'Capital of France',
  );
});

test('chat titles preserve technical names and pad very short prompts', () => {
  assert.equal(chatTitleFromFirstMessage('PDF'), 'PDF Chat Overview');
  assert.equal(chatTitleFromFirstMessage('hello'), 'New Garden Chat');
  assert.equal(chatTitleFromFirstMessage('compare gpt-5.6 and chatgpt'), 'Compare GPT-5.6 and ChatGPT');
});

test('every generated chat title contains three to five words', () => {
  const prompts = [
    '',
    'help',
    'quantum entanglement',
    'How do neural networks learn from examples?',
    'Add a generate button to this state when an error occurs',
  ];

  for (const prompt of prompts) {
    const title = chatTitleFromFirstMessage(prompt);
    assert.ok(wordCount(title) >= 3 && wordCount(title) <= 5, `${prompt}: ${title}`);
  }
});
