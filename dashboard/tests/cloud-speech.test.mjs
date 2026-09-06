import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import Database from "better-sqlite3";
import esbuild from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new Database(":memory:");
db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY);
  INSERT INTO users VALUES (1), (2);
  CREATE TABLE speech_user_settings (
    user_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, profile_id TEXT,
    language TEXT NOT NULL DEFAULT 'en', engine TEXT NOT NULL DEFAULT 'auto',
    model_size TEXT NOT NULL DEFAULT '1.7B', transcription_language TEXT,
    transcription_model TEXT NOT NULL DEFAULT 'base', updated_at TEXT DEFAULT (datetime('now'))
  );
  INSERT INTO speech_user_settings (user_id, profile_id, engine) VALUES (1, 'local-voice', 'kokoro');`);

class RouteError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const unexpected = async () => { throw new Error("Unexpected local service call"); };
const state = { cloud: { configured: true, source: "subscription" }, db, RouteError, userId: 1, localFetch: unexpected, localJson: unexpected, encode: unexpected, segment: unexpected };
globalThis.__cloudSpeechTest = state;
const oldSecret = process.env.NEXTAUTH_SECRET;
const oldApiKey = process.env.OPENAI_API_KEY;
const originalFetch = globalThis.fetch;

const bundled = await esbuild.build({
  stdin: {
    contents: `
      export * as settings from './src/lib/speech/settings.ts';
      export * as credentials from './src/lib/speech/credentials.ts';
      export * as synthesis from './src/lib/speech/synthesis.ts';
      export * as recording from './src/lib/speech/recording-transcription.ts';
      export * as prepareRoute from './src/app/api/speech/prepare/route.ts';
      export * as statusRoute from './src/app/api/speech/status/route.ts';
      export * as transcribeRoute from './src/app/api/speech/transcribe/route.ts';
      export * as mp3Route from './src/app/api/speech/synthesize/mp3/route.ts';
      export * as credentialRoute from './src/app/api/speech/credentials/route.ts';
    `,
    resolveDir: root, loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", target: "node22", write: false,
  plugins: [{ name: "isolated-speech-boundaries", setup(build) {
    const stubs = {
      "subscription-server": `export const requireVoiceOrigin = () => {}; export const subscriptionStatus = async () => globalThis.__cloudSpeechTest.cloud;`,
      "server-only": "export {};",
      "@/lib/db": "export default globalThis.__cloudSpeechTest.db;",
      "@/lib/server-auth": `
        const state = globalThis.__cloudSpeechTest;
        export const RouteError = state.RouteError;
        export async function requireUserId() {
          if (!state.userId) throw new RouteError(401, 'Unauthorized');
          return state.userId;
        }
        export function routeErrorResponse(error) { return Response.json({ error: error.message }, { status: error.status || 500 }); }
      `,
      "next/server": "export const NextResponse = Response;",
      "voicebox-client": `
        const state = globalThis.__cloudSpeechTest;
        export const voiceboxFetch = (...args) => state.localFetch(...args);
        export const voiceboxJson = (...args) => state.localJson(...args);
        export const voiceboxObservationJson = (...args) => state.localJson(...args);
        export const voiceboxStartupStatus = () => null;
        export const voiceboxResponseError = (body, fallback) => body?.error || fallback;
      `,
      "speech-media-job": `
        export class SpeechMediaRuntimeError extends Error {}
        export const encodeSpeechMp3ViaRuntime = (...args) => globalThis.__cloudSpeechTest.encode(...args);
        export const segmentRecordingViaRuntime = (...args) => globalThis.__cloudSpeechTest.segment(...args);
      `,
    };
    build.onResolve({ filter: /server-only|@\/lib\/(db|server-auth)$|next\/server|voicebox-client|speech-media-job|subscription-server/ }, ({ path: specifier }) => {
      const key = Object.keys(stubs).find((key) => specifier === key || specifier.endsWith(`/${key}.ts`) || specifier.endsWith(`/${key}`));
      return key ? { path: key, namespace: "stub" } : undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({ contents: stubs[path], loader: "js" }));
  } }],
});
const fixture = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), fixture, fixture.exports);
const { settings, credentials, client, synthesis, recording, prepareRoute, statusRoute, transcribeRoute, mp3Route, credentialRoute } = fixture.exports;
const migrated = settings.getSpeechSettings(1);

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "speech-tests-only-stable-secret";
  delete process.env.OPENAI_API_KEY;
  db.exec("DELETE FROM speech_user_settings;");
  state.userId = 1;
  state.localFetch = state.localJson = state.encode = state.segment = unexpected;
  globalThis.fetch = unexpected;
});
after(() => {
  if (oldSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = oldSecret;
  if (oldApiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldApiKey;
  globalThis.fetch = originalFetch;
  delete globalThis.__cloudSpeechTest;
  db.close();
});

function cloud() {
  settings.updateSpeechSettings(1, { speechProvider: "chatgpt", openaiVoice: "maple" });

}
function recordingRequest() {
  const form = new FormData();
  form.set("file", new Blob(["test-audio"], { type: "audio/wav" }), "dictation.wav");
  return new Request("http://breadboard.test/api/speech/transcribe", { method: "POST", body: form });
}


test("upgrade preserves local profiles and maps the old API selection to subscription", () => {
  assert.equal(migrated.speechProvider, "local");
  assert.equal(migrated.profileId, "local-voice");
  assert.equal(migrated.openaiVoice, "cove");
  settings.updateSpeechSettings(1, { profileId: "retained", engine: "kokoro" });
  cloud();
  assert.equal(settings.getSpeechSettings(1).profileId, "retained");
  assert.equal(settings.getSpeechSettings(2).speechProvider, "local");
  settings.updateSpeechSettings(1, { speechProvider: "evil", openaiVoice: "marin" });
  assert.equal(settings.getSpeechSettings(1).openaiVoice, "maple");
  db.prepare("UPDATE speech_user_settings SET speech_provider='openai',openai_voice='marin' WHERE user_id=1").run();
  assert.equal(settings.getSpeechSettings(1).speechProvider, "chatgpt");
  assert.equal(settings.getSpeechSettings(1).openaiVoice, "cove");
  settings.updateSpeechSettings(1, { speechProvider: "local" });
  assert.equal(settings.getSpeechSettings(1).profileId, "retained");
});

test("subscription status and prepare do not contact Voicebox or use an API key", async () => {
  cloud();
  process.env.OPENAI_API_KEY = "local";
  state.cloud = { configured: true, source: "subscription" };
  assert.deepEqual(await (await prepareRoute.POST()).json(), { ready: true, provider: "chatgpt" });
  const result = await (await statusRoute.GET()).json();
  assert.equal(result.cloud.source, "subscription");
  assert.deepEqual(result.profiles, []);
  state.cloud = { configured: false, source: "subscription", error: "Sign in to ChatGPT" };
  assert.equal((await prepareRoute.POST()).status, 503);
});

test("unknown voice failures never imply that an existing account needs another login", async () => {
  cloud();
  state.cloud = { configured: false, source: "subscription" };
  const response = await prepareRoute.POST();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Re-check it in Voice settings/);
});

test("stale API-key clients cannot enable billed speech or fall back to local", async () => {
  cloud();
  process.env.OPENAI_API_KEY = "sk-test-do-not-use";
  assert.equal((await credentialRoute.PUT()).status, 410);
  await assert.rejects(synthesis.synthesizeSpeech({ userId: 1, text: "hello" }), { status: 409 });
  assert.equal((await transcribeRoute.POST(recordingRequest())).status, 409);
});

test("speech routes still require an authenticated user", async () => {
  state.userId = null;
  for (const route of [prepareRoute.POST, statusRoute.GET, credentialRoute.PUT, credentialRoute.DELETE]) {
    assert.equal((await route()).status, 401);
  }
  assert.equal((await transcribeRoute.POST(recordingRequest())).status, 401);
});

test("local synthesis retains Voicebox voice and request semantics", async () => {
  settings.updateSpeechSettings(1, { profileId: "voice", engine: "kokoro" });
  state.localJson = async () => ({ id: "voice", voice_type: "preset", name: "Local" });
  state.localFetch = async (url, init) => {
    assert.equal(url, "/generate/stream");
    assert.equal(JSON.parse(init.body).profile_id, "voice");
    return new Response("local-audio", { headers: { "Content-Type": "audio/wav" } });
  };
  assert.equal(await (await synthesis.synthesizeSpeech({ userId: 1, text: "hello" })).text(), "local-audio");
});

test("subscription WAV downloads use the existing media worker", async () => {
  cloud();
  state.encode = async (scope, audio) => {
    assert.equal(scope.userId, 1);
    assert.equal(new TextDecoder().decode(audio), "captured-wave");
    return new Uint8Array([1, 2, 3]);
  };
  const response = await mp3Route.POST(new Request("http://breadboard.test/api/speech/synthesize/mp3", {
    method: "POST", headers: { "Content-Type": "audio/wav" }, body: "captured-wave",
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
});
