import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerifiedSpeechOutput, sameSpokenWords, SpeechFidelityError } from '../src/lib/speech/verified-output.ts';
import { recordedVoiceFixture } from './fixtures/recorded-voice.mjs';

test('transcript comparison preserves every word, negation, repetition and language', () => {
  assert.equal(sameSpokenWords('“Hello,” she said. Don’t go!', 'hello she said dont go'), true);
  for (const [script, transcript] of [
    ['First middle last.', 'First last.'],
    ['Keep every word.', 'Preserve all the words.'],
    ['What is two plus two?', 'Four.'],
    ['Say only hello.', 'Hello.'],
    ['Do not delete it.', 'Do delete it.'],
    ['Go go go.', 'Go go.'],
    ['Hello there.', '你好。'],
    ['Your answer is ready.', 'Your answer is ready. Let me explain.'],
    ['Your answer is ready.', ''],
    ['', ''],
  ]) assert.equal(sameSpokenWords(script, transcript), false, `${script} / ${transcript}`);
});

test('recorded speech stays inaudible until its complete transcript matches', async t => {
  const players = recordedVoiceFixture(t);
  const output = createVerifiedSpeechOutput(new AbortController().signal);
  output.attach(new MediaStream());
  await output.begin();
  assert.equal(players.length, 0);
  const audio = await output.finish('Every word survives.', 'Every word survives.', true);
  assert.equal(players.length, 0, 'validation itself does not start playback');
  const progress = [];
  await output.play(audio, value => progress.push(value));
  assert.equal(players.filter(player => player.played).length, 1);
  assert.deepEqual(progress, [0, 1, 1]);
});

test('missing, changed, repeated or extra words are discarded before any audio can play', async t => {
  const players = recordedVoiceFixture(t);
  for (const transcript of ['Every word.', 'All words survive.', 'Every word survives. Yes.', '']) {
    const output = createVerifiedSpeechOutput(new AbortController().signal);
    output.attach(new MediaStream());
    await output.begin();
    await assert.rejects(output.finish('Every word survives.', transcript, false), error =>
      error instanceof SpeechFidelityError && error.safeToRetry === false);
  }
  assert.equal(players.length, 0);
});

test('aborting while a recorded passage is being finalized prevents late playback', async t => {
  const players = recordedVoiceFixture(t);
  const controller = new AbortController();
  const output = createVerifiedSpeechOutput(controller.signal);
  output.attach(new MediaStream());
  await output.begin();
  const audio = output.finish('Cancelled.', 'Cancelled.', true);
  controller.abort();
  await assert.rejects(audio, { name: 'AbortError' });
  assert.equal(players.length, 0);
});
