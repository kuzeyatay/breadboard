import assert from 'node:assert/strict';
import test from 'node:test';
import { connectLiveKitTurnDetector } from '../src/lib/speech/livekit-turn-client.ts';
import { LIVEKIT_MAX_BATCH_SAMPLES } from '../src/lib/speech/livekit-turns.ts';

test('LiveKit catches up after a short transport stall without losing audio or exceeding wire limits', async () => {
  const original = globalThis.fetch;
  const batches = [], errors = [], events = [];
  let release, deleted = 0;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, init) => {
    if (init.method === 'POST') return Response.json({ id: 'fixture' });
    if (init.method === 'DELETE') { deleted++; return Response.json({ closed: true }); }
    const sequence = Number(new URL(url, 'http://localhost').searchParams.get('sequence'));
    const samples = [...new Int16Array(init.body)];
    batches.push({ sequence, samples });
    if (sequence === 0) await gate;
    return Response.json({ events: [{ type: 'speech-start', sample: sequence * 1024 }] });
  };
  let detector;
  try {
    detector = await connectLiveKitTurnDetector({ sampleRate: 16000, signal: new AbortController().signal,
      onError: error => errors.push(error), onEvent: event => events.push(event) });
    for (let index = 1; index <= 21; index++) detector.push(new Float32Array(1024).fill(index / 32));
    assert.deepEqual(errors, [], 'a 1.3-second backlog must not permanently disable interruptions');
    assert.equal(batches.length, 1, 'requests remain sequential');
    release();
    for (let tries = 0; tries < 20 && events.length < 4; tries++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(batches.map(batch => batch.sequence), [0, 1, 2, 3]);
    assert.ok(batches.every(batch => batch.samples.length <= LIVEKIT_MAX_BATCH_SAMPLES));
    const samples = batches.flatMap(batch => batch.samples);
    assert.equal(samples.length, 21 * 1024);
    for (let index = 0; index < 21; index++) {
      assert.ok(samples.slice(index * 1024, (index + 1) * 1024).every(value => value === Math.round((index + 1) / 32 * 32767)), 'no audio is dropped or reordered');
    }
    assert.deepEqual(errors, []);
    detector.close(); assert.equal(deleted, 1);
  } finally { release(); detector?.close(); globalThis.fetch = original; }
});

test('LiveKit still bounds a permanently stalled queue and ignores late boundary events', async () => {
  const original = globalThis.fetch;
  const errors = [], events = [];
  let release, deleted = 0;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'POST') return Response.json({ id: 'fixture' });
    if (init.method === 'DELETE') { deleted++; return Response.json({ closed: true }); }
    await gate; return Response.json({ events: [{ type: 'speech-start', sample: 1024 }] });
  };
  try {
    const detector = await connectLiveKitTurnDetector({ sampleRate: 16000, signal: new AbortController().signal,
      onError: error => errors.push(error), onEvent: event => events.push(event) });
    for (let index = 0; index < 60; index++) detector.push(new Float32Array(1024));
    assert.equal(errors.length, 1); assert.equal(deleted, 1);
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, []);
    detector.close(); assert.equal(deleted, 1);
  } finally { release(); globalThis.fetch = original; }
});


test('a stalled detector reconnects with a fresh sequence and never replays stale boundaries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [], events = [], errors = [];
  let starts = 0, release;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, method: init.method });
    if (init.method === 'POST') return Response.json({ id: String(++starts) });
    if (init.method === 'DELETE') return Response.json({});
    if (url.includes('id=1')) await new Promise(resolve => { release = resolve; });
    return Response.json({ events: [{ type: 'speech-start', sample: 1024 }] });
  });
  const controller = new AbortController();
  const detector = await connectLiveKitTurnDetector({ sampleRate: 16000, signal: controller.signal,
    onEvent: event => events.push(event), onError: error => errors.push(error) });
  t.after(() => detector.close());
  for (let index = 0; index < 30; index++) detector.push(new Float32Array(1024));
  assert.equal(detector.ready, false); assert.equal(errors.length, 1);
  t.mock.timers.tick(500);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(detector.ready, true); assert.equal(starts, 2);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, []);
  detector.push(new Float32Array(1024)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.ok(requests.some(r => r.method === 'PUT' && r.url.includes('id=2&sequence=0')));
  controller.abort(); t.mock.timers.tick(30_000);
  assert.equal(detector.ready, false); assert.equal(starts, 2);
});

test('a cold detector failure recovers without reopening and close cancels retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method === 'POST') return ++attempts === 1 ? Response.json({ error: 'Model unavailable' }, { status: 503 }) : Response.json({ id: 'ready' });
    return Response.json({});
  });
  const detector = await connectLiveKitTurnDetector({ sampleRate: 48000, signal: new AbortController().signal, onEvent() {}, onError() {} });
  assert.equal(detector.ready, false);
  t.mock.timers.tick(500); await new Promise(resolve => setImmediate(resolve));
  assert.equal(detector.ready, true);
  detector.close(); t.mock.timers.tick(30_000); assert.equal(attempts, 2);
});

test('a delayed inference response enables acoustic interruption while preserving ordered audio', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 10000 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const batches = [], errors = [], events = [];
  let deleted = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'POST') return Response.json({ id: 'lagging' });
    if (init.method === 'DELETE') { deleted++; return Response.json({}); }
    const sequence = Number(new URL(url, 'http://localhost').searchParams.get('sequence'));
    batches.push({ sequence, samples: new Int16Array(init.body).length });
    if (sequence === 0) await gate;
    return Response.json({ events: [{ type: 'speech-start', sample: sequence * 1024 }] });
  });
  const detector = await connectLiveKitTurnDetector({ sampleRate: 16000, signal: new AbortController().signal,
    onError: error => errors.push(error), onEvent: event => events.push(event) });
  t.after(() => { release(); detector.close(); });
  t.mock.timers.tick(10000);
  assert.equal(detector.ready, true, 'an idle microphone has no pending inference delay');
  detector.push(new Float32Array(1024));
  t.mock.timers.tick(100);
  assert.equal(detector.ready, true, 'a normal response still uses native detection');
  t.mock.timers.tick(150);
  assert.equal(detector.ready, false, 'a lagging native response must not block local interruption');
  for (let i = 0; i < 12; i++) detector.push(new Float32Array(1024));
  assert.equal(batches.length, 1, 'the diagnostic fallback does not race PCM requests');
  assert.deepEqual(errors, []);
  assert.equal(deleted, 0, 'a temporary delay does not tear down the detector');
  release();
  for (let i = 0; i < 20 && !detector.ready; i++) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(detector.ready, true);
  assert.deepEqual(batches.map(batch => batch.sequence), [0, 1, 2]);
  assert.equal(batches.reduce((sum, batch) => sum + batch.samples, 0), 13 * 1024);
  assert.equal(events.length, 3);
  assert.deepEqual(errors, []);
  detector.close();
  assert.equal(detector.ready, false);
  assert.equal(deleted, 1);
});


test('recovering a transport response cannot hide the remaining microphone backlog', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 10000 });
  const gates = [], batches = [], errors = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'POST') return Response.json({ id: 'backlog' });
    if (init.method === 'DELETE') return Response.json({});
    batches.push(new Int16Array(init.body).length);
    await new Promise(resolve => gates.push(resolve));
    return Response.json({ events: [] });
  });
  const detector = await connectLiveKitTurnDetector({ sampleRate: 16000, signal: new AbortController().signal,
    onEvent() {}, onError: error => errors.push(error) });
  t.after(() => { detector.close(); for (const resolve of gates) resolve(); });
  detector.push(new Float32Array(1024));
  t.mock.timers.tick(250);
  for (let i = 0; i < 12; i++) detector.push(new Float32Array(1024));
  assert.equal(detector.ready, false);
  gates.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(detector.ready, false, '768 ms of old audio still needs inference after the first response');
  gates.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(detector.ready, false, 'the final in-flight 256 ms batch is still behind the live microphone');
  gates.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(detector.ready, true, 'native detection resumes once it has caught up');
  assert.deepEqual(batches, [1024, 8192, 4096]);
  assert.deepEqual(errors, [], 'catch-up preserves the connection and every ordered audio frame');
});
