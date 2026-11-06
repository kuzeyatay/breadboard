import assert from 'node:assert/strict';
import test from 'node:test';
import { playVoiceCue } from '../src/lib/speech/voice-cues.ts';

function audioFixture(t, suspended = false) {
  const contexts = [];
  const previous = Object.fromEntries(['window', 'AudioContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  globalThis.window = {};
  globalThis.AudioContext = class {
    state = suspended ? 'suspended' : 'running'; currentTime = 10; destination = {}; notes = []; gains = [];
    constructor() { contexts.push(this); }
    createOscillator() {
      const note = {}; this.notes.push(note);
      return { frequency: { setValueAtTime: value => note.frequency = value }, connect() {},
        start: at => note.start = at, stop: at => note.stop = at };
    }
    createGain() {
      return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {},
        linearRampToValueAtTime: value => this.gains.push(value) } };
    }
    resume() { return new Promise(resolve => { this.release = () => { if (this.state !== 'closed') this.state = 'running'; resolve(); }; }); }
    async close() { this.state = 'closed'; }
  };
  return contexts;
}

test('four distinct short quiet cues clean up their own audio without touching voice capture', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const contexts = audioFixture(t);
  for (const cue of ['open', 'enable', 'stop', 'close']) playVoiceCue(cue);
  assert.deepEqual(contexts.map(context => context.notes.map(note => note.frequency)), [[440, 660], [740], [370], [660, 440]]);
  for (const context of contexts) {
    assert.ok(context.notes.every(note => note.stop - note.start <= 0.081));
    assert.ok(context.gains.every(gain => gain > 0 && gain <= 0.04));
  }
  t.mock.timers.tick(250);
  assert.ok(contexts.every(context => context.state === 'closed'));
});

test('autoplay refusal cannot produce a stale cue when the user later enables audio', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const contexts = audioFixture(t, true);
  playVoiceCue('open');
  t.mock.timers.tick(250);
  contexts[0].release(); await Promise.resolve();
  assert.deepEqual(contexts[0].notes, []);
  assert.equal(contexts[0].state, 'closed');
});
