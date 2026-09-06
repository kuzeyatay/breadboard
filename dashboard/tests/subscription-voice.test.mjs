import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await esbuild.build({ entryPoints: [root + "src/lib/speech/subscription-live.ts"], bundle: true, write: false, platform: "browser", format: "esm" });
const { connectSubscriptionVoice, splitSpeechText } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

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

test("long readings are divided for transport without a user character cutoff", () => {
  const text = "This is a complete sentence about Breadboard. ".repeat(300).trim();
  const parts = splitSpeechText(text);
  assert.ok(parts.length > 4);
  assert.ok(parts.every(part => part.length <= 1800));
  assert.equal(parts.join(" "), text);
  assert.deepEqual(splitSpeechText("   "), []);
});

test("splitting never loses Unicode code points", () => {
  const text = "🦉".repeat(3500);
  assert.equal(splitSpeechText(text).join(""), text);
  assert.ok(splitSpeechText(text).every(part => !/[\uD800-\uDBFF]$/.test(part)));
});

test("read-aloud connections use speech mode while microphone calls retain conversation mode", async (t) => {
  const previous = Object.fromEntries(['AudioContext', 'RTCPeerConnection'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const node = () => ({ gain: { value: 0 }, connect() { return this; }, disconnect() {}, start() {}, stop() {} });
  globalThis.AudioContext = class {
    state = 'running'; destination = {};
    createGain = node; createOscillator = node; createMediaStreamSource = node;
    createMediaStreamDestination() { const track = node(); return { stream: { getAudioTracks: () => [track], getTracks: () => [track] } }; }
    async resume() {} async close() {}
  };
  globalThis.RTCPeerConnection = class {
    addTrack() {} close() {}
    createDataChannel() { return { readyState: 'open', close() {} }; }
    async createOffer() { return { sdp: 'v=0' }; }
    async setLocalDescription() {} async setRemoteDescription() {}
    async getStats() { return new Map([['audio', { type: 'outbound-rtp', kind: 'audio', packetsSent: 10 }]]); }
  };
  t.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const modes = [];
  let delivered;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST') {
      modes.push(JSON.parse(options.body).mode); delivered = false;
      return Response.json({ id: 'fixture' });
    }
    if (options.method === 'DELETE') return Response.json({});
    if (!delivered) {
      delivered = true;
      return Response.json({ cursor: 1, events: [{ type: 'sdp', sdp: 'v=0' }] });
    }
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  for (const options of [{}, { microphone: {} }, { mode: 'transcribe' }]) {
    const voice = await connectSubscriptionVoice(options);
    await voice.close();
  }
  assert.deepEqual(modes, ['speak', 'conversation', 'transcribe']);
});

test("all microphone surfaces use a live subscription stream and release it", async () => {
  for (const file of ["components/voice-conversation-overlay.tsx", "components/speech-dictation-button.tsx", "clicky/page.tsx"]) {
    const source = await fs.readFile(root + "src/app/" + file, "utf8");
    assert.match(source, /connectSubscriptionVoice\(\{ microphone: stream/);
    assert.match(source, /finishTranscript\(/);
    assert.match(source, /subscriptionRef\.current\?\.close\(/);
  }
  const playback = await fs.readFile(root + "src/lib/speech/playback.ts", "utf8");
  assert.match(playback, /void voice\.speak\(text\)/);
  assert.match(playback, /activeSubscriptionStop/);
});
