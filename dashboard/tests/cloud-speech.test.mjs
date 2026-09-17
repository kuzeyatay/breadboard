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
const state = { cloud: { configured: true, source: "subscription" }, db, RouteError, userId: 1, localFetch: unexpected, localJson: unexpected, encode: unexpected, segment: unexpected, subscriptionBridge: unexpected, voiceBridgeFetch: unexpected };
globalThis.__cloudSpeechTest = state;
const oldSecret = process.env.NEXTAUTH_SECRET;
const oldApiKey = process.env.OPENAI_API_KEY;
const oldElevenLabsKey = process.env.ELEVENLABS_API_KEY;
const originalFetch = globalThis.fetch;

const bundled = await esbuild.build({
  stdin: {
    contents: `
      export * as settings from './src/lib/speech/settings.ts';
      export * as credentials from './src/lib/speech/credentials.ts';
      export * as elevenlabsCredentials from './src/lib/speech/elevenlabs-credentials.ts';
      export * as elevenlabs from './src/lib/speech/elevenlabs.ts';
      export * as elevenlabsCredentialRoute from './src/app/api/speech/elevenlabs/credentials/route.ts';
      export * as elevenlabsVoicesRoute from './src/app/api/speech/elevenlabs/voices/route.ts';
      export * as requestClient from './src/lib/speech/request-client.ts';
      export * as subscriptionLive from './src/lib/speech/subscription-live.ts';
      export * as subscriptionRoute from './src/app/api/speech/subscription/route.ts';
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
      "subscription-server": `export const requireVoiceOrigin = () => {}; export const subscriptionStatus = async () => globalThis.__cloudSpeechTest.cloud; export const subscriptionBridge = (...args) => globalThis.__cloudSpeechTest.subscriptionBridge(...args); export const voiceBridgeFetch = (...args) => globalThis.__cloudSpeechTest.voiceBridgeFetch(...args);`,
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
const { elevenlabsCredentials, elevenlabs, elevenlabsCredentialRoute, elevenlabsVoicesRoute, requestClient, subscriptionLive, subscriptionRoute } = fixture.exports;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "speech-tests-only-stable-secret";
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  db.exec("DELETE FROM speech_user_settings;");
  db.exec("DELETE FROM speech_elevenlabs_credentials;");
  state.userId = 1;
  state.localFetch = state.localJson = state.encode = state.segment = state.subscriptionBridge = state.voiceBridgeFetch = unexpected;
  globalThis.fetch = unexpected;
});
after(() => {
  if (oldSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = oldSecret;
  if (oldApiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldApiKey;
  if (oldElevenLabsKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = oldElevenLabsKey;
  globalThis.fetch = originalFetch;
  delete globalThis.__cloudSpeechTest;
  db.close();
});

test("notification readers use the saved speech language without changing automatic microphone detection", async () => {
  for (const preference of [
    { language: "en", transcriptionLanguage: null, expected: "en" },
    { language: "en", transcriptionLanguage: "nl", expected: "en" },
    { language: "en", transcriptionLanguage: "zh", expected: "en" },
    { language: "nl", transcriptionLanguage: null, expected: "nl" },
  ]) {
    settings.updateSpeechSettings(1, { speechProvider: "chatgpt", ...preference });
    for (const mode of ["speak", "transcribe", "conversation"]) {
      let bridged;
      state.subscriptionBridge = async (userId, suffix, init) => {
        assert.equal(userId, 1);
        assert.equal(suffix, "sessions");
        bridged = JSON.parse(init.body);
        return Response.json({ id: "reader", voice: bridged.voice });
      };
      const response = await subscriptionRoute.POST(new Request("http://breadboard.test/api/speech/subscription", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: "v=0", mode }),
      }));
      assert.equal(response.status, 200);
      assert.equal(bridged.mode, mode);
      assert.equal(bridged.language, mode === "speak" ? preference.expected : preference.transcriptionLanguage);
    }
  }
});

function cloud() {
  settings.updateSpeechSettings(1, { speechProvider: "chatgpt", openaiVoice: "maple" });

}
function recordingRequest() {
  const form = new FormData();
  form.set("file", new Blob(["test-audio"], { type: "audio/wav" }), "dictation.wav");
  return new Request("http://breadboard.test/api/speech/transcribe", { method: "POST", body: form });
}


test("OpenAI (web) speech reads, transcribes and prepares through the chatgpt.com page", async () => {
  settings.updateSpeechSettings(1, { speechProvider: "openaiweb", openaiVoice: "maple", transcriptionLanguage: "nl" });
  assert.equal(settings.getSpeechSettings(1).speechProvider, "openaiweb");
  const calls = [];
  state.voiceBridgeFetch = async (userId, suffix, init = {}) => {
    assert.equal(userId, 1);
    calls.push(suffix);
    if (suffix === "web/status") return Response.json({ configured: true, source: "web", signedIn: true, reason: "ready", error: null });
    if (suffix === "web/synthesize") {
      assert.deepEqual(JSON.parse(init.body), { text: "Hello there.", voice: "maple" });
      return new Response(new Uint8Array([0xff, 0xf1, 1, 2]), { headers: { "Content-Type": "audio/aac" } });
    }
    if (suffix === "web/transcribe") {
      assert.equal(init.body.get("language"), "nl");
      assert.equal(init.body.get("file").name, "dictation.wav");
      return Response.json({ text: " hallo " });
    }
    throw new Error(`unexpected bridge call ${suffix}`);
  };
  const spoken = await synthesis.synthesizeSpeech({ userId: 1, text: "Hello there." });
  assert.equal(spoken.headers.get("content-type"), "audio/aac");
  assert.equal((await spoken.arrayBuffer()).byteLength, 4);
  const transcribed = await transcribeRoute.POST(recordingRequest());
  assert.deepEqual(await transcribed.json(), { text: "hallo" });
  assert.deepEqual(await (await prepareRoute.POST()).json(), { ready: true, provider: "openaiweb" });
  const status = await (await statusRoute.GET()).json();
  assert.equal(status.available, true);
  assert.equal(status.web.source, "web");
  assert.equal(status.cloud, undefined);
  assert.deepEqual(calls, ["web/synthesize", "web/transcribe", "web/status", "web/status"]);

  state.voiceBridgeFetch = async () => Response.json({ error: "ChatGPT's limit to read this text aloud is reached for now. Try again later." }, { status: 429 });
  await assert.rejects(synthesis.synthesizeSpeech({ userId: 1, text: "Hello there." }), (error) => error.status === 429 && /limit/.test(error.message));

  // Every voice surface uses request/response audio, never the realtime connection.
  globalThis.fetch = async (url) => {
    if (url === "/api/speech/settings") return Response.json({ userId: "1", settings: settings.getSpeechSettings(1) });
    if (url === "/api/speech/synthesize") return new Response("web-audio");
    throw new Error(`unexpected fetch ${url}`);
  };
  assert.equal(await subscriptionLive.subscriptionSelected(), false);
  const response = await requestClient.speechRequest("/api/speech/synthesize", { method: "POST", body: JSON.stringify({ text: "x" }) });
  assert.equal(await response.text(), "web-audio");
});

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

test('pronunciation settings migrate empty, are isolated per user, and reject invalid updates atomically', () => {
  assert.equal(migrated.pronunciations, '');
  settings.updateSpeechSettings(1, { pronunciations: 'SQL = sequel' });
  settings.updateSpeechSettings(1, { speechProvider: 'elevenlabs' });
  assert.equal(settings.getSpeechSettings(1).pronunciations, 'SQL = sequel');
  assert.equal(settings.getSpeechSettings(2).pronunciations, '');
  for (const pronunciations of ['SQL =', ['SQL', 'sequel'], 'SQL = one\nSQL = two']) {
    assert.throws(() => settings.updateSpeechSettings(1, { pronunciations, language: 'nl' }), { status: 400 });
    assert.equal(settings.getSpeechSettings(1).pronunciations, 'SQL = sequel');
    assert.equal(settings.getSpeechSettings(1).language, 'en');
  }
  settings.updateSpeechSettings(1, { pronunciations: '' });
  assert.equal(settings.getSpeechSettings(1).pronunciations, '');
});

test('local synthesis corrects pronunciations once and directs only an instruction-capable engine', async () => {
  const bodies = [];
  state.localJson = async () => ({ id: 'voice', voice_type: 'preset', name: 'Local', preset_engine: 'qwen_custom_voice' });
  state.localFetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response('local-audio', { headers: { 'Content-Type': 'audio/wav' } });
  };
  for (const [engine, modelSize, directed] of [['auto', '1.7B', true], ['qwen_custom_voice', '1.7B', true], ['qwen_custom_voice', '0.6B', false], ['qwen', '1.7B', false], ['kokoro', '1.7B', false]]) {
    settings.updateSpeechSettings(1, { profileId: 'voice', engine, modelSize, pronunciations: 'SQL = sequel\nsequel = follow-up' });
    await synthesis.synthesizeSpeech({ userId: 1, text: 'SQL.\n\nNext paragraph.' });
    assert.equal(bodies.at(-1).text, 'sequel.\n\nNext paragraph.');
    assert.equal(Boolean(bodies.at(-1).instruct), directed);
  }
});

test('subscription readers receive their own pronunciation snapshot separately from their instructions', async () => {
  settings.updateSpeechSettings(1, { speechProvider: 'chatgpt', pronunciations: 'SQL = sequel' });
  state.subscriptionBridge = async (_userId, _suffix, init) => {
    assert.equal(JSON.parse(init.body).pronunciations, undefined);
    return Response.json({ id: 'reader', voice: 'cove' });
  };
  const response = await subscriptionRoute.POST(new Request('http://breadboard.test/api/speech/subscription', {
    method: 'POST', body: JSON.stringify({ sdp: 'v=0', mode: 'speak' }),
  }));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).pronunciations, 'SQL = sequel');
});

function selectElevenLabs() {
  elevenlabsCredentials.storeElevenLabsApiKey(1, "elevenlabs-test-key");
  return settings.updateSpeechSettings(1, { speechProvider: "elevenlabs", elevenlabsVoiceId: "voice123" });
}

test("ElevenLabs preferences survive provider switches without changing local or subscription voices", () => {
  settings.updateSpeechSettings(1, { profileId: "retained", openaiVoice: "maple" });
  selectElevenLabs();
  settings.updateSpeechSettings(1, { elevenlabsModel: "eleven_v3" });
  settings.updateSpeechSettings(1, { speechProvider: "local" });
  settings.updateSpeechSettings(1, { speechProvider: "chatgpt" });
  const restored = settings.updateSpeechSettings(1, { speechProvider: "elevenlabs", elevenlabsVoiceId: "../../evil", elevenlabsModel: "unknown" });
  assert.equal(restored.elevenlabsVoiceId, "voice123");
  assert.equal(restored.elevenlabsModel, "eleven_v3");
  assert.equal(restored.profileId, "retained");
  assert.equal(restored.openaiVoice, "maple");
  assert.equal(settings.getSpeechSettings(2).elevenlabsVoiceId, "");
});

test("ElevenLabs keys are encrypted, bound to the user, removable, and never returned by routes", async () => {
  const request = new Request("http://breadboard.test/api/speech/elevenlabs/credentials", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "private-test-key" }),
  });
  const response = await elevenlabsCredentialRoute.PUT(request);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(!body.includes("private-test-key"));
  const stored = db.prepare("SELECT encrypted_value FROM speech_elevenlabs_credentials WHERE user_id=1").get().encrypted_value;
  assert.ok(!stored.includes("private-test-key"));
  assert.equal(elevenlabsCredentials.getElevenLabsApiKey(1), "private-test-key");
  assert.equal(elevenlabsCredentials.getElevenLabsApiKey(2), null);
  db.prepare("INSERT INTO speech_elevenlabs_credentials VALUES (2, ?)").run(stored);
  assert.throws(() => elevenlabsCredentials.getElevenLabsApiKey(2), { status: 503 });
  process.env.ELEVENLABS_API_KEY = "server-test-key";
  assert.equal(elevenlabsCredentials.getElevenLabsApiKey(1), "private-test-key");
  await elevenlabsCredentialRoute.DELETE(new Request(request.url, { method: "DELETE" }));
  assert.equal(elevenlabsCredentials.getElevenLabsApiKey(1), "server-test-key");
  assert.equal(elevenlabsCredentials.elevenLabsCredentialStatus(1).source, "environment");
  delete process.env.NEXTAUTH_SECRET;
  assert.equal(elevenlabsCredentials.elevenLabsCredentialStatus(1).canStore, false);
  assert.throws(() => elevenlabsCredentials.storeElevenLabsApiKey(1, "new-key"), { status: 503 });
});

test("ElevenLabs status and preparation do not start local or subscription speech", async () => {
  selectElevenLabs();
  state.cloud = null;
  assert.deepEqual(await (await prepareRoute.POST()).json(), { ready: true, provider: "elevenlabs" });
  const status = await (await statusRoute.GET()).json();
  assert.equal(status.elevenlabs.configured, true);
  assert.deepEqual(status.profiles, []);
  assert.equal(status.settings.speechProvider, "elevenlabs");
  elevenlabsCredentials.forgetElevenLabsApiKey(1);
  assert.equal((await prepareRoute.POST()).status, 409);
});

test("ElevenLabs voice listing forwards pagination and only returns voice names and IDs", async () => {
  selectElevenLabs();
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=page+2");
    assert.equal(init.headers.get("xi-api-key"), "elevenlabs-test-key");
    assert.equal(init.redirect, "error");
    return Response.json({ voices: [{ voice_id: "voice123", name: "My voice", secret: "discard" }], has_more: true, next_page_token: "page3" });
  };
  const result = await elevenlabsVoicesRoute.GET(new Request("http://breadboard.test/api/speech/elevenlabs/voices?cursor=page%202"));
  assert.deepEqual(await result.json(), { voices: [{ id: "voice123", name: "My voice" }], nextCursor: "page3" });
});

test("ElevenLabs synthesis chunks long text and downloads MP3 without a local voice or encoder", async () => {
  selectElevenLabs();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128");
    const body = JSON.parse(init.body);
    assert.equal(body.model_id, "eleven_flash_v2_5");
    assert.ok(body.text.length <= 4000);
    calls++;
    return new Response(`mp3-part-${calls}`, { headers: { "Content-Type": "audio/mpeg" } });
  };
  const response = await mp3Route.POST(new Request("http://breadboard.test/api/speech/synthesize/mp3", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "word ".repeat(1700) }),
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.equal(await response.text(), "mp3-part-1mp3-part-2mp3-part-3");
  const unicode = "a".repeat(3999) + "🎙" + "b".repeat(20);
  assert.equal(elevenlabs.elevenLabsTextChunks(unicode).join(""), unicode);
  assert.equal(elevenlabs.elevenLabsTextChunks(unicode)[0].length, 3999);
});

test('ElevenLabs preserves sentence boundaries and sends neighbouring context only on v2 models', async () => {
  selectElevenLabs();
  const text = 'SQL is useful. '.repeat(620).trim();
  settings.updateSpeechSettings(1, { pronunciations: 'SQL = sequel' });
  const chunks = elevenlabs.elevenLabsTextChunks(text.replaceAll('SQL', 'sequel'));
  assert.ok(chunks.every(chunk => chunk.endsWith('.')));
  for (const model of ['eleven_flash_v2_5', 'eleven_multilingual_v2', 'eleven_v3']) {
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
    };
    settings.updateSpeechSettings(1, { elevenlabsModel: model });
    await synthesis.synthesizeSpeech({ userId: 1, text });
    assert.equal(bodies.length, chunks.length);
    for (const [index, body] of bodies.entries()) {
      assert.equal(body.text, chunks[index]);
      assert.equal(body.previous_text, model === 'eleven_v3' ? undefined : chunks[index - 1]);
      assert.equal(body.next_text, model === 'eleven_v3' ? undefined : chunks[index + 1]);
      assert.equal(body.voice_settings, undefined, 'retain saved voice settings');
    }
  }
});

test("ElevenLabs transcription uses Scribe and the selected spoken language", async () => {
  selectElevenLabs();
  settings.updateSpeechSettings(1, { transcriptionLanguage: "nl" });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.elevenlabs.io/v1/speech-to-text");
    assert.equal(init.body.get("model_id"), "scribe_v2");
    assert.equal(init.body.get("language_code"), "nl");
    assert.equal(init.body.get("tag_audio_events"), "false");
    assert.equal(await init.body.get("file").text(), "test-audio");
    return Response.json({ text: " Hallo wereld " });
  };
  assert.deepEqual(await (await transcribeRoute.POST(recordingRequest())).json(), { text: "Hallo wereld" });
});

test("ElevenLabs uploaded recording segments use the same provider and clean up", async () => {
  selectElevenLabs();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "elevenlabs-test-"));
  const part = path.join(directory, "recording.wav");
  await fs.writeFile(part, "segment-audio");
  let cleaned = false;
  const events = [];
  state.segment = async () => ({ available: true, parts: [part], cleanup: () => { cleaned = true; } });
  globalThis.fetch = async (_url, init) => {
    assert.equal(await init.body.get("file").text(), "segment-audio");
    return Response.json({ text: "Uploaded transcript" });
  };
  try {
    const result = await recording.transcribeStoredRecording({ speechProvider: "elevenlabs", runtimeScope: { userId: 1, gardenId: null, conversationId: null },
      workspace: { directory, filePath: part }, filename: "recording.wav", model: "base", language: null,
      signal: new AbortController().signal, onEvent: (event) => events.push(event) });
    assert.equal(result, "Uploaded transcript");
    assert.equal(cleaned, true);
    assert.equal(events.at(-1).stage, "transcribing");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("ElevenLabs errors, disabled speech, missing credentials, and cancellation never fall back", async () => {
  selectElevenLabs();
  globalThis.fetch = async () => new Response("sensitive upstream content", { status: 401 });
  await assert.rejects(synthesis.synthesizeSpeech({ userId: 1, text: "hello" }), (error) => error.status === 409 && !error.message.includes("sensitive"));
  globalThis.fetch = async () => new Response("limit", { status: 429 });
  await assert.rejects(synthesis.synthesizeSpeech({ userId: 1, text: "hello" }), { status: 429 });
  globalThis.fetch = unexpected;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(synthesis.synthesizeSpeech({ userId: 1, text: "hello", signal: controller.signal }), { name: "AbortError" });
  settings.updateSpeechSettings(1, { enabled: false });
  await assert.rejects(synthesis.synthesizeSpeech({ userId: 1, text: "hello" }), { status: 409 });
  assert.equal((await transcribeRoute.POST(recordingRequest())).status, 409);
  settings.updateSpeechSettings(1, { enabled: true });
  elevenlabsCredentials.forgetElevenLabsApiKey(1);
  await assert.rejects(synthesis.synthesizeSpeech({ userId: 1, text: "hello" }), { status: 409 });
});

test("ElevenLabs browser dispatch bypasses the subscription connection for playback and recordings", async () => {
  const current = selectElevenLabs();
  const calls = [];
  globalThis.fetch = async (url) => {
    if (url === "/api/speech/settings") return Response.json({ settings: current });
    calls.push(url);
    return new Response("provider-result");
  };
  assert.equal(await subscriptionLive.subscriptionSelected(), false);
  for (const url of ["/api/speech/synthesize", "/api/speech/synthesize/mp3", "/api/speech/transcribe", "/api/speech/transcribe-upload"]) {
    assert.equal(await (await requestClient.speechRequest(url)).text(), "provider-result");
  }
  assert.equal(calls.length, 4);
});

test("ElevenLabs credential and voice routes require an authenticated user", async () => {
  state.userId = null;
  const request = new Request("http://breadboard.test/api/speech/elevenlabs/credentials", { method: "PUT" });
  assert.equal((await elevenlabsCredentialRoute.PUT(request)).status, 401);
  assert.equal((await elevenlabsCredentialRoute.DELETE(request)).status, 401);
  assert.equal((await elevenlabsVoicesRoute.GET(request)).status, 401);
});
