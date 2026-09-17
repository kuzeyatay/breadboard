import assert from 'node:assert/strict';
import test from 'node:test';
import { playVoicePassages } from '../src/lib/speech/voice-playback.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const synthesis = [], playback = [], progress = [];
  const controller = new AbortController();
  const result = playVoicePassages('A complete sentence for the voice assistant. '.repeat(24).trim(), {
    signal: controller.signal,
    synthesize(text, signal) {
      const pending = { ...deferred(), text, signal };
      synthesis.push(pending);
      return pending.promise;
    },
    play(audio, signal, onProgress) {
      const pending = { ...deferred(), audio, signal, onProgress };
      playback.push(pending);
      signal.addEventListener('abort', () => pending.reject(signal.reason), { once: true });
      return pending.promise;
    },
    onProgress: value => progress.push(value),
  });
  return { synthesis, playback, progress, controller, result };
}

test('the first passage plays before the rest is ready and synthesis stays one passage ahead', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.synthesis.length, 1);
  f.synthesis[0].resolve(new Blob([f.synthesis[0].text]));
  await flush();
  assert.equal(f.playback.length, 1, 'first audio starts without waiting for the rest of the answer');
  assert.equal(f.synthesis.length, 2, 'prepare the next passage during current playback');
  await flush();
  assert.equal(f.synthesis.length, 2, 'prefetch is bounded');
  for (let index = 0; index < f.synthesis.length; index++) {
    f.synthesis[index].resolve(new Blob([f.synthesis[index].text]));
    await flush();
    assert.equal(await f.playback[index].audio.text(), f.synthesis[index].text);
    f.playback[index].onProgress(0.5);
    f.playback[index].resolve();
    await flush();
  }
  await f.result;
  assert.equal(f.synthesis.map(item => item.text).join(' '), 'A complete sentence for the voice assistant. '.repeat(24).trim());
  assert.equal(f.progress.at(-1), 1);
  assert.ok(f.progress.every((value, index) => index === 0 || value >= f.progress[index - 1]));
});

test('interruption cancels prefetch and prevents late audio or progress from playing', async () => {
  const f = fixture();
  const rejected = assert.rejects(f.result, { name: 'AbortError' });
  await flush();
  f.synthesis[0].resolve(new Blob(['First passage']));
  await flush();
  f.controller.abort();
  await rejected;
  assert.equal(f.synthesis[1].signal.aborted, true);
  f.synthesis[1].resolve(new Blob(['Stale passage']));
  f.playback[0].onProgress(1);
  await flush();
  assert.equal(f.playback.length, 1);
  assert.deepEqual(f.progress, []);
});

test('a prefetched synthesis failure is handled and surfaces after current audio finishes', async () => {
  const f = fixture();
  const rejected = assert.rejects(f.result, /Synthesis failed/);
  await flush();
  f.synthesis[0].resolve(new Blob(['First passage']));
  await flush();
  f.synthesis[1].reject(new Error('Synthesis failed'));
  await flush();
  f.playback[0].resolve();
  await rejected;
  assert.equal(f.playback.length, 1);
});

test('playback failure cancels the queued request and observes a late rejection', async () => {
  const f = fixture();
  const rejected = assert.rejects(f.result, /Playback failed/);
  await flush();
  f.synthesis[0].resolve(new Blob(['First passage']));
  await flush();
  f.playback[0].reject(new Error('Playback failed'));
  await rejected;
  assert.equal(f.synthesis[1].signal.aborted, true);
  f.synthesis[1].reject(new Error('Late network error'));
  await flush();
});
