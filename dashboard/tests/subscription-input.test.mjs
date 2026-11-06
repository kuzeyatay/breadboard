import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/speech/subscription-input.ts'], bundle: true, write: false, format: 'esm' });
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
