import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { readClaudeUsageStatus, readCodexUsageStatus } from "../src/lib/hermes/usage-status.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";

const TOOL = "breadboard_usage";
const NOW = new Date("2026-11-08T12:00:30Z");

// The Claude meter must read this machine's real sign-in in no test: an empty
// config dir makes every Claude read a deterministic "not signed in".
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-usage-claude-"));
const report = () => ({
  captured_at: "2026-11-08T12:00:00Z", account: "test@example.com", plan: "pro",
  primary: { used_percent: 100, window_minutes: 10080, resets_in_seconds: 3600 },
  limit_reached: true,
  reserve: { model: "gpt-test-luna", active: true, limit_reached: false,
    primary: { used_percent: 26, window_minutes: 10080, resets_in_seconds: 7200 } },
  access_token: "must-not-escape",
});

async function usageServer(t, payload = report(), status = 200) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push([req.method, req.url]);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

test("ordinary authenticated chats can read usage and receive the tool contract", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    for (const authenticated of [true, false]) {
      const isolated = surface === "quartz_ai";
      const plan = planTask({ request: "How much Codex do I have left?", authenticated, isolated });
      const grant = brokerCapabilities({ plan, surface, userId: authenticated ? 1 : null,
        grants: [], workspaceRoot: "/runtime/usage-test", isolated });
      assert.equal(grant.allowedTools[TOOL], authenticated && !isolated);
    }
    assert.equal(allowedToolsForSurface(surface).includes(TOOL), surface !== "quartz_ai");
  }
  const decision = {
    mode: "knowledge", requestedOutcome: "Read usage", implementationRequired: false,
    decisionReason: "Knowledge task", decisionSource: "breadboard_server_policy_v1", authorizedRoots: [],
    authorizedPathPatterns: [], allowedTools: [TOOL], allowedOperations: ["knowledge_work"],
    allowedCommandPatterns: [], selectedConditionalSkills: [], selectedConnections: [],
    createdAt: NOW.toISOString(), expiresAt: null, revokedAt: null,
  };
  for (const voice of [false, true]) {
    const prompt = composeHermesSystemPrompt({ surface: "dashboard_terminal", decision, voice });
    assert.match(prompt, /breadboard_usage/);
    assert.match(prompt, /last-known/);
    assert.match(prompt, /remaining/);
    assert.match(prompt, /reserve/);
    const without = composeHermesSystemPrompt({ surface: "dashboard_terminal", voice,
      decision: { ...decision, allowedTools: [] } });
    assert.doesNotMatch(without, /breadboard_usage/);
  }
});

test("the real usage reader reports reserve, unknown windows and capture-based reset times", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const fixture = await usageServer(t);
  const result = await readCodexUsageStatus(fixture.baseURL);
  assert.equal(result.available, true);
  assert.equal(result.refreshed, true);
  assert.equal(result.source, "report");
  assert.equal(result.plan, "pro");
  assert.equal(result.reserve.active, true);
  assert.equal(result.limit_reached, true);
  assert.equal(result.age_seconds, 30);
  assert.deepEqual(result.windows.map((w) => [w.key, w.used_percent, w.remaining_percent]), [
    ["five-hour", null, null], ["primary", 100, 0], ["reserve", 26, 74],
  ]);
  assert.equal(result.windows[0].reported, false);
  assert.equal(result.windows[0].resets_at, null);
  assert.equal(result.windows[1].resets_at, "2026-11-08T13:00:00.000Z");
  assert.equal(result.windows[1].resets_in_seconds, 3570);
  assert.equal(result.windows[2].resets_at, "2026-11-08T14:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(result), /must-not-escape|access_token/);
  assert.equal(result.claude.provider, "anthropic");
  assert.equal(result.claude.available, false);
  assert.match(result.claude.error, /not signed in/);
  assert.deepEqual(result.claude.windows, []);
  t.mock.timers.tick(3000);
  const cached = await readCodexUsageStatus(fixture.baseURL);
  assert.equal(cached.age_seconds, 33);
  assert.equal(cached.windows[1].resets_in_seconds, 3567);
  assert.equal(cached.windows[1].resets_at, result.windows[1].resets_at);
  assert.deepEqual(fixture.requests, [["GET", "/v1/settings/usage"]]);
});

test("chat uses the same absolute GPT reset times as the notch", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const payload = report();
  payload.primary.resets_at = Date.parse("2026-11-08T14:00:00Z") / 1000;
  payload.reserve.primary.resets_at = Date.parse("2026-11-08T15:00:00Z") / 1000;
  delete payload.reserve.primary.resets_in_seconds;
  const fixture = await usageServer(t, payload);
  const first = await readCodexUsageStatus(fixture.baseURL);
  assert.equal(first.windows.find(w => w.key === "primary").resets_at, "2026-11-08T14:00:00.000Z");
  assert.equal(first.windows.find(w => w.key === "primary").resets_in_seconds, 7170);
  assert.equal(first.windows.find(w => w.key === "reserve").resets_at, "2026-11-08T15:00:00.000Z");
  t.mock.timers.tick(1000);
  const second = await readCodexUsageStatus(fixture.baseURL);
  assert.equal(second.windows.find(w => w.key === "primary").resets_in_seconds, 7169);
  assert.equal(second.windows.find(w => w.key === "primary").resets_at, "2026-11-08T14:00:00.000Z");
  assert.deepEqual(fixture.requests, [["GET", "/v1/settings/usage"]]);
});

test("the Claude meter maps subscription windows into the shared window shape", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const reader = async (model) => {
    assert.match(model, /^cliproxy\/claude-/);
    return {
      provider: "anthropic", available: true, captured_at: "2026-11-08T12:00:00Z",
      model: "claude-sonnet-5", usage_url: "https://claude.ai/settings/usage",
      limits: [
        { key: "five_hour", label: "Current session", limit: { used_percent: 55, resets_in_seconds: 3600 } },
        { key: "seven_day", label: "Current week (all models)", limit: { used_percent: 12 } },
      ],
    };
  };
  const status = await readClaudeUsageStatus(reader);
  assert.equal(status.provider, "anthropic");
  assert.equal(status.available, true);
  assert.equal(status.age_seconds, 30);
  assert.deepEqual(status.windows.map((w) => [w.key, w.used_percent, w.remaining_percent, w.window_minutes]), [
    ["five_hour", 55, 45, 300], ["seven_day", 12, 88, 10080],
  ]);
  assert.equal(status.windows[0].resets_at, "2026-11-08T13:00:00.000Z");
  assert.equal(status.windows[0].resets_in_seconds, 3570);
  assert.equal(status.windows[1].resets_at, null);
  assert.equal(status.windows[1].resets_in_seconds, null);

  const stale = await readClaudeUsageStatus(async () => ({
    provider: "anthropic", available: true, captured_at: "2026-11-08T11:00:00Z",
    model: "claude-sonnet-5", usage_url: "", stale: true, refresh_error: "offline",
    limits: [{ key: "five_hour", label: "Current session", limit: { used_percent: 20 } }],
  }));
  assert.equal(stale.stale, true);
  assert.equal(stale.refresh_error, "offline");

  const failed = await readClaudeUsageStatus(async () => { throw new Error("Claude Code is not signed in."); });
  assert.equal(failed.available, false);
  assert.match(failed.error, /not signed in/);
  assert.deepEqual(failed.windows, []);
});

test("a failed refresh preserves stale evidence and never turns missing usage into zero", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-usage-tool-"));
  const snapshot = path.join(directory, "limits.json");
  const previous = process.env.CHATMOCK_USAGE_LIMITS_PATH;
  process.env.CHATMOCK_USAGE_LIMITS_PATH = snapshot;
  t.after(() => {
    if (previous === undefined) delete process.env.CHATMOCK_USAGE_LIMITS_PATH;
    else process.env.CHATMOCK_USAGE_LIMITS_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.writeFileSync(snapshot, JSON.stringify({ captured_at: "2026-11-08T10:00:00Z",
    primary: { used_percent: 60, window_minutes: 300, resets_in_seconds: 1800 } }));
  const fixture = await usageServer(t, { error: "offline" }, 502);
  const stale = await readCodexUsageStatus(fixture.baseURL);
  assert.equal(stale.available, true);
  assert.equal(stale.refreshed, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.source, "headers");
  assert.match(stale.refresh_error, /Could not refresh/);
  assert.equal(stale.windows[0].remaining_percent, 40);
  assert.equal(stale.windows[0].resets_in_seconds, 0);
  assert.equal(stale.windows[0].resets_at, "2026-11-08T10:30:00.000Z");
  assert.equal(stale.reserve, undefined);
  fs.unlinkSync(snapshot);
  const unavailable = await readCodexUsageStatus(fixture.baseURL);
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.refreshed, false);
  assert.deepEqual(unavailable.windows, []);
  assert.deepEqual(fixture.requests, [["GET", "/v1/settings/usage"]]);
});

test("the real callback checks ownership, active grants and arguments before reading the meter", async (t) => {
  const fixture = await usageServer(t);
  const state = globalThis.__usageToolTest = {
    baseURL: fixture.baseURL, token: null,
    session: { id: 33, user_id: 1, surface: "dashboard_terminal", conversation_id: 44 },
    conversation: { id: 44, user_id: 1 }, run: { id: "run" }, decision: { allowedTools: [TOOL] },
  };
  t.after(() => { delete globalThis.__usageToolTest; });
  const stubs = {
    "@/lib/chatmock-server.ts": "export const localChatmockBaseUrl = () => globalThis.__usageToolTest.baseURL;",
    "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest = () => globalThis.__usageToolTest.token;",
    "@/lib/hermes/runtime-store.ts": `export const getRuntimeSessionById = id => id === 33 ? globalThis.__usageToolTest.session : null;
      export const runtimeExternalSessionId = () => "usage-session";
      export const getActiveCapabilityDecision = () => globalThis.__usageToolTest.decision;`,
    "@/lib/hermes/run-store.ts": "export const getActiveRuntimeRun = () => globalThis.__usageToolTest.run;",
    "@/lib/conversations/store.ts": "export const getConversationById = () => globalThis.__usageToolTest.conversation;",
    "@/lib/hermes/route-helpers.ts": `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; } }
      export const requireEnabled = () => {}; export const readJsonBody = req => req.json();
      export const apiErrorResponse = error => Response.json({ error: error.message }, { status: error.status || 500 });`,
  };
  const bundle = await build({ entryPoints: ["src/app/api/hermes/tools/usage/route.ts"], bundle: true,
    write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "authority", setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: "authority" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "authority" }, args => ({ contents: stubs[args.path], loader: "js" }));
    } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const call = (args = {}, action = TOOL) => module.exports.POST(new Request("http://localhost/api/hermes/tools/usage", {
    method: "POST", body: JSON.stringify({ action, args }),
  }));
  const token = (overrides = {}) => issueCapabilityToken({ userId: 1, conversationId: 44,
    breadboardSessionId: "33", hermesSessionId: "usage-session", surface: state.session.surface,
    allowedTools: [TOOL], ...overrides });
  assert.equal((await call()).status, 403);
  for (const overrides of [{ userId: 2 }, { conversationId: 45 }, { surface: "quartz_ai" },
    { hermesSessionId: "wrong" }, { breadboardSessionId: "34" }, { allowedTools: [] }]) {
    state.token = token(overrides);
    assert.equal((await call()).status, 403);
  }
  state.token = token();
  state.conversation.user_id = 2;
  assert.equal((await call()).status, 403);
  state.conversation.user_id = 1;
  for (const decision of [null, { allowedTools: [] }]) {
    state.decision = decision;
    assert.equal((await call()).status, 403);
  }
  state.decision = { allowedTools: [TOOL] };
  state.run = null;
  assert.equal((await call()).status, 409);
  state.run = { id: "run" };
  for (const args of [{ account: "other" }, { baseURL: "http://other.invalid" }, [], null, "bad"]) {
    assert.equal((await call(args)).status, 400);
  }
  assert.equal((await call({}, "other_tool")).status, 400);
  assert.deepEqual(fixture.requests, []);
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    state.session.surface = surface;
    state.token = token();
    const response = await call();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.data.available, true);
    assert.equal(result.data.windows.find(w => w.key === "reserve").remaining_percent, 74);
  }
  state.session.surface = "quartz_ai";
  state.token = token();
  assert.equal((await call()).status, 403);
  assert.deepEqual(fixture.requests, [["GET", "/v1/settings/usage"]]);
});
