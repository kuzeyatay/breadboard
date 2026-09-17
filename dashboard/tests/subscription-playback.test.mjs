import test from 'node:test';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await esbuild.build({
  entryPoints: [fileURLToPath(new URL('../src/lib/speech/playback.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'esm',
  plugins: [{ name: 'voice-fixture', setup(build) {
    build.onResolve({ filter: /subscription-live|clap\/audio-focus/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('subscription-live')
      ? 'export const subscriptionSelected=async signal=>globalThis.voicePlaybackFixture.selected?.(signal) ?? true; export const connectSubscriptionVoice=options=>globalThis.voicePlaybackFixture.connect(options);'
      : 'export const holdForegroundAudio=()=>()=>{};' }));
  } }],
});
const { playSubscriptionText, stopSpeechPlayback } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('a superseded connection cannot start a second reader when it resolves late', async t => {
  const pending = [], spoken = [], closed = [], finished = [];
  globalThis.voicePlaybackFixture = { connect({ signal }) {
    return new Promise(resolve => pending.push({ signal, resolve }));
  } };
  t.after(() => { stopSpeechPlayback(); delete globalThis.voicePlaybackFixture; });
  const first = playSubscriptionText('Old message', () => finished.push('old'));
  await new Promise(resolve => setImmediate(resolve));
  const second = playSubscriptionText('New message', () => finished.push('new'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending[0].signal.aborted, true);
  const connection = id => ({ async close() { closed.push(id); }, async speak(text) { spoken.push(text); } });
  pending[1].resolve(connection('new'));
  await second;
  pending[0].resolve(connection('old'));
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(spoken, ['New message']);
  assert.deepEqual(finished, ['old', 'new']);
  assert.ok(closed.includes('old'));
});

test('stop cancels settings lookup as well as connection setup', async t => {
  let selected, connections = 0, finished = 0;
  globalThis.voicePlaybackFixture = {
    selected: () => new Promise(resolve => { selected = resolve; }),
    async connect() { connections++; },
  };
  t.after(() => { stopSpeechPlayback(); delete globalThis.voicePlaybackFixture; });
  const reading = playSubscriptionText('Cancelled before connecting', () => finished++);
  stopSpeechPlayback();
  selected(true);
  await reading;
  assert.equal(connections, 0);
  assert.equal(finished, 1);
});
test('a wholly silent notification retries once, releases the failed session, and keeps the completed reader', async t => {
  const events = [];
  let connections = 0;
  globalThis.voicePlaybackFixture = { async connect() {
    const id = ++connections;
    return { async close() { events.push(`close:${id}`); }, async release(reusable) { events.push(`release:${id}:${reusable}`); },
      async speak() { events.push(`speak:${id}`); if (id === 1) throw Object.assign(Error('silent'), { safeToRetry: true }); } };
  } };
  t.after(() => { stopSpeechPlayback(); delete globalThis.voicePlaybackFixture; });
  const result = new Promise(resolve => void playSubscriptionText('Notification', resolve));
  assert.equal(await result, undefined);
  assert.deepEqual(events, ['speak:1', 'close:1', 'speak:2', 'release:2:true']);
});

test('partial speech, uncertain failures and repeated silence cannot trigger repeated readings', async t => {
  t.after(() => { stopSpeechPlayback(); delete globalThis.voicePlaybackFixture; });
  for (const safeToRetry of [undefined, false, true]) {
    let connections = 0;
    const failure = Object.assign(Error('reading failed'), { safeToRetry });
    globalThis.voicePlaybackFixture = { async connect() {
      connections++;
      return { async close() {}, async speak() { throw failure; } };
    } };
    const result = new Promise(resolve => void playSubscriptionText('Notification', resolve));
    assert.equal(await result, failure);
    assert.equal(connections, safeToRetry === true ? 2 : 1);
  }
});

test('dismissing a notification during reconnection prevents late playback and releases the replacement', async t => {
  let releaseConnection, spoken = 0, closed = 0, connections = 0;
  globalThis.voicePlaybackFixture = { async connect() {
    const id = ++connections;
    if (id === 2) await new Promise(resolve => { releaseConnection = resolve; });
    return { async close() { closed++; }, stopSpeaking() {},
      async speak() { spoken++; throw Object.assign(Error('silent'), { safeToRetry: true }); } };
  } };
  t.after(() => { stopSpeechPlayback(); delete globalThis.voicePlaybackFixture; });
  const controller = new AbortController();
  const result = new Promise(resolve => void playSubscriptionText('Notification', resolve, controller.signal));
  while (!releaseConnection) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); releaseConnection();
  await result;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spoken, 1);
  assert.ok(closed >= 2);
});
