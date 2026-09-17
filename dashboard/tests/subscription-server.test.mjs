import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import esbuild from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryHome = await fs.mkdtemp(path.join(os.tmpdir(), "breadboard-subscription-server-test-"));
const originalFetch = globalThis.fetch;
const originalCodexHome = process.env.CODEX_HOME;
const calls = [];
globalThis.__subscriptionServerTest = {
  fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ ok: true });
  },
};

const bundled = await esbuild.build({
  stdin: {
    contents: `export { subscriptionBridge } from './src/lib/speech/subscription-server.ts';
      export { POST } from './src/app/api/speech/subscription/route.ts';`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  write: false,
  plugins: [{
    name: "subscription-server-boundaries",
    setup(build) {
      const stubs = {
        "server-only": "export {};",
        "@/lib/chatmock-server": `export const localChatmockBaseUrl = () => "http://127.0.0.1:55416";`,
        "@/lib/server-auth": `export class RouteError extends Error { constructor(status, message) { super(message); this.status = status; } }
          export const requireUserId = async () => 7;
          export const routeErrorResponse = error => Response.json({error: error.message}, {status: error.status || 500});`,
        "@/lib/request-origin": "export const requireSameOrigin = () => {};",
        "@/lib/speech/settings": `export const getSpeechSettings = () => ({enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol', language: 'en', pronunciations: ''});`,
      };
      build.onResolve({ filter: /^(server-only|@\/lib\/(chatmock-server|server-auth|request-origin|speech\/settings))$/ }, ({ path }) => ({
        path,
        namespace: "stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({ contents: stubs[path], loader: "js" }));
    },
  }],
});
const fixture = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), fixture, fixture.exports);
const { subscriptionBridge, POST } = fixture.exports;

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = globalThis.__subscriptionServerTest.fetch;
  process.env.CODEX_HOME = temporaryHome;
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  await fs.rm(temporaryHome, { recursive: true, force: true });
});

test("subscription long polls do not reuse half-closed ChatMock connections", async () => {
  await subscriptionBridge(7, "sessions/example?cursor=1");

  assert.equal(calls.length, 1);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("connection"), "close");
  assert.equal(headers.get("x-breadboard-voice-owner"), "7");
});

function voiceRequest(signal) {
  return new Request('http://127.0.0.1:3000/api/speech/subscription', {
    method: 'POST', signal, body: JSON.stringify({ sdp: 'v=0', mode: 'conversation' }),
  });
}

test('closing the tab during session creation retires the late allocation', async () => {
  const controller = new AbortController();
  let created;
  const started = new Promise(resolve => { created = resolve; });
  let finishSetup;
  const setup = new Promise(resolve => { finishSetup = resolve; });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === 'POST') { created(); return setup; }
    return Response.json({ ok: true });
  };
  const result = POST(voiceRequest(controller.signal));
  await started;
  controller.abort();
  assert.equal(calls[0].init.signal.aborted, false, 'the server must keep the allocation ID for cleanup');
  finishSetup(Response.json({ id: 'cancelled-session-123456789', voice: 'sol' }));
  assert.equal((await result).status, 499);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, 'DELETE');
  assert.ok(calls[1].url.endsWith('/sessions/cancelled-session-123456789'));
  assert.equal(calls[1].init.signal.aborted, false);
  assert.equal(new Headers(calls[1].init.headers).get('x-breadboard-voice-owner'), '7');
});

test('an already cancelled tab does not allocate a voice session', async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await POST(voiceRequest(controller.signal));
  assert.equal(response.ok, false);
  assert.equal(calls.length, 0);
});

test('a connected tab receives its session and saved speech preferences without cleanup', async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ id: 'active-session-123456789', voice: 'sol' });
  };
  const response = await POST(voiceRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'active-session-123456789', voice: 'sol', pronunciations: '' });
  assert.equal(calls.length, 1);
});
