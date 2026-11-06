// Run the production native detector on a supplied, non-private speech fixture.
// Usage: node scripts/test-livekit-voice-audio.mjs path/to/16k-mono-pcm.wav
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createVoiceDetector, detectVoiceFrame, closeVoiceDetector } from '../src/lib/speech/livekit-detector.ts';

assert.ok(process.argv[2], 'Supply a 16 kHz mono PCM16 WAV containing spoken words.');
const wav = fs.readFileSync(process.argv[2]);
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
let pcm;
for (let offset = 12; offset + 8 <= wav.length;) {
  const type = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4);
  const data = wav.subarray(offset + 8, offset + 8 + size);
  if (type === 'fmt ') {
    assert.equal(data.readUInt16LE(0), 1, 'PCM WAV required');
    assert.equal(data.readUInt16LE(2), 1, 'Mono WAV required');
    assert.equal(data.readUInt32LE(4), 16000, '16 kHz WAV required');
    assert.equal(data.readUInt16LE(14), 16, '16-bit WAV required');
  }
  if (type === 'data') pcm = Int16Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2));
  offset += 8 + size + size % 2;
}
assert.ok(pcm?.length, 'WAV must contain audio');
const padded = new Int16Array(Math.ceil((8000 + pcm.length + 24000) / 1024) * 1024);
padded.set(pcm, 8000);
const audibleStart = padded.findIndex(sample => Math.abs(sample) > 300);
const audibleEnd = padded.findLastIndex(sample => Math.abs(sample) > 300);
assert.ok(audibleStart >= 0, 'Fixture must contain audible speech');
const started = performance.now(), id = await createVoiceDetector(97531);
const setupMs = performance.now() - started, events = [];
const processingStarted = performance.now();
try {
  for (let offset = 0, sequence = 0; offset < padded.length; offset += 1024, sequence++) {
    const result = await detectVoiceFrame(97531, id, sequence, padded.slice(offset, offset + 1024));
    events.push(...result.events);
  }
} finally { closeVoiceDetector(97531, id); }
const processingMs = performance.now() - processingStarted;
const starts = events.filter(event => event.type === 'speech-start'), ends = events.filter(event => event.type === 'speech-end');
assert.ok(starts.length > 0, 'Native LiveKit must recognize spoken words');
assert.equal(ends.length, starts.length, 'Every utterance must end after trailing silence');
const startDetectionMs = (starts[0].sample - audibleStart) / 16;
const endDetectionMs = (ends.at(-1).sample - audibleEnd) / 16;
assert.ok(startDetectionMs >= 0 && startDetectionMs < 1000, 'Speech must be detected promptly');
assert.ok(endDetectionMs >= 0 && endDetectionMs < 1500, 'Turn must finish promptly after silence');
const audioMs = padded.length / 16;
assert.ok(processingMs < audioMs, 'Native inference must keep up with real time');
console.log(JSON.stringify({ test: 'native LiveKit speech fixture', setupMs: Math.round(setupMs),
  audioMs, processingMs: Math.round(processingMs), startDetectionMs, endDetectionMs, utterances: starts.length, passed: true }));
