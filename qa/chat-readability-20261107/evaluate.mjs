// Live model checks using the production prompt and real in-memory status reader.
// No Telegram messages are sent. Run with a loopback model gateway as argument.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "../../dashboard/node_modules/better-sqlite3/lib/index.js";

process.env.BREADBOARD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-readable-eval-"));
const { composeHermesSystemPrompt } = await import("../../dashboard/src/lib/hermes/system-prompts.ts");
const { breadSystemPrompt } = await import("../../dashboard/src/lib/assistant-identity.ts");
const { collectProcessStatus, summarizeProcessStatus } = await import("../../dashboard/src/lib/hermes/process-status.ts");
const base = process.argv[2];
if (!base || !["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("Supply the local model gateway URL");
const models = process.argv.slice(3);
if (!models.length) throw new Error("Supply the app models to check");
const directory = path.dirname(fileURLToPath(import.meta.url));
const report = { method: "Production prompt builder and SQLite status reader with fixture chats, through the running model gateway. No user chats or Telegram sends.", results: [] };
const decision = { mode: "knowledge", requestedOutcome: "Answer the user's question", implementationRequired: false,
  decisionReason: "Status check", decisionSource: "breadboard_server_policy_v1", authorizedRoots: [],
  authorizedPathPatterns: [], allowedTools: ["breadboard_process_status", "chat_list", "terminal"],
  allowedOperations: ["knowledge_work"], allowedCommandPatterns: [], selectedConditionalSkills: [], selectedConnections: [] };
const tools = [
  { type: "function", function: { name: "breadboard_process_status", description: "Read live Breadboard task status: uploads, lessons, transcriptions, agent work, chats currently replying, schedules and workflows.", parameters: { type: "object", properties: { kinds: { type: "array", items: { type: "string" } }, active_only: { type: "boolean", description: "Include only running or waiting work. Use true when asked what is active." }, all_gardens: { type: "boolean" }, garden: { type: "string" } } } } },
  { type: "function", function: { name: "chat_list", description: "List saved Breadboard conversations, with titles and IDs, to browse or contact another chat.", parameters: { type: "object", properties: { query: { type: "string" } } } } },
  { type: "function", function: { name: "terminal", description: "Run a shell command on the computer.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];
const fixtures = [
  { id: "current-only", question: "any active chats inside breadboard?" },
  { id: "correction", question: "i meant active chats inside breadboard", history: [
    { role: "user", content: "what's active in breadboard?" },
    { role: "assistant", content: "The runtime manager has several active services, including the Hermes agent, dashboard, Telegram gateway, Spotify playback, background workers, and screen recording. **PIDs and process status are a snapshot and may change.**" },
  ] },
  { id: "other-chats", question: "which chats are still working?", other: true },
  { id: "unavailable", question: "are any other chats active?", unavailable: true },
  { id: "voice-correction", question: "i meant active chats inside breadboard", voice: true },
];

function status(fixture, args) {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE clusters (id INTEGER, user_id INTEGER, slug TEXT, name TEXT);
      CREATE TABLE conversations (id INTEGER, user_id INTEGER, title TEXT);
      CREATE TABLE hermes_runtime_sessions (id INTEGER, user_id INTEGER, conversation_id INTEGER, surface TEXT, garden_id TEXT);
      CREATE TABLE hermes_runs (id TEXT, runtime_session_id INTEGER, instruction TEXT, status TEXT, started_at TEXT, finished_at TEXT);
      INSERT INTO conversations VALUES (1, 7, 'Telegram: Status'), (2, 7, 'Holiday planning');
      INSERT INTO hermes_runtime_sessions VALUES (11, 7, 1, 'dashboard_terminal', NULL), (12, 7, 2, 'dashboard_terminal', NULL);
      INSERT INTO hermes_runs VALUES ('current', 11, 'i meant active chats inside breadboard', 'active', '2026-11-07T12:00:00Z', NULL),
      ('other', 12, 'go ahead', '${fixture.other ? "active" : "completed"}', '2026-11-07T11:00:00Z', ${fixture.other ? "NULL" : "'2026-11-07T11:10:00Z'"});`);
    if (fixture.unavailable) db.exec("DROP TABLE hermes_runs; CREATE TABLE hermes_runs (id TEXT)");
    const result = collectProcessStatus({ database: db, userId: 7, currentConversationId: 1, kinds: args.kinds, activeOnly: args.active_only === true,
      runtimeDatabasePath: path.join(process.env.BREADBOARD_DATA_DIR, "no-runtime.sqlite3"), now: () => new Date("2026-11-07T13:00:00Z") });
    return { ok: true, ...result, summary: summarizeProcessStatus(result) };
  } finally { db.close(); }
}

async function completion(model, messages) {
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages, tools, stream: true, reasoning_effort: "low" }), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Model gateway returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  let pending = "", content = "", finished = false;
  const calls = new Map();
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n"); pending = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue;
      const event = JSON.parse(line.slice(5));
      if (event.error) throw new Error(JSON.stringify(event.error));
      const choice = event.choices?.[0];
      content += choice?.delta?.content ?? "";
      for (const call of choice?.delta?.tool_calls ?? []) {
        const item = calls.get(call.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
        item.id = call.id ?? item.id;
        item.function.name += call.function?.name ?? "";
        item.function.arguments += call.function?.arguments ?? "";
        calls.set(call.index, item);
      }
      if (choice?.finish_reason) finished = true;
    }
  }
  if (!finished) throw new Error("Model stream ended without a completion");
  return { role: "assistant", content: content || null, ...(calls.size ? { tool_calls: [...calls.values()] } : {}) };
}

async function run(model, fixture) {
  const entry = { model, case: fixture.id, calls: [], answer: null };
  const messages = [{ role: "system", content: breadSystemPrompt(composeHermesSystemPrompt({ surface: "dashboard_terminal", decision, voice: fixture.voice })) },
    ...(fixture.history ?? []), { role: "user", content: fixture.question }];
  try {
    for (let turn = 0; turn < 4; turn++) {
      const message = await completion(model, messages);
      messages.push(message);
      if (!message.tool_calls?.length) { entry.answer = message.content; break; }
      for (const call of message.tool_calls) {
        const args = JSON.parse(call.function.arguments);
        entry.calls.push({ name: call.function.name, args });
        if (call.function.name !== "breadboard_process_status") throw new Error(`Wrong status tool: ${call.function.name}`);
        const result = status(fixture, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    if (!entry.answer) throw new Error("No final answer");
    entry.checks = { readStatus: entry.calls.length > 0, chatScope: entry.calls.every((call) => JSON.stringify(call.args.kinds) === '["chat_turn"]'),
      activeFilter: entry.calls.every((call) => call.args.active_only === true),
      noInternalLabels: !/\bturns?\b|runtime|PIDs|snapshot|gateway/i.test(entry.answer),
      noEchoedQuestion: !/i meant active chats inside breadboard/i.test(entry.answer),
      activeScope: fixture.other || fixture.unavailable || !/Holiday planning/i.test(entry.answer),
      unavailableHonesty: !fixture.unavailable || !/only.*(?:this chat|conversation)|no other chats|no.*active chats/i.test(entry.answer),
      concise: entry.answer.split(/\s+/).length <= 65 };
  } catch (error) { entry.error = error.message; }
  report.results.push(entry);
  fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(entry));
}
const queue = models.flatMap((model) => fixtures.map((fixture) => ({ model, fixture })));
await Promise.all(Array.from({ length: 2 }, async () => { while (queue.length) { const item = queue.shift(); await run(item.model, item.fixture); } }));
if (report.results.some((entry) => entry.error || Object.values(entry.checks).some((passed) => !passed))) process.exitCode = 1;
