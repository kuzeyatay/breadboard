import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';

const bundle = await build({ entryPoints: ['src/lib/speech/dictation-worklet.ts'], bundle: true, write: false, format: 'esm' });
const { DICTATION_WORKLET_SOURCE } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { DictationAudioQueue, Processor } = vm.runInNewContext(DICTATION_WORKLET_SOURCE + ';({DictationAudioQueue,Processor:BreadboardDictationBuffer})', {
  Float32Array, sampleRate: 10, registerProcessor() {}, AudioWorkletProcessor: class { port = { postMessage: () => {} }; },
});

test('PCM captured before connection is preserved in order across callback sizes', () => {
  const queue = new DictationAudioQueue();
  const first = Float32Array.from([1, 2, 3]); queue.push(first); first.fill(0);
  queue.push(Float32Array.from([4, 5]));
  const frame = new Float32Array(4);
  assert.equal(queue.read(frame), 4); assert.deepEqual([...frame], [1, 2, 3, 4]);
  queue.push(Float32Array.from([6, 7]));
  assert.equal(queue.read(frame), 3); assert.deepEqual([...frame], [5, 6, 7, 0]);
  assert.equal(queue.length, 0); assert.equal(queue.read(frame), 0); assert.deepEqual([...frame], [0, 0, 0, 0]);
});

test('a long hold compacts consumed chunks and cancellation discards remaining audio', () => {
  const queue = new DictationAudioQueue(); const frame = new Float32Array(13); const observed = [];
  for (let i = 1; i <= 300; i++) queue.push(Float32Array.of(i));
  while (queue.length) observed.push(...frame.subarray(0, queue.read(frame)));
  assert.deepEqual(observed, Array.from({ length: 300 }, (_, i) => i + 1));
  queue.push(Float32Array.of(301)); queue.clear();
  assert.equal(queue.read(frame), 0); assert.equal(queue.length, 0);
});

test('audio thread retains startup speech, stops capture on release and drains the tail once', () => {
  const p = new Processor(), out = new Float32Array(4), events = [];
  p.port.postMessage = value => events.push(value);
  p.process([[Float32Array.of(1,2,3)]], [[out]]); assert.deepEqual([...out], [0,0,0,0]);
  p.port.onmessage({ data: 'start' }); p.process([[Float32Array.of(4,5)]], [[out]]);
  assert.deepEqual([...out], [1,2,3,4]);
  p.port.onmessage({ data: 'stop' }); p.port.onmessage({ data: 'finish' });
  p.process([[Float32Array.of(99,99)]], [[out]]); assert.deepEqual([...out], [5,0,0,0]);
  p.process([[]], [[out]]); p.process([[]], [[out]]); assert.deepEqual(events, ['drained']);
});

test('waiting silently for connection does not put seconds of silence ahead of the first words', () => {
  const p = new Processor(), out = new Float32Array(1);
  for (let i = 0; i < 100; i++) p.process([[Float32Array.of(0)]], [[out]]);
  p.port.onmessage({ data: 'start' });
  const heard = [];
  for (let i = 0; i < 8; i++) { p.process([[Float32Array.of(i + 1)]], [[out]]); heard.push(out[0]); }
  assert.ok(heard.indexOf(1) >= 0 && heard.indexOf(1) <= 2, 'the first word should follow at most 200ms of pre-roll, not the entire connection wait');
});
