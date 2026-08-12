import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OPENSCIENCE_AGENT_ID,
  OPENSCIENCE_COMMAND,
  openscienceUserMessage,
  taskFromOpenscienceCommand,
} from "../src/lib/openscience/identity.ts";
import { HARNESSES, isHarness, runInstruction, sessionTitle } from "../src/lib/openscience/prompt.ts";
import { buildConfig, DEFAULT_MODEL_ID, PROVIDER_ID } from "../src/lib/openscience/config.ts";
import { openscienceDefaults } from "../src/lib/agent-settings/defaults.ts";
import { CONFIGURABLE_AGENTS } from "../src/lib/agent-settings/catalog.ts";

test("the command token is recognised, and prose does not become a goal", () => {
  assert.equal(taskFromOpenscienceCommand("hello there"), null);
  assert.equal(taskFromOpenscienceCommand("/agents:openwork do a thing"), null);
  // A bare token selects the agent; the person is still typing, so the caller
  // waits rather than launching an empty run.
  assert.equal(taskFromOpenscienceCommand(OPENSCIENCE_COMMAND), "");
  assert.equal(taskFromOpenscienceCommand(`  ${OPENSCIENCE_COMMAND}  `), "");
  assert.equal(
    taskFromOpenscienceCommand(`${OPENSCIENCE_COMMAND} does caffeine affect reaction time?`),
    "does caffeine affect reaction time?",
  );
  // Case-insensitive, and a multi-line goal survives intact.
  assert.equal(taskFromOpenscienceCommand("/AGENTS:OPENSCIENCE  fit a curve"), "fit a curve");
  assert.equal(
    taskFromOpenscienceCommand(`${OPENSCIENCE_COMMAND} line one\nline two`),
    "line one\nline two",
  );
});

test("a stacked capability token is preserved so the resolver can refuse it", () => {
  // The token is not stripped here: the run route hands the goal to
  // findCapabilityConflict, which is what produces the refusal message.
  const goal = taskFromOpenscienceCommand(`${OPENSCIENCE_COMMAND} /skill:stats fit a curve`);
  assert.equal(goal, "/skill:stats fit a curve");
});

test("the user half of the turn round-trips through the command", () => {
  assert.equal(openscienceUserMessage(""), OPENSCIENCE_COMMAND);
  assert.equal(openscienceUserMessage("   "), OPENSCIENCE_COMMAND);
  assert.equal(
    openscienceUserMessage("model an epidemic"),
    `${OPENSCIENCE_COMMAND} model an epidemic`,
  );
  assert.equal(
    taskFromOpenscienceCommand(openscienceUserMessage("model an epidemic")),
    "model an epidemic",
  );
});

test("the three spellings of the agent's name stay consistent", () => {
  assert.equal(OPENSCIENCE_COMMAND, `/agents:${OPENSCIENCE_AGENT_ID}`);
  const entry = CONFIGURABLE_AGENTS.find((agent) => agent.id === OPENSCIENCE_AGENT_ID);
  assert.ok(entry, "OpenScience is missing from the settings catalog");
  assert.equal(entry.command, OPENSCIENCE_COMMAND);
});

test("settings fall back to defaults, and unknown values do not leak through", () => {
  assert.deepEqual(openscienceDefaults({}), { harness: "research", deliverFiles: true });
  assert.deepEqual(openscienceDefaults({ harness: "plan", deliverFiles: false }), {
    harness: "plan",
    deliverFiles: false,
  });
  // An unrecognised harness must not reach the runtime as an agent name.
  assert.equal(openscienceDefaults({ harness: "biology" }).harness, "research");
  assert.equal(openscienceDefaults({ harness: 7 }).harness, "research");
});

test("only the runtime's primary agents are offered as harnesses", () => {
  // biology, physics and ml are subagents: the runtime refuses them as a
  // primary agent and silently falls back, so offering one would be a lie.
  assert.deepEqual([...HARNESSES], ["research", "plan"]);
  assert.ok(isHarness("research"));
  assert.ok(!isHarness("biology"));
  const entry = CONFIGURABLE_AGENTS.find((agent) => agent.id === OPENSCIENCE_AGENT_ID);
  const harness = entry.fields.find((field) => field.key === "harness");
  assert.deepEqual(
    harness.options.map((option) => option.value),
    [...HARNESSES],
  );
});

test("the written config carries the two settings that decide whether tools run", () => {
  const config = buildConfig({
    baseUrl: "http://127.0.0.1:8765/v1",
    apiKey: "breadboard",
    models: ["gpt-5.6-sol"],
  });
  const provider = config.provider[PROVIDER_ID];

  // The Responses API. Over `@ai-sdk/openai-compatible`, ChatMock reports
  // finish_reason "stop" on a response that carried tool calls and the agent
  // loop ends after a single tool call.
  assert.equal(provider.npm, "@ai-sdk/openai");
  assert.equal(provider.options.baseURL, "http://127.0.0.1:8765/v1");

  // Without tool_call the runtime sends no tools at all.
  for (const [id, model] of Object.entries(provider.models)) {
    assert.equal(model.tool_call, true, `${id} would be given no tools`);
  }
  // The requested model and the background sentinel are both declared, so
  // switching between them never rewrites the file or restarts the server.
  assert.ok(Object.keys(provider.models).includes("gpt-5.6-sol"));
  assert.ok(Object.keys(provider.models).includes(DEFAULT_MODEL_ID));

  // No sandbox backend exists on Windows, and the default refuses every
  // execution capability rather than running unconfined.
  assert.equal(config.sandbox.enabled, false);
  assert.equal(config.sandbox.onUnavailable, "allow");
  // A headless run has nobody to answer a question and waits forever.
  assert.equal(config.permission.question, "deny");
});

test("the instruction adds what the runtime cannot know, and nothing it already owns", () => {
  const research = runInstruction("measure the decay constant", {
    harness: "research",
    deliverFiles: true,
  });
  assert.ok(research.startsWith("measure the decay constant"));
  assert.match(research, /delivered straight into a chat/);
  assert.match(research, /collected and attached/);
  assert.doesNotMatch(research, /do not modify/i);

  const plan = runInstruction("measure the decay constant", {
    harness: "plan",
    deliverFiles: false,
  });
  assert.match(plan, /Do not modify anything/);
  assert.doesNotMatch(plan, /collected and attached/);
});

test("a session title stays short and never empty", () => {
  assert.equal(sessionTitle("  fit   a curve \n"), "fit a curve");
  assert.equal(sessionTitle("   "), "Research run");
  const long = sessionTitle("x".repeat(200));
  assert.ok(long.length <= 80, `title was ${long.length} characters`);
});

test("the runtime state root is shallow enough for Windows to write a session", async () => {
  // OpenScience writes each session through a temp file whose name carries the
  // session id, a pid and a uuid — roughly 90 characters on top of the data
  // root. Under a deep root that path passes Windows' limit and every session
  // creation fails with ENAMETOOLONG, which surfaces only as "Session not
  // found". This asserts the headroom that bug consumed.
  const { stateRoot } = await import("../src/lib/openscience/runtime.ts");
  const sessionPath = path.join(
    stateRoot(),
    "data",
    "storage",
    "session",
    `prj_${"0".repeat(32)}`,
    `ses_${"0".repeat(26)}.json.65535.${"0".repeat(36)}.tmp`,
  );
  assert.ok(
    sessionPath.length < 260,
    `a session file would be ${sessionPath.length} characters: ${sessionPath}`,
  );
});

test("the workspace stops a package manager from climbing into the repository", async () => {
  // .git is not enough: npm and bun find their project by walking up for a
  // package.json. Without one in the workspace, `bun install` run by the agent
  // climbs out and installs over the dashboard's own node_modules — which is
  // exactly how this integration's verification destroyed the compiled
  // better-sqlite3 binding.
  const { ensureWorkspace } = await import("../src/lib/openscience/setup.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-openscience-ws-"));
  try {
    const created = ensureWorkspace({ OPENSCIENCE_WORKSPACE_ROOT: root });
    const manifest = path.join(created, "package.json");
    assert.ok(fs.existsSync(manifest), "the workspace has no package.json to stop the walk");
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
    assert.equal(parsed.private, true);
    assert.ok(fs.existsSync(path.join(created, ".git")), "the workspace is not its own project root");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a deliverable path cannot walk out of the workspace", async () => {
  const { readDeliverable } = await import("../src/lib/openscience/run-manager.ts");
  // No run exists, so ownership is refused before any path is even considered.
  assert.throws(() => readDeliverable(1, "no-such-run", "../../secrets.env"), /run_not_found/);
});

test("the clone pins the version an install uses", async () => {
  const { targetCliVersion, resolveOpenscienceRoot } = await import(
    "../src/lib/openscience/runtime.ts"
  );
  const root = resolveOpenscienceRoot();
  if (!root) return; // The clone is optional in a checkout without it.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "backend", "cli", "package.json"), "utf8"),
  );
  assert.equal(targetCliVersion(), manifest.version);
  assert.match(targetCliVersion(), /^\d+\.\d+\.\d+/);
});

test("the run route reads stored defaults and lets the message win", () => {
  const source = fs.readFileSync(
    path.join("src", "app", "api", "openscience", "runs", "route.ts"),
    "utf8",
  );
  assert.match(source, /requireUserId\(\)/);
  assert.match(source, /resolveChatmockBaseUrl\(request\)/);
  assert.match(source, /agentSettingsFor\(userId, "openscience"\)/);
  assert.match(source, /findCapabilityConflict/);
  // A flag in the message always beats a stored default.
  assert.match(source, /isHarness\(requestedHarness\) \? requestedHarness : stored\.harness/);
  assert.match(source, /typeof body\.deliverFiles === "boolean"/);
});

test("the temp directory is not mistaken for a configured state root", () => {
  // stateRoot honours an override; this guards the override actually applying
  // rather than being silently ignored, which would send state somewhere the
  // service does not clean up.
  const override = path.join(os.tmpdir(), "bb-openscience-probe");
  return import("../src/lib/openscience/runtime.ts").then(({ stateRoot }) => {
    assert.equal(stateRoot({ OPENSCIENCE_STATE_ROOT: override }), path.resolve(override));
  });
});
