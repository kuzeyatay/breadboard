import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHATGPT_VOICE_OPENING,
  CHATGPT_VOICE_UNANSWERED,
  chatgptVoiceContext,
  pairSpokenMessages,
} from '../src/lib/speech/chatgpt-voice.ts';

test('ChatGPT is told the chat so far, newest kept when it is long', () => {
  const messages = [
    { role: 'user', content: 'old question '.repeat(40) },
    { role: 'assistant', content: '  ' },
    { role: 'assistant', content: 'Middle answer' },
    { role: 'user', content: 'Latest question' },
  ];
  assert.equal(chatgptVoiceContext(messages, 60), 'Assistant: Middle answer\n\nMe: Latest question');
  assert.equal(chatgptVoiceContext([]), '');
  const long = chatgptVoiceContext([{ role: 'user', content: 'x'.repeat(100) + ' the end' }], 30);
  assert.equal(long.length, 30);
  assert.ok(long.endsWith('the end'));
});

test('spoken messages become exchanges once ChatGPT has answered', () => {
  const first = pairSpokenMessages([], [
    { id: 'a0', role: 'assistant', text: 'Hi, what can I do?' },
    { id: 'u1', role: 'user', text: 'Plan my day.' },
  ]);
  assert.deepEqual(first.exchanges, [{ clientMessageId: 'chatgpt-voice-a0', user: CHATGPT_VOICE_OPENING, assistant: 'Hi, what can I do?' }]);
  assert.deepEqual(first.pending, [{ id: 'u1', role: 'user', text: 'Plan my day.' }]);

  const second = pairSpokenMessages(first.pending, [
    { id: 'u2', role: 'user', text: 'Starting at nine.' },
    { id: 'a1', role: 'assistant', text: 'Here is a plan.' },
  ]);
  assert.deepEqual(second.exchanges, [{ clientMessageId: 'chatgpt-voice-u1', user: 'Plan my day.\n\nStarting at nine.', assistant: 'Here is a plan.' }]);
  assert.deepEqual(second.pending, []);
});

test('hanging up keeps a question ChatGPT never answered', () => {
  const ended = pairSpokenMessages([{ id: 'u3', role: 'user', text: 'One more thing' }], [], true);
  assert.deepEqual(ended.exchanges, [{ clientMessageId: 'chatgpt-voice-u3', user: 'One more thing', assistant: CHATGPT_VOICE_UNANSWERED }]);
  assert.deepEqual(ended.pending, []);
  assert.deepEqual(pairSpokenMessages([], [], true), { exchanges: [], pending: [] });
});
