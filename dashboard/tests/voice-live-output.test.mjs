import assert from 'node:assert/strict';
import test from 'node:test';
import { startLiveSpeechOutput } from '../src/lib/speech/live-output.ts';

function fixture() {
  const controller = new AbortController();
  const context = { state: 'running', async resume() { this.state = 'running'; } };
  const player = { paused: true, ended: false, muted: false, volume: 0, error: null,
    async play() { this.paused = false; } };
  let current = true;
  return { context, player, signal: controller.signal, controller,
    active: () => current, stop() { current = false; player.volume = 0; } };
}

test('a warmed paused output resumes before a reading is submitted', async () => {
  const f = fixture();
  f.context.state = 'suspended';
  f.player.muted = true;
  const calls = [];
  f.context.resume = async () => { calls.push('resume'); f.context.state = 'running'; };
  f.player.play = async () => { calls.push('play'); assert.equal(f.player.volume, 1); f.player.paused = false; };
  assert.equal(await startLiveSpeechOutput(f.context, f.player, f.active, f.signal), true);
  assert.deepEqual(calls, ['resume', 'play']);
  assert.equal(f.player.muted, false);
});

test('decoded remote audio cannot hide a refused or still-paused speaker', async () => {
  for (const reject of [false, true]) {
    const f = fixture();
    f.player.play = async () => { if (reject) throw new DOMException('blocked', 'NotAllowedError'); };
    await assert.rejects(startLiveSpeechOutput(f.context, f.player, f.active, f.signal),
      reject ? /enable audio playback/ : /stopped before playback/);
    assert.equal(f.player.volume, 0);
  }
});

test('interrupting while the output resumes cannot unmute or start a stale reply', async () => {
  const f = fixture();
  let resume;
  f.context.state = 'suspended';
  f.context.resume = () => new Promise(resolve => { resume = () => { f.context.state = 'running'; resolve(); }; });
  let played = false;
  f.player.play = async () => { played = true; };
  const started = startLiveSpeechOutput(f.context, f.player, f.active, f.signal);
  f.stop(); resume();
  assert.equal(await started, false);
  assert.equal(played, false);
  assert.equal(f.player.volume, 0);
});

test('a delayed play resolution cannot undo interruption', async () => {
  const f = fixture();
  let play;
  f.player.play = () => new Promise(resolve => { play = resolve; });
  const started = startLiveSpeechOutput(f.context, f.player, f.active, f.signal);
  f.stop(); play();
  assert.equal(await started, false);
  assert.equal(f.player.volume, 0);
});

test('a stuck output fails within two seconds instead of pretending the answer was spoken', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.player.play = () => new Promise(() => {});
  const started = startLiveSpeechOutput(f.context, f.player, f.active, f.signal);
  const rejected = assert.rejects(started, /could not start/);
  t.mock.timers.tick(2000);
  await rejected;
  assert.equal(f.player.volume, 0);
});

test('closing voice does not wait for a stuck speaker', async () => {
  const f = fixture();
  f.player.play = () => new Promise(() => {});
  const started = startLiveSpeechOutput(f.context, f.player, f.active, f.signal);
  f.controller.abort();
  assert.equal(await started, false);
  assert.equal(f.player.volume, 0);
});
