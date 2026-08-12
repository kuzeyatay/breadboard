// `agent_launch`: a super-agent turn starting a runtime agent for itself.
//
// The promise is narrow and easy to break in a way nothing else would catch: the
// agent chooses and the surface launches after the asking turn. Action-capable
// agents wait for approval; explicitly read-only delegations can start without
// manufacturing a user message. The eligibility, timing, de-duplication, and
// wording contracts are checked here.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const queue = source("../src/app/components/hermes/use-agent-launch-queue.ts");
const route = source("../src/app/api/hermes/tools/agent-launch/route.ts");
const plugin = source("../../hermes-agent/plugins/breadboard/__init__.py");
const pluginManifest = source(
  "../../hermes-agent/plugins/breadboard/plugin.yaml",
);
const toolScopes = source("../src/lib/hermes/tool-scopes.ts");
const garden = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const terminal = source(
  "../src/app/components/hermes/dashboard-agent-terminal.tsx",
);
const gardenAdapter = source("../src/lib/hermes/garden-chat-adapter.ts");
const eventStream = source("../src/lib/hermes/event-stream.ts");
const sessionHook = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const runtimePanel = source(
  "../src/app/components/hermes/agent-runtime-panel.tsx",
);
const conversationTurns = source(
  "../src/lib/conversations/turn-service.ts",
);

test("only agents that start from a brief are offered to the model", async () => {
  const {
    RUNTIME_AGENT_PROFILES,
    modelLaunchableRuntimeAgents,
  } = await import("../src/lib/hermes/capability-combinations.ts");

  const byId = new Map(
    RUNTIME_AGENT_PROFILES.map((agent) => [agent.id, agent]),
  );
  // These two only seed a form — the request, and the video to cut — so a model
  // launch would open a dialog nobody is looking at and report a run that never
  // started.
  assert.equal(byId.get("trading-agent").launchableByModel, false);
  assert.equal(byId.get("shorts").launchableByModel, false);
  assert.equal(byId.get("formsmith").launchableByModel, false);
  assert.equal(byId.get("money-printer").launchableByModel, true);
  assert.equal(byId.get("vimax").launchableByModel, true);
  assert.equal(byId.get("deep-research").requiresLaunchApproval, false);
  for (const readOnlyAgent of [
    "agent-reach",
    "get-doc",
    "deep-tutor",
    "vibe-trading",
  ]) {
    assert.equal(byId.get(readOnlyAgent).requiresLaunchApproval, false);
  }
  assert.equal(byId.get("career-ops").requiresLaunchApproval, true);
  assert.equal(byId.get("vimax").requiresLaunchApproval, true);

  const garden = modelLaunchableRuntimeAgents("garden_chat");
  assert.ok(garden.every((agent) => agent.surfaces.includes("garden_chat")));
  assert.ok(!garden.some((agent) => agent.id === "shorts"));
  assert.ok(!garden.some((agent) => agent.id === "formsmith"));
  // Agent TARS has a Terminal runner and no Garden one, so the surface filter
  // has to be what decides, not the launchable flag alone.
  assert.ok(!garden.some((agent) => agent.id === "agent-tars"));
  assert.ok(
    modelLaunchableRuntimeAgents("dashboard_terminal").some(
      (agent) => agent.id === "agent-tars",
    ),
  );
  assert.equal(modelLaunchableRuntimeAgents("quartz_ai").length, 0);
});

test("the launch store is per-run, capped, and forgets on demand", async () => {
  const store = await import("../src/lib/hermes/agent-launch-store.ts");
  store.resetAgentLaunchRequests();

  const request = (runId, agentId = "vimax") =>
    store.recordAgentLaunchRequest({
      runId,
      agentId,
      agentName: "ViMax",
      command: "/agents:vimax",
      brief: "a short film about a lighthouse",
      reason: "it makes films",
      awaitResult: true,
    });

  const first = request("run-1");
  const second = request("run-1", "money-printer");
  assert.ok(first.requestId && second.requestId !== first.requestId);

  // A second run's client must never be handed the first run's launches.
  request("run-2");
  const forRunOne = store.listAgentLaunchRequestsAfter({
    runId: "run-1",
    afterId: 0,
  });
  assert.deepEqual(
    forRunOne.map((item) => item.agentId),
    ["vimax", "money-printer"],
  );
  assert.equal(
    store.listAgentLaunchRequestsAfter({ runId: "run-2", afterId: 0 }).length,
    1,
  );

  // The offset is what keeps a re-drained stream from re-delivering.
  assert.deepEqual(
    store.listAgentLaunchRequestsAfter({ runId: "run-1", afterId: first.id }),
    [second],
  );

  // A turn that keeps asking is told to stop rather than silently dropped.
  for (let index = 0; index < 10; index += 1) request("run-3");
  assert.equal(store.countAgentLaunchRequests("run-3"), 8);
  assert.equal(request("run-3"), null);

  store.clearAgentLaunchRequests("run-1");
  assert.equal(
    store.listAgentLaunchRequestsAfter({ runId: "run-1", afterId: 0 }).length,
    0,
  );
});

test("separate Next.js route bundles share launch requests", async () => {
  // A query string gives Node two isolated module instances, matching the
  // agent-launch tool route and event-stream route being compiled separately.
  // The request still has to cross that boundary or no approval card appears.
  const writer = await import(
    "../src/lib/hermes/agent-launch-store.ts?route=agent-launch"
  );
  const reader = await import(
    "../src/lib/hermes/agent-launch-store.ts?route=event-stream"
  );
  assert.notEqual(writer.recordAgentLaunchRequest, reader.recordAgentLaunchRequest);
  writer.resetAgentLaunchRequests();

  const recorded = writer.recordAgentLaunchRequest({
    runId: "cross-bundle-run",
    agentId: "deep-research",
    agentName: "Deep Research",
    command: "/agents:deep-research",
    brief: "check course blocks and exam dates",
    reason: "this needs sourced web research",
    awaitResult: true,
  });
  assert.ok(recorded);
  assert.deepEqual(
    reader.listAgentLaunchRequestsAfter({
      runId: "cross-bundle-run",
      afterId: 0,
    }),
    [recorded],
  );

  const second = reader.recordAgentLaunchRequest({
    runId: "cross-bundle-run",
    agentId: "deep-research",
    agentName: "Deep Research",
    command: "/agents:deep-research",
    brief: "compare the official course pages",
    reason: "the first pass needs a follow-up",
    awaitResult: true,
  });
  assert.equal(second.id, recorded.id + 1);
  writer.resetAgentLaunchRequests();
});

test("a launch request is read from either surface's event shape", async () => {
  const { parseAgentLaunchRequest } = await import(
    "../src/lib/hermes/agent-launch.ts"
  );
  const flat = parseAgentLaunchRequest({
    type: "agent_launch",
    requestId: "r1",
    agentId: "vimax",
    agentName: "ViMax",
    command: "/agents:vimax",
    brief: "a film",
    reason: "films",
    awaitResult: false,
  });
  assert.equal(flat.agentId, "vimax");
  assert.equal(flat.awaitResult, false);
  assert.equal(flat.requiresApproval, true);

  const nested = parseAgentLaunchRequest({
    type: "agent.launch_requested",
    payload: {
      requestId: "r2",
      agentId: "money-printer",
      agentName: "MoneyPrinter",
      command: "/agents:money-printer",
      brief: "a video",
    },
  });
  assert.equal(nested.agentId, "money-printer");
  // Chaining is the default, so an event that omits the flag must not read as
  // a hand-off with no follow-up.
  assert.equal(nested.awaitResult, true);
  assert.equal(nested.requiresApproval, true);

  const delegated = parseAgentLaunchRequest({
    type: "agent_launch",
    requestId: "r-delegated",
    agentId: "deep-research",
    agentName: "Deep Research",
    command: "/agents:deep-research",
    brief: "verify the official timetable",
    requiresApproval: false,
    originClientMessageId: "assistant-turn-1",
  });
  assert.equal(delegated.requiresApproval, false);
  assert.equal(delegated.originClientMessageId, "assistant-turn-1");

  assert.equal(parseAgentLaunchRequest({ type: "tool.completed" }), null);
  // A request with no brief would submit the bare command, which opens a
  // palette entry instead of running anything.
  assert.equal(
    parseAgentLaunchRequest({
      type: "agent_launch",
      requestId: "r3",
      command: "/agents:vimax",
      brief: "   ",
    }),
    null,
  );
});

test("the continuation turn carries the outcome and refuses to relaunch", async () => {
  const { agentLaunchContinuationMessage, MAX_AGENT_LAUNCH_HOPS } =
    await import("../src/lib/hermes/agent-launch.ts");

  const completed = agentLaunchContinuationMessage({
    agentName: "MoneyPrinter",
    outcome: "completed",
    content: "video at artifacts/clip.mp4",
  });
  assert.match(completed, /MoneyPrinter finished\./);
  assert.match(completed, /artifacts\/clip\.mp4/);
  assert.match(completed, /Summarize the useful result/);
  assert.match(completed, /present that exact output/);

  const failed = agentLaunchContinuationMessage({
    agentName: "ViMax",
    outcome: "failed",
    content: "",
  });
  assert.match(failed, /did not finish/);
  assert.match(failed, /no output/);
  assert.match(failed, /Do not relaunch it without being asked\./);

  assert.ok(MAX_AGENT_LAUNCH_HOPS >= 2 && MAX_AGENT_LAUNCH_HOPS <= 6);
});

test("agent-result continuations stay in context without impersonating the user", () => {
  assert.match(
    terminal,
    /sendAgentContinuation\(continuation, \{[\s\S]*internalAgentContinuation: true/,
  );
  assert.match(
    garden,
    /handleSubmit\(continuation, undefined, undefined, true\)/,
  );
  assert.match(
    runtimePanel,
    /message\.internalAgentContinuation === true/,
  );
  assert.match(
    garden,
    /if \(msg\.internalAgentContinuation === true\) return null/,
  );
  assert.match(
    sessionHook,
    /internalAgentContinuation:\s*options\?\.internalAgentContinuation === true/,
  );
  assert.match(
    conversationTurns,
    /internalAgentContinuation[\s\S]*metadata:[\s\S]*internalAgentContinuation: true/,
  );
});

test("the queue waits for the surface and only gates launches that need approval", () => {
  // The three properties that make a queued launch safe, asserted against the
  // hook's source because they are structural: nothing is launched while the
  // asking turn still streams, a replayed request is ignored, and the chip is
  // withheld until a submit would actually be accepted.
  assert.match(queue, /if \(seenRef\.current\.has\(request\.requestId\)\) return true;/);
  assert.match(
    queue,
    /if \(!head \|\| !ready \|\| \(head\.requiresApproval && !yoloMode\)\) return;/,
  );
  assert.match(queue, /!head\.requiresApproval \|\| isYoloModeEnabled\(\)/);
  assert.match(
    queue,
    /yoloMode \|\| !ready \|\| !head\?\.requiresApproval \? null : head/,
  );
  // The same predicate proves YOLO is re-read inside the timer while an
  // approval-free request remains independent of that global switch.
});

test("every model-launchable agent uses structured same-message delegation", async () => {
  const { modelLaunchableRuntimeAgents } = await import(
    "../src/lib/hermes/capability-combinations.ts"
  );

  for (const agent of modelLaunchableRuntimeAgents("dashboard_terminal")) {
    assert.match(terminal, new RegExp(`case ["']${agent.id}["']`), agent.id);
  }
  for (const agent of modelLaunchableRuntimeAgents("garden_chat")) {
    assert.match(garden, new RegExp(`case ["']${agent.id}["']`), agent.id);
  }

  assert.match(queue, /submit: \(request: AgentLaunchRequestPayload\) => void/);
  assert.match(queue, /submitRef\.current\(request\)/);
  assert.match(queue, /queued: Boolean\(head\)/);
  assert.doesNotMatch(queue, /submitRef\.current\(`\$\{request\.command\}/);
  assert.match(terminal, /beginDelegatedExternalAgentTurn\(originClientMessageId\)/);
  assert.match(terminal, /attachToExistingTurn: true/);
  assert.match(terminal, /externalRunLaunching \|\| agentLaunchQueue\.queued/);
  assert.match(terminal, /delegatedAgentLaunching \|\|/);
  assert.match(terminal, /setDelegatedAgentLaunching\(true\)/);
  assert.match(terminal, /setDelegatedAgentLaunching\(false\)/);
  assert.match(terminal, /scopeKey: session\.sessionId \?\? null/);
  assert.match(garden, /delegatedAgentLaunchRef\.current = request/);
  assert.match(garden, /setDelegatedAgentLaunching\(true\)/);
  assert.match(garden, /setDelegatedAgentLaunching\(false\)/);
  assert.match(garden, /agentLaunchQueue\.queued \|\| delegatedAgentLaunching/);
  assert.match(garden, /scopeKey: activeChatId/);
  assert.match(garden, /index === assistantIndex[\s\S]*persistChatSession\(session\.id, nextMessages\)/);
  assert.match(runtimePanel, /message\.delegatedAgentRun \? "hidden" : "contents"/);
  assert.match(garden, /msg\.delegatedAgentRun \? "hidden" : "contents"/);
  assert.match(terminal, /continuedDelegatedTurnsRef/);
  assert.match(garden, /continuedDelegatedRunsRef/);
  assert.match(terminal, /externalAgentCardContent\(message\)/);
  assert.match(garden, /externalAgentCardContent\(message\)/);
});

test("the tool is super-agent only and revalidated on the route", () => {
  assert.match(toolScopes, /export const SUPER_AGENT_TOOLS = \[[\s\S]*?"agent_launch",[\s\S]*?\] as const;/);
  assert.match(route, /decision\.allowedTools\.includes\(TOOL\)/);
  assert.match(route, /getActiveRuntimeRun\(session\.id\)/);
  // Without a live run the request has no client to reach, so accepting it
  // would promise a launch that never happens.
  assert.match(route, /agent_launch_run_required/);
  // A brief that opens with a slash token would be re-parsed as a second
  // capability and refused at the surface, where the model cannot see it.
  assert.match(route, /findCapabilityConflict\(\{\s*text: `\$\{agent\.command\} \$\{brief\}`/);
  assert.match(route, /agent_launch_not_launchable/);
  assert.match(route, /requiresApproval: agent\.requiresLaunchApproval/);
  assert.match(route, /confirmationRequired: agent\.requiresLaunchApproval/);
  assert.match(route, /const awaitResult = true/);
  assert.match(route, /card is not shown to the user/);
  assert.match(route, /Summarize it in your own response/);
  assert.match(route, /parseRuntimeRunDispatch\(run\)\.clientMessageId\?\.trim\(\)/);
  assert.match(route, /agent_launch_origin_required/);
  assert.match(route, /countAgentLaunchRequests\(run\.id\) > 0/);
  assert.match(route, /agent_launch_one_per_turn/);
  assert.match(route, /worker runs privately/);
});

test("the broker opens agent_launch for a super-agent turn and nobody else", async () => {
  const { prepareTurn } = await import("../src/lib/hermes/dispatch-core.ts");
  const tools = (input) =>
    prepareTurn({
      request: "cut a short video about the lighthouse restoration",
      surface: "dashboard_terminal",
      grants: [],
      workspaceRoot: "/tmp/workspace",
      ...input,
    }).grant.allowedTools;

  assert.equal(tools({ userId: 7, superAgent: true }).agent_launch, true);
  assert.equal(tools({ userId: 7 }).agent_launch, false);
  // A public or anonymous session is never elevated, whatever it claims — and
  // Quartz has no chat runner to perform a launch with.
  assert.equal(tools({ userId: null, superAgent: true }).agent_launch, false);
  assert.equal(
    tools({ userId: 7, superAgent: true, surface: "quartz_ai" }).agent_launch,
    false,
  );
  assert.equal(
    tools({ userId: 7, superAgent: true, surface: "garden_chat" }).agent_launch,
    true,
  );
});

test("the plugin registers the tool the runtime actually loads", () => {
  // The live registry is the Python plugin; a tool listed only on the
  // Breadboard side is gated but never offered to the model.
  assert.match(pluginManifest, /^ {2}- agent_launch$/m);
  assert.match(plugin, /"agent_launch",\s*\n\s*"\/api\/hermes\/tools\/agent-launch",/);
  // The description has to carry the one fact the model cannot observe: the
  // run has not happened when the tool returns.
  assert.match(plugin, /describe its work as finished/i);
  assert.match(plugin, /run starts after your turn ends/i);
  assert.match(plugin, /never ask for approval when it says none is required/i);
});

test("both surfaces drain launches before their stream closes", () => {
  for (const [name, text] of [
    ["garden", gardenAdapter],
    ["terminal", eventStream],
  ]) {
    assert.match(text, /listAgentLaunchRequestsAfter/, name);
    // Once on the idle event, or a launch queued by the final tool call is
    // lost with the stream.
    assert.ok(
      (text.match(/emitAgentLaunchRequests\(\)/g) ?? []).length >= 3,
      `${name} drains launches on every beat, including the last`,
    );
  }
});

test("a human message ends the chain on both surfaces", () => {
  for (const [name, text] of [
    ["garden", garden],
    ["terminal", terminal],
  ]) {
    assert.match(
      text,
      /if \(textOverride === undefined\) \{\s*\n\s*launchHopsRef\.current = 0;/,
      name,
    );
  }
  // The Garden also drops a launch still waiting to be confirmed: the user has
  // moved on, and starting the old one behind their new message is wrong.
  assert.match(garden, /agentLaunchQueue\.reset\(\);/);
  for (const [name, text] of [
    ["garden", garden],
    ["terminal", terminal],
  ]) {
    assert.match(text, /launchHopsRef\.current >= MAX_AGENT_LAUNCH_HOPS/, name);
  }
});
