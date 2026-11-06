import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceDetector, detectVoiceFrame, closeVoiceDetector } from '../src/lib/speech/livekit-detector.ts';
import { createVoicePcmEncoder } from '../src/lib/speech/livekit-turns.ts';
import { createVoiceNarrationQueue, voiceSentenceBoundary } from '../src/lib/speech/voice-conversation.ts';
import { createRequire } from 'node:module';

// Reproduce the real desktop process, where Next has already loaded Sharp.
// Loading the whole LiveKit SDK here loads a second libvips DLL and fails.
createRequire(import.meta.url)('sharp');

const flush = () => new Promise(resolve => setImmediate(resolve));

test('LiveKit runs its native VAD, isolates users and rejects replayed audio', async () => {
  const id = await createVoiceDetector(501);
  try {
    await assert.rejects(detectVoiceFrame(502, id, 0, new Int16Array(1024)), { status: 404 });
    assert.deepEqual(await detectVoiceFrame(501, id, 0, new Int16Array(1024)), { events: [] });
    await assert.rejects(detectVoiceFrame(501, id, 0, new Int16Array(1024)), { status: 409 });
    await assert.rejects(detectVoiceFrame(501, id, 1, new Int16Array(15)), { status: 400 });
    for (let sequence = 1; sequence <= 12; sequence++) {
      // Room noise and a click must not become a spoken interruption.
      const pcm = Int16Array.from({ length: 1024 }, (_, i) => i === 0 ? 6000 : Math.sin(i * 0.17) * 35);
      assert.deepEqual(await detectVoiceFrame(501, id, sequence, pcm), { events: [] });
    }
  } finally { closeVoiceDetector(501, id); }
  await assert.rejects(detectVoiceFrame(501, id, 13, new Int16Array(1024)), { status: 404 });
});

test('voice admission is bounded and closing a session returns capacity', async () => {
  const a = await createVoiceDetector(601), b = await createVoiceDetector(601);
  try { await assert.rejects(createVoiceDetector(601), { status: 429 }); }
  finally { closeVoiceDetector(601, a); closeVoiceDetector(601, b); }
  const c = await createVoiceDetector(601); closeVoiceDetector(601, c);
});

test('PCM resampling preserves duration across non-integral capture frames and clamps clipping', () => {
  for (const sampleRate of [16000, 44100, 48000]) {
    const encode = createVoicePcmEncoder(sampleRate);
    const frames = [];
    for (let offset = 0; offset < sampleRate; offset += 2048) frames.push(...encode(new Float32Array(Math.min(2048, sampleRate - offset)).fill(2)));
    const count = frames.reduce((n, frame) => n + frame.length, 0);
    assert.equal(count, 15360);
    assert.ok(frames.every(frame => frame.every(sample => sample === 32767)));
  }
});

test('completed sentences speak during generation, do not replay, and final tail resumes listening once', async () => {
  const spoken = [], idle = [];
  const queue = createVoiceNarrationQueue({ startIndex: 0, streamAnswers: true,
    speak: async item => { if (item.text) spoken.push(item.text); }, onIdle: done => idle.push(done), onError: error => { throw error; } });
  const first = 'This is the first complete spoken sentence. ';
  assert.equal(queue.update([{ role: 'assistant', content: first + 'Next' }], true), false);
  await flush();
  assert.deepEqual(spoken, [first.trim()]);
  queue.update([{ role: 'assistant', content: first + 'Next comes the rest.' }], true);
  await flush();
  assert.deepEqual(spoken, [first.trim()]);
  assert.equal(queue.update([{ role: 'assistant', content: first + 'Next comes the rest.' }], false), true);
  await flush();
  assert.deepEqual(spoken, [first.trim(), 'Next comes the rest.']);
  assert.deepEqual(idle, [false, true]);
});

test('barge-in discards queued and late streamed sentences', async () => {
  const spoken = [], idle = [];
  let complete;
  const queue = createVoiceNarrationQueue({ startIndex: 0, streamAnswers: true,
    speak: (item, signal) => { spoken.push({ text: item.text, signal }); return new Promise(resolve => { complete = resolve; }); },
    onIdle: value => idle.push(value), onError: error => { throw error; } });
  const messages = [{ role: 'assistant', content: 'Here is the sentence currently playing. Another complete sentence waiting behind it. And the tail.' }];
  queue.update(messages, true);
  queue.cancel(); complete();
  await flush();
  queue.update(messages, false);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].signal.aborted, true);
  assert.deepEqual(idle, []);
});

test('streaming boundaries preserve unfinished math and code', () => {
  assert.equal(voiceSentenceBoundary('A short fragment with no punctuation'), 0);
  assert.equal(voiceSentenceBoundary('Here is code: ```\nconsole.log("long unfinished sentence. '), 0);
  assert.equal(voiceSentenceBoundary('This is the math expression $a long incomplete expression. '), 0);
  assert.equal(voiceSentenceBoundary('We spoke with the researcher Dr. Smith today. More'), 'We spoke with the researcher Dr. Smith today. '.length);
});
