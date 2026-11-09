import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import Database from "better-sqlite3";
import fs from "node:fs";
import { recoverPendingChatMessages, requestChatRecovery } from "../src/lib/conversations/coordination-recovery.ts";

const originalFetch = globalThis.fetch;
const originalEnv = { secret: process.env.BREADBOARD_HERMES_TOOL_SECRET, url: process.env.BREADBOARD_INTERNAL_URL };
const calls = [];
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response(null, { status: 202 }); };
process.env.BREADBOARD_HERMES_TOOL_SECRET = "startup-test-service-token";
process.env.BREADBOARD_INTERNAL_URL = "http://127.0.0.1:43123";
const hooks = registerHooks({
  load(url, context, next) {
    assert.ok(!url.endsWith("/conversations/coordination.ts"), "startup must not import dispatch");
    assert.ok(!url.endsWith("/swarm/pump.ts"), "startup must not import specialist routes");
    return next(url, context);
  },
});

test("startup hands off persisted teams without loading the specialist route graph", async () => {
  const teams = new Database(":memory:");
  const initialCalls = calls.length;
  try {
    teams.exec("CREATE TABLE swarm_runs (status TEXT)");
    for (const status of ["completed", "cancelled", "failed", "running", "paused", "cancelling", "verifying", "awaiting_input", "budget_limited"]) {
      teams.exec("DELETE FROM swarm_runs");
      teams.prepare("INSERT INTO swarm_runs VALUES (?)").run(status);
      const before = calls.length;
      await recoverPendingChatMessages(teams);
      assert.equal(calls.length - before, ["completed", "cancelled", "failed"].includes(status) ? 0 : 1, status);
    }
    const instrumentation = fs.readFileSync(new URL('../src/instrumentation-runtime.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(instrumentation, /import\(["']\.\/lib\/swarm\/(?:pump|service|runtime-adapter|runtime-routes)\.ts["']\)/);
  } finally { teams.close(); calls.length = initialCalls; }
});
const db = new Database(":memory:");
after(() => {
  db.close(); hooks.deregister(); globalThis.fetch = originalFetch;
  for (const [key, value] of [["BREADBOARD_HERMES_TOOL_SECRET", originalEnv.secret], ["BREADBOARD_INTERNAL_URL", originalEnv.url]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("startup keeps settled history idle and hands off all unfinished states without importing dispatch", async () => {
  await recoverPendingChatMessages(db);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chat_agent_messages'").get(), undefined);
  db.exec("CREATE TABLE chat_agent_messages (status TEXT)");
  await recoverPendingChatMessages(db);
  for (const status of ["complete", "failed", "cancelled"]) {
    db.prepare("INSERT INTO chat_agent_messages VALUES (?)").run(status);
    await recoverPendingChatMessages(db);
  }
  assert.equal(calls.length, 0);
  for (const status of ["queued", "dispatching", "running"]) {
    db.exec("DELETE FROM chat_agent_messages");
    db.prepare("INSERT INTO chat_agent_messages VALUES (?)").run(status);
    const before = calls.length;
    await recoverPendingChatMessages(db);
    assert.equal(calls.length, before + 1, `${status} must hand off recovery`);
  }
  for (const call of calls) {
    assert.equal(call.url, "http://127.0.0.1:43123/api/internal/chat-coordination-recovery");
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.authorization, "Bearer startup-test-service-token");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.body, undefined);
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test("startup retries readiness failures and stops at a finite deadline", async () => {
  let attempts = 0;
  await requestChatRecovery({ timeoutMs: 1500, fetcher: async () => {
    if (++attempts === 1) throw Error("connection refused");
    return new Response(null, { status: attempts === 2 ? 503 : 202 });
  } });
  assert.equal(attempts, 3);
  attempts = 0;
  const start = Date.now();
  await assert.rejects(requestChatRecovery({ timeoutMs: 30, fetcher: async () => {
    attempts++; return new Response(null, { status: 503 });
  } }), /deferred/);
  assert.ok(Date.now() - start < 1000);
  assert.ok(attempts >= 1 && attempts <= 2);
  attempts = 0;
  await assert.rejects(requestChatRecovery({ fetcher: async () => {
    attempts++; return new Response(null, { status: 401 });
  } }), /deferred/);
  assert.equal(attempts, 1, "invalid credentials cannot become ready by retrying");
});

test("startup never sends the service credential to a remote or credential-bearing URL", async () => {
  for (const url of ["https://example.com", "http://example.com", "http://127.0.0.1.evil.test", "http://name:pass@127.0.0.1"]) {
    await assert.rejects(requestChatRecovery({ env: { BREADBOARD_HERMES_TOOL_SECRET: "test", BREADBOARD_INTERNAL_URL: url },
      fetcher: async () => { throw Error("must not fetch"); } }), /local dashboard URL/);
  }
  await assert.rejects(requestChatRecovery({ env: {} }), /authentication/);
});
