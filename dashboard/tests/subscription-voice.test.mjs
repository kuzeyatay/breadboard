import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { recordedVoiceFixture } from './fixtures/recorded-voice.mjs';

const root = fileURLToPath(new URL("../", import.meta.url));
// These transport fixtures supply audio samples through their synthetic stats.
// Real decoded-sample detection is exercised in verified-output-ui.test.mjs.
const bundle = await esbuild.build({ entryPoints: [root + "src/lib/speech/subscription-live.ts"], bundle: true, write: false, platform: "browser", format: "esm",
  plugins: [{ name: 'synthetic-audio', setup(build) {
    build.onResolve({ filter: /\/remote-audio-activity$/ }, () => ({ path: 'audio', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const createRemoteAudioActivity=()=>({attach(){},close(){},snapshot(){}});' }));
  } }],
});
const { connectSubscriptionVoice, splitSpeechText, splitLiveSpeechText, preloadSubscriptionVoice, clearSubscriptionPreload } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function requestedScript(body) {
  const {text} = JSON.parse(body);
  assert.equal(typeof text, 'string');
  return text;
}

function voiceChannel({ confirm = true } = {}) {
  let contextClock = 1e12;
  const channel = {
    readyState: 'open', sent: [],
    close() { this.onclose?.(); },
    emit(message) { this.onmessage?.({ data: JSON.stringify(message) }); },
    send(data) {
      this.sent.push(JSON.parse(data));
      if (confirm) queueMicrotask(() => this.emit(JSON.parse(data).type==='session.context.append'
        ? {type:'session.context.appended',start_ms:contextClock,end_ms:++contextClock}
        : {type:'session.updated'}));
    },
  };
  queueMicrotask(() => channel.emit({ type: 'session.started' }));
  return channel;
}

const serverBundle = await esbuild.build({
  entryPoints: [root + "src/lib/speech/subscription-server.ts"],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "voice-origin-boundaries", setup(build) {
    const stubs = {
      "server-only": "export {};",
      "@/lib/chatmock-server": "export const localChatmockBaseUrl = () => { throw new Error('Unexpected voice bridge call'); };",
      "@/lib/server-auth": "export class RouteError extends Error { constructor(status, message) { super(message); this.status = status; } }",
    };
    build.onResolve({ filter: /.*/ }, ({ path }) => path in stubs ? { path, namespace: "stub" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({ contents: stubs[path], loader: "js" }));
  } }],
});
const { requireVoiceOrigin } = await import(`data:text/javascript;base64,${Buffer.from(serverBundle.outputFiles[0].text).toString("base64")}`);

test("voice accepts the browser-facing origin when Next.js uses an internal bind address", () => {
  const cases = [
    ["http://127.0.0.1:3000", { origin: "http://127.0.0.1:3000" }],
    ["http://0.0.0.0:3000", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }],
    ["http://[::]:3000", { host: "[::1]:3000", origin: "http://[::1]:3000" }],
    ["http://127.0.0.1:3000", { host: "localhost:3000", origin: "http://localhost:3000" }],
    ["http://0.0.0.0:3000", { host: "127.0.0.1:3000", "x-forwarded-host": "breadboard.example", "x-forwarded-proto": "https", origin: "https://breadboard.example" }],
    ["http://0.0.0.0:3000", { host: "127.0.0.1:3000", "x-forwarded-host": "breadboard.example, proxy.internal", "x-forwarded-proto": "https, http", origin: "https://breadboard.example" }],
  ];
  for (const [base, headers] of cases) {
    for (const method of ["POST", "GET", "DELETE"]) {
      assert.doesNotThrow(() => requireVoiceOrigin(new Request(`${base}/api/speech/subscription`, {
        method, headers: { ...headers, "sec-fetch-site": "same-origin" },
      })), `${method} from ${headers.origin} through ${base}`);
    }
  }
  assert.doesNotThrow(() => requireVoiceOrigin(new Request("http://0.0.0.0:3000/api/speech/subscription", {
    headers: { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" },
  })), "same-origin event polling may omit Origin");
});

test("voice still rejects other origins, ports, protocols and malformed authorities", () => {
  const headers = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" };
  for (const override of [
    { origin: "https://untrusted.example" },
    { origin: "http://127.0.0.1:3001" },
    { origin: "https://127.0.0.1:3000" },
    { origin: "http://localhost:3000", "sec-fetch-site": "same-site" },
    { origin: "http://0.0.0.0:3000" },
    { origin: "null" },
    { origin: "not a URL" },
    { "sec-fetch-site": "cross-site" },
    { origin: "", "sec-fetch-site": "cross-site" },
    { "x-forwarded-host": "invalid host" },
    { "x-forwarded-host": "user@127.0.0.1:3000" },
    { "x-forwarded-host": "127.0.0.1:3000/path" },
    { "x-forwarded-proto": "file" },
  ]) {
    assert.throws(() => requireVoiceOrigin(new Request("http://0.0.0.0:3000/api/speech/subscription", {
      method: "POST", headers: { ...headers, ...override },
    })), { status: 403, message: "Voice requests must come from Breadboard." }, JSON.stringify(override));
  }
});

test("long readings use short passages without losing words", () => {
  const text = "This is a complete sentence about Breadboard. ".repeat(300).trim();
  const parts = splitSpeechText(text);
  assert.ok(parts.length > 4);
  assert.ok(parts.every(part => part.length <= 360 && part.split(/\s+/u).length <= 50));
  assert.ok(parts.every(part => part.endsWith('.')), 'prefer complete sentences');
  assert.equal(parts.join(" "), text);
  assert.deepEqual(splitSpeechText("   "), []);
});

test("even short words cannot turn a passage into a rushed, long reading", () => {
  const text = 'We can do it if we take it one step at a time '.repeat(15).trim();
  const parts = splitSpeechText(text);
  assert.ok(parts.every(part => part.split(/\s+/u).length <= 50));
  assert.equal(parts.join(' '), text);
});

test("passages split at quotes, paragraphs and whitespace without dropping text", () => {
  const normalize = text => text.replace(/\s+/gu, ' ').trim();
  for (const text of [
    'She said, “Take your time.” '.repeat(40),
    'One paragraph ends here\n\nAnother paragraph begins here\tand continues '.repeat(30),
    'This sentence has no punctuation and keeps going '.repeat(40),
    '一つずつ確認してください。 次の手順に進みましょう！ '.repeat(40),
  ]) {
    const parts = splitSpeechText(text);
    assert.ok(parts.every(part => part.length > 0 && part.length <= 360));
    assert.equal(normalize(parts.join(' ')), normalize(text));
  }
  assert.ok(splitSpeechText('She said, “Take your time.” '.repeat(40)).every(part => part.endsWith('.”')));
});

test("splitting never loses Unicode code points", () => {
  const text = "🦉".repeat(3500);
  assert.equal(splitSpeechText(text).join(""), text);
  assert.ok(splitSpeechText(text).every(part => !/[\uD800-\uDBFF]$/.test(part)));
});

test("subscription speech selects its mode and reports progress only after audio arrives, stopping on interruption", { timeout: 10_000 }, async (t) => {
  recordedVoiceFixture(t);
  const previous = Object.fromEntries(['AudioContext', 'RTCPeerConnection'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const node = () => ({ gain: { value: 0 }, connect() { return this; }, disconnect() {}, start() {}, stop() {} });
  globalThis.AudioContext = class {
    state = 'running'; destination = {};
    createGain = node; createOscillator = node; createMediaStreamSource = node;
    createMediaStreamDestination() { const track = node(); return { stream: { getAudioTracks: () => [track], getTracks: () => [track] } }; }
    async resume() {} async close() {}
  };
  let inboundLevel = 0;
  globalThis.RTCPeerConnection = class {
    addTrack() {} close() {}
    createDataChannel() { return voiceChannel(); }
    async createOffer() { return { sdp: 'v=0' }; }
    async setLocalDescription() {} async setRemoteDescription() { this.ontrack({ track: {} }); }
    async getStats() { return new Map([
      ['audio', { type: 'outbound-rtp', kind: 'audio', packetsSent: 10 }],
      ['incoming', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 10, audioLevel: inboundLevel }],
    ]); }
  };
  t.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const modes = [];
  const readings = [];
  let delivered;
  let deliverOutput;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST') {
      if (JSON.parse(options.body).text) { readings.push(requestedScript(options.body)); return Response.json({}); }
      modes.push(JSON.parse(options.body).mode); delivered = false;
      return Response.json({ id: 'fixture', voice: 'sol', pronunciations: 'SQL = sequel\nsequel = follow-up' });
    }
    if (options.method === 'DELETE') return Response.json({});
    if (!delivered) {
      delivered = true;
      return Response.json({ cursor: 1, events: [{ type: 'sdp', sdp: 'v=0' }] });
    }
    return new Promise((resolve, reject) => {
      deliverOutput = () => resolve(Response.json({ cursor: 2, events: [{ type: 'transcript', role: 'assistant', text: readings.at(-1) }] }));
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  });
  for (const options of [{}, { microphone: {} }, { mode: 'transcribe' }]) {
    const voice = await connectSubscriptionVoice(options);
    await voice.close();
  }
  assert.deepEqual(modes, ['speak', 'conversation', 'transcribe']);

  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  const progress = [];
  const reading = voice.speak('A long enough message about SQL to check the reading pace.', true, value => progress.push(value));
  const until = async predicate => {
    const deadline = Date.now() + 2500;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'expected a speech progress update');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  await until(() => readings.length === 1);
  assert.ok(progress.every(value => value === 0), 'preparation and quiet media must not scroll');
  inboundLevel = 0.2;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(progress.every(value => value === 0), 'unverified remote speech must not advance reading progress');
  inboundLevel = 0;
  deliverOutput();
  await reading;
  assert.deepEqual(readings, ['A long enough message about sequel to check the reading pace.']);
  assert.equal(progress.at(-1), 1);

  progress.length = 0;
  inboundLevel = 0.2;
  const interrupted = voice.speak('Another message to interrupt.', true, value => progress.push(value));
  await until(() => readings.length === 2);
  voice.stopSpeaking();
  const countAtStop = progress.length;
  await interrupted;
  assert.equal(progress.length, countAtStop, 'stopping must not emit late progress or completion');
  await voice.close();
});

test("all microphone surfaces use a live subscription stream and release it", async () => {
  for (const file of ["components/voice-conversation-overlay.tsx", "components/speech-dictation-button.tsx"]) {
    const source = await fs.readFile(root + "src/app/" + file, "utf8");
    assert.match(source, /connectSubscriptionVoice\(\{[^}]*\bmicrophone:\s*stream|openDictationProvider\(stream,/);
    assert.match(source, /finishTranscript\(/);
    if (file === 'components/voice-conversation-overlay.tsx') {
      assert.match(source, /connectSubscriptionVoice\(\{[^}]*\bmode:\s*'conversation'/);
      assert.match(source, /const retiring = subscriptionRef\.current;/);
      assert.match(source, /subscriptionRetirement\.current = Promise\.all\(\[subscriptionRetirement\.current, retiring\.close\(\)\]/);
    } else assert.match(source, /subscriptionRef\.current\?\.close\(/);
  }
  const provider = await fs.readFile(root + 'src/lib/speech/dictation-provider.ts', 'utf8');
  assert.match(provider, /connectSubscriptionVoice\(\{ microphone, signal, onTranscript, onDisconnect, onInputReady, inputOnly: true \}\)/);
  const playback = await fs.readFile(root + "src/lib/speech/playback.ts", "utf8");
  assert.match(playback, /await voice!?\.speak\(text\)/);
  assert.match(playback, /activeSubscriptionStop/);
});

function transportFixture(t, { confirm = true, selectedVoice = 'sol', inboundPackets = 10, outboundPackets = 10 } = {}) {
  const players = recordedVoiceFixture(t);
  const previous = Object.fromEntries(['AudioContext', 'RTCPeerConnection'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const node = () => ({ gain: { value: 0 }, connect() { return this; }, disconnect() {}, start() {}, stop() {} });
  let audioContext;
  globalThis.AudioContext = class {
    state = 'running'; destination = {};
    constructor() { audioContext = this; }
    createGain = node; createOscillator = node; createMediaStreamSource = node;
    createMediaStreamDestination() { const track = node(); return { stream: { getAudioTracks: () => [track], getTracks: () => [track] } }; }
    async resume() {} async close() {}
  };
  let peer;
  globalThis.RTCPeerConnection = class {
    connectionState = 'connected';
    energy = 0;
    bufferDelay = 0;
    incomingStats = {};
    constructor() { peer = this; }
    addTrack() {} close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
    createDataChannel() { return this.channel = voiceChannel({ confirm }); }
    async createOffer() { return { sdp: 'v=0' }; }
    async setLocalDescription() {} async setRemoteDescription() { this.ontrack({ track: {} }); }
    async getStats() { return new Map([
      ['audio', { type: 'outbound-rtp', kind: 'audio', packetsSent: outboundPackets }],
      ['incoming', { type: 'inbound-rtp', kind: 'audio', packetsReceived: inboundPackets, totalAudioEnergy: this.energy,
        jitterBufferDelay: this.bufferDelay, jitterBufferEmittedCount: 1, ...this.incomingStats }],
    ]); }
  };
  t.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const actions = [];
  const polls = [];
  const scripts = [];
  let pending;
  let creates = 0;
  let deletes = 0;
  let initial = true;
  const push = value => { if (pending) { const deliver = pending; pending = null; deliver(value); } else actions.push(value); };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST') {
      creates++;
      if (JSON.parse(options.body).text) scripts.push(requestedScript(options.body));
      return Response.json({id:'fixture', voice: selectedVoice});
    }
    if (options.method === 'DELETE') { deletes++; return Response.json({}); }
    polls.push(url);
    if (initial) { initial = false; return Response.json({cursor:1, events:[{type:'sdp', sdp:'v=0'}]}); }
    return new Promise((resolve, reject) => {
      const abort = () => { pending = null; reject(options.signal.reason); };
      const deliver = value => {
        options.signal.removeEventListener('abort', abort);
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
      if (options.signal.aborted) return abort();
      options.signal.addEventListener('abort', abort, {once:true});
      if (actions.length) deliver(actions.shift());
      else pending = deliver;
    });
  });
  return { push, polls, players, scripts, get context() { return audioContext; }, set inboundPackets(value) { inboundPackets = value; }, set outboundPackets(value) { outboundPackets = value; }, get peer() {return peer;}, get creates() {return creates;}, get deletes() {return deletes;} };
}

async function waitFor(predicate) {
  const deadline = performance.now() + 4000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, 'expected transport event');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('subscription playback applies the saved voice and waits for the live session acknowledgment', async t => {
  const fixture = transportFixture(t, { confirm: false });
  let connected = false;
  const connection = connectSubscriptionVoice().then(voice => { connected = true; return voice; });
  await waitFor(() => fixture.peer?.channel?.sent.length === 1);
  assert.deepEqual(fixture.peer.channel.sent, [{ type: 'session.update', session: { audio: { output: { voice: 'sol' } } } }]);
  assert.equal(connected, false, 'no caller can start speech before its voice is applied');
  fixture.peer.channel.emit({ type: 'session.updated' });
  const voice = await connection;
  assert.equal(connected, true);
  await voice.close();
});

test('buffered microphone input waits for voice acknowledgment and remote media readiness', async t => {
  const fixture = transportFixture(t, { confirm: false, inboundPackets: 0 });
  let ready = 0, complete = false;
  const connecting = connectSubscriptionVoice({ microphone: {}, onInputReady: () => ready++ }).then(voice => { complete = true; return voice; });
  await waitFor(() => fixture.peer?.channel?.sent.length === 1);
  fixture.peer.connectionState = 'connected'; fixture.peer.onconnectionstatechange(); fixture.peer.onconnectionstatechange();
  assert.equal(ready, 0, 'a connected transport alone cannot drain the first words');
  fixture.inboundPackets = 10;
  assert.equal(ready, 0); assert.equal(complete, false);
  fixture.peer.channel.emit({ type: 'session.updated' });
  const voice = await connecting; assert.equal(ready, 1); await voice.close();
});

test('dictation starts when input media is ready without waiting for unused speaker setup', async t => {
  const fixture = transportFixture(t, { confirm: false, inboundPackets: 0, outboundPackets: 0 });
  let ready = 0;
  const connecting = connectSubscriptionVoice({ microphone: {}, inputOnly: true, onInputReady: () => ready++ });
  await waitFor(() => fixture.peer?.channel);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(ready, 0, 'an open control channel is not sufficient to send audio');
  fixture.outboundPackets = 10;
  const voice = await connecting;
  assert.equal(ready, 1);
  assert.deepEqual(fixture.peer.channel.sent, [], 'dictation requires no output voice update');
  assert.ok(fixture.players.every(player => player.volume === 0), 'remote replies remain inaudible');
  await voice.close(); assert.equal(fixture.deletes, 1);
});

test('a cached dictation transport is unusable immediately when media or control disconnects', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {}, inputOnly: true });
  t.after(() => voice.close());
  assert.equal(voice.isHealthy(), true);
  fixture.peer.connectionState = 'disconnected';
  assert.equal(voice.isHealthy(), false, 'do not attach a new hold during the disconnect grace period');
  fixture.peer.connectionState = 'connected';
  assert.equal(voice.isHealthy(), true);
  fixture.context.state = 'suspended';
  assert.equal(voice.isHealthy(), false, 'a suspended audio graph cannot capture a new hold');
  fixture.context.state = 'running';
  assert.equal(voice.isHealthy(), true);
  fixture.peer.channel.readyState = 'closing';
  assert.equal(voice.isHealthy(), false, 'do not wait for onclose to invalidate a cached connection');
});

test('an empty media event cannot suppress live relay words until send message', async t => {
  const fixture = transportFixture(t), notices = [];
  const voice = await connectSubscriptionVoice({ microphone: {}, inputOnly: true, onTranscript: text => notices.push(text) });
  t.after(() => voice.close());
  fixture.peer.channel.emit({ type: 'input_transcript.added', start_ms: 0, end_ms: 200, item: { id: 'empty', text: '' } });
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcriptDelta', role: 'user', text: 'Words while speaking' }] }));
  await waitFor(() => fixture.polls.length >= 3);
  assert.equal(voice.transcript(), 'Words while speaking');
  assert.deepEqual(notices, ['Words while speaking']);
});

test('finishing a buffered hold waits for final words even when partial recognition pauses', async t => {
  const fixture = transportFixture(t);
  const notifications = [];
  const voice = await connectSubscriptionVoice({ microphone: {}, onTranscript: (text, final) => notifications.push({ text, final }) }); t.after(() => voice.close());
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcriptDelta', role: 'user', text: 'Keep my' }] }));
  await waitFor(() => voice.transcript() === 'Keep my');
  let finished = false;
  const final = voice.finishTranscript({ settleFinal: true }).then(text => { finished = true; return text; });
  await new Promise(resolve => setTimeout(resolve, 750)); assert.equal(finished, false, 'a 500ms pause between deltas is not a final transcript');
  fixture.push(Response.json({ cursor: 3, events: [{ type: 'transcriptDelta', role: 'user', text: ' last words.' }] }));
  await waitFor(() => voice.transcript() === 'Keep my last words.');
  assert.equal(finished, false);
  fixture.push(Response.json({ cursor: 4, events: [{ type: 'transcript', role: 'user', text: 'Keep my last words.' }] }));
  assert.equal(await final, 'Keep my last words.');
  assert.deepEqual(notifications.map(n => n.final), [false, false, true], 'commands can distinguish interim words from a completed utterance');
});

test('delta-only transcription settles without a final event or replaying the recording', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcriptDelta', role: 'user', text: 'The complete final words.' }] }));
  await waitFor(() => voice.transcript() === 'The complete final words.');
  const started = performance.now();
  assert.equal(await voice.finishTranscript({ settleFinal: true }), 'The complete final words.');
  assert.ok(performance.now() - started < 1300, 'stable conversation words should not incur the old 1.5 second floor');
  assert.equal(fixture.creates, 1);
});

test('conversation reuses transcript quiet time observed before the acoustic endpoint', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcriptDelta', role: 'user', text: 'These words have already settled.' }] }));
  await waitFor(() => voice.transcript() === 'These words have already settled.');
  await new Promise(resolve => setTimeout(resolve, 950));
  const started = performance.now();
  assert.equal(await voice.finishTranscript({ settleFinal: true }), 'These words have already settled.');
  assert.ok(performance.now() - started < 400, 'do not add a second 600ms wait after end-of-speech');
});

test('new words during the endpoint guard restart transcript settling', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcriptDelta', role: 'user', text: 'Include the' }] }));
  await waitFor(() => voice.transcript() === 'Include the');
  await new Promise(resolve => setTimeout(resolve, 950));
  let finished = false;
  const final = voice.finishTranscript({ settleFinal: true }).then(text => { finished = true; return text; });
  await new Promise(resolve => setTimeout(resolve, 20));
  fixture.push(Response.json({ cursor: 3, events: [{ type: 'transcriptDelta', role: 'user', text: ' correction too.' }] }));
  await waitFor(() => voice.transcript() === 'Include the correction too.');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(finished, false, 'new activity invalidates the previously stable prefix');
  assert.equal(await final, 'Include the correction too.');
});

test('dictation accepts completed media turns without waiting for a missing or delayed relay', async t => {
  const fixture = transportFixture(t), notices = [];
  const voice = await connectSubscriptionVoice({ microphone: {}, inputOnly: true, onTranscript: (text, final) => notices.push({ text, final }) });
  t.after(() => voice.close());
  const emit = event => fixture.peer.channel.emit(event);
  emit({ type: 'input_transcript.added', start_ms: 0, end_ms: 200, item: { id: 'one', text: 'Ready to send.' } });
  emit({ type: 'turn.created', turn: { id: 'turn1', role: 'user', start_ms: 0, end_ms: 200 } });
  emit({ type: 'input_transcript.added', start_ms: 200, end_ms: 400, item: { id: 'two', text: ' Send message.' } });
  emit({ type: 'turn.done', turn: { id: 'turn1', role: 'user', start_ms: 0, end_ms: 600, transcript: 'Ready to send. Send message.' } });
  assert.deepEqual(notices.at(-1), { text: 'Ready to send. Send message.', final: true }, 'command completion is immediate on the media event');
  assert.equal(await voice.finishTranscript({ settleFinal: true }), 'Ready to send. Send message.');
  voice.resetTranscript();
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcript', role: 'user', text: 'Ready to send. Send message.' }] }));
  await new Promise(resolve => setTimeout(resolve, 20));
  emit({ type: 'turn.created', turn: { id: 'turn1', role: 'user', start_ms: 0, end_ms: 200 } });
  emit({ type: 'turn.done', turn: { id: 'turn1', role: 'user', start_ms: 0, end_ms: 600, transcript: 'Ready to send. Send message.' } });
  assert.equal(voice.transcript(), '', 'late media and relay events cannot enter the next hold');
  emit({ type: 'input_transcript.added', start_ms: 800, end_ms: 1000, item: { id: 'three', text: 'Another message.' } });
  emit({ type: 'turn.done', turn: { id: 'turn2', role: 'user', start_ms: 800, end_ms: 1200, transcript: 'Another message.' } });
  assert.equal(await voice.finishTranscript({ settleFinal: true }), 'Another message.');
});

test('an earlier completed sentence cannot finish a hold while newer input is still being recognized', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {}, inputOnly: true }); t.after(() => voice.close());
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcript', role: 'user', text: 'Keep every word.' }] }));
  fixture.peer.channel.emit({ type: 'input_transcript.added', start_ms: 0, end_ms: 1000 });
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'first', role: 'user', end_ms: 1000, transcript: 'Keep every word.' } });
  await waitFor(() => voice.transcript() === 'Keep every word.');
  // Data-channel input arrives before the bridge publishes the next turn.
  fixture.peer.channel.emit({ type: 'input_transcript.added', start_ms: 1100, end_ms: 1500 });
  let finished = false;
  const final = voice.finishTranscript({ settleFinal: true }).then(text => { finished = true; return text; });
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(finished, false, 'the prior sentence must not authorize submission');
  fixture.peer.channel.emit({ type: 'turn.created', turn: { id: 'last', role: 'user', start_ms: 1100, end_ms: 1500 } });
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'last', role: 'user', start_ms: 1100, end_ms: 1500, transcript: 'Send message.' } });
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(finished, false, 'the data-channel final must also reach the transcript bridge');
  fixture.push(Response.json({ cursor: 3, events: [{ type: 'transcript', role: 'user', text: 'Send message.' }] }));
  assert.equal(await final, 'Keep every word. Send message.');
  voice.resetTranscript();
  assert.equal(voice.transcript(), '', 'a new hold starts without the previous turn state');
});

test('local RTP and voice confirmation cannot start speech before remote audio is ready', async t => {
  const fixture = transportFixture(t, { inboundPackets: 0 });
  let connected = false;
  const connection = connectSubscriptionVoice().then(voice => { connected = true; return voice; });
  await waitFor(() => fixture.peer?.channel?.sent.length === 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(connected, false);
  fixture.inboundPackets = 9;
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(connected, false);
  fixture.inboundPackets = 10;
  const voice = await connection;
  assert.equal(connected, true);
  await voice.close();
});

test('a remote media startup timeout releases the session without posting a script', async t => {
  const fixture = transportFixture(t, { inboundPackets: 0 });
  const now = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const rejected = assert.rejects(connectSubscriptionVoice(), /audio connection did not become ready/);
  await waitFor(() => fixture.peer?.channel?.sent.length === 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  offset = 16000;
  await rejected;
  assert.equal(fixture.creates, 1);
  assert.equal(fixture.deletes, 1);
  assert.equal(fixture.peer.connectionState, 'closed');
});

test('direct WebRTC completion works without bridge transcripts and ignores delayed duplicate completion', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  const first = voice.speak('First sentence.');
  await waitFor(() => fixture.creates === 2);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.created', turn: { id: 'one', role: 'assistant', transcript: 'First sentence.' } });
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'one', role: 'assistant', transcript: 'First sentence.' } });
  await first;
  let finished = false;
  const second = voice.speak('Second sentence.').then(() => { finished = true; });
  await waitFor(() => fixture.creates === 3);
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcript', role: 'assistant', text: 'First sentence.' }] }));
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'one', role: 'assistant', transcript: 'First sentence.' } });
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'user', role: 'user' } });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(finished, false, 'old bridge events and user transcripts cannot finish the next script');
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.created', turn: { id: 'two', role: 'assistant', transcript: 'Second sentence.' } });
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'two', role: 'assistant', transcript: 'Second sentence.' } });
  await second;
  assert.equal(finished, true);
  finished = false;
  const third = voice.speak('Third sentence.').then(() => { finished = true; });
  await waitFor(() => fixture.creates === 4);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'one', role: 'assistant', transcript: 'First sentence.' } });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(finished, false, 'a duplicate older than the last turn cannot finish current audio');
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'three', role: 'assistant', transcript: 'Third sentence.' } });
  await third;
});

test('early completion cannot clip continued audio when audioLevel is absent', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  let finished = false;
  const reading = voice.speak('Read every word through the end.').then(() => { finished = true; });
  await waitFor(() => fixture.creates === 2);
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'early', role: 'assistant', transcript: 'Read every word through the end.' } });
  for (let index = 0; index < 15; index++) {
    fixture.peer.energy += 0.00001;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(finished, false, 'quiet words are still arriving after the transcript completed');
  }
  const drainedAt = performance.now();
  await reading;
  assert.ok(performance.now() - drainedAt < 800, 'a drained stream hands off promptly');
});

for (const transcript of ['A paraphrase of the message.', 'Read every word. Here is my answer.']) {
  test(`a live reading that strays from the script is muted at once and says where to resume: ${transcript}`, async t => {
    const fixture = transportFixture(t);
    const voice = await connectSubscriptionVoice();
    t.after(() => voice.close());
    const script = 'Read every word.';
    const rejected = assert.rejects(voice.speak(script), error => typeof error.resumeAt === 'number');
    await waitFor(() => fixture.creates === 2);
    const live = fixture.players.find(player => player.srcObject);
    assert.equal(live.volume, 1, 'the remote track is audible while the reader speaks');
    fixture.peer.energy += 0.1;
    fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'wrong', role: 'assistant', transcript } });
    await rejected;
    assert.equal(live.volume, 0, 'a reading that strayed is muted');
    assert.ok(fixture.players.every(player => !player.url), 'live readings never play a recording');
    assert.equal(voice.isHealthy(), false, 'the strayed reader is not reused');
  });
}

test('a live reading follows streamed words, mutes as soon as they leave the script, and resumes at that sentence', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  const script = 'First sentence here. Second sentence follows now. Third one ends it.';
  const progress = [];
  const rejected = assert.rejects(voice.speak(script, true, value => progress.push(value)), error => error.resumeAt === 'First sentence here. '.length && error.safeToRetry === false);
  await waitFor(() => fixture.creates === 2);
  const live = fixture.players.find(player => player.srcObject);
  fixture.peer.energy += 0.1;
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcriptDelta', role: 'assistant', text: 'First sentence here. Second ' }] }));
  await waitFor(() => progress.some(value => value > 0));
  assert.ok(progress.every(value => value <= 'First sentence here. Second'.length / script.length + 1e-9), 'progress follows confirmed words only');
  assert.equal(live.volume, 1);
  fixture.push(Response.json({ cursor: 3, events: [{ type: 'transcriptDelta', role: 'assistant', text: 'Let me know if you ' }] }));
  await waitFor(() => live.volume === 0);
  await rejected;
  assert.equal(fixture.creates, 2, 'a strayed reader is not asked again on the same connection');
});

test('a slightly different reading is accepted; a truncated one asks to resume the unread remainder', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  const close = voice.speak('Read every word.');
  await waitFor(() => fixture.creates === 2);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'close', role: 'assistant', transcript: 'Read every last word.' } });
  await close;
  assert.equal(voice.isHealthy(), true);
  const truncated = assert.rejects(voice.speak('Read every single word.'), error => error.resumeAt === 0 && error.safeToRetry === true);
  await waitFor(() => fixture.creates === 3);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'short', role: 'assistant', transcript: 'Four.' } });
  await truncated;
});

test('a live reading requests the whole message at once and stays audible until it has finished', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  const text = 'This is the complete first sentence. '.repeat(12).trim();
  assert.deepEqual(splitLiveSpeechText(text), [text]);
  const progress = [];
  let finished = false;
  const reading = voice.speak(text, true, value => progress.push(value)).then(() => { finished = true; });
  await waitFor(() => fixture.creates === 2);
  assert.deepEqual(fixture.scripts, [text], 'one reading request carries the whole paragraph');
  const live = fixture.players.find(player => player.srcObject);
  assert.equal(live.volume, 1);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(fixture.creates, 2, 'no further passages are requested');
  assert.equal(finished, false);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'whole', role: 'assistant', transcript: text } });
  await reading;
  assert.equal(live.volume, 0, 'the track is muted again once the reading has drained');
  assert.equal(progress.at(-1), 1);
  assert.ok(fixture.players.every(player => !player.url));
});

test('buffered output is still verified word for word and an unfaithful passage is recorded again', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ capture: true });
  t.after(() => voice.close());
  const text = 'This is the complete first sentence. '.repeat(6).trim();
  const parts = splitSpeechText(text);
  assert.ok(parts.length >= 2);
  const reading = voice.speak(text, false);
  await waitFor(() => fixture.creates === 2);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'p1', role: 'assistant', transcript: parts[0] } });
  await waitFor(() => fixture.creates === 3);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'p2-wrong', role: 'assistant', transcript: 'The complete first sentence, again.' } });
  await waitFor(() => fixture.creates === 4);
  assert.deepEqual(fixture.scripts, [parts[0], parts[1], parts[1]]);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'p2-right', role: 'assistant', transcript: parts[1] } });
  for (let index = 2; index < parts.length; index++) {
    await waitFor(() => fixture.creates === 3 + index);
    fixture.peer.energy += 0.1;
    fixture.peer.channel.emit({ type: 'turn.done', turn: { id: `p${index + 1}`, role: 'assistant', transcript: parts[index] } });
  }
  await reading;
  assert.ok(fixture.players.every(player => player.volume === 0), 'buffered output is never audible');
  assert.equal(voice.isHealthy(), true);
});

test('completion leaves time for buffered audio to reach the speaker', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  fixture.peer.bufferDelay = 1.2;
  let finished = false;
  const reading = voice.speak('The buffered final words.').then(() => { finished = true; });
  await waitFor(() => fixture.creates === 2);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'buffered', role: 'assistant', transcript: 'The buffered final words.' } });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(finished, false);
  await reading;
});

test('frozen audio statistics cannot be mistaken for the end of a message', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  fixture.peer.incomingStats.totalSamplesDuration = 0;
  let finished = false;
  const reading = voice.speak('Wait for the remaining audio.').then(() => { finished = true; });
  await waitFor(() => fixture.creates === 2);
  fixture.peer.energy = 0.1;
  fixture.peer.incomingStats.totalSamplesDuration = 1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'frozen', role: 'assistant', transcript: 'Wait for the remaining audio.' } });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(finished, false);
  const timer = setInterval(() => { fixture.peer.incomingStats.totalSamplesDuration += 0.02; }, 20);
  t.after(() => clearInterval(timer));
  await reading;
});

test('inaudible comfort noise does not stall the next passage', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  fixture.peer.incomingStats.totalSamplesDuration = 0;
  const reading = voice.speak('Finish with a quiet connection.');
  await waitFor(() => fixture.creates === 2);
  fixture.peer.energy = 0.1;
  fixture.peer.incomingStats.totalSamplesDuration = 1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'noise', role: 'assistant', transcript: 'Finish with a quiet connection.' } });
  const timer = setInterval(() => {
    fixture.peer.energy += 0.0000000002;
    fixture.peer.incomingStats.totalSamplesDuration += 0.02;
  }, 20);
  t.after(() => clearInterval(timer));
  await reading;
});

test('concurrent scripts cannot overlap and interrupted output cannot be reused', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  const first = voice.speak('First reading.');
  await waitFor(() => fixture.creates === 2);
  await assert.rejects(voice.speak('Overlapping reading.'), /already being read/);
  assert.equal(fixture.creates, 2, 'the overlapping script was never posted');
  voice.stopSpeaking();
  await first;
  assert.equal(voice.isHealthy(), false);
  await assert.rejects(voice.speak('A stale audio tail must not precede this.'), /fresh voice connection/);
});

test('a different acknowledged voice fails and closes the session instead of reading with it', async t => {
  const fixture = transportFixture(t, { confirm: false });
  const rejected = assert.rejects(connectSubscriptionVoice(), /selected a different voice/);
  await waitFor(() => fixture.peer?.channel?.sent.length === 1);
  fixture.peer.channel.emit({ type: 'session.updated', session: { audio: { output: { voice: 'cove' } } } });
  await rejected;
  assert.equal(fixture.deletes, 1);
  assert.equal(fixture.peer.connectionState, 'closed');
});

test('voice confirmation can be cancelled and missing selections never fall back to a default', async t => {
  const fixture = transportFixture(t, { confirm: false });
  const controller = new AbortController();
  const rejected = assert.rejects(connectSubscriptionVoice({ signal: controller.signal }), { name: 'AbortError' });
  await waitFor(() => fixture.peer?.channel?.sent.length === 1);
  controller.abort();
  await rejected;
  assert.equal(fixture.deletes, 1);
  t.mock.restoreAll();
  const missing = transportFixture(t, { selectedVoice: null });
  await assert.rejects(connectSubscriptionVoice(), /did not return the selected voice/);
  assert.deepEqual(missing.peer.channel.sent, []);
  assert.equal(missing.deletes, 1);
});

function conversationFixture(t, { pronunciations = '' } = {}) {
  const requests = [];
  const players = recordedVoiceFixture(t);
  const previous = Object.fromEntries(['AudioContext', 'RTCPeerConnection', 'Audio', 'MediaStream']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const node = () => ({ gain: { value: 0 }, connect() { return this; }, disconnect() {}, start() {}, stop() {} });
  const sessions = [], posts = [], deleted = [], peers = [], microphones = [];
  let holdReaderSetup = false, holdInputSetup = false, releaseInputSetup;
  let holdInputAllocation = false, releaseInputAllocation;
  let postError = false;
  globalThis.AudioContext = class {
    state = 'running'; destination = {};
    createGain = node; createOscillator = node;
    createMediaStreamSource(stream) { microphones.push(stream); return node(); }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [node()], getTracks: () => [node()] } }; }
    async resume() {} async close() {}
  };
  globalThis.MediaStream = class {};
  globalThis.RTCPeerConnection = class {
    connectionState = 'connected';
    energy = 0;
    constructor() { peers.push(this); }
    addTrack() {} close() {}
    createDataChannel() { return this.channel = voiceChannel(); }
    async createOffer() { return { sdp: 'v=0' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.ontrack({ track: {} }); }
    async getStats() { return new Map([
      ['audio', { type: 'outbound-rtp', kind: 'audio', packetsSent: 10 }],
      ['incoming', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 10, totalAudioEnergy: this.energy }],
    ]); }
  };
  t.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url === '/api/speech/subscription') {
      const session = { id: String(sessions.length), initial: true, mode: JSON.parse(options.body).mode };
      sessions.push(session);
      if (holdInputAllocation && session.mode === 'conversation') {
        return new Promise((resolve,reject)=>{
          const abort=()=>reject(options.signal.reason);
          options.signal.addEventListener('abort',abort,{once:true});
          releaseInputAllocation=()=>{options.signal.removeEventListener('abort',abort);resolve(Response.json({id:session.id,voice:'sol',pronunciations}));};
        });
      }
      return Response.json({ id: session.id, voice: 'sol', pronunciations });
    }
    const id = url.split('/').at(-1).split('?')[0], session = sessions[Number(id)];
    if (options.method === 'DELETE') { deleted.push(id); return Response.json({}); }
    if (options.method === 'POST') {
      posts.push({ id, text: requestedScript(options.body) });
      requests.push(JSON.parse(options.body).text);
      if (postError) throw new TypeError('Ambiguous speech POST failure');
      return Response.json({});
    }
    if (session.initial) {
      session.initial = false;
      if (holdInputSetup && session.mode === 'conversation') {
        return new Promise((resolve,reject)=>{
          const abort=()=>reject(options.signal.reason);
          options.signal.addEventListener('abort',abort,{once:true});
          releaseInputSetup=()=>{options.signal.removeEventListener('abort',abort);resolve(Response.json({cursor:1,events:[{type:'sdp',sdp:'v=0'}]}));};
        });
      }
      if (holdReaderSetup && session.mode === 'speak') {
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      }
      return Response.json({ cursor: 1, events: [{ type: 'sdp', sdp: 'v=0' }] });
    }
    return new Promise((resolve, reject) => {
      const abort = () => reject(options.signal.reason);
      options.signal.addEventListener('abort', abort, { once: true });
      session.deliver = text => {
        peers[Number(id)].energy += 0.1;
        options.signal.removeEventListener('abort', abort);
        resolve(Response.json({ cursor: 2, events: [{ type: 'transcript', role: 'assistant', text }] }));
      };
    });
  });
  return { players, sessions, posts, requests, deleted, peers, microphones,
    set holdReaderSetup(value) { holdReaderSetup = value; },
    set holdInputSetup(value) { holdInputSetup = value; },
    set holdInputAllocation(value) { holdInputAllocation = value; },
    releaseAllocation() { releaseInputAllocation(); },
    releaseInput() { releaseInputSetup(); },
    set postError(value) { postError = value; },
  };
}

test('startup and nine idle hours open no sessions; actual voice connects on demand', { timeout: 10_000 }, async t => {
  const fixture = conversationFixture(t);
  t.after(() => clearSubscriptionPreload());
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-04T20:00:00Z') });
  for (let minute = 0; minute < 9 * 60; minute++) {
    await preloadSubscriptionVoice('1', { enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol' });
    t.mock.timers.tick(60_000);
  }
  assert.equal(fixture.sessions.length, 0, 'startup preparation never opens a metered session');
  assert.equal(fixture.microphones.length, 0);
  assert.deepEqual(fixture.requests, [], 'idle ticks make no voice requests');
  const microphone = {};
  const voice = await connectSubscriptionVoice({ microphone, listening: false });
  assert.deepEqual(fixture.microphones, [microphone]);
  await voice.prepareSpeaker();
  assert.equal(fixture.sessions.length, 2, 'input and output connect only for actual voice');
  assert.ok(fixture.players.every(player => player.volume === 0));
  voice.setListening(true);
  assert.equal(voice.isHealthy(), true);
  await voice.close();
  await voice.close();
  assert.equal(fixture.deleted.length, 2, 'closing releases both slots exactly once');
});

test('a drained notification reader survives the old caller abort and starts the next notice without reconnecting', { timeout: 10_000 }, async t => {
  const fixture = conversationFixture(t);
  t.after(() => clearSubscriptionPreload());
  await preloadSubscriptionVoice('1', { enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol' }, false);
  const firstController = new AbortController();
  const first = await connectSubscriptionVoice({ signal: firstController.signal });
  await first.release(true);
  firstController.abort();
  await first.close();
  const second = await connectSubscriptionVoice();
  assert.equal(second.isHealthy(), true);
  assert.equal(fixture.sessions.length, 1);
  assert.equal(fixture.deleted.length, 0);
  const started = performance.now();
  const speech = second.speak('Your answer is ready.');
  await waitFor(() => fixture.posts.length === 1);
  assert.ok(performance.now() - started < 500, 'ready notification submits speech immediately');
  fixture.sessions[0].deliver('Your answer is ready.');
  await speech;
  await second.release(true);
});

test('microphone replies stay muted and cannot complete or prefix read-aloud', { timeout: 10_000 }, async t => {
  const fixture = conversationFixture(t);
  const { players, sessions, posts, deleted } = fixture;
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  let finished = false;
  const text = 'First words of the actual answer.';
  const reading = voice.speak(text).then(() => { finished = true; });
  await waitFor(() => posts.length === 1);
  assert.deepEqual(sessions.map(session => session.mode), ['conversation', 'speak']);
  assert.deepEqual(posts, [{ id: '1', text }]);
  assert.equal(players[0].volume, 0, 'microphone response must never be unmuted');
  assert.equal(players[1].volume, 1, 'the dedicated reader is audible while it reads the script');
  sessions[0].deliver('An unwanted reply to microphone input.');
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(finished, false, 'an unrelated transcript must not complete the reading');
  sessions[1].deliver(text);
  await reading;

  const next = voice.speak('A second message.');
  await waitFor(() => posts.length === 2);
  assert.equal(sessions.length, 2, 'reuse the dedicated reader for subsequent messages');
  voice.stopSpeaking();
  assert.ok(players.every(player => player.volume === 0), 'interruption immediately mutes both tracks');
  await next;

  const resumed = voice.speak('Fresh words after interruption.');
  await waitFor(() => posts.length === 3);
  assert.equal(posts[2].id, '2', 'interrupted remote audio is discarded before another reading');
  assert.ok(deleted.includes('1'), 'release the old reader before taking another session slot');
  assert.equal(players[1].volume, 0);
  sessions[2].deliver(posts[2].text);
  await resumed;
  await voice.close();
  assert.deepEqual(deleted.sort(), ['0', '1', '2'], 'closing releases all owned sessions');

  const cancelledVoice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => cancelledVoice.close());
  fixture.holdReaderSetup = true;
  const cancelledReading = cancelledVoice.speak('Cancelled before reader setup finishes.');
  await waitFor(() => sessions.length === 5);
  cancelledVoice.stopSpeaking();
  await cancelledReading;
  assert.equal(posts.length, 3, 'interruption during setup must not send or play a late script');
  assert.ok(players.every(player => player.volume === 0));
  await cancelledVoice.close();
  assert.deepEqual(deleted.sort(), ['0', '1', '2', '3', '4']);
});

test('completed readers survive turn cleanup and warmup never posts a script or unmutes audio', { timeout: 10_000 }, async t => {
  const { sessions, posts, players, deleted } = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  await Promise.all([voice.prepareSpeaker(), voice.prepareSpeaker()]);
  assert.equal(sessions.length, 2, 'concurrent warmups share one reader');
  assert.deepEqual(posts, [], 'warmup must not generate speech');
  assert.ok(players.every(player => player.volume === 0));
  voice.stopSpeaking();
  await voice.prepareSpeaker();
  assert.equal(sessions.length, 2, 'starting narration retains the warm reader');
  for (const text of ['The greeting.', 'The next answer.']) {
    const count = posts.length;
    const reading = voice.speak(text);
    await waitFor(() => posts.length > count);
    assert.equal(posts.at(-1).id, '1');
    sessions[1].deliver(text);
    await reading;
    // The overlay calls stop on both beginTurn and startNarration.
    voice.stopSpeaking();
    voice.setListening(true);
    voice.stopSpeaking();
    await voice.prepareSpeaker();
    assert.equal(sessions.length, 2, 'completed playback must not reconnect between turns');
    assert.deepEqual(deleted, []);
    assert.ok(players.every(player => player.volume === 0));
  }
  await voice.close();
  assert.deepEqual(deleted.sort(), ['0', '1']);
});

test('closing during silent warmup releases both sessions without late playback', async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  fixture.holdReaderSetup = true;
  const prepared = voice.prepareSpeaker();
  const rejected = assert.rejects(prepared, { name: 'AbortError' });
  await waitFor(() => fixture.sessions.length === 2);
  await voice.close();
  await rejected;
  assert.deepEqual(fixture.deleted.sort(), ['0', '1']);
  assert.deepEqual(fixture.posts, []);
});

test('event polling retries transient failures at the same cursor without losing the call or duplicating text', async t => {
  const fixture = transportFixture(t);
  const failures = [];
  const transcripts = [];
  const voice = await connectSubscriptionVoice({onDisconnect:error=>failures.push(error),onTranscript:text=>transcripts.push(text)});
  t.after(() => voice.close());
  fixture.push(new TypeError('Failed to fetch'));
  fixture.push(Response.json({error:'Temporarily unavailable'}, {status:503}));
  fixture.push(Response.json({cursor:2, events:[{type:'transcript',role:'user',text:'The next turn'}]}));
  await waitFor(() => transcripts.length > 0);
  assert.deepEqual(transcripts, ['The next turn']);
  assert.equal(await voice.finishTranscript(), 'The next turn');
  assert.equal(voice.isHealthy(), true);
  assert.deepEqual(failures, []);
  assert.deepEqual(fixture.polls.slice(1,4), Array(3).fill('/api/speech/subscription/fixture?cursor=1'));
  assert.equal(fixture.creates, 1);
});

test('a silent reader is retired before one automatic retry and the microphone stays connected', async t => {
  const fixture = conversationFixture(t);
  const { sessions, posts, deleted, players } = fixture;
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const now = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const reading = voice.speak('Recover this silent reading.');
  await waitFor(() => posts.length === 1);
  offset += 6000;
  await waitFor(() => posts.length === 2);
  assert.deepEqual(deleted, ['1']);
  assert.equal(players[1].volume, 0);
  assert.deepEqual(posts, [
    { id: '1', text: 'Recover this silent reading.' },
    { id: '2', text: 'Recover this silent reading.' },
  ]);
  sessions[2].deliver(posts[1].text);
  await reading;
  assert.equal(voice.isHealthy(), true);
  assert.equal(sessions.filter(session => session.mode === 'conversation').length, 1);
});

for (const completed of [false, true]) test(`reader metadata with completed=${completed} cannot hide silence or finish a reading`, async t => {
  const { sessions, posts, peers, deleted } = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const now = Date.now.bind(Date);
  let offset = 0, finished = false;
  t.mock.method(Date, 'now', () => now() + offset);
  const reading = voice.speak('The greeting must actually speak.').then(() => { finished = true; });
  await waitFor(() => posts.length === 1);
  peers[1].channel.emit({ type: 'turn.created', turn: { id: 'silent', role: 'assistant' } });
  peers[1].channel.emit({ type: 'output_transcript.added' });
  if (completed) peers[1].channel.emit({ type: 'turn.done', turn: { id: 'silent', role: 'assistant' } });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(finished, false, 'text completion without any audio must not count as successful speech');
  offset += 21000;
  await waitFor(() => posts.length === 2);
  assert.deepEqual(deleted, ['1']);
  sessions[2].deliver(posts[1].text);
  await reading;
  assert.equal(voice.isHealthy(), true);
});

test('transcript completion waits for delayed speech packets before finishing playback', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  let finished = false;
  const reading = voice.speak('The audio arrives after the transcript.').then(() => { finished = true; });
  await waitFor(() => fixture.creates === 2);
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'early', role: 'assistant', transcript: 'The audio arrives after the transcript.' } });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(finished, false);
  fixture.peer.energy += 0.1;
  await reading;
  assert.equal(fixture.creates, 2, 'late audio uses the same script, without replay');
});

test('silent retry has a finite budget and failed readers are not cached for later replies', async t => {
  const { sessions, posts, deleted } = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const now = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const rejected = assert.rejects(voice.speak('No speech this time.'), /did not start speaking/);
  await waitFor(() => posts.length === 1);
  offset += 21000;
  await waitFor(() => posts.length === 2);
  offset += 21000;
  await rejected;
  assert.equal(posts.length, 2);
  assert.deepEqual(deleted, ['1', '2']);
  assert.equal(voice.isHealthy(), true);
  const next = voice.speak('The next reply can still speak.');
  await waitFor(() => posts.length === 3);
  sessions[3].deliver(posts[2].text);
  await next;
});

test('partially spoken text and ambiguous POST failures are never replayed', async t => {
  const fixture = conversationFixture(t);
  const { posts, peers, deleted } = fixture;
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const now = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const rejected = assert.rejects(voice.speak('Some words already played.'), /did not finish the spoken response/);
  await waitFor(() => posts.length === 1);
  peers[1].energy = 0.2;
  await new Promise(resolve => setTimeout(resolve, 150));
  offset += 121000;
  await rejected;
  assert.equal(posts.length, 1);
  assert.deepEqual(deleted, ['1']);
  assert.equal(voice.isHealthy(), true);
  fixture.postError = true;
  await assert.rejects(voice.speak('An ambiguous request.'), /Ambiguous speech POST failure/);
  assert.equal(posts.length, 2);
  assert.deepEqual(deleted, ['1', '2']);
  assert.equal(voice.isHealthy(), true);
});

test('interruption during silent-reader recovery prevents replay', async t => {
  const fixture = conversationFixture(t);
  const { sessions, posts, deleted } = fixture;
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const now = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const reading = voice.speak('Stop before the retry.');
  await waitFor(() => posts.length === 1);
  fixture.holdReaderSetup = true;
  offset += 21000;
  await waitFor(() => sessions.length === 3);
  voice.stopSpeaking();
  await reading;
  assert.equal(posts.length, 1);
  assert.deepEqual(deleted, ['1', '2']);
  assert.equal(voice.isHealthy(), true);
});

test('an idle reader disconnect leaves the microphone healthy and the next reply uses a new reader', async t => {
  const { sessions, posts, peers, deleted } = conversationFixture(t);
  const disconnects = [];
  const voice = await connectSubscriptionVoice({ microphone: {}, onDisconnect: error => disconnects.push(error) });
  t.after(() => voice.close());
  const first = voice.speak('First reply.');
  await waitFor(() => posts.length === 1);
  sessions[1].deliver(posts[0].text);
  await first;
  peers[1].channel.close();
  assert.equal(voice.isHealthy(), true);
  assert.deepEqual(disconnects, []);
  const second = voice.speak('Next reply.');
  await waitFor(() => posts.length === 2);
  assert.deepEqual(deleted, ['1']);
  assert.equal(posts[1].id, '2');
  sessions[2].deliver(posts[1].text);
  await second;
});

test('a live reading that strays mid-message resumes from that sentence on a fresh reader, without repeating heard text', async t => {
  const { sessions, posts, deleted, players } = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const text = 'First sentence here. Second sentence follows now. Third one ends it.';
  const progress = [];
  const reading = voice.speak(text, true, value => progress.push(value));
  await waitFor(() => posts.length === 1);
  assert.equal(posts[0].text, text, 'the whole message is one live reading');
  sessions[1].deliver('First sentence here. Something else entirely instead now.');
  await waitFor(() => posts.length === 2);
  assert.deepEqual(deleted, ['1'], 'the strayed reader is released before another is used');
  assert.equal(posts[1].id, '2');
  assert.equal(posts[1].text, 'Second sentence follows now. Third one ends it.');
  sessions[2].deliver(posts[1].text);
  await reading;
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1] - 1e-9), 'the reading position never jumps back');
  assert.equal(voice.isHealthy(), true);
  assert.ok(players.every(player => player.volume === 0), 'both tracks are muted after the reading');
});

test('a reading that stops early continues with the unread remainder instead of starting over', async t => {
  const { sessions, posts, deleted } = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const text = 'First sentence here. Second sentence follows now.';
  const reading = voice.speak(text);
  await waitFor(() => posts.length === 1);
  sessions[1].deliver('First sentence here.');
  await waitFor(() => posts.length === 2);
  assert.deepEqual(deleted, ['1']);
  assert.equal(posts[1].text, 'Second sentence follows now.');
  sessions[2].deliver(posts[1].text);
  await reading;
  assert.equal(voice.isHealthy(), true);
});

test('resuming a strayed reading has a finite budget', async t => {
  const { sessions, posts, deleted } = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const text = 'First sentence here. Second sentence follows now. Third one ends it. Fourth one closes.';
  const rejected = assert.rejects(voice.speak(text), /stopped reading/);
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitFor(() => posts.length === attempt + 1);
    sessions[attempt + 1].deliver('Something else entirely instead of reading now.');
  }
  await rejected;
  assert.equal(posts.length, 3);
  assert.deepEqual(deleted, ['1', '2', '3']);
  assert.equal(voice.isHealthy(), true, 'the microphone connection is unaffected');
});

test('an utterance with no transcript times out without poisoning the next turn', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();
  t.after(() => voice.close());
  const now = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const missed = voice.finishTranscript();
  offset = 16000;
  assert.equal(await missed, '');
  assert.equal(voice.isHealthy(), true);
  voice.resetTranscript();
  voice.setListening(true);
  fixture.push(Response.json({cursor:2,events:[{type:'transcript',role:'user',text:'Try again'}]}));
  await waitFor(() => voice.transcript() === 'Try again');
  offset += 600;
  assert.equal(await voice.finishTranscript(), 'Try again');
  assert.equal(fixture.creates, 1);
});

test('poll failures stop after a finite budget and auth failures are surfaced immediately', async t => {
  for (const status of [503,403]) await t.test(String(status), async t => {
    const fixture = transportFixture(t);
    const failures = [];
    const voice = await connectSubscriptionVoice({onDisconnect:error=>failures.push(error)});
    t.after(() => voice.close());
    const attempts = status === 503 ? 4 : 1;
    for (let i=0;i<attempts;i++) fixture.push(Response.json({error:'Fixture provider failure'}, {status}));
    await waitFor(() => failures.length === 1);
    assert.equal(failures[0].message, 'Fixture provider failure');
    assert.equal(fixture.polls.length, 1 + attempts);
    assert.equal(voice.isHealthy(), false);
    await assert.rejects(voice.finishTranscript(), /Fixture provider failure/);
    await voice.close();
    assert.equal(failures.length, 1, 'intentional cleanup must not report another disconnect');
    assert.equal(fixture.deletes, 1);
  });
});

test('failed media notifies an idle call; closing during a poll retry cancels further work', async t => {
  const fixture = transportFixture(t);
  const failures = [];
  const voice = await connectSubscriptionVoice({onDisconnect:error=>failures.push(error)});
  t.after(() => voice.close());
  fixture.push(new TypeError('Failed to fetch'));
  await new Promise(resolve => setTimeout(resolve, 20));
  fixture.peer.connectionState = 'failed';
  fixture.peer.onconnectionstatechange();
  assert.equal(failures.length, 1);
  assert.equal(voice.isHealthy(), false);
  await Promise.all([voice.close(), voice.close()]);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(fixture.polls.length, 2);
  assert.equal(fixture.creates, 1);
  assert.equal(fixture.deletes, 1);
  assert.equal(failures.length, 1);
});

test('closing a voice tab sends keepalive cleanup before waiting for audio shutdown', async t => {
  const fixture = transportFixture(t);
  const page = new EventTarget();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: page });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  let finishAudioClose;
  t.mock.method(AudioContext.prototype, 'close', () => new Promise(resolve => { finishAudioClose = resolve; }));
  const voice = await connectSubscriptionVoice();
  const fetch = globalThis.fetch;
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => { requests.push({ url, options }); return fetch(url, options); });
  page.dispatchEvent(new Event('pagehide'));
  try {
    assert.equal(fixture.peer.connectionState, 'closed');
    assert.equal(fixture.deletes, 1, 'the tab must send DELETE before its asynchronous audio cleanup');
    assert.equal(requests[0].options.keepalive, true);
    assert.equal(requests[0].options.signal.aborted, false, 'cleanup outlives the cancelled voice operation');
  } finally {
    const closing = voice.close();
    finishAudioClose?.();
    await closing;
  }
  page.dispatchEvent(new Event('pagehide'));
  assert.equal(fixture.deletes, 1, 'page cleanup removes its listener and releases each session once');
});

test('read-aloud waits for both retiring cached connections after voice gives up its slots', async t => {
  const fixture = conversationFixture(t);
  t.after(() => clearSubscriptionPreload());
  await preloadSubscriptionVoice('1', { enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol' });
  const conversation = await connectSubscriptionVoice({ mode: 'conversation', listening: false });
  await conversation.prepareSpeaker();
  await conversation.release(true);
  await waitFor(() => fixture.sessions.length === 2);
  const fetch = globalThis.fetch;
  const finishDeletes = [];
  t.mock.method(globalThis, 'fetch', (url, options) => options?.method === 'DELETE'
    ? new Promise(resolve => { finishDeletes.push(() => resolve(fetch(url, options))); }) : fetch(url, options));
  const clearing = clearSubscriptionPreload();
  const reading = connectSubscriptionVoice();
  await waitFor(() => finishDeletes.length === 2);
  try {
    assert.equal(fixture.sessions.length, 2, 'read-aloud must wait until the previous session slots are released');
  } finally {
    finishDeletes.forEach(finish => finish());
    await clearing;
    const voice = await reading;
    globalThis.fetch = fetch;
    await voice.close();
  }
  assert.equal(fixture.sessions.length, 3);
  assert.equal(fixture.deleted.length, 3);
});

test('read-aloud retries an explicit busy rejection while another tab releases its slots', async t => {
  const fixture = transportFixture(t);
  const fetch = globalThis.fetch;
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (url === '/api/speech/subscription' && ++attempts <= 2) {
      return Promise.resolve(Response.json({ error: 'Another voice operation is still running.' }, { status: 429 }));
    }
    return fetch(url, options);
  });
  const voice = await connectSubscriptionVoice();
  try {
    assert.equal(attempts, 3);
    assert.equal(fixture.creates, 1, 'only the successful allocation creates a session');
    assert.equal(fixture.deletes, 0, 'no existing active session is interrupted');
  } finally { await voice.close(); }
});

test('cancelling during a capacity retry prevents a late connection', async t => {
  const fixture = transportFixture(t);
  const controller = new AbortController();
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    return Response.json({ error: 'Voice busy' }, { status: 429 });
  });
  const connection = connectSubscriptionVoice({ signal: controller.signal });
  const rejected = assert.rejects(connection, { name: 'AbortError' });
  await waitFor(() => attempts === 1);
  controller.abort();
  await rejected;
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(attempts, 1);
  assert.equal(fixture.peer.connectionState, 'closed');
});

test('ambiguous creation failures and non-capacity rejections are never replayed', async t => {
  for (const status of [undefined, 403, 503]) await t.test(String(status), async t => {
    const fixture = transportFixture(t);
    let attempts = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      attempts++;
      if (status === undefined) throw new TypeError('Ambiguous creation failure');
      return Response.json({ error: 'Creation rejected' }, { status });
    });
    await assert.rejects(connectSubscriptionVoice(), /creation failure|Creation rejected/);
    assert.equal(attempts, 1);
    assert.equal(fixture.peer.connectionState, 'closed');
  });
});


test('conversational wording reaches the separate reader without adding delivery instructions', { timeout: 10000 }, async t => {
  const { sessions, posts, requests } = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  const text = "That's the latest result. The date is October 3.";
  const reading = voice.speak(text, true);
  await waitFor(() => posts.length === 1);
  assert.equal(requests[0], text);
  assert.equal(posts[0].text, text);
  sessions[1].deliver(text); await reading;
  const plain = voice.speak('Read this exact sentence.');
  await waitFor(() => posts.length === 2);
  assert.equal(requests[1], 'Read this exact sentence.');
  sessions[1].deliver('Read this exact sentence.'); await plain;
});

test('conversation spells explicit temperature units out and still delivers every sentence', { timeout: 10000 }, async t => {
  const { sessions, posts } = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  const reading = voice.speak('The high is 11°C and the low is 5°C. Keep the window closed.');
  await waitFor(() => posts.length === 1);
  assert.equal(posts[0].text, 'The high is 11 degrees Celsius and the low is 5 degrees Celsius. Keep the window closed.');
  sessions[1].deliver('The high is eleven degrees Celsius and the low is five degrees. Keep the window closed.'); await reading;
});

test('ordinary read-aloud keeps the original temperature script', { timeout: 10000 }, async t => {
  const { sessions, posts } = conversationFixture(t);
  const voice = await connectSubscriptionVoice(); t.after(() => voice.close());
  const reading = voice.speak('The reading is 11°C. Keep the window closed.');
  await waitFor(() => posts.length === 1);
  assert.equal(posts[0].text, 'The reading is 11°C. Keep the window closed.');
  sessions[0].deliver('The reading is eleven degrees Celsius. Keep the window closed.'); await reading;
});


test('conversation uses the complete media transcript before a delayed or missing relay', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcriptDelta', role: 'user', text: 'The incomplete' }] }));
  await waitFor(() => voice.transcript() === 'The incomplete');
  fixture.peer.channel.emit({ type: 'input_transcript.added', start_ms: 0, end_ms: 1000, item: { id: 'input', text: 'The complete final words.' } });
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'final', role: 'user', start_ms: 0, end_ms: 1200, transcript: 'The complete final words.' } });
  const started = performance.now();
  assert.equal(await voice.finishTranscript({ settleFinal: true }), 'The complete final words.');
  assert.ok(performance.now() - started < 1000, 'confirmed media words do not wait on the relay');
  fixture.push(Response.json({ cursor: 3, events: [{ type: 'transcript', role: 'user', text: 'The incomplete' }] }));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(voice.transcript(), 'The complete final words.');
});

test('conversation with activity but no final event settles complete stable words without a timeout', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  fixture.peer.channel.emit({ type: 'input_transcript.added', start_ms: 0, end_ms: 1000 });
  fixture.push(Response.json({ cursor: 2, events: [{ type: 'transcriptDelta', role: 'user', text: 'Keep the' }] }));
  await waitFor(() => voice.transcript() === 'Keep the');
  let finished = false;
  const final = voice.finishTranscript({ settleFinal: true }).then(text => { finished = true; return text; });
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(finished, false, 'do not send an incomplete delta after 500 ms');
  fixture.push(Response.json({ cursor: 3, events: [{ type: 'transcriptDelta', role: 'user', text: ' last words.' }] }));
  assert.equal(await final, 'Keep the last words.');
  assert.equal(voice.isHealthy(), true);
});

test('a late cumulative provider final settles the current utterance without repeating prior requests', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  fixture.peer.channel.emit({ type: 'input_transcript.added', start_ms: 0, end_ms: 1000, item: { id: 'old', text: 'Earlier request' } });
  voice.resetTranscript();
  fixture.peer.channel.emit({ type: 'input_transcript.added', start_ms: 2000, end_ms: 3000, item: { id: 'new', text: 'New request' } });
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'combined', role: 'user', start_ms: 0, end_ms: 3200, transcript: 'Earlier request New request' } });
  const started = performance.now();
  assert.equal(await voice.finishTranscript({ settleFinal: true }), 'New request');
  assert.ok(performance.now() - started < 1000, 'fresh confirmed words do not wait for an impossible match to the cumulative final');
  assert.equal(voice.isHealthy(), true);
});

test('live conversation recovers its next answer when a reading command never acknowledges', {timeout:9000},async t=>{
 const {sessions,posts,deleted}=conversationFixture(t);
 const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());await voice.prepareSpeaker();
 const fetch=globalThis.fetch;let requests=0,commandSignal;
 t.mock.method(globalThis,'fetch',(url,options)=>{
  if(options?.method==='POST'&&JSON.parse(options.body).text&&requests++===0){commandSignal=options.signal;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}
  return fetch(url,options);
 });
 const started=Date.now();await assert.rejects(voice.speak('This answer cannot start.'),/voice service did not respond/);
 assert.ok(Date.now()-started<6500,'no fifty-second silent command wait');assert.equal(commandSignal.aborted,true);
 assert.equal(requests,1,'ambiguous acknowledgement is not replayed');assert.equal(voice.isHealthy(),true);
 assert.deepEqual(deleted,['1']);
 const next=voice.speak('The next answer can speak.');await waitFor(()=>posts.length===1);sessions[2].deliver(posts[0].text);await next;
 assert.equal(requests,2);assert.equal(voice.isHealthy(),true);
});

 test('provider quota failure is not misreported as a selected-voice failure', async t=>{
 const fixture=transportFixture(t);const voice=await connectSubscriptionVoice();t.after(()=>voice.close());
 fixture.peer.channel.emit({type:'error',error:{code:'rate_limit_exceeded'}});
 await assert.rejects(voice.speak('This must not be sent.'),/speech provider is temporarily rate limited/);
 assert.equal(voice.isHealthy(),false);
 });
 test('a confirmed session reports later provider failures separately from voice selection', async t=>{
 const fixture=transportFixture(t);const voice=await connectSubscriptionVoice();t.after(()=>voice.close());
 fixture.peer.channel.emit({type:'error',error:{code:'server_error'}});
 await assert.rejects(voice.speak('This must not be sent.'),/speech provider connection failed/);
 });

test('conversation prepares its muted reader while microphone media is still connecting', async t=>{
 const fixture=conversationFixture(t);fixture.holdInputSetup=true;
 const controller=new AbortController();
 const connecting=connectSubscriptionVoice({mode:'conversation',microphone:{},signal:controller.signal});
 void connecting.catch(()=>{});
 t.after(async()=>{controller.abort();await connecting.catch(()=>{});});
 await waitFor(()=>fixture.sessions.length===2);
 assert.deepEqual(fixture.sessions.map(s=>s.mode),['conversation','speak']);
 assert.deepEqual(fixture.posts,[]);
 assert.ok(fixture.players.every(p=>p.volume===0),'warming must stay silent');
 fixture.releaseInput();const voice=await connecting;
 await voice.prepareSpeaker();assert.equal(fixture.sessions.length,2,'first answer reuses the parallel reader');
 await voice.close();assert.deepEqual(fixture.deleted.sort(),['0','1']);
});
test('cancelling parallel conversation startup releases both reserved slots',async t=>{
 const fixture=conversationFixture(t);fixture.holdInputSetup=true;fixture.holdReaderSetup=true;
 const controller=new AbortController();
 const connecting=connectSubscriptionVoice({mode:'conversation',microphone:{},signal:controller.signal});
 void connecting.catch(()=>{});
 t.after(async()=>{controller.abort();await connecting.catch(()=>{});});
 await waitFor(()=>fixture.sessions.length===2);controller.abort();
 await assert.rejects(connecting,{name:'AbortError'});
 assert.deepEqual(fixture.deleted.sort(),['0','1']);assert.deepEqual(fixture.posts,[]);
});
test('input-only dictation never reserves an unused parallel speaker',async t=>{
 const fixture=conversationFixture(t);
 const voice=await connectSubscriptionVoice({mode:'conversation',microphone:{},inputOnly:true});
 try{assert.equal(fixture.sessions.length,1);assert.deepEqual(fixture.posts,[]);}
 finally{await voice.close();}
});


test('an accepted reading with no audio or reader activity recovers before a five-second wait', async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const now = Date.now.bind(Date); let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const reading = voice.speak('The complete response is retained.');
  void reading.catch(() => {});
  await waitFor(() => fixture.posts.length === 1);
  offset += 3200;
  const recoveryStarted = performance.now();
  await waitFor(() => fixture.posts.length === 2);
  assert.ok(performance.now() - recoveryStarted < 1000, 'a confirmed idle reader must recover near three seconds');
  assert.deepEqual(fixture.deleted, ['1']);
  assert.equal(fixture.players[1].volume, 0);
  assert.equal(fixture.posts[1].text, fixture.posts[0].text);
  fixture.sessions[2].deliver(fixture.posts[1].text);
  await reading;
  assert.equal(voice.isHealthy(), true);
});

test('reader activity retains the audio allowance without duplicating a slow first word', async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  const now = Date.now.bind(Date); let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const reading = voice.speak('These words arrive after generation starts.');
  await waitFor(() => fixture.posts.length === 1);
  fixture.peers[1].channel.emit({type:'turn.created',turn:{id:'starting',role:'assistant'}});
  offset += 3200;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(fixture.posts.length, 1);
  assert.deepEqual(fixture.deleted, []);
  fixture.sessions[1].deliver(fixture.posts[0].text);
  fixture.peers[1].channel.emit({type:'turn.done',turn:{id:'starting',role:'assistant',transcript:fixture.posts[0].text}});
  await reading;
});

test('an unfinalized media span retains a last word arriving after a one-second recognition gap', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({microphone:{}});
  t.after(() => voice.close());
  let offset = 0; const now = Date.now.bind(Date);
  t.mock.method(Date, 'now', () => now() + offset);
  const emit = value => fixture.peer.channel.emit(value);
  emit({type:'input_transcript.added',start_ms:0,end_ms:200,item:{id:'prefix',text:'Keep the last'}});
  let finished = false;
  const result = voice.finishTranscript({settleFinal:true}).then(text => {finished=true;return text;});
  offset += 1000;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(finished, false, 'the pending media span must not commit a truncated request');
  emit({type:'input_transcript.added',start_ms:800,end_ms:1000,item:{id:'tail',text:' word'}});
  emit({type:'turn.done',turn:{id:'complete',role:'user',start_ms:0,end_ms:1200,transcript:'Keep the last word.'}});
  offset += 250;
  assert.equal(await result, 'Keep the last word.');
  voice.resetTranscript();
  emit({type:'turn.done',turn:{id:'complete',role:'user',start_ms:0,end_ms:1200,transcript:'Keep the last word.'}});
  assert.equal(voice.transcript(), '');
});

test('a new acoustic turn drops old delayed recognition without clipping early interruption words', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({microphone:{}});
  t.after(() => voice.close());
  let offset = 0; const now = Date.now.bind(Date);
  t.mock.method(Date, 'now', () => now() + offset);
  const emit = value => fixture.peer.channel.emit(value);
  emit({type:'input_transcript.added',start_ms:0,end_ms:400,item:{id:'old',text:'An old request'}});
  voice.resetTranscript();
  emit({type:'input_transcript.added',start_ms:400,end_ms:600,item:{id:'late',text:' please'}});
  offset += 2200;
  emit({type:'input_transcript.added',start_ms:2000,end_ms:2400,item:{id:'new',text:'Actually stop'}});
  voice.beginTranscript?.();
  assert.equal(voice.transcript(), 'Actually stop');
});

test('the direct media transcript mutes an abandoned reading before a missing relay or final', {timeout:3000}, async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();t.after(() => voice.close());
  const script = 'A rainbow appears when sunlight shines through raindrops.';
  const rejected=assert.rejects(voice.speak(script), error=>error.resumeAt===0);
  await waitFor(()=>fixture.creates===2);
  fixture.peer.channel.emit({type:'output_transcript.added',item:{text:'It is something '}});
  await rejected;
  assert.equal(fixture.players.find(p=>p.srcObject).volume,0);
});

test('direct output words remain authoritative when a stale relay arrives', {timeout:3000}, async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice();t.after(() => voice.close());
  const script='Keep the selected reading intact.';
  const reading=voice.speak(script);await waitFor(()=>fixture.creates===2);
  fixture.peer.channel.emit({type:'output_transcript.added',item:{text:'Keep the selected '}});
  fixture.push(Response.json({cursor:2,events:[{type:'transcriptDelta',role:'assistant',text:'Unrelated previous words entirely '}]}));
  await new Promise(resolve=>setTimeout(resolve,75));
  fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'output_transcript.added',item:{text:'reading intact.'}});
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'reading',role:'assistant',transcript:script}});
  await reading;assert.equal(voice.isHealthy(),true);
});

test('short numeric answers reject added words or the wrong language', {timeout:3000}, async t => {
  const fixture=transportFixture(t);
  const voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  const rejected=assert.rejects(voice.speak('28'),error=>typeof error.resumeAt==='number');
  await waitFor(()=>fixture.creates===2);
  fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'wrong-number',role:'assistant',transcript:'Ventotto ottobre.'}});
  await rejected;assert.equal(fixture.players.find(p=>p.srcObject).volume,0);
});

test('a correct numeric reading remains live and is spelled before submission', async t => {
  const fixture=conversationFixture(t);
  const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());
  const reading=voice.speak('28');await waitFor(()=>fixture.posts.length===1);
  assert.equal(fixture.posts[0].text,'The answer is twenty eight.');
  fixture.sessions[1].deliver('The answer is twenty-eight.');
  await reading;assert.equal(voice.isHealthy(),true);
});

test('natural contraction expansion does not restart an otherwise exact reading', {timeout:3000}, async t => {
  const fixture=transportFixture(t);
  const voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  const reading=voice.speak("It's going well. What's the plan?");
  const completed=reading.then(()=>({ok:true}),error=>({ok:false,error:String(error)}));
  await waitFor(()=>fixture.creates===2);
  fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'output_transcript.added',item:{text:'It is going well. What is the plan? '}});
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'expanded-contractions',role:'assistant',transcript:'It is going well. What is the plan?'}});
  assert.deepEqual(await completed,{ok:true});
  assert.equal(voice.isHealthy(),true);
});


for(const ending of ['Done.','Stay warm.','Do not.'])test('a missing short ending is read completely: '+ending,{timeout:4000},async t=>{
 const {sessions,posts,deleted}=conversationFixture(t);
 const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());
 const first='This is the complete first sentence. ',text=first+ending;
 let finished=false;
 const reading=voice.speak(text).then(()=>{finished=true;});
 await waitFor(()=>posts.length===1);
 sessions[1].deliver(first.trim());
 await waitFor(()=>posts.length===2||finished);
 assert.equal(posts.length,2,'a short unspoken final sentence must not be discarded');
 assert.equal(posts[1].text,ending,'completed sentences must not be repeated');
 assert.deepEqual(deleted,['1']);
 sessions[2].deliver(ending);
 await reading;assert.equal(voice.isHealthy(),true);
});


for (const holdReaderSetup of [false, true]) {
  test(`closing a preloaded conversation with a ${holdReaderSetup ? 'connecting' : 'ready'} reader permits reopening`, { timeout: 4000 }, async t => {
    const fixture = conversationFixture(t);
    fixture.holdReaderSetup = holdReaderSetup;
    await preloadSubscriptionVoice('1', { enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol' });
    const controller = new AbortController();
    const voice = await connectSubscriptionVoice({ microphone: {}, signal: controller.signal });
    const preparing = voice.prepareSpeaker().catch(() => {});
    await waitFor(() => fixture.sessions.length === 2 && !fixture.sessions[1].initial);
    if (!holdReaderSetup) await preparing;
    assert.deepEqual(fixture.sessions.map(session => session.mode), ['conversation', 'speak']);
    controller.abort();
    await voice.close();
    await preparing;
    await clearSubscriptionPreload();
    assert.deepEqual(fixture.deleted.toSorted(), ['0', '1'], 'both old slots close exactly once');
    fixture.holdReaderSetup = false;
    await preloadSubscriptionVoice('1', { enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol' });
    const reopened = await connectSubscriptionVoice({ microphone: {} });
    await reopened.prepareSpeaker();
    assert.deepEqual(fixture.sessions.map(session => session.mode), ['conversation', 'speak', 'conversation', 'speak'],
      'reopening creates exactly one new input and its prepared output');
    assert.equal(reopened.isHealthy(), true);
    assert.ok(fixture.players.every(player => player.volume === 0), 'reopening alone cannot play speech');
    await reopened.close();
    await clearSubscriptionPreload();
    assert.deepEqual(fixture.deleted.toSorted(), ['0', '1', '2', '3'], 'all owned slots close exactly once');
  });
}


for (const missing of ['Wait.', 'Stay warm.', 'Do not enter.', 'Keep the door closed.']) {
  test('a missing middle sentence triggers readout recovery: ' + missing, { timeout: 4000 }, async t => {
    const { sessions, posts, deleted } = conversationFixture(t);
    const voice = await connectSubscriptionVoice({ microphone: {} });
    t.after(() => voice.close());
    const first = 'The first sentence is complete. ';
    const last = 'Here is the next complete sentence.';
    const text = first + missing + ' ' + last;
    let finished = false;
    const reading = voice.speak(text).then(() => { finished = true; });
    await waitFor(() => posts.length === 1);
    sessions[1].deliver(first + last);
    await waitFor(() => posts.length === 2 || finished);
    assert.equal(posts.length, 2, 'skipped sentences cannot count as a complete reading');
    assert.equal(posts[1].text, missing + ' ' + last, 'recovery starts at the first unread sentence');
    assert.deepEqual(deleted, ['1']);
    sessions[2].deliver(missing + ' ' + last);
    await reading;
    assert.equal(voice.isHealthy(), true);
  });
}


for (const [first, spokenFirst, pronunciations] of [
  ['AI is ready. ', 'Artificial intelligence is ready. ', 'AI = Artificial intelligence'],
  ['International Business Machines is ready. ', 'IBM is ready. ', 'International Business Machines = IBM'],
  ['SQL is ready. ', 'sequel is ready. ', 'SQL = sequel\nsequel = follow-up'],
  ['It is 11°C. ', 'It is 11 degrees Celsius. ', ''],
  ['Water is 11°C. ', 'Liquid is 11 degrees Celsius. ', 'Water = Liquid'],
]) test('recovery preserves every remaining word after a pronunciation: ' + first, {timeout:4000}, async t=>{
  const {sessions,posts}=conversationFixture(t,{pronunciations});
  const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());
  const rest='Read the remaining sentences. Stay here.';
  let finished=false;
  const reading=voice.speak(first+rest).then(()=>{finished=true;});
  await waitFor(()=>posts.length===1);
  assert.equal(posts[0].text,spokenFirst+rest);
  sessions[1].deliver(spokenFirst.trim());
  await waitFor(()=>posts.length===2||finished);
  assert.equal(posts.length,2,'an expanded first sentence must not discard the remainder');
  assert.equal(posts[1].text,rest,'the recovery offset belongs to the original script');
  sessions[2].deliver(rest);await reading;
  assert.equal(voice.isHealthy(),true);
});

test('recovery after a long passage retains the original paragraph spacing', {timeout:4000}, async t=>{
  const {sessions,posts}=conversationFixture(t);
  const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());
  const first='Every sentence is read accurately. '.repeat(107).trim();
  const next='The second passage begins with several words that are deliberately long enough to start a new transport request. ';
  const last='Keep all remaining words.';
  const text=first+'\n\n    '+next+last;
  assert.deepEqual(splitLiveSpeechText(text),[first,next+last]);
  const reading=voice.speak(text);
  await waitFor(()=>posts.length===1);sessions[1].deliver(first);
  await waitFor(()=>posts.length===2);sessions[1].deliver(next.trim());
  await waitFor(()=>posts.length===3);
  assert.equal(posts[2].text,last,'discarded chunk whitespace must not shift recovery into already spoken words');
  sessions[2].deliver(last);await reading;
});

test('unfinished recognition retains a tail arriving after the recorded 2.83 second gap', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice({microphone:{}});t.after(() => voice.close());
  let offset=0;const now=Date.now.bind(Date);t.mock.method(Date,'now',()=>now()+offset);
  const emit=message=>fixture.peer.channel.emit(message);
  emit({type:'input_transcript.added',start_ms:0,end_ms:1000,item:{id:'head',text:'Compare the routes and include'}});
  emit({type:'turn.created',turn:{id:'unfinished',role:'user',start_ms:0,end_ms:1000}});
  let finished=false;const result=voice.finishTranscript({settleFinal:true}).then(text=>{finished=true;return text;});
  offset+=2830;await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(finished,false,'a stalled recognizer must not turn the prefix into the request');
  emit({type:'input_transcript.added',start_ms:1000,end_ms:1400,item:{id:'tail',text:' their travel times'}});
  emit({type:'turn.done',turn:{id:'unfinished',role:'user',start_ms:0,end_ms:1600,transcript:'Compare the routes and include their travel times.'}});
  offset+=250;
  assert.equal(await result,'Compare the routes and include their travel times.');
  assert.equal(fixture.creates,1,'no second recording or provider session is started');
});

test('a missing provider final has a bounded settle path that restarts when delayed words arrive', async t => {
  const fixture=transportFixture(t);const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());
  let offset=0;const now=Date.now.bind(Date);t.mock.method(Date,'now',()=>now()+offset);
  const emit=message=>fixture.peer.channel.emit(message);
  emit({type:'input_transcript.added',start_ms:0,end_ms:1000,item:{id:'head',text:'Set the reminder for'}});
  let finished=false;const result=voice.finishTranscript({settleFinal:true}).then(text=>{finished=true;return text;});
  offset+=2830;await new Promise(resolve=>setTimeout(resolve,60));assert.equal(finished,false);
  emit({type:'input_transcript.added',start_ms:1000,end_ms:1400,item:{id:'tail',text:' next Tuesday'}});
  offset+=450;await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(finished,false,'new words must restart the unfinished recognition window');
  offset+=2800;assert.equal(await result,'Set the reminder for next Tuesday');
  assert.equal(voice.isHealthy(),true);
});

test('confirmed final transcription keeps the short guard even after an earlier unfinished span', async t => {
  const fixture=transportFixture(t);const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());
  let offset=0;const now=Date.now.bind(Date);t.mock.method(Date,'now',()=>now()+offset);
  const emit=message=>fixture.peer.channel.emit(message);
  emit({type:'input_transcript.added',start_ms:0,end_ms:600,item:{id:'greeting',text:'Hello there'}});
  emit({type:'turn.done',turn:{id:'greeting-final',role:'user',start_ms:0,end_ms:800,transcript:'Hello there.'}});
  const started=performance.now();const result=voice.finishTranscript({settleFinal:true});offset+=250;
  assert.equal(await result,'Hello there.');
  assert.ok(performance.now()-started<400,'finalized speech does not inherit the unfinished-recognition wait');
});

test('audio timeline keeps later sentences audible across an early completion and a natural pause', async t => {
  const fixture=transportFixture(t),voice=await connectSubscriptionVoice();
  t.after(()=>voice.close());
  const script='The first sentence has finished. The second sentence arrives after a pause. This is the final sentence.';
  let finished=false;
  const reading=voice.speak(script).then(()=>{finished=true;});
  await waitFor(()=>fixture.creates===2);
  fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'long-reading',role:'assistant',start_ms:1000,end_ms:2600,transcript:script}});
  await new Promise(resolve=>setTimeout(resolve,650));
  assert.equal(finished,false,'generation completion and a sentence pause do not finish playback');
  assert.equal(fixture.players.find(player=>player.srcObject)?.volume,1,'later PCM must still reach the speaker');
  const audible=[];
  for(let sentence=0;sentence<2;sentence++){
    fixture.peer.energy+=0.1;
    audible.push(fixture.players.find(player=>player.srcObject)?.volume===1);
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  assert.deepEqual(audible,[true,true]);
  await reading;
  assert.equal(fixture.players.find(player=>player.srcObject)?.volume,0);
  assert.deepEqual(fixture.scripts,[script],'no repeated request to cover a clipped sentence');
});

test('audio timeline still needs generation completion and fresh drained samples',async t=>{
  const fixture=transportFixture(t),voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  let finished=false;const script='Wait for the actual final word.';
  const reading=voice.speak(script).then(()=>{finished=true;});
  await waitFor(()=>fixture.creates===2);fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'turn.created',turn:{id:'pending',role:'assistant',start_ms:200,end_ms:400,transcript:script}});
  await new Promise(resolve=>setTimeout(resolve,800));assert.equal(finished,false,'elapsed audio timeline alone is not completion');
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'pending',role:'assistant',start_ms:200,end_ms:400,transcript:script}});
  const completedAt=performance.now();await reading;
  assert.ok(performance.now()-completedAt<650,'a genuinely drained answer returns the floor promptly');
});

test('audio timeline interruption mutes immediately without waiting for scheduled words',async t=>{
  const fixture=transportFixture(t),voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  const script='The answer can be interrupted. These later sentences must not play.';
  const reading=voice.speak(script);await waitFor(()=>fixture.creates===2);fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'cancel',role:'assistant',start_ms:100,end_ms:6100,transcript:script}});
  await new Promise(resolve=>setTimeout(resolve,150));const stoppedAt=performance.now();voice.stopSpeaking();
  assert.equal(fixture.players.find(player=>player.srcObject)?.volume,0);
  await reading;assert.ok(performance.now()-stoppedAt<250);
});

test('audio timeline cannot leave a stalled or frozen receiver speaking forever',async t=>{
  const fixture=transportFixture(t),voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  const realNow=Date.now;let offset=0;t.mock.method(Date,'now',()=>realNow()+offset);
  const script='A stalled receiver must report a failure.';
  const reading=voice.speak(script);const failure=assert.rejects(reading,/spoken response did not finish/);
  await waitFor(()=>fixture.creates===2);
  fixture.peer.energy+=0.1;fixture.peer.incomingStats.totalSamplesDuration=1;
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'frozen-span',role:'assistant',start_ms:100,end_ms:2100,transcript:script}});
  await new Promise(resolve=>setTimeout(resolve,150));offset+=34000;await failure;
  assert.equal(fixture.players.find(player=>player.srcObject)?.volume,0);
  assert.equal(voice.isHealthy(),false);
});

test('audio timeline allows a complete long paragraph to drain beyond thirty seconds',async t=>{
  const fixture=transportFixture(t),voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  const realNow=Date.now;let offset=0;t.mock.method(Date,'now',()=>realNow()+offset);
  const script='A long paragraph still owns its complete scheduled audio.';
  let finished=false;const reading=voice.speak(script).then(()=>{finished=true;});
  await waitFor(()=>fixture.creates===2);fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'long-span',role:'assistant',start_ms:100,end_ms:41100,transcript:script}});
  await new Promise(resolve=>setTimeout(resolve,150));offset+=31000;
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(finished,false);
  fixture.peer.energy+=0.1;offset+=11000;await reading;
  assert.equal(fixture.players.find(player=>player.srcObject)?.volume,0);
});

test('measured playout does not finish during fresh concealed comfort noise', async t => {
  const fixture=transportFixture(t), voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  const realNow=Date.now;let offset=0;t.mock.method(Date,'now',()=>realNow()+offset);
  const peer=fixture.peer, getStats=peer.getStats.bind(peer);
  let samples=0, concealed=0;
  peer.getStats=async()=>{const stats=await getStats();Object.assign(stats.get('incoming'),{codecId:'codec',totalSamplesReceived:samples,concealedSamples:concealed,totalSamplesDuration:realNow()/1000});stats.set('codec',{clockRate:48000});return stats;};
  const script='The opening sentence. The delayed ending must still be heard.';
  let finished=false;const reading=voice.speak(script).then(()=>{finished=true;});
  await waitFor(()=>fixture.creates===2);
  // One reader connection is borrowed for this request; instrument that peer.
  const reader=fixture.peer, readerStats=reader.getStats.bind(reader);
  reader.getStats=async()=>{const stats=await readerStats();Object.assign(stats.get('incoming'),{codecId:'codec',totalSamplesReceived:samples,concealedSamples:concealed,totalSamplesDuration:realNow()/1000});stats.set('codec',{clockRate:48000});return stats;};
  await new Promise(resolve=>setTimeout(resolve,80));
  samples=24000;reader.energy+=0.1;
  reader.channel.emit({type:'turn.done',turn:{id:'delayed-media',role:'assistant',start_ms:100,end_ms:1700,transcript:script}});
  await new Promise(resolve=>setTimeout(resolve,150));
  // A real decoder continues producing fresh comfort-noise samples while
  // the network cannot deliver the remaining sentence.
  samples+=96000;concealed+=96000;offset+=2200;
  await new Promise(resolve=>setTimeout(resolve,350));
  try { assert.equal(finished,false,'elapsed wall time and fresh concealed samples cannot stand in for later words');
    assert.equal(fixture.players.find(player=>player.srcObject)?.volume,1);
  } catch(error){voice.stopSpeaking();await reading;throw error;}
  samples+=76800;reader.energy+=0.1;
  await reading;
  assert.equal(fixture.players.find(player=>player.srcObject)?.volume,0);
});

test('measured playout times out rather than claiming a concealed tail was spoken',async t=>{
  const fixture=transportFixture(t),voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  const realNow=Date.now;let offset=0;t.mock.method(Date,'now',()=>realNow()+offset);
  const script='This tail is lost in a connection failure.';
  const reading=voice.speak(script);const failure=assert.rejects(reading,/spoken response did not finish/);
  await waitFor(()=>fixture.creates===2);
  const reader=fixture.peer,original=reader.getStats.bind(reader);let samples=0,concealed=0;
  reader.getStats=async()=>{const stats=await original();Object.assign(stats.get('incoming'),{codecId:'codec',totalSamplesReceived:samples,concealedSamples:concealed,totalSamplesDuration:realNow()/1000});stats.set('codec',{clockRate:48000});return stats;};
  await new Promise(resolve=>setTimeout(resolve,80));samples=4800;reader.energy+=0.1;
  reader.channel.emit({type:'turn.done',turn:{id:'lost-media',role:'assistant',start_ms:100,end_ms:2100,transcript:script}});
  await new Promise(resolve=>setTimeout(resolve,150));samples+=48000*35;concealed+=48000*35;offset+=35000;
  await failure;assert.equal(fixture.players.find(player=>player.srcObject)?.volume,0);
});

test('stale completed assistant events cannot extend the following passage',async t=>{
  const fixture=transportFixture(t),voice=await connectSubscriptionVoice();t.after(()=>voice.close());
  let reading=voice.speak('First short reading.');await waitFor(()=>fixture.creates===2);fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'first-timeline',role:'assistant',start_ms:100,end_ms:200,transcript:'First short reading.'}});
  await reading;
  let finished=false;reading=voice.speak('Second short reading.').then(()=>{finished=true;});await waitFor(()=>fixture.scripts.length===2);
  fixture.peer.energy+=0.1;
  fixture.peer.channel.emit({type:'turn.created',turn:{id:'second-timeline',role:'assistant',start_ms:300,end_ms:400}});
  // An old final event is duplicated while the next passage owns playback.
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'first-timeline',role:'assistant',start_ms:100,end_ms:20000,transcript:'First short reading.'}});
  fixture.peer.channel.emit({type:'turn.done',turn:{id:'second-timeline',role:'assistant',start_ms:300,end_ms:400,transcript:'Second short reading.'}});
  await new Promise(resolve=>setTimeout(resolve,800));
  try{assert.equal(finished,true,'an old timeline must not hold the new answer open');}
  finally{voice.stopSpeaking();await reading;}
});

test('speaker allocation overlaps a slow microphone allocation response',async t=>{
  const fixture=conversationFixture(t);fixture.holdInputAllocation=true;
  const controller=new AbortController();
  const connecting=connectSubscriptionVoice({mode:'conversation',microphone:{},signal:controller.signal});
  void connecting.catch(()=>{});
  t.after(async()=>{controller.abort();await connecting.catch(()=>{});});
  await waitFor(()=>fixture.sessions.length===2);
  assert.deepEqual(fixture.sessions.map(session=>session.mode),['conversation','speak']);
  assert.deepEqual(fixture.posts,[]);
  assert.ok(fixture.players.every(player=>player.volume===0));
  fixture.releaseAllocation();const voice=await connecting;
  await voice.prepareSpeaker();assert.equal(fixture.sessions.length,2);
  await voice.close();assert.deepEqual(fixture.deleted.sort(),['0','1']);
});

test('cancelling before microphone allocation returns also retires its parallel speaker',async t=>{
  const fixture=conversationFixture(t);fixture.holdInputAllocation=true;fixture.holdReaderSetup=true;
  const controller=new AbortController();
  const connecting=connectSubscriptionVoice({mode:'conversation',microphone:{},signal:controller.signal});
  void connecting.catch(()=>{});
  t.after(async()=>{controller.abort();await connecting.catch(()=>{});});
  await waitFor(()=>fixture.sessions.length===2);
  controller.abort();fixture.releaseAllocation();await assert.rejects(connecting,{name:'AbortError'});
  assert.deepEqual(fixture.deleted.sort(),['0','1'], 'only actual DELETE requests release allocated sessions');
  assert.deepEqual(fixture.posts,[]);
});

test('input-only startup allocates no speaker while its allocation is slow',async t=>{
  const fixture=conversationFixture(t);fixture.holdInputAllocation=true;
  const controller=new AbortController();
  const connecting=connectSubscriptionVoice({mode:'conversation',microphone:{},inputOnly:true,signal:controller.signal});
  void connecting.catch(()=>{});
  t.after(async()=>{controller.abort();await connecting.catch(()=>{});});
  await waitFor(()=>fixture.sessions.length===1);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.deepEqual(fixture.sessions.map(session=>session.mode),['conversation']);
  fixture.releaseAllocation();const voice=await connecting;
  await voice.close();assert.deepEqual(fixture.deleted,['0']);
});


for (const [number, script, wrong] of [
  ['28', 'The answer is twenty eight.', 'The answer is twenty eight hundred nine.'],
  ['3.5', 'The answer is three point five.', 'The answer is three point five six.'],
]) test('a numeric prefix extended into a different value retries the whole answer: ' + number, async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  let finished = false;
  const reading = voice.speak(number).then(() => { finished = true; });
  void reading.catch(() => {});
  t.after(async () => { voice.stopSpeaking(); await reading.catch(() => {}); await voice.close(); });
  await waitFor(() => fixture.posts.length === 1);
  assert.equal(fixture.posts[0].text, script);
  fixture.sessions[1].deliver(wrong);
  await waitFor(() => fixture.posts.length === 2 || finished);
  assert.equal(fixture.posts.length, 2, 'a correct prefix does not prove the numeric answer finished correctly');
  assert.equal(finished, false);
  assert.equal(fixture.posts[1].text, script, 'the whole original number is read on the replacement connection');
  assert.deepEqual(fixture.deleted, ['1']);
  fixture.sessions[2].deliver(script);
  await reading;
  assert.equal(voice.isHealthy(), true);
  assert.ok(fixture.players.every(player => player.volume === 0));
});

test('numeric prefix repair remains bounded and leaves the next answer usable', async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  let settled = false;
  const reading = voice.speak('28').then(() => ({ ok: true }), error => ({ ok: false, error }));
  void reading.then(() => { settled = true; });
  t.after(async () => { voice.stopSpeaking(); await reading; await voice.close(); });
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitFor(() => fixture.posts.length === attempt + 1 || settled);
    assert.equal(fixture.posts.length, attempt + 1, 'each failed numeric reading consumes one bounded retry');
    fixture.sessions[attempt + 1].deliver('The answer is twenty eight hundred nine.');
  }
  const result = await reading;
  assert.equal(result.ok, false);
  assert.match(result.error.message, /stopped reading/);
  assert.equal(fixture.posts.length, 3);
  assert.deepEqual(fixture.deleted, ['1', '2', '3']);
  assert.equal(voice.isHealthy(), true, 'speech failure does not poison recognition');
  const next = voice.speak('29');
  await waitFor(() => fixture.posts.length === 4);
  fixture.sessions[4].deliver('The answer is twenty nine.');
  await next;
});

test('numeric prefix repair is cancelled while the replacement reader connects', async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  let finished = false;
  const reading = voice.speak('28').then(() => { finished = true; });
  void reading.catch(() => {});
  t.after(async () => { voice.stopSpeaking(); await reading.catch(() => {}); await voice.close(); });
  await waitFor(() => fixture.posts.length === 1);
  fixture.holdReaderSetup = true;
  fixture.sessions[1].deliver('The answer is twenty eight hundred nine.');
  await waitFor(() => fixture.sessions.length === 3 || finished);
  assert.equal(finished, false, 'the failed reading has not been accepted as complete');
  assert.equal(fixture.sessions.length, 3);
  voice.stopSpeaking();
  await reading;
  assert.equal(fixture.posts.length, 1, 'interruption prevents the replacement from speaking');
  assert.deepEqual(fixture.deleted, ['1', '2']);
  assert.equal(voice.isHealthy(), true);
});

for (const [number, reading] of [
  ['21', 'Mm-hmm. The answer is twenty one.'], ['3.5', 'Okay. The answer is three point five.'],
  ['-105.04', 'Okay, The answer is minus one hundred five point zero four.'], ['007', 'Mm-hmm. The answer is zero zero seven.'],
]) test('conversation numeric acknowledgement retains the full answer without retry: ' + number, async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} });
  t.after(() => voice.close());
  let completed = false;
  const speaking = voice.speak(number).then(() => { completed = true; });
  void speaking.catch(() => {});
  await waitFor(() => fixture.posts.length === 1);
  fixture.sessions[1].deliver(reading);
  await waitFor(() => completed || fixture.posts.length > 1);
  assert.equal(completed, true, 'an exact number after one audible acknowledgement is complete');
  assert.equal(fixture.posts.length, 1);
  assert.deepEqual(fixture.deleted, []);
  await speaking;
});

for (const [number, wrong] of [
  ['21', 'Okay. The answer is twenty one hundred.'], ['21', 'Okay. The answer is minus twenty one.'],
  ['3.5', 'Mm-hmm. The answer is three point five six.'], ['3.5', 'Okay. The answer is three five.'],
  ['21', 'Okay. Okay. The answer is twenty one.'], ['21', 'Mm-hmm. Okay. The answer is twenty one.'],
  ['21', 'Yes. The answer is twenty one.'], ['21', 'The answer is twenty one. Okay.'],
  ['21', 'Okay. The answer is twenty one twenty one.'], ['21', 'Mm-hmm.'],
]) test('conversation numeric acknowledgement preserves strict rejection: ' + wrong, async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  const failed = assert.rejects(voice.speak(number), /stopped reading/);
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitFor(() => fixture.posts.length === attempt + 1);
    fixture.sessions[attempt + 1].deliver(wrong);
  }
  await failed;
  assert.equal(fixture.posts.length, 3, 'retries remain bounded');
  assert.deepEqual(fixture.deleted, ['1', '2', '3']);
  const next = voice.speak('29'); await waitFor(() => fixture.posts.length === 4);
  fixture.sessions[4].deliver('The answer is twenty nine.'); await next;
  assert.equal(voice.isHealthy(), true);
});

test('conversation numeric acknowledgement can stream in partial words before its answer', async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  let completed = false;
  const speaking = voice.speak('21').then(() => { completed = true; }); void speaking.catch(() => {});
  await waitFor(() => fixture.posts.length === 1);
  const peer = fixture.peers[1]; peer.energy += 0.1;
  for (const text of [' Mm-h', 'mm.', ' The answer is', ' twenty', ' one.']) {
    peer.channel.emit({ type: 'output_transcript.added', text });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(completed, false);
    assert.equal(fixture.posts.length, 1);
  }
  peer.channel.emit({ type: 'turn.done', turn: { id: 'ack-and-number', role: 'assistant', transcript: ' Mm-hmm. The answer is twenty one.' } });
  await waitFor(() => completed || fixture.posts.length > 1);
  assert.equal(completed, true); await speaking;
});

test('conversation numeric acknowledgement cannot hold the reader indefinitely without number words', async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  const now = Date.now.bind(Date); let offset = 0;
  t.mock.method(Date, 'now', () => now() + offset);
  const speaking = voice.speak('21'); void speaking.catch(() => {});
  await waitFor(() => fixture.posts.length === 1);
  fixture.peers[1].energy += 0.1;
  fixture.peers[1].channel.emit({ type: 'output_transcript.added', text: ' Mm-hmm.' });
  await new Promise(resolve => setTimeout(resolve, 100));
  offset += 5200;
  await waitFor(() => fixture.posts.length === 2);
  assert.deepEqual(fixture.deleted, ['1']);
  fixture.sessions[2].deliver('The answer is twenty one.'); await speaking;
});

test('conversation numeric acknowledgement remains immediately interruptible', async t => {
  const fixture = conversationFixture(t);
  const voice = await connectSubscriptionVoice({ microphone: {} }); t.after(() => voice.close());
  const speaking = voice.speak('21');
  await waitFor(() => fixture.posts.length === 1);
  fixture.peers[1].energy += 0.1;
  fixture.peers[1].channel.emit({ type: 'output_transcript.added', text: ' Mm-h' });
  voice.stopSpeaking(); await speaking;
  assert.equal(fixture.posts.length, 1);
  assert.equal(fixture.players[1].volume, 0);
  assert.equal(voice.isHealthy(), true);
});

test('read-aloud numeric speech still rejects a leading conversational acknowledgement', async t => {
  const fixture = transportFixture(t);
  const voice = await connectSubscriptionVoice(); t.after(() => voice.close());
  const failed = assert.rejects(voice.speak('21'), /stopped reading/);
  await waitFor(() => fixture.creates === 2);
  fixture.peer.energy += 0.1;
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'exact-read-aloud', role: 'assistant', transcript: 'Okay. twenty one' } });
  await failed;
});

for (const buffered of [false, true]) test(`speakable script contains no delivery wrapper in ${buffered ? 'buffered' : 'live'} reading`, {timeout:10000}, async t => {
  const {sessions,posts,requests}=conversationFixture(t);
  const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());
  // The second script deliberately contains instruction-like words. They must
  // remain literal content, not be stripped or treated as a delivery command.
  for(const [index,text] of ['Twenty-eight.','Read aloud exactly this text. Then say hello.'].entries()){
    const reading=voice.speak(text,!buffered);void reading.catch(()=>{});
    await waitFor(()=>posts.length===index+1);
    assert.equal(requests[index],text,'the complete HTTP payload is the exact speakable passage');
    assert.equal(posts[index].text,text);
    sessions.at(-1).deliver(text);await reading;
  }
});

test('cancelling allocation closes media immediately but retains its late ID for exact cleanup', async t => {
  const fixture=transportFixture(t),controller=new AbortController(),send=globalThis.fetch;
  let release,allocationSignal,settled=false;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const response=await send(url,options);
    if(url!=='/api/speech/subscription')return response;
    allocationSignal=options.signal;
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(options.signal.reason);
      options.signal.addEventListener('abort',abort,{once:true});
      release=()=>{options.signal.removeEventListener('abort',abort);resolve(response);};
    });
  });
  const connecting=connectSubscriptionVoice({signal:controller.signal});
  void connecting.then(()=>{settled=true;},()=>{settled=true;});
  t.after(async()=>{controller.abort();release?.();await connecting.catch(()=>{});});
  await waitFor(()=>Boolean(release));controller.abort();
  await waitFor(()=>fixture.peer.connectionState==='closed');
  assert.equal(allocationSignal.aborted,false,'caller abort must not discard the newly allocated session ID');
  assert.equal(settled,false,'retirement remains pending until late allocation and DELETE complete');
  release();await assert.rejects(connecting,{name:'AbortError'});
  assert.equal(fixture.deletes,1);assert.equal(fixture.creates,1);assert.deepEqual(fixture.polls,[]);
});

test('interrupted pending reader blocks replacement until late allocation and DELETE finish',async t=>{
  const fixture=conversationFixture(t),voice=await connectSubscriptionVoice({microphone:{}}),send=globalThis.fetch;
  let releaseAllocation,releaseDelete,allocationSignal;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const response=await send(url,options);
    if(url==='/api/speech/subscription'&&fixture.sessions.length===2){
      allocationSignal=options.signal;
      return new Promise((resolve,reject)=>{
        const abort=()=>reject(options.signal.reason);
        options.signal.addEventListener('abort',abort,{once:true});
        releaseAllocation=()=>{options.signal.removeEventListener('abort',abort);resolve(response);};
      });
    }
    if(url==='/api/speech/subscription/1'&&options.method==='DELETE')return new Promise(resolve=>{releaseDelete=()=>resolve(response);});
    return response;
  });
  const interrupted=voice.speak('This cancelled reading must never start.');
  void interrupted.catch(()=>{});
  let replacement;
  t.after(async()=>{releaseAllocation?.();releaseDelete?.();await interrupted.catch(()=>{});await replacement?.catch(()=>{});await voice.close();});
  await waitFor(()=>Boolean(releaseAllocation));voice.stopSpeaking();
  replacement=voice.prepareSpeaker();void replacement.catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(allocationSignal.aborted,false);
  assert.equal(fixture.sessions.length,2,'do not allocate over a cancelled reader still consuming its slot');
  releaseAllocation();await waitFor(()=>Boolean(releaseDelete));
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(fixture.sessions.length,2,'DELETE acknowledgement is part of the retirement barrier');
  releaseDelete();await replacement;await interrupted;
  assert.equal(fixture.sessions.length,3);assert.deepEqual(fixture.posts,[]);
  await voice.close();assert.deepEqual(fixture.deleted.sort(),['0','1','2']);
});

test('conversational small rewrites read all sentences and keep the same warm reader', {timeout:10000}, async t=>{
 const {sessions,posts,deleted}=conversationFixture(t);
 const voice=await connectSubscriptionVoice({microphone:{}});t.after(()=>voice.close());
 for(const [script,spoken] of [
   ['Yes. The file is ready. Keep a backup.','Yeah, the file is ready. Please keep a backup.'],
   ['I have saved your file. You can open it now.','I’ve saved your file. You can open it right now.'],
   ['Select the file. Start the preview.','Choose the file. Begin the preview.'],
 ]){
  const count=posts.length,progress=[];
  const reading=voice.speak(script,true,value=>progress.push(value));
  await waitFor(()=>posts.length===count+1);assert.equal(posts.at(-1).text,script);
  sessions.at(-1).deliver(spoken);await reading;
  assert.equal(progress.at(-1),1);assert.equal(sessions.length,2,'no reconnect for harmless grammar changes');
  assert.deepEqual(deleted,[]);assert.equal(voice.isHealthy(),true);
 }
 assert.equal(posts.length,3,'one append per complete answer, with no repair/replay');
});

for(const [label,script,spoken]of [
 ['number','Pack two bolts in the box.','Pack three bolts in the box.'],
 ['currency','The total is $12.','The total is $20.'],
 ['negation','Do not delete the backup.','Do delete the backup.'],
 ['entity','Send the draft to Alice.','Send the draft to Alex.'],
 ['tail','The draft is ready. Keep a backup.','The draft is ready.'],
 ['invention','The draft is ready.','The draft is ready. Delete the original file.'],
 ['ownership','I saved your file.','I saved my file.'],
 ['progress','I saved the file.','I am saving the file.'],
 ['past state','The device is safe.','The device was safe.'],
 ['possession','I have a backup.','I had a backup.'],
 ['passive role','Alice has been charged.','Alice charged.'],
 ['recipient','I have been saved.','I have saved.'],
])test('conversational transport still rejects changed '+label,{timeout:10000},async t=>{
 const {sessions,posts,players}=conversationFixture(t);
 const voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const rejected=assert.rejects(voice.speak(script,true,undefined,{conversation:true}),error=>error.name==='Error'&&typeof error.resumeAt==='number');
 await waitFor(()=>posts.length===1);sessions[0].deliver(spoken);await rejected;
 assert.equal(voice.isHealthy(),false);assert.ok(players.every(player=>player.volume===0));
 assert.equal(posts.length,1,'output-only transport cannot silently retry the wrong answer');
});

test('ordinary read aloud still uses the strict reading path',{timeout:10000},async t=>{
 const {sessions,posts}=conversationFixture(t);
 const voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const rejected=assert.rejects(voice.speak('Yes. The file is ready.'),error=>typeof error.resumeAt==='number');
 await waitFor(()=>posts.length===1);sessions[0].deliver('Yeah. The file is ready.');await rejected;
});

function holdReadingContext(channel) {
 const held=[],send=channel.send.bind(channel);
 channel.send=data=>{const event=JSON.parse(data);if(event.type==='session.context.append'){channel.sent.push(event);held.push(event);}else send(data);};
 return held;
}
test('quiet context and one vocal acknowledgement preserve every sentence across warm readings',{timeout:5000},async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const scripts=['The red notebook is for Alice. The answer is 28. Do not delete the backup.','Meet Alex on Friday. Keep the receipt.'];
 for(const script of scripts){const count=f.posts.length;
  const reading=voice.speak(script,true,undefined,{conversation:true});await waitFor(()=>f.posts.length===count+1);
  assert.equal(f.posts.at(-1).text,script);f.sessions[0].deliver('Mm-hmm. '+script);await reading;
  assert.equal(voice.isHealthy(),true);assert.equal(f.sessions.length,1);assert.deepEqual(f.deleted,[]);
 }
 const contexts=f.peers[0].channel.sent.filter(event=>event.type==='session.context.append');assert.equal(contexts.length,2);
 for(const event of contexts){assert.deepEqual(Object.keys(event).sort(),['content','type']);assert.equal(event.content[0].type,'input_text');}
});
test('conversation remains muted until a fresh bounded quiet-context acknowledgement',{timeout:3000},async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const held=holdReadingContext(f.peers[0].channel),realNow=Date.now.bind(Date);let offset=0;t.mock.method(Date,'now',()=>realNow()+offset);
 const rejected=assert.rejects(voice.speak('The file is ready.',true,undefined,{conversation:true}),/timed out/);
 await waitFor(()=>held.length===1);assert.ok(f.players.every(player=>player.volume===0));assert.equal(f.posts.length,0);
 offset=6000;await rejected;assert.equal(f.posts.length,0);assert.equal(voice.isHealthy(),false);
});
for(const action of ['stop','abort'])test(action+' during quiet preparation sends no speech request',{timeout:3000},async t=>{
 const f=conversationFixture(t),controller=new AbortController(),voice=await connectSubscriptionVoice({mode:'speak',signal:controller.signal});t.after(()=>voice.close());
 const held=holdReadingContext(f.peers[0].channel);const reading=voice.speak('The file is ready.',true,undefined,{conversation:true}).catch(()=>{});
 await waitFor(()=>held.length===1);const start=performance.now();if(action==='abort')controller.abort();else voice.stopSpeaking();
 await reading;assert.ok(performance.now()-start<250);assert.ok(f.players.every(player=>player.volume===0));assert.equal(f.posts.length,0);
});
test('a leaked quiet-context reply fails before the requested script is submitted',{timeout:3000},async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const channel=f.peers[0].channel,held=holdReadingContext(channel);
 const rejected=assert.rejects(voice.speak('The file is ready.',true,undefined,{conversation:true}),/spoke before/);
 await waitFor(()=>held.length===1);channel.emit({type:'output_transcript.added',text:'Read every sentence.'});
 channel.emit({type:'session.context.appended',end_ms:50});await rejected;
 assert.equal(f.posts.length,0);assert.ok(f.players.every(player=>player.volume===0));
});
test('a late old acknowledgement cannot release a new warm reading',{timeout:5000},async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const first=voice.speak('The file is ready.',true,undefined,{conversation:true});await waitFor(()=>f.posts.length===1);f.sessions[0].deliver('The file is ready.');await first;
 const channel=f.peers[0].channel,held=holdReadingContext(channel);
 const second=voice.speak('Keep the backup.',true,undefined,{conversation:true});await waitFor(()=>held.length===1);
 channel.emit({type:'session.context.appended',end_ms:1e12+1});await new Promise(resolve=>setTimeout(resolve,90));
 assert.equal(f.posts.length,1);assert.ok(f.players.every(player=>player.volume===0));
 channel.emit({type:'session.context.appended',end_ms:1e12+2});await waitFor(()=>f.posts.length===2);f.sessions[0].deliver('Keep the backup.');await second;
 assert.equal(f.sessions.length,1);
});
test('context speech arriving during output activation is rejected before appending',{timeout:3000},async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const player=f.players.find(player=>player.srcObject),play=player.play.bind(player);let release;
 t.mock.method(player,'play',async()=>{await play();await new Promise(resolve=>{release=resolve;});});
 const rejected=assert.rejects(voice.speak('The file is ready.',true,undefined,{conversation:true}),/spoke before/);
 await waitFor(()=>Boolean(release));assert.equal(player.volume,0);
 f.peers[0].channel.emit({type:'output_transcript.added',text:'Read every sentence.'});assert.equal(player.volume,0);
 release();await rejected;
 assert.equal(f.posts.length,0);assert.equal(player.volume,0);
});
test('strict ordinary readout never prepares quiet context or permits mm-hmm',{timeout:3000},async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const rejected=assert.rejects(voice.speak('28'),error=>typeof error.resumeAt==='number');
 await waitFor(()=>f.posts.length===1);f.sessions[0].deliver('Mm-hmm. twenty-eight');await rejected;
 assert.ok(!f.peers[0].channel.sent.some(event=>event.type==='session.context.append'));
});

test('complete numeric sentences and prose both prepare their exact script',async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 for(const script of ['21','The amber parcel is ready. Do not open it.']){
  const count=f.posts.length,reading=voice.speak(script,true,undefined,{conversation:true});
  await waitFor(()=>f.posts.length===count+1);
  const expected=script==='21'?'The answer is twenty one.':script;
  const context=f.peers[0].channel.sent.filter(event=>event.type==='session.context.append').at(-1);
  assert.equal(context.content[0].text.includes(expected),true,'the complete prepared reply is seeded verbatim');
  assert.equal(f.posts.at(-1).text,expected);
  f.sessions[0].deliver(expected);await reading;
  assert.equal(f.sessions.length,1);assert.deepEqual(f.deleted,[]);
 }
});

// Recorded provider failure: labels before a bare numeric answer are already
// incorrect. A completed turn is not required to mute that reading.
test('a numeric reader rejects the first unsolicited streamed word', {timeout:3000}, async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 const rejected=assert.rejects(voice.speak('21',true,undefined,{conversation:true}),/stopped reading/);
 await waitFor(()=>f.posts.length===1);f.peers[0].energy+=0.1;
 f.peers[0].channel.emit({type:'output_transcript.added',text:' Unit '});
 await rejected;
 assert.equal(f.posts.length,1);assert.ok(f.players.every(player=>player.volume===0));
 assert.equal(voice.isHealthy(),false,'a failed reader cannot leak more words into another answer');
});
for(const [number,acknowledgement]of [['21',''],['1052','Okay. '],['-105.04','Mm-hmm. ']])
test('a normalized numeric prefix cannot hide extra streamed words: '+acknowledgement+number,{timeout:3000},async t=>{
 const f=conversationFixture(t),voice=await connectSubscriptionVoice({mode:'speak'});t.after(()=>voice.close());
 let failed=false;const rejected=assert.rejects(voice.speak(number,true,undefined,{conversation:true}),/stopped reading/).then(()=>{failed=true;});
 await waitFor(()=>f.posts.length===1);f.peers[0].energy+=0.1;
 f.peers[0].channel.emit({type:'output_transcript.added',text:acknowledgement+'The answer is '+number+' '});
 await new Promise(resolve=>setTimeout(resolve,80));assert.equal(failed,false,'the complete original value is still valid');
 f.peers[0].channel.emit({type:'output_transcript.added',text:'units '});
 await rejected;assert.equal(f.posts.length,1);assert.ok(f.players.every(player=>player.volume===0));
});
