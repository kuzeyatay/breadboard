import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/speech/dictation-standby.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' });
const { createDictationStandby } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  let now = 0, selected = true, blocked = false, prepares = 0, clears = 0, reserved = 0, selections = 0;
  const standby = createDictationStandby({
    now: () => now, select: async () => { selections++; return selected; },
    blocked: () => blocked, prepare: async () => { prepares++; return true; },
    clear: async () => { clears++; }, reserve: () => { reserved++; return () => reserved--; }, ...overrides,
  });
  return { standby, time: value => { now = value; }, blocked: value => { blocked = value; }, selected: value => { selected = value; },
    counts: () => ({ prepares, clears, reserved, selections }) };
}

test('standby starts before a shortcut and holds one reservation without microphone or foreground focus', async () => {
  const f = fixture(); await f.standby.sync(); await f.standby.sync();
  assert.deepEqual(f.counts(), { prepares: 2, clears: 0, reserved: 1, selections: 1 });
  f.blocked(true); await f.standby.sync();
  assert.equal(f.counts().clears, 1); assert.equal(f.counts().prepares, 2);
  f.blocked(false); await f.standby.sync(); assert.equal(f.counts().prepares, 3);
  await f.standby.close(); assert.equal(f.counts().reserved, 0);
  await f.standby.sync(); assert.equal(f.counts().prepares, 3);
});

test('provider changes close the old standby and disabling speech stops allocations', async () => {
  const f = fixture(); await f.standby.sync();
  f.selected(false); await f.standby.invalidate();
  assert.equal(f.counts().reserved, 0); assert.equal(f.counts().prepares, 1);
  await f.standby.sync(); assert.equal(f.counts().selections, 2);
  f.selected(true); await f.standby.invalidate(); assert.equal(f.counts().prepares, 2);
  await f.standby.close();
});

test('failed background connections back off exponentially and never retry on every timer tick', async () => {
  let attempts = 0, failing = true;
  const f = fixture({ prepare: async () => { attempts++; if (failing) throw Error('Unavailable'); return true; } });
  await f.standby.sync(); assert.equal(attempts, 1);
  for (const time of [1000, 10000, 29999]) { f.time(time); await f.standby.sync(); }
  assert.equal(attempts, 1);
  f.time(30000); await f.standby.sync(); assert.equal(attempts, 2);
  f.time(89999); await f.standby.sync(); assert.equal(attempts, 2);
  failing = false; f.time(90000); await f.standby.sync(); assert.equal(attempts, 3);
  f.time(150000); await f.standby.sync(); // Healthy for a full minute resets backoff.
  failing = true; await f.standby.sync(); assert.equal(attempts, 5);
  f.time(180000); await f.standby.sync(); assert.equal(attempts, 6);
  await f.standby.close();
});

test('actual audio activity cancels a pending warm-up and cleanup never permits overlapping retries', async () => {
  const setup = deferred(), cleanup = deferred(); let signal, count = 0;
  const f = fixture({ prepare: async current => { count++; signal = current; await setup.promise; return true; }, clear: () => cleanup.promise });
  const first = f.standby.sync(); await new Promise(resolve => setImmediate(resolve));
  const duplicate = f.standby.sync(); assert.equal(count, 1);
  f.blocked(true); const yielding = f.standby.sync(); assert.equal(signal.aborted, true);
  f.blocked(false); const queued = f.standby.sync(); assert.equal(count, 1);
  setup.resolve(); cleanup.resolve(); await Promise.all([first, duplicate, yielding, queued]);
  await f.standby.sync(); assert.equal(count, 2);
  await f.standby.close();
});

test('a stale settings result cannot restart standby after settings change or shutdown', async () => {
  const selected = deferred(); let first = true;
  const f = fixture({ select: () => first ? (first = false, selected.promise) : Promise.resolve(false) });
  const starting = f.standby.sync(); await new Promise(resolve => setImmediate(resolve));
  const invalidating = f.standby.invalidate(); selected.resolve(true);
  await Promise.all([starting, invalidating]);
  assert.equal(f.counts().prepares, 0); assert.equal(f.counts().reserved, 0);
  await f.standby.close();
});

test('disabled or signed-out settings release the standby reservation even when selection rejects', async () => {
  let enabled = true;
  const f = fixture({ select: async () => { if (!enabled) throw Error('Speech is turned off'); return true; } });
  await f.standby.sync(); assert.equal(f.counts().reserved, 1);
  enabled = false; await f.standby.invalidate();
  assert.equal(f.counts().reserved, 0); assert.equal(f.counts().prepares, 1);
  await f.standby.close();
});
