// DeerFlow: the command, the settings, the config Breadboard writes for the
// cloned Gateway, and the wire format between the two projects.
//
// The last one is the point of this file. DeerFlow is a separate repository with
// its own release cycle, so the SSE event names, the stream modes and the run
// context keys are a contract that can drift without anything failing at build
// time. Each of those is asserted against the clone's own source rather than
// against a comment.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const cloneRoot = path.resolve(dashboardRoot, "..", "deer-flow");
const cloned = fs.existsSync(path.join(cloneRoot, "backend", "app", "gateway", "app.py"));
const backendSource = (relative) =>
  fs.readFileSync(path.join(cloneRoot, "backend", relative), "utf8");

const {
  DEER_FLOW_COMMAND,
  DEER_FLOW_AGENT_ID,
  DEER_FLOW_AGENT_NAME,
  taskFromDeerFlowCommand,
  deerFlowUserMessage,
  deerFlowRunLabel,
} = await import("../src/lib/deer-flow/identity.ts");

const {
  DEFAULT_DEER_FLOW_SETTINGS,
  deerFlowSettingsFrom,
  runContext,
} = await import("../src/lib/deer-flow/settings.ts");

const { parseFrame, messageText, describeArguments } = await import(
  "../src/lib/deer-flow/run-manager.ts"
);

// ---- the command ------------------------------------------------------------

test("the command, the id and the name stay in step", () => {
  assert.equal(DEER_FLOW_COMMAND, `/agents:${DEER_FLOW_AGENT_ID}`);
  assert.equal(DEER_FLOW_AGENT_NAME, "DeerFlow");
});

test("a task is read out of the command and everything else is left alone", () => {
  assert.equal(
    taskFromDeerFlowCommand("/agents:deer-flow write a market brief"),
    "write a market brief",
  );
  // A bare token selects the agent; the next message carries the task.
  assert.equal(taskFromDeerFlowCommand("/agents:deer-flow"), "");
  // A message addressed to nobody, or to someone else, is not this agent's.
  assert.equal(taskFromDeerFlowCommand("write a market brief"), null);
  assert.equal(taskFromDeerFlowCommand("/agents:openwork tidy the outbox"), null);
  // A stacked token survives so the capability resolver still sees it and can
  // refuse the combination, instead of it being swallowed into the task.
  assert.equal(
    taskFromDeerFlowCommand("/my-skill /agents:deer-flow write a brief"),
    "/my-skill write a brief",
  );
  // Prose that merely mentions the command is not a command.
  assert.equal(taskFromDeerFlowCommand("ask /agents:deer-flow about this"), null);
});

test("the user half of the turn renders the command back", () => {
  assert.equal(deerFlowUserMessage("plan the migration"), "/agents:deer-flow plan the migration");
  assert.equal(deerFlowUserMessage("   "), "/agents:deer-flow");
});

test("a run's label is the first line, bounded", () => {
  assert.equal(deerFlowRunLabel("first line\nsecond line"), "first line");
  assert.equal(deerFlowRunLabel(""), "DeerFlow task");
  assert.equal(deerFlowRunLabel("x".repeat(200)).length, 80);
});

// ---- settings ---------------------------------------------------------------

test("stored settings fall back to the shipped defaults, one field at a time", () => {
  assert.deepEqual(deerFlowSettingsFrom({}), DEFAULT_DEER_FLOW_SETTINGS);
  // An unset boolean has to read as the default rather than as false, or a row
  // written before a field existed would silently disable it.
  assert.equal(deerFlowSettingsFrom({ web: undefined }).web, true);
  assert.equal(deerFlowSettingsFrom({ web: "yes" }).web, true);
  assert.equal(deerFlowSettingsFrom({ web: false }).web, false);
  // Numbers are clamped rather than trusted.
  assert.equal(deerFlowSettingsFrom({ maxSubagents: 99 }).maxSubagents, 12);
  assert.equal(deerFlowSettingsFrom({ maxSubagents: 0 }).maxSubagents, 1);
  assert.equal(deerFlowSettingsFrom({ maxSubagents: "nonsense" }).maxSubagents, 6);
  // Running commands is off unless it was explicitly turned on.
  assert.equal(deerFlowSettingsFrom({}).shell, false);
});

test("every run-context key is one the Gateway forwards", { skip: !cloned }, () => {
  const context = runContext(DEFAULT_DEER_FLOW_SETTINGS, {
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
  });
  // `_CONTEXT_CONFIGURABLE_KEYS` is the Gateway's allowlist; a key outside it is
  // dropped before it reaches the agent, so a setting would silently do nothing.
  const allowlist = backendSource("app/gateway/services.py").split(
    "_CONTEXT_CONFIGURABLE_KEYS",
  )[1];
  for (const key of Object.keys(context)) {
    assert.ok(allowlist.includes(`"${key}"`), `the Gateway does not forward context.${key}`);
  }
  assert.equal(context.model_name, "gpt-5.6-sol");
  assert.equal(context.subagent_enabled, true);
  assert.equal(context.max_total_subagents, 6);
});

// ---- the generated config ---------------------------------------------------

test("the config Breadboard writes is the config DeerFlow reads", async () => {
  process.env.DEER_FLOW_STATE_DIR = fs.mkdtempSync(
    path.join(process.env.TEMP ?? "/tmp", "deer-flow-config-"),
  );
  const { writeConfig } = await import("../src/lib/deer-flow/config.ts");
  const generated = await writeConfig({
    // Unreachable on purpose: a model list that failed to load must not be the
    // reason a run cannot start, so the requested model is declared regardless.
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "local",
    model: "gpt-5.6-sol",
    settings: { ...DEFAULT_DEER_FLOW_SETTINGS, shell: false },
  });
  const config = fs.readFileSync(generated.configPath, "utf8");

  assert.match(config, /name: "gpt-5\.6-sol"/);
  assert.match(config, /use: langchain_openai:ChatOpenAI/);
  assert.match(config, /api_base: "http:\/\/127\.0\.0\.1:9\/v1"/);
  // Declaring thinking without a `when_thinking_enabled` block makes DeerFlow
  // send `reasoning_effort: minimal` on every non-thinking turn.
  assert.doesNotMatch(config, /supports_thinking/);
  assert.match(config, /supports_reasoning_effort: true/);
  assert.match(config, /allow_host_bash: false/);
  assert.match(config, /use: deerflow\.community\.ddg_search\.tools:web_search_tool/);

  // The web group is a setting, and the harness itself drops the bash tool when
  // host bash is not allowed — so bash stays declared and `allow_host_bash`
  // decides.
  const withoutWeb = await writeConfig({
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "local",
    model: "gpt-5.6-sol",
    settings: { ...DEFAULT_DEER_FLOW_SETTINGS, web: false, shell: true },
  });
  const second = fs.readFileSync(withoutWeb.configPath, "utf8");
  assert.doesNotMatch(second, /ddg_search/);
  assert.match(second, /use: deerflow\.sandbox\.tools:bash_tool/);
  assert.match(second, /allow_host_bash: true/);

  // Only the startup-only part of the config forces a restart; everything else
  // is re-read per request.
  assert.notEqual(generated.startupFingerprint, withoutWeb.startupFingerprint);
  const sameShape = await writeConfig({
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "local",
    model: "another-model",
    settings: { ...DEFAULT_DEER_FLOW_SETTINGS, memory: false, maxSubagents: 2 },
  });
  assert.equal(sameShape.startupFingerprint, generated.startupFingerprint);

  fs.rmSync(process.env.DEER_FLOW_STATE_DIR, { recursive: true, force: true });
  delete process.env.DEER_FLOW_STATE_DIR;
});

test("`sandbox` really is the startup-only field the restart rule rests on", { skip: !cloned }, () => {
  const boundary = backendSource("packages/harness/deerflow/config/reload_boundary.py");
  assert.match(boundary, /"sandbox"/);
  // Memory and subagent limits are deliberately not in that set: the run
  // rewrites them into config.yaml and expects the next request to pick them up.
  const startupOnly = boundary.split("STARTUP_ONLY_FIELDS")[1];
  assert.doesNotMatch(startupOnly, /"memory"/);
  assert.doesNotMatch(startupOnly, /"subagents"/);
});

// ---- the wire format --------------------------------------------------------

test("an SSE frame is read the way the Gateway writes it", () => {
  const frame = 'event: messages\ndata: [{"type":"AIMessageChunk","content":"hi"},{}]\nid: 7';
  assert.deepEqual(parseFrame(frame), {
    // The id is what a rejoin replays from, so it has to survive parsing.
    id: "7",
    event: "messages",
    data: [{ type: "AIMessageChunk", content: "hi" }, {}],
  });
  // A comment-only heartbeat carries no data and is not an event.
  assert.equal(parseFrame(": heartbeat"), null);
  assert.deepEqual(parseFrame("event: end\ndata: null"), { id: "", event: "end", data: null });
  // A truncated frame is dropped rather than throwing mid-stream.
  assert.equal(parseFrame("event: messages\ndata: {oops"), null);
});

test("the Gateway names its frames the way this client listens for them", { skip: !cloned }, () => {
  const worker = backendSource("packages/harness/deerflow/runtime/runs/worker.py");
  // `messages-tuple` is the mode requested; `messages` is the event published.
  assert.match(worker, /def _lg_mode_to_sse_event/);
  assert.match(worker, /return mode/);
  assert.match(worker, /publish\(\s*run_id,\s*"error"/s);

  const modes = backendSource("packages/harness/deerflow/runtime/stream_modes.py");
  for (const mode of ["messages-tuple", "custom"]) {
    assert.ok(modes.includes(`"${mode}"`), `the Gateway no longer supports stream mode ${mode}`);
  }

  const services = backendSource("app/gateway/services.py");
  assert.match(services, /format_sse\("end", None/);
  // The run's own address comes back on this header; it is what a cancel is
  // sent to.
  const runs = backendSource("app/gateway/routers/runs.py");
  assert.match(runs, /"Content-Location": f"\/api\/threads\/\{thread_id\}\/runs\/\{record\.run_id\}"/);
  assert.match(backendSource("app/gateway/routers/thread_runs.py"), /runs\/\{run_id\}\/cancel/);
});

test("message content is read out of both shapes LangChain serializes", () => {
  assert.equal(messageText("plain"), "plain");
  assert.equal(
    messageText([
      { type: "text", text: "one " },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "text", text: "two" },
    ]),
    "one two",
  );
  assert.equal(messageText(undefined), "");
});

test("a tool call renders as one line, whatever it was given", () => {
  assert.equal(
    describeArguments({ path: "/mnt/user-data/outputs/plan.md", append: false }),
    "path=/mnt/user-data/outputs/plan.md append=false",
  );
  assert.equal(describeArguments("raw partial json"), "raw partial json");
  assert.equal(describeArguments(null), "");
});

test("only assistant and tool frames become visible run output", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src/lib/deer-flow/run-manager.ts"),
    "utf8",
  );
  // DeerFlow injects recalled memory and durable context as hidden *human*
  // messages, and LangGraph fans those state writes out on the same stream. A
  // denylist ("anything that is not a tool") publishes the agent's private
  // context as if it were the answer — the clone documents that exact failure in
  // its own IM channel layer.
  assert.match(source, /type === "ai" \|\| type === "AIMessageChunk"/);
  assert.match(source, /type === "tool"/);
  assert.doesNotMatch(source, /includes\("tool"\)/);
});

test("the agent is registered everywhere a run has to be remembered", async () => {
  const { EXTERNAL_AGENT_RUN_KINDS, EXTERNAL_AGENT_RUN_FIELD_BY_KIND, parseExternalAgentRun } =
    await import("../src/lib/conversations/external-agent-runs.ts");
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("deer_flow"));
  assert.equal(EXTERNAL_AGENT_RUN_FIELD_BY_KIND.deer_flow, "deerFlowRun");
  assert.deepEqual(parseExternalAgentRun({ kind: "deer_flow", runId: "r1", task: "t" }), {
    kind: "deer_flow",
    runId: "r1",
    task: "t",
  });
  // A malformed row must not break an otherwise healthy transcript.
  assert.equal(parseExternalAgentRun({ kind: "deer_flow", runId: "r1" }), null);

  const { findConfigurableAgent } = await import("../src/lib/agent-settings/catalog.ts");
  const catalogEntry = findConfigurableAgent(DEER_FLOW_AGENT_ID);
  assert.ok(catalogEntry, "DeerFlow has no settings entry");
  assert.equal(catalogEntry.command, DEER_FLOW_COMMAND);
  // Every catalog field has to be one the settings translation reads, or the
  // dialog would offer a control that changes nothing.
  const translated = deerFlowSettingsFrom({});
  for (const field of catalogEntry.fields) {
    assert.ok(field.key in translated, `settings ignore the catalog's ${field.key}`);
  }
});
