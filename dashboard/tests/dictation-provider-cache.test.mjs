import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/speech/dictation-provider-cache.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' });
const { createDictationProviderCache } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function fixture(options = {}) {
  const voices = []; let reclaim;
  const cache = createDictationProviderCache(async (microphone, selected, signal, onTranscript, onDisconnect, ready) => {
    if (!await selected) return null;
    const voice = { signal, microphone, callbacks: { onTranscript, onDisconnect }, listening: true, closed: 0, healthy: true, resets: 0,
      async close() { this.closed++; }, isHealthy() { return this.healthy && !signal.aborted; },
      setListening(value) { this.listening = value; }, setCallbacks(value) { this.callbacks = value; },
      setMicrophone(value) { this.microphone = value; }, resetTranscript() { this.resets++; },
      async finishTranscript() { return 'All final words.'; },
    };
    voices.push(voice); ready?.(); return voice;
  }, { watchIdle: discard => { reclaim = discard; return () => { reclaim = undefined; }; }, ...options });
  return { cache, voices, reclaim: () => reclaim?.(),
    open: (controller = new AbortController(), text = () => {}) => cache.open({}, Promise.resolve(true), controller.signal, text) };
}

test('a complete hold can reuse the muted connection with a fresh microphone and callbacks', async () => {
  const f = fixture(); const old = [], current = [];
  const firstController = new AbortController();
  const first = await f.open(firstController, text => old.push(text));
  await first.finishTranscript({ settleFinal: true }); await first.close();
  assert.equal(f.voices[0].listening, false); assert.equal(f.voices[0].callbacks.onTranscript, undefined);
  firstController.abort(); assert.equal(f.voices[0].signal.aborted, false, 'retired caller cannot abort the idle connection');
  const second = await f.open(undefined, (text, final) => current.push({ text, final }));
  assert.equal(f.voices.length, 1); assert.equal(f.voices[0].resets, 1); assert.equal(f.voices[0].listening, true);
  f.voices[0].callbacks.onTranscript('New words', true); assert.deepEqual(current, [{ text: 'New words', final: true }]); assert.deepEqual(old, []);
  await second.close(); assert.equal(f.voices[0].closed, 1, 'unfinished holds are never cached'); await f.cache.clear();
});

test('idle connections expire or yield to other audio/settings without opening more sessions', async () => {
  for (const mode of ['expire', 'reclaim']) {
    const f = fixture({ idleMs: 15 }); const voice = await f.open();
    await voice.finishTranscript({ settleFinal: true }); await voice.close();
    if (mode === 'reclaim') f.reclaim(); else await new Promise(resolve => setTimeout(resolve, 30));
    await f.cache.clear(); assert.equal(f.voices[0].closed, 1); assert.equal(f.voices[0].signal.aborted, true); assert.equal(f.voices.length, 1);
  }
});

test('cancellation, changed providers, unhealthy calls and another active voice never retain a session', async () => {
  for (const reason of ['cancel', 'provider', 'unhealthy', 'other']) {
    const f = fixture({ otherAudio: () => reason === 'other' }); const controller = new AbortController();
    const voice = await f.open(controller); await voice.finishTranscript({ settleFinal: true });
    if (reason === 'cancel') controller.abort();
    if (reason === 'unhealthy') f.voices[0].healthy = false;
    await voice.close();
    if (reason === 'provider') assert.equal(await f.cache.open({}, Promise.resolve(false), new AbortController().signal), null);
    await f.cache.clear(); assert.equal(f.voices[0].closed, 1); assert.equal(f.voices[0].listening, false);
  }
});

test('the provider slot stays leased while idle and until remote cleanup finishes', async () => {
  let holds = 0, released = 0, finishClose;
  const f = fixture({ holdFocus: () => { holds++; return () => { holds--; released++; }; } });
  const first = await f.open();
  await first.finishTranscript({ settleFinal: true }); await first.close();
  assert.equal(holds, 1, 'background warmups must not compete with the idle slot');
  const second = await f.open(); assert.equal(holds, 1, 'reuse transfers the existing lease');
  f.voices[0].close = () => new Promise(resolve => { finishClose = resolve; });
  const closing = second.close();
  await Promise.resolve(); assert.equal(holds, 1, 'the slot is still occupied during DELETE');
  finishClose(); await closing;
  assert.equal(holds, 0); assert.equal(released, 1);
  await f.cache.clear(); assert.equal(released, 1);
});

function preparedFixture() {
  let ready, preparations = 0, cold = 0;
  const prepared = new Promise(resolve => { ready = resolve; });
  const voice = { closed: 0, listening: false, microphone: undefined, callbacks: {}, healthy: true, resets: 0,
    async close() { this.closed++; }, isHealthy() { return this.healthy; },
    setListening(value) { this.listening = value; }, setCallbacks(value) { this.callbacks = value; },
    setMicrophone(value) { this.microphone = value; }, resetTranscript() { this.resets++; },
    async finishTranscript() { return 'Finished words.'; },
  };
  const cache = createDictationProviderCache(async () => { cold++; throw Error('Unexpected cold connection'); }, {
    idleMs: Infinity, prepare: async signal => { preparations++; voice.signal = signal; return prepared; },
  });
  return { cache, voice, ready: () => ready(voice), counts: () => ({ preparations, cold }) };
}

test('background preparation has no microphone and a ready shortcut adopts the same muted transport', async () => {
  const f = preparedFixture(), control = new AbortController();
  const warming = f.cache.prepare(control.signal); f.ready(); assert.equal(await warming, true);
  assert.equal(f.voice.microphone, undefined); assert.equal(f.voice.listening, false);
  for (let n = 0; n < 3; n++) assert.equal(await f.cache.prepare(control.signal), true);
  const microphone = {}, words = [];
  const held = await f.cache.open(microphone, Promise.resolve(true), new AbortController().signal, text => words.push(text));
  assert.deepEqual(f.counts(), { preparations: 1, cold: 0 });
  assert.equal(f.voice.microphone, microphone); assert.equal(f.voice.listening, true); assert.equal(f.voice.resets, 1);
  f.voice.callbacks.onTranscript('New words'); assert.deepEqual(words, ['New words']);
  assert.equal(await f.cache.prepare(control.signal), false, 'active dictation cannot allocate another standby');
  await held.finishTranscript({ settleFinal: true }); await held.close();
  assert.equal(f.voice.listening, false); assert.equal(f.voice.callbacks.onTranscript, undefined);
  await f.cache.clear(); assert.equal(f.voice.closed, 1);
});

test('a shortcut during warm-up shares the in-flight connection and completes readiness once', async () => {
  const f = preparedFixture();
  const warming = f.cache.prepare(new AbortController().signal);
  let ready = 0;
  const opening = f.cache.open({}, Promise.resolve(true), new AbortController().signal, undefined, undefined, () => ready++);
  f.ready(); await warming; const voice = await opening;
  assert.deepEqual(f.counts(), { preparations: 1, cold: 0 }); assert.equal(ready, 1);
  await voice.close(); await f.cache.clear(); assert.equal(f.voice.closed, 1);
});

test('closing while background setup is pending disposes a late connection instead of retaining it', async () => {
  const f = preparedFixture(); const warming = f.cache.prepare(new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  const closing = f.cache.clear(); f.ready(); await closing;
  assert.equal(await warming, false); assert.equal(f.voice.closed, 1); assert.equal(f.voice.signal.aborted, true);
  await f.cache.clear(); assert.equal(f.voice.closed, 1);
});

test('a dead standby reports failure for backoff instead of continuously allocating replacement sessions', async () => {
  const f = preparedFixture(); f.ready(); await f.cache.prepare(new AbortController().signal);
  f.voice.healthy = false;
  await assert.rejects(f.cache.prepare(new AbortController().signal), /background dictation connection ended/);
  assert.deepEqual(f.counts(), { preparations: 1, cold: 0 }); assert.equal(f.voice.closed, 1);
  await f.cache.clear();
});
