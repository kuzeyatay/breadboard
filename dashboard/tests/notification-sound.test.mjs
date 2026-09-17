import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';

const code = transformSync(fs.readFileSync(new URL('../src/lib/notification-sound.ts', import.meta.url), 'utf8'), {
  loader: 'ts', format: 'cjs',
}).code;

test('a card that fades in still chimes, and an unfocused desktop window is not muted', () => {
  // Cards materialize from opacity 0, so every check made while one mounts
  // reads it as hidden. The end of that entrance must be checked again.
  const toast = fs.readFileSync(new URL('../src/app/components/toast.tsx', import.meta.url), 'utf8');
  assert.match(toast, /host\.addEventListener\('animationend', announce\);/);
  assert.match(toast, /host\.removeEventListener\('animationend', announce\);/);
  // Answers usually finish while the person is in another app or the voice
  // companion; focus must not silence the overlay that shows the card.
  const shell = fs.readFileSync(new URL('../../desktop/src/main/tab-manager.ts', import.meta.url), 'utf8');
  const audible = shell.match(/const audible = [^;]+;/)?.[0] ?? '';
  assert.match(audible, /isVisible\(\) && !host\.window\.isMinimized\(\)/);
  assert.doesNotMatch(audible, /isFocused/);
});

function fixture({ deferredLock = false, deferredAudio = false } = {}) {
  const stored = new Map();
  const locks = [];
  const contexts = [];
  const resumes = [];
  let notes = 0;
  const window = {
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    setTimeout: () => 1, clearTimeout() {}, dispatchEvent() {},
    AudioContext: class {
      state = 'running'; currentTime = 0; destination = {};
      constructor() { contexts.push(this); }
      resume() { return deferredAudio ? new Promise(resolve => resumes.push(resolve)) : Promise.resolve(); }
      async close() { this.state = 'closed'; }
      createOscillator() { return { frequency: { setValueAtTime() {} }, connect: node => node, start() { notes++; }, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, window, Event, Date, navigator: {
    locks: { request: async (_key, callback) => { if (deferredLock) locks.push(callback); else callback(); } },
  } });
  return { ...module.exports, stored, contexts, locks, resumes, notes: () => notes };
}

test('only visible notifications claim sound receipts; duplicates and muted backlogs stay silent', async () => {
  const f = fixture();
  f.chimeForNotifications(['hidden'], () => false);
  assert.equal(f.stored.size, 0);
  assert.equal(f.contexts.length, 0);
  f.chimeForNotifications(['shown'], () => true);
  await Promise.resolve();
  assert.equal(f.notes(), 2);
  f.chimeForNotifications(['shown'], () => true);
  assert.equal(f.contexts.length, 1);
  f.setNotificationSoundEnabled(false);
  f.chimeForNotifications(['muted'], () => true);
  f.setNotificationSoundEnabled(true);
  f.chimeForNotifications(['muted'], () => true);
  assert.equal(f.contexts.length, 1);
});

test('dismissal while waiting for another window cannot claim or play a sound', () => {
  const f = fixture({ deferredLock: true });
  let visible = true;
  f.chimeForNotifications(['gone'], () => visible);
  visible = false;
  f.locks.shift()();
  assert.equal(f.contexts.length, 0);
  assert.equal(f.stored.size, 0);
  const cancel = f.chimeForNotifications(['unmounted'], () => true);
  cancel();
  f.locks.shift()();
  assert.equal(f.contexts.length, 0);
  assert.equal(f.stored.size, 0);
});

for (const cancel of [false, true]) {
  test(`audio resuming after ${cancel ? 'unmount' : 'hiding'} cannot produce a ghost chime`, async () => {
    const f = fixture({ deferredAudio: true });
    let visible = true;
    const stop = f.chimeForNotifications(['gone'], () => visible);
    if (cancel) stop(); else visible = false;
    f.resumes.shift()();
    await Promise.resolve();
    assert.equal(f.notes(), 0);
    assert.equal(f.contexts[0].state, 'closed');
  });
}
