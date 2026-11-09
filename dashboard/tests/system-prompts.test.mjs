import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import Database from "better-sqlite3";
import { SystemPromptStore } from "../src/lib/system-prompts/store.ts";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-system-prompts-"));
process.env.BREADBOARD_DATA_DIR = temporary;
process.env.BREADBOARD_REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const { default: db } = await import("../src/lib/db.ts");
const { listSystemPrompts, updateSystemPrompt, systemPromptText } = await import("../src/lib/system-prompts/service.ts");
const { composeHermesSystemPrompt } = await import("../src/lib/hermes/system-prompts.ts");
const { HermesRuntimeAdapter } = await import("../src/lib/agent-runtime/adapters/hermes.ts");
db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, 'test')").run(701, "prompts-a", "prompts-a@test.local");
db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, 'test')").run(702, "prompts-b", "prompts-b@test.local");
after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });

const decision = { mode: "knowledge", implementationRequired: false, allowedTools: ["weather_forecast", "websearch"],
  authorizedRoots: [], authorizedPathPatterns: [], allowedOperations: ["knowledge_work"], allowedCommandPatterns: [] };
function edit(id, content, userId = 701) {
  const prompt = listSystemPrompts(userId).find((item) => item.id === id);
  assert.ok(prompt, id);
  return updateSystemPrompt(userId, { id, content, revision: prompt.revision });
}

test("saved prompts apply immediately to every chat surface and stay private to their owner", () => {
  const before = systemPromptText("chat-core", 701);
  const changed = edit("chat-core", "Answer each question as a short poem. LIVE_CORE");
  assert.equal(changed.customized, true);
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const input = { userId: 701, surface, decision };
    assert.match(composeHermesSystemPrompt(input), /LIVE_CORE/);
    assert.doesNotMatch(composeHermesSystemPrompt({ ...input, userId: 702 }), /LIVE_CORE/);
    assert.doesNotMatch(composeHermesSystemPrompt({ ...input, userId: null }), /LIVE_CORE/);
  }
  assert.equal(systemPromptText("chat-core", 702), before);
  edit("chat-core", null);
  assert.equal(systemPromptText("chat-core", 701), before);
});

test("voice, tool, surface and concise prompts are replaced at composition time, including an intentionally empty prompt", () => {
  const changes = { "voice-conversation": "VOICE_LIVE", "voice-weather-results": "WEATHER_VOICE_LIVE",
    "weather-results": "WEATHER_TYPED_LIVE", "quartz-surface": "READER_LIVE", "concise-mode": "CONCISE_LIVE", "artifact-delivery": "" };
  for (const [id, text] of Object.entries(changes)) edit(id, text);
  const input = { userId: 701, surface: "quartz_ai", decision, adhdMode: true };
  const typed = composeHermesSystemPrompt(input);
  const spoken = composeHermesSystemPrompt({ ...input, voice: true });
  assert.match(typed, /WEATHER_TYPED_LIVE/);
  assert.doesNotMatch(typed, /# artifact_delivery|WEATHER_VOICE_LIVE/);
  assert.match(spoken, /VOICE_LIVE/);
  assert.match(spoken, /WEATHER_VOICE_LIVE/);
  assert.doesNotMatch(spoken, /WEATHER_TYPED_LIVE/);
  for (const output of [typed, spoken]) {
    assert.match(output, /READER_LIVE/);
    assert.match(output, /CONCISE_LIVE/);
    assert.match(output, /# server_capability_decision/);
  }
  for (const id of Object.keys(changes)) edit(id, null);
});

test("conflicting windows, invalid values and oversized changes cannot silently overwrite saved prompts", () => {
  const initial = edit("chat-core", "CURRENT");
  assert.throws(() => updateSystemPrompt(701, { id: "chat-core", content: "STALE", revision: initial.revision - 1 }), { status: 409 });
  for (const change of [
    { id: "../../outside", content: "bad", revision: 0 },
    { id: "chat-core", content: "x".repeat(64_001), revision: initial.revision },
    { id: "chat-core", content: "bad\0text", revision: initial.revision },
    { id: "chat-core", content: true, revision: initial.revision },
    { id: "chat-core", content: "bad", revision: -1 },
  ]) assert.throws(() => updateSystemPrompt(701, change));
  assert.equal(systemPromptText("chat-core", 701), "CURRENT");
  edit("chat-core", null);
  assert.throws(() => updateSystemPrompt(701, { id: "chat-core", content: "STALE_AFTER_RESET", revision: initial.revision }), { status: 409 });
});

test("another database connection sees edits and resets without a process restart", () => {
  const second = new Database(db.name);
  try {
    const store = new SystemPromptStore(second);
    edit("chat-core", "DURABLE");
    assert.equal(store.content(701, "chat-core", "fallback"), "DURABLE");
    assert.equal(store.content(702, "chat-core", "fallback"), "fallback");
    edit("chat-core", "");
    assert.equal(store.content(701, "chat-core", "fallback"), "");
    edit("chat-core", null);
    assert.equal(store.content(701, "chat-core", "fallback"), "fallback");
  } finally { second.close(); }
});

test("an existing Hermes session receives the new runtime and chat instructions on its next submission", async () => {
  const requests = [];
  const adapter = new HermesRuntimeAdapter({ baseUrl: "http://127.0.0.1:9119", sessionToken: "test", requestTimeoutMs: 5_000 });
  adapter.client = { async request(method, params) {
    requests.push({ method, params });
    return method === "session.create" ? { session_id: "live-system", stored_session_id: "stored-system" } : { status: "streaming" };
  }, clearSession() {}, close() {} };
  const session = await adapter.createSession({ surface: "garden_chat", sessionKey: "system-prompts", filesystemMode: "restricted" });
  try {
    const run = async () => adapter.startRun({ ...session, userId: 701, text: "Hello", system: composeHermesSystemPrompt({ userId: 701, surface: "garden_chat", decision }) });
    await run();
    edit("runtime-base", "RUNTIME_CHANGED_LIVE");
    edit("chat-core", "CHAT_CHANGED_LIVE");
    await run();
    const submits = requests.filter((item) => item.method === "prompt.submit");
    assert.equal(submits.length, 2);
    assert.equal(submits[0].params.session_id, submits[1].params.session_id);
    assert.doesNotMatch(submits[0].params.system_prompt, /CHANGED_LIVE/);
    assert.match(submits[1].params.system_prompt, /RUNTIME_CHANGED_LIVE/);
    assert.match(submits[1].params.system_prompt, /CHAT_CHANGED_LIVE/);
    assert.equal(requests.filter((item) => item.method === "session.create").length, 1);
    edit("runtime-base", "LONG_RUNTIME " + "r".repeat(60_000));
    const composed = composeHermesSystemPrompt({ userId: 701, surface: "garden_chat", decision, additional: "c".repeat(400_000) });
    await adapter.startRun({ ...session, userId: 701, text: "Long context", system: composed });
    const latest = requests.filter((item) => item.method === "prompt.submit").at(-1).params.system_prompt;
    assert.ok(latest.length <= 262_144);
    assert.ok(latest.includes(composed), "the adapter must not clip customized sections after composition");
  } finally {
    edit("runtime-base", null);
    edit("chat-core", null);
    adapter.dispose();
  }
});
