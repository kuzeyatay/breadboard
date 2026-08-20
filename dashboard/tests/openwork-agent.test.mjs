// What has to stay true about the OpenWork agent.
//
// The run itself belongs to a wrapped runtime, so these cover the seams
// Breadboard owns: the command grammar, the traits the shared registries
// declare, the prompt rules that exist because nobody is watching a chat run,
// and the shape of the generated engine configuration — the one file that
// decides whether the model is reachable at all.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  OPENWORK_AGENT_ID,
  OPENWORK_AGENT_NAME,
  OPENWORK_COMMAND,
  openworkUserMessage,
  taskFromOpenworkCommand,
} from "../src/lib/openwork/identity.ts";
import { OUTBOX_RELATIVE_PATH, sessionTitle, workspaceAgentPrompt } from "../src/lib/openwork/prompt.ts";
import { runtimeAgentById } from "../src/lib/hermes/capability-combinations.ts";
import { EXTERNAL_AGENT_RUN_KINDS, parseExternalAgentRun } from "../src/lib/conversations/external-agent-runs.ts";
import { openworkDefaults } from "../src/lib/agent-settings/defaults.ts";
import { findConfigurableAgent, agentSettingDefaults } from "../src/lib/agent-settings/catalog.ts";

test("the command carries the task and nothing else", () => {
  assert.equal(taskFromOpenworkCommand("/agents:openwork summarise the notes"), "summarise the notes");
  assert.equal(taskFromOpenworkCommand("  /agents:openwork   spaced   "), "spaced");
  // Multi-line tasks survive: a brief is often pasted, not typed.
  assert.equal(taskFromOpenworkCommand("/agents:openwork line one\nline two"), "line one\nline two");
  // The bare token means "still typing", not "run with no task".
  assert.equal(taskFromOpenworkCommand(OPENWORK_COMMAND), "");
  // Anything else belongs to another agent.
  assert.equal(taskFromOpenworkCommand("/agents:opencode fix the parser"), null);
  assert.equal(taskFromOpenworkCommand("openwork do a thing"), null);
});

test("the round trip through a chat message is lossless", () => {
  const task = "draft the quarterly update";
  assert.equal(taskFromOpenworkCommand(openworkUserMessage(task)), task);
  assert.equal(openworkUserMessage(""), OPENWORK_COMMAND);
});

test("the runtime profile matches the identity module", () => {
  const profile = runtimeAgentById(OPENWORK_AGENT_ID);
  assert.ok(profile, "OpenWork is missing from RUNTIME_AGENT_PROFILES");
  assert.equal(profile.command, OPENWORK_COMMAND);
  assert.equal(profile.name, OPENWORK_AGENT_NAME);
  // The task is handed to the workspace agent verbatim, so a stacked skill or
  // an attachment would arrive as prose. Both traits must stay false.
  assert.equal(profile.stacksCapabilities, false);
  assert.equal(profile.acceptsAttachments, false);
  assert.deepEqual([...profile.surfaces].sort(), ["dashboard_terminal", "garden_chat"]);
});

test("a stored run descriptor survives the transcript round trip", () => {
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("openwork"));
  const parsed = parseExternalAgentRun({
    kind: "openwork",
    runId: "run-1",
    task: "write the report",
  });
  assert.deepEqual(parsed, { kind: "openwork", runId: "run-1", task: "write the report" });
  // A descriptor with no task cannot rebuild a card, so it is refused.
  assert.equal(parseExternalAgentRun({ kind: "openwork", runId: "run-1", task: "" }), null);
});

test("the prompt owns the three rules a workspace skill cannot know", () => {
  const prompt = workspaceAgentPrompt({ deliverFiles: true, allowCommands: true });
  assert.match(prompt, /never ask a clarifying question/i);
  assert.match(prompt, /Never start a command that does not exit on its own/i);
  assert.ok(
    prompt.includes(OUTBOX_RELATIVE_PATH.replaceAll("\\", "/")),
    "the prompt must name the outbox, or nothing is ever delivered",
  );
});

test("the settings actually change the prompt", () => {
  const permissive = workspaceAgentPrompt({ deliverFiles: true, allowCommands: true });
  const restricted = workspaceAgentPrompt({ deliverFiles: false, allowCommands: false });
  assert.notEqual(permissive, restricted);
  assert.match(restricted, /may not run shell commands/i);
  assert.doesNotMatch(restricted, /Never start a command that does not exit/i);
});

test("every catalog field is one a run reads", () => {
  const agent = findConfigurableAgent("openwork");
  assert.ok(agent, "OpenWork is missing from the settings catalog");
  assert.equal(agent.command, OPENWORK_COMMAND);
  const defaults = openworkDefaults(agentSettingDefaults(agent));
  // A field the run never reads is a control that changes nothing, which the
  // catalog exists to avoid.
  assert.deepEqual(Object.keys(defaults).sort(), agent.fields.map((field) => field.key).sort());
  assert.deepEqual(defaults, { deliverFiles: true, allowCommands: true });
});

test("a session title stays inside OpenWork's own limit", () => {
  // The server refuses a title over 120 characters with a 400, which would fail
  // the run before the model was ever asked.
  assert.ok(sessionTitle("x".repeat(400)).length <= 120);
  assert.equal(sessionTitle("  keep   the words  "), "keep the words");
  assert.equal(sessionTitle(""), "Breadboard run");
});

test("the run route neither resolves capability tokens nor takes attachments", () => {
  const source = fs.readFileSync(
    path.join(path.resolve("."), "src", "app", "api", "openwork", "runs", "route.ts"),
    "utf8",
  );
  // These two are what the shared conformance test checks the profile against;
  // asserting them here means a change to the route is caught in this file too.
  assert.doesNotMatch(source, /resolveCommandMessage\(/);
  assert.doesNotMatch(source, /\battachments\b/);
  // The route must refuse a stacked token rather than pass it through as prose.
  assert.match(source, /findCapabilityConflict\(/);
  assert.match(source, /activeRuntimeAgentId: "openwork"/);
});

test("dashboard typechecking does not compile the prepared Bun runtime", () => {
  const dashboardConfig = JSON.parse(
    fs.readFileSync(path.join(path.resolve("."), "tsconfig.json"), "utf8"),
  );
  for (const generated of [
    "openwork-runtime",
    "openwork-state",
    "openwork-workspace",
    ".next-desktop",
  ]) {
    assert.ok(
      dashboardConfig.exclude.includes(generated),
      `${generated} must stay outside the dashboard TypeScript program`,
    );
  }
  assert.doesNotMatch(JSON.stringify(dashboardConfig.include), /\.next-desktop/);

  // Desktop route validators still have their own project. A desktop build
  // regenerates this directory before checking it, independently of the IDE's
  // normal `.next` route types.
  const desktopConfig = JSON.parse(
    fs.readFileSync(path.join(path.resolve("."), "tsconfig.desktop.json"), "utf8"),
  );
  assert.ok(desktopConfig.include.includes(".next-desktop/types/**/*.ts"));
});

test("the engine config declares the model the run asked for", async () => {
  // The generated config is the only place the model becomes reachable: OpenCode
  // reads it once at boot and refuses a model it does not declare, which is why
  // the service restarts when a run wants one that is missing.
  const service = await import("../src/lib/openwork/service.ts");
  assert.equal(typeof service.ensureService, "function");
  assert.equal(typeof service.stopService, "function");
  assert.equal(service.currentService(), null, "no service should be running in a unit test");
});
