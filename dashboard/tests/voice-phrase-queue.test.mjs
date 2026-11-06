import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceNarrationQueue, VOICE_ANSWER_COALESCE_MS } from '../src/lib/speech/voice-conversation.ts';

const mocked = new WeakSet();
function harness(t) {
  if (!mocked.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); mocked.add(t); }
  const spoken = [], idle = [], done = [];
  const queue = createVoiceNarrationQueue({ startIndex: 0, streamAnswers: true,
    speak(item) { spoken.push({ ...item }); return new Promise(resolve => done.push(resolve)); },
    onIdle: value => idle.push(value), onError: error => { throw error; },
  });
  t.after(() => queue.cancel());
  const update = (text, busy = true) => queue.update([{ role: 'assistant', content: text, voiceStream: { segment: 0, text } }], busy);
  return { queue, spoken, idle, done, update };
}
const first = 'That makes complete sense. ';
const second = 'Let us work through it together.';

test('nearby streamed sentences share one speech request without waiting after finalization', async t => {
  const h = harness(t);
  h.update(first); t.mock.timers.tick(70); h.update(first + second, false);
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].text, first + second);
  h.done[0](); await Promise.resolve();
  assert.deepEqual(h.idle, [true]);
  t.mock.timers.tick(1000); assert.equal(h.spoken.length, 1);
});

test('a slow continuation cannot keep resetting the first-word deadline', t => {
  const h = harness(t);
  h.update(first); t.mock.timers.tick(80); h.update(first + 'Let us');
  t.mock.timers.tick(VOICE_ANSWER_COALESCE_MS - 81);
  assert.equal(h.spoken.length, 0); t.mock.timers.tick(1);
  assert.equal(h.spoken[0].text, first.trim());
});

test('complete answers and substantial opening phrases incur no batching delay', t => {
  const h = harness(t); h.update(first + second, false);
  assert.equal(h.spoken.length, 1);
  const other = harness(t);
  other.update('This longer opening sentence already gives the speech provider a substantial natural phrase to read, so starting it immediately preserves the quick first response that makes a conversation feel responsive. ');
  assert.equal(other.spoken.length, 1);
});

test('interruption cancels a pending phrase before any sound can start', t => {
  const h = harness(t); h.update(first); h.queue.cancel();
  t.mock.timers.tick(VOICE_ANSWER_COALESCE_MS + 100);
  assert.equal(h.spoken.length, 0); assert.deepEqual(h.idle, []);
});

test('text received during speech stays together without another batching pause', async t => {
  const h = harness(t); h.update(first); t.mock.timers.tick(VOICE_ANSWER_COALESCE_MS);
  h.update(first + second + ' A final sentence. ');
  h.update(first + second + ' A final sentence.', false);
  h.done[0](); await Promise.resolve();
  assert.equal(h.spoken.length, 2);
  assert.equal(h.spoken[1].text, second + ' A final sentence.');
});
