import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/speech/hold-dictation.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' });
const { HoldDictationRecorder } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const reports = [], statuses = [], stopped = [], recordings = [], stages = [];
  const track = new EventTarget();
  const stream = { getAudioTracks: () => [track] };
  const deps = {
    microphone: async () => stream,
    stopStream: value => { if (value) stopped.push(value); },
    recorder: () => {
      const recorder = { state: 'inactive', mimeType: 'audio/webm',
        start() { this.state = 'recording'; },
        stop() { this.state = 'inactive'; queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(['recorded audio']) }); this.onstop?.();
        }); } };
      recordings.push(recorder); return recorder;
    },
    transcribe: async () => 'Café 世界',
    ...overrides,
  };
  const recorder = new HoldDictationRecorder(notice => reports.push(notice), (...status) => statuses.push(status), deps, undefined, (id, stage) => stages.push({ id, stage }));
  return { recorder, reports, statuses, stopped, recordings, track, stream, stages };
}

test('hold records, release closes the microphone before transcription and returns Unicode text once', async () => {
  const f = fixture(); await f.recorder.start(1);
  assert.equal(f.recordings[0].state, 'recording'); assert.equal(f.reports.length, 0);
  f.recorder.stop(1); f.recorder.stop(1);
  assert.equal(f.stopped.length, 1);
  await tick(); assert.deepEqual(f.reports, [{ type: 'result', id: 1, text: 'Café 世界', submit: false }]);
});
test('release while permission is pending stops the late stream and never records', async () => {
  const mic = deferred(); const f = fixture({ microphone: () => mic.promise });
  const start = f.recorder.start(1); f.recorder.stop(1); mic.resolve(f.stream); await start;
  assert.equal(f.recordings.length, 0); assert.equal(f.stopped.length, 1);
  assert.equal(f.reports[0].type, 'error');
});
test('cancelled transcription cannot insert into a new focus or newer session', async () => {
  const result = deferred(); let signal;
  const f = fixture({ transcribe: async (_blob, s) => { signal = s; return result.promise; } });
  await f.recorder.start(1); f.recorder.stop(1); await tick(); f.recorder.cancel(1);
  assert.equal(signal.aborted, true);
  await f.recorder.start(2); result.resolve('stale text'); await tick();
  assert.equal(f.reports.length, 0); assert.equal(f.recordings[1].state, 'recording'); f.recorder.cancel();
});
test('old stop/cancel events cannot affect a newer hold', async () => {
  const f = fixture(); await f.recorder.start(1); await f.recorder.start(2);
  f.recorder.stop(1); f.recorder.cancel(1);
  assert.equal(f.recordings[1].state, 'recording');
  f.recorder.stop(2); await tick(); assert.equal(f.reports.length, 1); assert.equal(f.reports[0].id, 2);
});
test('microphone denial and device removal show actionable errors and release resources', async () => {
  const denied = fixture({ microphone: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  await denied.recorder.start(1); assert.match(denied.reports[0].message, /Allow microphone access/);
  const removed = fixture(); await removed.recorder.start(2); removed.track.dispatchEvent(new Event('ended')); await tick();
  assert.equal(removed.stopped.length, 1); assert.equal(removed.reports[0].type, 'error');
  assert.match(removed.reports[0].message, /disconnected/);
});
test('cancelling while recording releases microphone without sending any audio for transcription', async () => {
  let calls = 0; const f = fixture({ transcribe: async () => { calls++; return 'unexpected'; } });
  await f.recorder.start(1); f.recorder.cancel(); await tick();
  assert.equal(calls, 0); assert.equal(f.stopped.length, 1); assert.equal(f.reports.length, 0);
});

test('spoken send command is stripped and submitted only once after release', async () => {
  const f = fixture({ transcribe: async () => 'Hello there. Send message. Send message!' });
  await f.recorder.start(7); f.recorder.stop(7); f.recorder.stop(7); await tick();
  assert.deepEqual(f.reports, [{ type: 'result', id: 7, text: 'Hello there.', submit: true }]);
});

test('file fallback retains the entire hold, including its first words', async () => {
  const response = deferred(); let recordedAudio;
  const f = fixture({ transcribe: async blob => { recordedAudio = await blob.text(); return response.promise; } });
  await f.recorder.start(1);
  f.recordings[0].ondataavailable({ data: new Blob(['first words ']) });
  assert.equal(recordedAudio, undefined);
  f.recorder.stop(1); await tick();
  assert.equal(recordedAudio, 'first words recorded audio');
  assert.equal(f.stopped.length, 1);
  response.resolve('First words. Send message.'); await tick();
  assert.deepEqual(f.reports, [{ type: 'result', id: 1, text: 'First words.', submit: true }]);
});

function liveFixture(options = {}) {
  const calls = [], opened = deferred(), drained = deferred(), final = deferred(), closed = deferred();
  let disconnect, transcript, inputReady;
  const buffered = { stream: {}, start: () => calls.push('stream'), stopCapture: () => calls.push('stop-capture'),
    finish: () => { calls.push('drain'); return drained.promise; }, close: () => calls.push('close-buffer') };
  const voice = { isHealthy: () => true, close: () => { calls.push('close-voice'); return closed.promise; },
    finishTranscript: options => { assert.equal(options?.settleFinal, true); calls.push('final'); return final.promise; } };
  const f = fixture({
    selectProvider: async () => true,
    buffer: () => buffered,
    openProvider: async (stream, selected, signal, onDisconnect, onTranscript, onInputReady) => {
      assert.equal(stream, buffered.stream); assert.equal(await selected, true); assert.equal(signal.aborted, false);
      disconnect = onDisconnect; transcript = onTranscript; inputReady = onInputReady; calls.push('connect'); return opened.promise;
    },
    transcribe: async blob => { calls.push('fallback:' + await blob.text()); return 'Backup words. Send message.'; },
    ...options,
  });
  return { ...f, calls, opened, drained, final, closed, voice, buffered, disconnect: () => disconnect(), transcript: (text, final) => transcript(text, final), inputReady: () => inputReady() };
}

test('release while Web Audio starts still drains the same hold without a parallel fallback', async () => {
  const f = liveFixture(), ready = deferred(); f.buffered.ready = ready.promise;
  const starting = f.recorder.start(12); await tick();
  f.recorder.stop(12); await tick(); assert.deepEqual(f.calls, ['stop-capture']);
  ready.resolve(); await starting; f.opened.resolve(f.voice); await tick();
  assert.ok(f.calls.includes('drain')); f.drained.resolve(); f.final.resolve('The complete hold.'); f.closed.resolve(); await tick();
  assert.deepEqual(f.reports, [{ type: 'result', id: 12, text: 'The complete hold.', submit: false }]);
  assert.equal(f.calls.some(c => c.startsWith('fallback:')), false);
  assert.equal(f.statuses.at(-1)[1], false, 'late audio readiness must not reopen the recording UI');
});

test('buffered speech starts on input readiness and ignores late notifications after cancellation', async () => {
  const f = liveFixture(); await f.recorder.start(11); await tick();
  assert.equal(f.stages.some(event => event.stage.endsWith('-ready') && event.stage !== 'capture-ready' && event.stage !== 'microphone-ready'), false, 'capturing alone does not finish the loading state');
  f.inputReady(); assert.deepEqual(f.calls, ['connect', 'stream']);
  assert.deepEqual(f.stages.at(-1), { id: 11, stage: 'provider-ready' });
  f.recorder.cancel(); const count = f.calls.length; f.inputReady(); assert.equal(f.calls.length, count);
  assert.equal(f.stages.filter(event => event.stage === 'provider-ready').length, 1, 'late readiness cannot reopen a cancelled loading state');
  f.opened.resolve(f.voice); f.closed.resolve(); await tick();
});

test('local capture and unavailable live transport stop loading while the backup recorder remains active', async () => {
  for (const options of [{}, { openProvider: async () => null }, { openProvider: async () => { throw Error('Connection unavailable'); } }, { buffer: () => { throw Error('Web Audio unavailable'); } }]) {
    const f = Object.keys(options).length ? liveFixture(options) : fixture();
    await f.recorder.start(13); await tick();
    assert.ok(f.stages.some(event => event.id === 13 && event.stage === 'recording-ready'));
    assert.equal(f.recordings[0].state, 'recording');
    f.recorder.cancel(); await tick();
  }
});

test('live words and corrections appear during the hold and a complete send command submits immediately', async () => {
  const f = liveFixture(); await f.recorder.start(9); f.opened.resolve(f.voice); await tick();
  for (const text of ['Hello', 'Hello', 'Hello there', 'Hello café.', 'Hello café. Send']) f.transcript(text);
  assert.deepEqual(f.reports, ['Hello', 'Hello there', 'Hello café.'].map(text => ({ type: 'preview', id: 9, text })));
  assert.equal(f.recordings[0].state, 'recording');
  f.transcript('Hello café! Send message.', false);
  assert.deepEqual(f.reports.at(-1), { type: 'result', id: 9, text: 'Hello café!', submit: true });
  assert.equal(f.recordings[0].state, 'inactive');
  assert.equal(f.calls.includes('final'), false, 'recognized command does not wait for a final turn');
  f.closed.resolve(); await tick();
  const count = f.reports.length; f.transcript('stale callback'); assert.equal(f.reports.length, count);
});

test('retracted previews and cancellation cannot insert stale or disconnected recognition', async () => {
  const f = liveFixture(); await f.recorder.start(10); f.opened.resolve(f.voice); await tick();
  f.transcript(''); f.transcript('Hello'); f.transcript(''); f.transcript('');
  assert.deepEqual(f.reports, [{ type: 'preview', id: 10, text: 'Hello' }, { type: 'preview', id: 10, text: '' }]);
  f.disconnect(); f.transcript('Disconnected words'); assert.equal(f.reports.length, 2);
  f.recorder.cancel(); f.transcript('Cancelled words'); f.closed.resolve(); await tick();
  assert.equal(f.reports.length, 2);
});

test('automatic punctuation in a spoken command is withheld and submits the live draft exactly once', async () => {
  const f = liveFixture(); await f.recorder.start(14); f.opened.resolve(f.voice); await tick();
  for (const text of ['Words appear', 'Words appear while speaking.', 'Words appear while speaking. Send.', 'Words appear while speaking. Send. Messag']) f.transcript(text);
  assert.deepEqual(f.reports, ['Words appear', 'Words appear while speaking.'].map(text => ({ type: 'preview', id: 14, text })));
  f.transcript('Words appear while speaking. Send. Message.');
  f.transcript('Words appear while speaking. Send. Message.');
  f.closed.resolve(); await tick();
  assert.deepEqual(f.reports.filter(report => report.type === 'result'), [{ type: 'result', id: 14, text: 'Words appear while speaking.', submit: true }]);
  assert.equal(f.calls.some(call => call.startsWith('fallback:')), false);
});

test('a recognized send command finishes synchronously while held or released, with or without a provider final', async () => {
  for (const released of [false, true]) for (const final of [false, true]) {
    const f = liveFixture(); await f.recorder.start(14); f.opened.resolve(f.voice); await tick();
    if (released) { f.recorder.stop(14); await tick(); }
    f.transcript('Keep every final word. Send message.', final);
    assert.deepEqual(f.reports.at(-1), { type: 'result', id: 14, text: 'Keep every final word.', submit: true }, 'Enter request is emitted in the recognition callback, before any pending promises resolve');
    f.transcript('Keep every final word. Send message.', true);
    f.transcript('More words after the command', false);
    assert.equal(f.stopped.length, 1);
    assert.deepEqual(f.reports.filter(n => n.type === 'finish'), [{ type: 'finish', id: 14 }]);
    // Closing the real buffer rejects a pending drain. This must use the
    // completed command, without replaying audio or dropping its final words.
    if (released) f.drained.reject(new Error('buffer closed'));
    await tick();
    assert.deepEqual(f.reports.filter(n => n.type === 'result'), [{ type: 'result', id: 14, text: 'Keep every final word.', submit: true }]);
    assert.equal(f.calls.includes('final'), false, 'command cleanup must not add a finalization wait to the next hold');
    assert.equal(f.calls.includes('close-voice'), true);
    assert.equal(f.calls.some(call => call.startsWith('fallback:')), false);
    f.recorder.stop(14); f.final.resolve('Keep every final word. Send message.'); f.closed.resolve(); await tick();
    assert.equal(f.reports.filter(n => n.type === 'result').length, 1);
  }
});

test('a send command bypasses unfinished provider setup and a delayed recorder stop event', async () => {
  const f = liveFixture(); await f.recorder.start(17); await tick();
  f.recordings[0].stop = function () { this.state = 'inactive'; };
  f.transcript('Keep the entire sentence. Send message.', false);
  assert.deepEqual(f.reports, [
    { type: 'finish', id: 17 },
    { type: 'result', id: 17, text: 'Keep the entire sentence.', submit: true },
  ]);
  f.opened.resolve(f.voice); f.closed.resolve(); await tick();
  f.recordings[0].onstop(); await tick();
  assert.equal(f.reports.filter(n => n.type === 'result').length, 1);
  assert.equal(f.calls.includes('final'), false);
  assert.equal(f.calls.some(c => c.startsWith('fallback:')), false);
});

test('completed interior or quoted command mentions do not stop dictation', async () => {
  const f = liveFixture(); await f.recorder.start(15); f.opened.resolve(f.voice); await tick();
  f.transcript('I will send message details tomorrow.', true);
  f.transcript('The button says "send message".', true);
  assert.equal(f.recordings[0].state, 'recording');
  assert.equal(f.reports.some(n => n.type === 'finish'), false);
  f.recorder.cancel(); f.transcript('Send message.', true); f.closed.resolve(); await tick();
  assert.equal(f.reports.some(n => n.type === 'finish'), false, 'cancellation still wins');
});

test('a send command arriving during finalization submits before provider cleanup settles', async () => {
  const f = liveFixture(); await f.recorder.start(16); f.opened.resolve(f.voice); await tick();
  f.recorder.stop(16); f.drained.resolve(); await tick();
  assert.equal(f.calls.filter(c => c === 'final').length, 1);
  f.transcript('Ready to send. Send message.', true); await tick();
  assert.deepEqual(f.reports.filter(n => n.type === 'result'), [{ type: 'result', id: 16, text: 'Ready to send.', submit: true }]);
  assert.equal(f.calls.filter(c => c === 'final').length, 1, 'cleanup shares the in-flight finalization');
  f.final.reject(new Error('Late cleanup timeout')); f.closed.resolve(); await tick();
  assert.equal(f.reports.filter(n => n.type === 'result').length, 1);
  assert.equal(f.calls.some(c => c.startsWith('fallback:')), false);
});

test('live transcription connects during the hold, drains on release and types without waiting for remote cleanup', async () => {
  const f = liveFixture(); await f.recorder.start(1); await tick();
  assert.deepEqual(f.calls, ['connect']);
  f.opened.resolve(f.voice); await tick();
  assert.deepEqual(f.calls, ['connect', 'stream']); assert.deepEqual(f.reports, []);
  f.recorder.stop(1); f.recorder.stop(1); await tick();
  assert.equal(f.stopped.length, 1); assert.deepEqual(f.calls.slice(-2), ['stop-capture', 'drain']);
  f.drained.resolve(); await tick(); assert.equal(f.calls.at(-1), 'final');
  f.final.resolve('First words. Send message.'); await tick();
  assert.deepEqual(f.reports, [{ type: 'result', id: 1, text: 'First words.', submit: true }]);
  assert.ok(f.calls.includes('close-buffer')); assert.ok(f.calls.includes('close-voice'));
  assert.equal(f.calls.some(c => c.startsWith('fallback:')), false);
  f.closed.resolve();
});

test('release during connection startup still streams buffered audio before finalizing', async () => {
  const f = liveFixture(); await f.recorder.start(2); f.recorder.stop(2); await tick();
  assert.deepEqual(f.reports, []); assert.equal(f.stopped.length, 1);
  f.opened.resolve(f.voice); await tick();
  assert.ok(f.calls.indexOf('stream') < f.calls.indexOf('drain'));
  f.drained.resolve(); f.final.resolve('All first words.'); f.closed.resolve(); await tick();
  assert.deepEqual(f.reports, [{ type: 'result', id: 2, text: 'All first words.', submit: false }]);
});

test('cancelling a connecting hold closes its late connection and never inserts', async () => {
  const f = liveFixture(); await f.recorder.start(3); await tick(); f.recorder.cancel();
  f.opened.resolve(f.voice); f.closed.resolve(); await tick();
  assert.ok(f.calls.includes('close-voice')); assert.ok(f.calls.includes('close-buffer'));
  assert.equal(f.calls.includes('stream'), false); assert.deepEqual(f.reports, []);
});

test('cancelling while audio drains or final text is pending never inserts or retries', async () => {
  for (const phase of ['drain', 'final']) {
    const f = liveFixture(); await f.recorder.start(4); f.opened.resolve(f.voice); await tick();
    f.recorder.stop(4); await tick();
    if (phase === 'final') { f.drained.resolve(); await tick(); }
    f.recorder.cancel(); f.drained.resolve(); f.final.resolve('Stale text. Send message.'); f.closed.resolve(); await tick();
    assert.deepEqual(f.reports, []); assert.ok(f.calls.includes('close-buffer'));
    assert.equal(f.calls.some(c => c.startsWith('fallback:')), false);
  }
});

test('failed, disconnected or empty live transcription retries the complete backup only after connection cleanup', async () => {
  for (const failure of ['connection', 'disconnect', 'empty', 'final']) {
    const f = liveFixture(); await f.recorder.start(5);
    f.recordings[0].ondataavailable({ data: new Blob(['first words ']) });
    if (failure === 'connection') f.opened.reject(new Error('offline')); else f.opened.resolve(f.voice);
    await tick();
    if (failure === 'disconnect') f.disconnect();
    f.recorder.stop(5); await tick();
    f.drained.resolve();
    if (failure === 'final') { await tick(); f.final.reject(new Error('lost')); } else f.final.resolve('');
    await tick();
    if (failure !== 'connection') assert.deepEqual(f.reports, []);
    f.closed.resolve(); await tick();
    assert.ok(f.calls.includes('fallback:first words recorded audio'));
    assert.deepEqual(f.reports, [{ type: 'result', id: 5, text: 'Backup words.', submit: true }]);
  }
});

test('a replacement hold captures immediately but waits for the cancelled connection to retire', async () => {
  for (const connected of [false, true]) {
    const f = liveFixture(); await f.recorder.start(1); await tick();
    if (connected) { f.opened.resolve(f.voice); await tick(); }
    await f.recorder.start(2); await tick();
    assert.equal(f.recordings[1].state, 'recording', 'new speech is buffered without waiting');
    assert.equal(f.calls.filter(call => call === 'connect').length, 1, 'old session still owns the provider slot');
    f.opened.resolve(f.voice); await tick();
    assert.equal(f.calls.filter(call => call === 'connect').length, 1, 'late connection must finish cleanup too');
    f.closed.resolve(); await tick();
    assert.equal(f.calls.filter(call => call === 'connect').length, 2);
    assert.deepEqual(f.reports, []); f.recorder.cancel();
  }
});

test('successful text is immediate but the next hold waits for remote cleanup', async () => {
  const f = liveFixture(); await f.recorder.start(1); f.opened.resolve(f.voice); await tick();
  f.recorder.stop(1); f.drained.resolve(); f.final.resolve('Complete words.'); await tick();
  assert.equal(f.reports[0].text, 'Complete words.');
  await f.recorder.start(2); await tick();
  assert.equal(f.calls.filter(call => call === 'connect').length, 1);
  f.closed.resolve(); await tick();
  assert.equal(f.calls.filter(call => call === 'connect').length, 2); f.recorder.cancel();
});

test('a cancelled queued hold never allocates another provider session', async () => {
  const f = liveFixture(); await f.recorder.start(1); f.opened.resolve(f.voice); await tick();
  await f.recorder.start(2); f.recorder.cancel(); f.closed.resolve(); await tick();
  assert.equal(f.calls.filter(call => call === 'connect').length, 1);
  assert.deepEqual(f.reports, []);
});

test('voice priority lasts through provider cleanup and is released on failure or cancellation', async () => {
  let held = 0;
  const f = liveFixture({ holdPriority: () => { held++; return () => held--; } });
  await f.recorder.start(20); assert.equal(held, 1);
  f.opened.resolve(f.voice); await tick();
  f.recorder.stop(20); f.drained.resolve(); f.final.resolve('All words.'); await tick();
  assert.equal(held, 1, 'the paused conversation cannot race remote cleanup');
  f.closed.resolve(); await tick(); assert.equal(held, 0);
  const denied = liveFixture({ holdPriority: () => { held++; return () => held--; } });
  await denied.recorder.start(21);
  denied.opened.reject(Object.assign(new Error('Voice connections are busy.'), { status: 429 })); await tick();
  assert.equal(denied.recordings[0].state, 'inactive');
  assert.deepEqual(denied.reports, [{ type: 'error', id: 21, message: 'Voice connections are busy.' }]);
  assert.equal(denied.calls.some(c => c.startsWith('fallback:')), false);
  assert.equal(held, 0);
});

test('voice remains paused while backup transcription uses the released provider slot', async () => {
  for (const cancel of [false, true]) {
    let held = 0;
    const backup = deferred();
    const f = liveFixture({ holdPriority: () => { held++; return () => held--; },
      transcribe: async () => { assert.equal(held, 1); return backup.promise; } });
    await f.recorder.start(22); f.opened.resolve(f.voice); await tick();
    f.recorder.stop(22); f.drained.resolve(); f.final.resolve(''); f.closed.resolve(); await tick();
    assert.equal(held, 1, 'closing the live connection must not resume the conversation');
    if (cancel) { f.recorder.cancel(); await tick(); assert.equal(held, 0); }
    backup.resolve('Complete backup. Send message.'); await tick();
    assert.equal(held, 0);
    assert.equal(f.reports.filter(n => n.type === 'result').length, cancel ? 0 : 1);
  }
});

test('screen-aware recording preserves spoken commands as instructions and waits for release', async () => {
  for (const promote of [false, true]) {
    const f = liveFixture(); await f.recorder.start(30, promote);
    f.opened.resolve(f.voice); await tick();
    if (promote) f.recorder.disableCommands(30);
    f.transcript('Compose a reply. Send message.', true);
    assert.equal(f.recordings[0].state, 'recording');
    assert.equal(f.reports.some(n => n.type === 'finish'), false);
    f.recorder.stop(30); f.drained.resolve(); f.final.resolve('Compose a reply. Send message.'); f.closed.resolve(); await tick();
    assert.deepEqual(f.reports.at(-1), { type: 'result', id: 30, text: 'Compose a reply. Send message.', submit: false });
  }
});
