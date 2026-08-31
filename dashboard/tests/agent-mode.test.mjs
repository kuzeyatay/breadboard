// Agent mode and Super agent: the runtime switches under YOLO mode.
//
// Agent mode decides which pipeline a message travels: on, the Hermes agent
// runtime; off, straight to the provider. Super agent is agent mode with the
// whole inventory selected for the turn. Both are checked here where the promise
// is cheap to break — the coupling between them, the client's routing decision,
// and the server's capability elevation.
//
// Goal used to be a third switch in this menu. It is a skill now, so it is
// absent from here by design and pinned in goal-skill.test.mjs instead.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const agentSession = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const directService = source("../src/lib/conversations/direct-turn-service.ts");
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

test("the Intelligence menu runs YOLO, then Agent, then Super agent", () => {
  const yolo = composer.indexOf("YOLO mode");
  const agent = composer.indexOf("Agent mode");
  const superAgent = composer.indexOf("Super agent");
  assert.ok(yolo >= 0 && agent > yolo && superAgent > agent);
  // Goal is a skill, not a switch. A row here would offer to turn on something
  // that is now started by asking for it.
  assert.equal(composer.indexOf("Goal mode"), -1);

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
  const store =
    await import("../src/app/components/use-agent-mode.ts?default-check");
  assert.equal(store.isAgentModeEnabled(), true);
  assert.equal(store.isSuperAgentEnabled(), false);
});

test("super agent turns agent mode on, and agent mode off turns it off", async () => {
  const stored = installBrowser();
  const store =
    await import("../src/app/components/use-agent-mode.ts?coupling-check");

  store.setSuperAgentEnabled(true);
  assert.equal(store.isSuperAgentEnabled(), true);
  assert.equal(
    store.isAgentModeEnabled(),
    true,
    "Hermes follows super agent on",
  );
  assert.equal(stored.get("breadboard:agent-mode"), "true");
  assert.equal(
    stored.get("breadboard:yolo-mode"),
    "true",
    "Super Agent implies YOLO",
  );

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
  const store =
    await import("../src/app/components/use-agent-mode.ts?stale-check");
  assert.equal(store.isSuperAgentEnabled(), false);
});

test("a skill named with agent mode off is explained, not silently dropped", () => {
  // Goal used to force agent mode on for itself. As a skill it needs the agent
  // runtime for the same reason every other skill does, and the direct prompt
  // already owns that explanation — so there is no switch left to couple.
  assert.match(
    directService,
    /A message beginning with a `\/token` is a skill[\s\S]{0,200}?needs Agent mode on/,
  );
});

test("the chat client routes by agent mode and sends its selected runtime modes per message", () => {
  // Read at send time: the switch that governs a message is the one that was on
  // when it was sent, not the one rendered when the hook last ran.
  assert.match(
    agentSession,
    /if \(!isAgentModeEnabled\(\)\) \{[\s\S]{0,400}?streamDirectTurn\(\{/,
  );
  assert.match(agentSession, /sessions\/\$\{input\.sessionId\}\/direct/);
  assert.match(agentSession, /const superAgentEnabled = isSuperAgentEnabled\(\)/);
  assert.match(agentSession, /superAgent: superAgentEnabled/);
  // The agent path is still the only one that opens an event stream.
  assert.match(agentSession, /\/events\?\$\{streamContext\.toString\(\)\}/);
});

test("the direct turn keeps the transcript and claims no tools", () => {
  // Breadboard owns the transcript on both paths, so a provider turn is still
  // reserved and finished in the canonical store.
  assert.match(directService, /reserveConversationTurn\(/);
  assert.match(directService, /completeAssistantMessage\(/);
  assert.match(directService, /failAssistantMessage\(/);
  // Losing a browser viewer no longer cancels the provider. The server drains
  // and finishes the durable row; only the explicit Stop API owns abort.
  const responseCancel = directService.slice(
    directService.indexOf("cancel() {"),
    directService.indexOf("return new Response(body"),
  );
  assert.doesNotMatch(responseCancel, /finish\("aborted"/);
  assert.doesNotMatch(responseCancel, /providerAbort\.abort\(/);
  assert.match(directService, /export function abortDirectProviderTurn/);
  assert.match(directService, /activeDirectTurn\.stopRequested[\s\S]*?"aborted"/);
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
  const plan = planTask({
    request: "sort this out for me",
    authenticated: true,
  });
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
  assert.equal(superAgent.workflow_create, true);

  const normal = tools({ userId: 7 });
  assert.equal(normal.skill_open, false);
  assert.equal(normal.workflow_run, false);
  assert.equal(normal.workflow_create, true);

  // An anonymous or public session is never elevated, whatever it claims.
  const anonymous = tools({ userId: null, superAgent: true });
  assert.equal(anonymous.skill_open, false);
  assert.equal(anonymous.workflow_run, false);
  assert.equal(anonymous.workflow_create, false);

  const quartz = tools({
    userId: 7,
    superAgent: true,
    surface: "quartz_ai",
  });
  assert.equal(quartz.skill_open, false);
  assert.equal(quartz.workflow_run, false);
  assert.equal(quartz.workflow_create, false);
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
  assert.match(
    turnService,
    /renderSuperAgentDirective\(superAgentInventory, researchPipeline\)/,
  );
  // How exhaustive the request is is decided before dispatch, from the request
  // text, so the turn cannot argue itself into a cheaper obligation later.
  assert.match(
    turnService,
    /classifyResearch\(\{ question: resolved\.userText \|\| input\.text \}\)/,
  );
  assert.match(turnService, /researchPipelineApplies\(researchPlan\)/);
});

test("the tracked research pipeline is offered only to a request that earns it", async () => {
  const { classifyResearch, researchPipelineApplies } =
    await import("../src/lib/research/classify.ts");
  const { researchPipelineRule } =
    await import("../src/lib/research/directive.ts");

  // Super agent plus a trivial question stays exactly as fast as it was: the
  // classifier declines, so the protocol section is never composed at all.
  const trivial = classifyResearch({ question: "Who founded OpenAI?" });
  assert.equal(researchPipelineApplies(trivial), false);

  const plan = classifyResearch({
    question:
      "Find every student team the university ever created, which are active, their member counts, historical names, and what happened to the inactive ones.",
  });
  assert.ok(researchPipelineApplies(plan));
  const section = researchPipelineRule(plan);
  assert.match(section, /## Exhaustive research: use the tracked pipeline/);
  assert.match(section, /`research_begin`/);
  assert.match(section, /`research_record`/);
  assert.match(section, /`research_status`/);
  // The behavioural change, stated as the contract: the ledger stops the turn,
  // not the model's sense of having enough to write.
  assert.match(section, /you are not finished, however much material you have/);
  assert.match(section, /notFoundAfterSearch/);
  assert.match(section, /unresolved/);
  // And the guardrail that keeps higher recall from becoming invention.
  assert.match(section, /never what would make the coverage look better/);

  // The directive composes it only when a plan is supplied, so every ordinary
  // super-agent turn — and every non-super-agent turn — is unchanged.
  assert.match(
    superAgentDirective,
    /if \(researchPlan\) sections\.push\(researchPipelineRule\(researchPlan\)\)/,
  );
});

test("super agent staffs web research across every instrument it has", () => {
  assert.match(
    superAgentDirective,
    /## Web research: read pages, and use more than one instrument/,
  );
  // The failure this replaced: a survey answered out of search-result snippets
  // because `web_search` was the tool the turn could run by itself.
  assert.match(superAgentDirective, /never by quoting search-result snippets/);
  assert.match(
    superAgentDirective,
    /Open the official page with `web_extract` first/,
  );
  // Each research worker is offered for the part it is actually good at, and
  // only when it is launchable on this surface.
  for (const id of ["deep-research", "agent-reach", "get-doc"]) {
    assert.match(superAgentDirective, new RegExp("`" + id + "` —"));
    assert.match(superAgentDirective, new RegExp('"' + id + '"'));
  }
  // agent-browser is deliberately not one of them. It is the slowest and most
  // failure-prone instrument, so it is kept out of the staffing list entirely
  // and gated behind a cheaper attempt that actually came back short.
  assert.match(superAgentDirective, /"agent-browser"/);
  assert.match(superAgentDirective, /`agent-browser` is not on that list/);
  assert.match(superAgentDirective, /never part of an opening plan/);
  assert.match(superAgentDirective, /Treat it as the last resort it is/);
  assert.match(superAgentDirective, /Wanting more coverage is not a reason/);
  assert.doesNotMatch(superAgentDirective, /- `agent-browser` —/);
  assert.match(
    superAgentDirective,
    /whether a method works, its benefits or harms, and whether learning is retained/,
  );
  assert.match(superAgentDirective, /Begin the brief with `--answer`/);
  assert.match(
    superAgentDirective,
    /explicitly says to do, conduct, run, perform, or use deep research/,
  );
  assert.match(
    superAgentDirective,
    /instruction to launch `deep-research` with `agent_launch`/,
  );
  assert.match(
    superAgentDirective,
    /not permission to substitute your own `web_search`/,
  );
  assert.match(superAgentDirective, /worker stays private/);
  // The same rule for Max Research, which needed writing down for the same
  // reason. A live turn that said "do max research" in as many words produced
  // five `web_search` calls and an answer written by the Super Agent itself:
  // the audit log for that turn records no `agent_launch` at all, only a
  // `tool_search` looking one up. Naming Deep Research and not this one left
  // the model to infer that "max research" meant the agent it had a rule for.
  assert.match(
    superAgentDirective,
    /when the user says to do, run, or use max research, launch `max-research` with `agent_launch`/,
  );
  assert.match(
    superAgentDirective,
    /not interchangeable with `deep-research` and never with your own `web_search`/,
  );
  // Tens of minutes is the expected shape of this agent, not a reason to
  // quietly pick a cheaper one.
  assert.match(superAgentDirective, /It runs for tens of minutes; that is expected/);
  assert.match(
    superAgentDirective,
    /A broad request earns more than one worker/,
  );
  // Launches are serial, so a brief that waits on another worker's findings
  // cannot work — the reconciliation happens in this agent instead.
  assert.match(superAgentDirective, /They run one at a time, in order/);
  assert.match(superAgentDirective, /write each brief to stand alone/);
  assert.match(superAgentDirective, /You are the one who reconciles/);
  // And the silent-degradation rule: a failed tool is reported, not papered over.
  assert.match(
    superAgentDirective,
    /A tool that returned an error did no work/,
  );
});
