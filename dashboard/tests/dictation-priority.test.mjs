import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('standby reserves one remote slot without claiming voice priority; holds and expiry remain independent', async () => {
  const bundle = await build({ entryPoints: ['src/lib/speech/dictation-priority.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' });
  const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`;
  const originalWindow = globalThis.window, OriginalChannel = globalThis.BroadcastChannel, originalNow = Date.now;
  const channels = [], timers = []; let now = 0;
  globalThis.window = { addEventListener() {}, setInterval(fn) { timers.push(fn); } };
  globalThis.BroadcastChannel = class {
    constructor(name) { this.name = name; channels.push(this); }
    postMessage(data) { for (const other of channels) if (other !== this && other.name === this.name) queueMicrotask(() => other.onmessage?.({ data })); }
  };
  Date.now = () => now;
  try {
    const dictation = await import(url + '#dictation'), companion = await import(url + '#companion');
    const unsubscribe = companion.watchDictationPriority(() => {});
    const releaseStandby = dictation.reserveDictationStandby(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(companion.dictationStandbyReserved(), true);
    assert.equal(companion.dictationHasPriority(), false, 'warm transport must not pause an open voice conversation');
    const releaseHold = dictation.holdDictationPriority(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(companion.dictationHasPriority(), true);
    releaseHold(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(companion.dictationHasPriority(), false); assert.equal(companion.dictationStandbyReserved(), true);
    now = 16000;
    assert.equal(companion.dictationStandbyReserved(), false, 'a crashed renderer cannot reserve a provider slot forever');
    releaseStandby(); releaseStandby(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(dictation.dictationStandbyReserved(), false); unsubscribe();
  } finally { Date.now = originalNow; globalThis.window = originalWindow; globalThis.BroadcastChannel = OriginalChannel; }
});
