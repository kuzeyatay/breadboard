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
  const prefix = 'Read aloud exactly this text. Say only these words, with no introduction or commentary: ';
  assert.ok(text.startsWith(prefix), 'every passage explicitly requests a verbatim reading');
  return text.slice(prefix.length);
}

function voiceChannel({ confirm = true } = {}) {
  const channel = {
    readyState: 'open', sent: [],
    close() { this.onclose?.(); },
    emit(message) { this.onmessage?.({ data: JSON.stringify(message) }); },
    send(data) {
      this.sent.push(JSON.parse(data));
      if (confirm) queueMicrotask(() => this.emit({ type: 'session.updated' }));
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
  for (const file of ["components/voice-conversation-overlay.tsx", "components/speech-dictation-button.tsx", "clicky/page.tsx"]) {
    const source = await fs.readFile(root + "src/app/" + file, "utf8");
    assert.match(source, /connectSubscriptionVoice\(\{\s*microphone: stream/);
    assert.match(source, /finishTranscript\(/);
    assert.match(source, /subscriptionRef\.current\?\.close\(/);
  }
  const playback = await fs.readFile(root + "src/lib/speech/playback.ts", "utf8");
  assert.match(playback, /await voice!?\.speak\(text\)/);
  assert.match(playback, /activeSubscriptionStop/);
});

function transportFixture(t, { confirm = true, selectedVoice = 'sol', inboundPackets = 10 } = {}) {
  const players = recordedVoiceFixture(t);
  const previous = Object.fromEntries(['AudioContext', 'RTCPeerConnection'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const node = () => ({ gain: { value: 0 }, connect() { return this; }, disconnect() {}, start() {}, stop() {} });
  globalThis.AudioContext = class {
    state = 'running'; destination = {};
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
      ['audio', { type: 'outbound-rtp', kind: 'audio', packetsSent: 10 }],
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
  return { push, polls, players, scripts, set inboundPackets(value) { inboundPackets = value; }, get peer() {return peer;}, get creates() {return creates;}, get deletes() {return deletes;} };
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
  fixture.peer.channel.emit({ type: 'turn.done', turn: { id: 'close', role: 'assistant', transcript: 'Read last.' } });
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

function conversationFixture(t) {
  const players = recordedVoiceFixture(t);
  const previous = Object.fromEntries(['AudioContext', 'RTCPeerConnection', 'Audio', 'MediaStream']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const node = () => ({ gain: { value: 0 }, connect() { return this; }, disconnect() {}, start() {}, stop() {} });
  const sessions = [], posts = [], deleted = [], peers = [], microphones = [];
  let holdReaderSetup = false;
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
      return Response.json({ id: session.id, voice: 'sol' });
    }
    const id = url.split('/').at(-1).split('?')[0], session = sessions[Number(id)];
    if (options.method === 'DELETE') { deleted.push(id); return Response.json({}); }
    if (options.method === 'POST') {
      posts.push({ id, text: requestedScript(options.body) });
      if (postError) throw new TypeError('Ambiguous speech POST failure');
      return Response.json({});
    }
    if (session.initial) {
      session.initial = false;
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
  return { players, sessions, posts, deleted, peers, microphones,
    set holdReaderSetup(value) { holdReaderSetup = value; },
    set postError(value) { postError = value; },
  };
}

test('background conversation and greeting hand off without reconnecting or opening a microphone early', { timeout: 10_000 }, async t => {
  const fixture = conversationFixture(t);
  t.after(() => clearSubscriptionPreload());
  await preloadSubscriptionVoice('1', { enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol' });
  await waitFor(() => fixture.sessions.length === 2);
  assert.equal(fixture.microphones.length, 0);
  assert.deepEqual(fixture.posts, [], 'warmup sends no spoken script');
  const microphone = {};
  const voice = await connectSubscriptionVoice({ microphone, listening: false });
  assert.deepEqual(fixture.microphones, [microphone]);
  await voice.prepareSpeaker();
  assert.equal(fixture.sessions.length, 2, 'both ready sessions are adopted');
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

test('read-aloud waits for both retiring preloads after voice gives up its slots', async t => {
  const fixture = conversationFixture(t);
  t.after(() => clearSubscriptionPreload());
  await preloadSubscriptionVoice('1', { enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol' });
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
