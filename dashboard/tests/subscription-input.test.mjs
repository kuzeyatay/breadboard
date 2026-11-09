import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/speech/subscription-input.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { createSubscriptionInput } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const item = (id, start, end, text) => ({ type: 'input_transcript.added', start_ms: start, end_ms: end, item: { id, text } });
const done = (id, start, end, transcript) => ({ type: 'turn.done', turn: { id, role: 'user', start_ms: start, end_ms: end, transcript } });

test('media words stream and completed turns correct them without duplication', () => {
  const input = createSubscriptionInput();
  assert.deepEqual(input.accept(item('1', 0, 200, 'Hello')), { text: 'Hello', final: false });
  assert.equal(input.accept(item('2', 200, 400, ' cafe')).text, 'Hello cafe');
  assert.equal(input.accept(item('2', 200, 400, ' cafe')), undefined);
  assert.deepEqual(input.accept(done('a', 0, 600, 'Hello café 世界.')), { text: 'Hello café 世界.', final: true });
  assert.equal(input.accept(done('a', 0, 600, 'Hello café 世界.')), undefined);
  assert.equal(input.accept(item('late', 200, 400, ' cafe')), undefined);
  input.accept(item('3', 600, 800, 'Send'));
  assert.deepEqual(input.accept(item('4', 800, 1000, ' message.')), { text: 'Hello café 世界. Send message.', final: false });
  assert.deepEqual(input.accept(done('b', 600, 1200, 'Send message.')), { text: 'Hello café 世界. Send message.', final: true });
});

test('earlier turn completion preserves newer words and cannot approve a partial command', () => {
  const input = createSubscriptionInput();
  input.accept(item('1', 0, 200, 'Please send'));
  input.accept(item('2', 200, 400, ' message'));
  input.accept(item('3', 600, 800, ' details tomorrow.'));
  assert.deepEqual(input.accept(done('a', 0, 600, 'Please send message')), { text: 'Please send message details tomorrow.', final: false });
  assert.equal(input.pending(), true);
  assert.deepEqual(input.accept(done('b', 600, 1000, 'details tomorrow.')), { text: 'Please send message details tomorrow.', final: true });
});

test('reuse rejects late old media and retains its authoritative source', () => {
  const input = createSubscriptionInput();
  input.accept(item('1', 0, 200, 'Old words'));
  input.accept(done('a', 0, 400, 'Old words.'));
  input.reset();
  assert.equal(input.active, true);
  assert.equal(input.text(), '');
  assert.equal(input.isStale(400), true);
  assert.equal(input.accept(done('a', 0, 400, 'Old words.')), undefined);
  input.accept(item('2', 600, 800, 'New words'));
  assert.deepEqual(input.accept(done('b', 600, 1000, 'New words.')), { text: 'New words.', final: true });
});

test('revisions to an existing live item appear before the turn is finalized', () => {
  const input = createSubscriptionInput();
  input.accept(item('1', 0, 200, 'Hello'));
  assert.deepEqual(input.accept(item('1', 0, 400, 'Hello there')), { text: 'Hello there', final: false });
  assert.deepEqual(input.accept(item('1', 0, 400, 'Hello café')), { text: 'Hello café', final: false });
  assert.equal(input.accept(item('1', 0, 400, 'Hello café')), undefined);
  input.accept(done('a', 0, 600, 'Hello café.'));
  assert.equal(input.accept(item('1', 0, 400, 'Hello there')), undefined, 'late revisions cannot overwrite a finalized turn');
  assert.equal(input.text(), 'Hello café.');
});

test('empty media placeholders do not disable the relay before usable words arrive', () => {
  const input = createSubscriptionInput();
  assert.equal(input.accept(item('1', 0, 200, '')), undefined);
  assert.equal(input.active, false);
  assert.equal(input.accept(item('1', 0, 200, '   ')), undefined);
  assert.equal(input.active, false);
  assert.deepEqual(input.accept(item('1', 0, 400, 'First words')), { text: 'First words', final: false });
  assert.equal(input.active, true);
  assert.deepEqual(input.accept(item('1', 0, 400, '')), { text: '', final: false }, 'a real correction may retract an existing preview');
});

test('a provider turn spanning two submitted utterances finalizes only fresh words', () => {
  const input = createSubscriptionInput();
  input.accept(item('old', 2000, 6200, 'Please check the forecast'));
  input.reset(); // The app submits after its own VAD; the provider turn stays open.
  input.accept(item('new1', 16400, 16600, 'Tell me'));
  input.accept(item('new2', 16600, 21200, ' a story'));
  const final = done('spanning', 2000, 22400, 'Please check the forecast Tell me a story');
  assert.deepEqual(input.accept(final), { text: 'Tell me a story', final: true });
  assert.equal(input.pending(), false);
  assert.equal(input.accept(final), undefined, 'duplicate late finals cannot restore the previous utterance');
  input.reset();
  input.accept(item('correction', 31600, 34800, 'Actually stop'));
  assert.deepEqual(input.accept(done('all', 2000, 35600, 'Please check the forecast Tell me a story Actually stop')),
    { text: 'Actually stop', final: true });
});

test('a spanning final cannot swallow words from a newer unfinished phrase', () => {
  const input = createSubscriptionInput();
  input.accept(item('old', 0, 200, 'Earlier request'));
  input.reset();
  input.accept(item('first', 600, 800, 'New request'));
  input.accept(item('second', 1200, 1400, ' with more detail'));
  assert.deepEqual(input.accept(done('spanning', 0, 1000, 'Earlier request New request')),
    { text: 'New request with more detail', final: false });
  assert.equal(input.pending(), true);
  assert.deepEqual(input.accept(done('later', 1200, 1600, 'with more detail.')),
    { text: 'New request with more detail.', final: true });
});

test('late extensions to an old item or empty final cannot reintroduce consumed words', () => {
  const input = createSubscriptionInput();
  input.accept(item('old', 0, 200, 'Consumed words'));
  input.reset();
  assert.equal(input.accept(item('old', 0, 400, 'Consumed words.')), undefined);
  assert.equal(input.accept(done('old', 0, 600, 'Consumed words.')), undefined);
  assert.equal(input.text(), '');
  input.accept(item('new', 800, 1000, 'New request'));
  assert.equal(input.text(), 'New request');
});

test('a new acoustic turn discards a delayed old tail and retains early interruption words', t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const input = createSubscriptionInput();
  input.accept(item('request', 0, 1000, 'Explain this briefly'));
  input.reset();
  now = 2200;
  input.accept(item('late-tail', 1100, 1400, ' please'));
  input.accept(done('old', 0, 1600, 'Explain this briefly please'));
  now = 5200;
  input.accept(item('interrupt', 4000, 4200, 'Actually'));
  input.accept(item('interrupt-more', 4200, 4400, ' stop'));
  assert.equal(input.discardBefore(4200), true);
  assert.equal(input.text(), 'Actually stop');
  assert.equal(input.accept(item('stale-replay', 1100, 1400, ' please')), undefined);
  assert.deepEqual(input.accept(done('new', 4000, 4800, 'Actually stop.')), {text:'Actually stop.', final:true});
});

test('short continuations keep every recently recognized word', t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const input = createSubscriptionInput();
  input.accept(item('first', 0, 400, 'Wait'));
  now = 1200;
  input.accept(item('second', 400, 800, ' I meant blue'));
  assert.equal(input.discardBefore(200), false);
  assert.equal(input.text(), 'Wait I meant blue');
});
