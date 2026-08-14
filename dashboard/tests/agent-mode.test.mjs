// Agent mode and Super agent: the two switches under YOLO mode.
//
// Agent mode decides which pipeline a message travels: on, the Hermes agent
// runtime; off, straight to the provider. Super agent is agent mode with the
// whole inventory selected for the turn. Both are checked here where the promise
// is cheap to break — the coupling between them, the client's routing decision,
// and the server's capability elevation.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const agentSession = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const directService = source(
  "../src/lib/conversations/direct-turn-service.ts",
);
const turnService = source("../src/lib/conversations/turn-service.ts");
const superAgentDirective = source("../src/lib/hermes/super-agent.ts");

/** A localStorage-shaped stub plus the window surface the store subscribes to. */
function installBrowser(initial = {}) {
  const store = new Map(Object.entries(initial));
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  return store;
}

test("the Intelligence menu offers both modes below YOLO mode", () => {
  const yolo = composer.indexOf("YOLO mode");
  const agent = composer.indexOf("Agent mode");
  const superAgent = composer.indexOf("Super agent");
  assert.ok(yolo >= 0 && agent > yolo && superAgent > agent);

  const block = composer.slice(agent - 600, superAgent + 900);
  assert.match(block, /aria-checked=\{agentMode\}/);
  assert.match(block, /onClick=\{\(\) => setAgentMode\(!agentMode\)\}/);
  assert.match(block, /aria-checked=\{superAgent\}/);
  assert.match(block, /onClick=\{\(\) => setSuperAgent\(!superAgent\)\}/);
  // Both switches are the same control the YOLO row uses, so they read the same
  // to a screen reader and animate the same way.
  assert.equal(block.match(/role="switch"/g)?.length, 2);
  assert.equal(block.match(/translate-x-5/g)?.length, 2);
});

test("agent mode defaults to on and super agent to off", async () => {
  installBrowser();
  const store = await import(
    "../src/app/components/use-agent-mode.ts?default-check"
  );
  assert.equal(store.isAgentModeEnabled(), true);
  assert.equal(store.isSuperAgentEnabled(), false);
});

test("super agent turns agent mode on, and agent mode off turns it off", async () => {
  const stored = installBrowser();
  const store = await import(
    "../src/app/components/use-agent-mode.ts?coupling-check"
  );

  store.setSuperAgentEnabled(true);
  assert.equal(store.isSuperAgentEnabled(), true);
  assert.equal(store.isAgentModeEnabled(), true, "Hermes follows super agent on");
  assert.equal(stored.get("breadboard:agent-mode"), "true");
  assert.equal(stored.get("breadboard:yolo-mode"), "true", "Super Agent implies YOLO");

  store.setAgentModeEnabled(false);
  assert.equal(store.isAgentModeEnabled(), false);
  assert.equal(
    store.isSuperAgentEnabled(),
    false,
    "super agent cannot outlive the runtime it needs",
  );
  assert.equal(stored.get("breadboard:super-agent"), "false");
});

test("a stale stored super agent never survives agent mode being off", async () => {
  installBrowser({
    "breadboard:agent-mode": "false",
    "breadboard:super-agent": "true",
  });
  const store = await import(
    "../src/app/components/use-agent-mode.ts?stale-check"
  );
  assert.equal(store.isSuperAgentEnabled(), false);
});

test("the chat client routes by agent mode and sends super agent per message", () => {
  // Read at send time: the switch that governs a message is the one that was on
  // when it was sent, not the one rendered when the hook last ran.
  assert.match(
    agentSession,
    /if \(!isAgentModeEnabled\(\)\) \{[\s\S]{0,400}?streamDirectTurn\(\{/,
  );
  assert.match(agentSession, /sessions\/\$\{input\.sessionId\}\/direct/);
  assert.match(agentSession, /superAgent: isSuperAgentEnabled\(\)/);
  // The agent path is still the only one that opens an event stream.
  assert.match(agentSession, /\/events\?\$\{streamContext\.toString\(\)\}/);
});

test("the direct turn keeps the transcript and claims no tools", () => {
  // Breadboard owns the transcript on both paths, so a provider turn is still
  // reserved and finished in the canonical store.
  assert.match(directService, /reserveConversationTurn\(/);
  assert.match(directService, /completeAssistantMessage\(/);
  assert.match(directService, /failAssistantMessage\(/);
  // A browser that stops reading must not leave a pending assistant message.
  assert.match(directService, /cancel\(\) \{[\s\S]{0,400}?finish\("aborted"/);
  // No runtime, and the prompt says so rather than letting the model imply it.
  assert.doesNotMatch(directService, /startRun|applyCapabilityDecision/);
  assert.match(directService, /direct_provider_turn/);
  assert.match(directService, /You have no tools in this turn/);
  assert.match(
    directService,
    /Never claim to have read, written, run, saved, sent, or remembered anything\./,
  );
});

test("a live agent run blocks a direct turn in the same chat", () => {
  assert.match(
    directService,
    /getActiveRuntimeRun\([\s\S]{0,120}?run_already_active/,
  );
});

test("super agent elevates the plan without widening the filesystem", async () => {
  const { planTask, elevateForSuperAgent, SUPER_AGENT_CAPABILITIES } =
    await import("../src/lib/hermes/task-plan.ts");
  const plan = planTask({ request: "sort this out for me", authenticated: true });
  const elevated = elevateForSuperAgent(plan);

  for (const capability of SUPER_AGENT_CAPABILITIES) {
    assert.ok(
      elevated.requiredCapabilities.includes(capability),
      `${capability} is part of a super-agent turn`,
    );
  }
  for (const capability of [
    "filesystem_read",
    "filesystem_write",
    "destructive_filesystem",
    "coding",
    "command_execution",
    "destructive_system_action",
  ]) {
    assert.ok(
      !SUPER_AGENT_CAPABILITIES.includes(capability),
      `${capability} still comes from the user's own grant, not from the mode`,
    );
  }
  // Reach changed; intent did not.
  assert.deepEqual(elevated.steps, plan.steps);
  assert.deepEqual(elevated.requiredResources, plan.requiredResources);
  assert.equal(elevated.riskLevel, plan.riskLevel);
  assert.equal(elevated.requiresCoding, plan.requiresCoding);
});

test("the inventory tools are open only to an authenticated super-agent turn", async () => {
  const { prepareTurn } = await import("../src/lib/hermes/dispatch-core.ts");
  const base = {
    request: "get the quarterly numbers together",
    surface: "dashboard_terminal",
    grants: [],
    workspaceRoot: "/tmp/workspace",
  };
  const tools = (input) =>
    prepareTurn({ ...base, ...input }).grant.allowedTools;

  const superAgent = tools({ userId: 7, superAgent: true });
  assert.equal(superAgent.skill_open, true);
  assert.equal(superAgent.workflow_run, true);

  const normal = tools({ userId: 7 });
  assert.equal(normal.skill_open, false);
  assert.equal(normal.workflow_run, false);

  // An anonymous or public session is never elevated, whatever it claims.
  const anonymous = tools({ userId: null, superAgent: true });
  assert.equal(anonymous.skill_open, false);
  assert.equal(anonymous.workflow_run, false);

  const quartz = tools({
    userId: 7,
    superAgent: true,
    surface: "quartz_ai",
  });
  assert.equal(quartz.skill_open, false);
  assert.equal(quartz.workflow_run, false);
});

test("a super-agent turn selects the whole inventory for itself", () => {
  assert.match(turnService, /superAgent: input\.superAgent === true/);
  assert.match(
    turnService,
    /loadSuperAgentInventory\(\{[\s\S]{0,200}?surface: input\.surface,/,
  );
  assert.match(
    turnService,
    /selectedConditionalSkills = \[[\s\S]{0,200}?superAgentInventory\.skillSlugs/,
  );
  assert.match(
    turnService,
    /selectedConnections = \[[\s\S]{0,200}?superAgentInventory\.connections/,
  );
  assert.match(turnService, /allowAllConnectionTools: superAgent/);
  assert.match(turnService, /renderSuperAgentDirective\(superAgentInventory\)/);
});

test("super agent delegates substantive evidence questions to Deep Research", () => {
  assert.match(
    superAgentDirective,
    /## Substantive research goes to Deep Research/,
  );
  assert.match(
    superAgentDirective,
    /research, search into, or investigate a topic/,
  );
  assert.match(
    superAgentDirective,
    /whether a method works, its benefits or harms, and whether learning is retained/,
  );
  assert.match(superAgentDirective, /agent id `deep-research`/);
  assert.match(superAgentDirective, /begin the Deep Research brief with `--answer`/);
  assert.match(
    superAgentDirective,
    /does the full research loop but returns a direct sourced answer/,
  );
});
