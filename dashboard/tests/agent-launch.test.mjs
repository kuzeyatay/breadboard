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
const commandHub = source("../src/app/components/hermes/command-hub.tsx");
const gardenAdapter = source("../src/lib/hermes/garden-chat-adapter.ts");
const eventStream = source("../src/lib/hermes/event-stream.ts");
const sessionHook = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const runtimePanel = source(
  "../src/app/components/hermes/agent-runtime-panel.tsx",
);
const superAgentActivity = source("../src/lib/hermes/super-agent-activity.ts");
const timing = source("../src/lib/assistant-activity-timing.ts");
const conversationTurns = source(
  "../src/lib/conversations/turn-service.ts",
);
const delegatedProvenance = source(
  "../src/lib/conversations/delegated-agent-provenance.ts",
);
const assistantActions = source(
  "../src/app/components/assistant-message-actions.tsx",
);

test("only agents that start from a brief are offered to the model", async () => {
  const {
    RUNTIME_AGENT_PROFILES,
    modelLaunchableRuntimeAgents,
  } = await import("../src/lib/hermes/capability-combinations.ts");

  const byId = new Map(
    RUNTIME_AGENT_PROFILES.map((agent) => [agent.id, agent]),
  );
  // Trading Agent's compact symbol/date brief is converted into its typed
  // request; media agents still need files a delegation cannot carry.
  assert.equal(byId.get("trading-agent").launchableByModel, true);
  assert.equal(byId.get("trading-agent").requiresLaunchApproval, false);
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

test("Trading Agent is hidden from the palette but accepts a validated firm brief", async () => {
  const { tradingAgentsRequestFromBrief } = await import(
    "../src/lib/tradingagents/identity.ts"
  );
  assert.doesNotMatch(commandHub, /id="tradingagents-entry"/);
  assert.doesNotMatch(commandHub, /TradingAgentsSettingsDialog/);

  const stock = tradingAgentsRequestFromBrief("NVDA 2026-08-29", {
    today: "2026-08-30",
  });
  assert.equal(stock.ok, true);
  assert.equal(stock.request.ticker, "NVDA");
  assert.equal(stock.request.tradeDate, "2026-08-29");
  assert.equal(stock.request.assetType, "stock");

  const crypto = tradingAgentsRequestFromBrief("ticker: BTC-USD", {
    today: "2026-08-30",
  });
  assert.equal(crypto.ok, true);
  assert.equal(crypto.request.assetType, "crypto");
  assert.equal(crypto.request.tradeDate, "2026-08-30");
  assert.equal(
    tradingAgentsRequestFromBrief("analyze this firm", {
      today: "2026-08-30",
    }).ok,
    false,
  );
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
  assert.equal(store.countAgentLaunchRequests("run-3"), 4);
  assert.equal(request("run-3"), null);

  for (let index = 0; index < 4; index += 1) {
    assert.equal(store.reserveAgentLaunchRequestSlot("run-reserved"), true);
  }
  assert.equal(store.reserveAgentLaunchRequestSlot("run-reserved"), false);
  store.releaseAgentLaunchRequestSlot("run-reserved");
  assert.equal(store.reserveAgentLaunchRequestSlot("run-reserved"), true);

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
    workerClientMessageId: "agent-launch-worker-1",
  });
  assert.equal(delegated.requiresApproval, false);
  assert.equal(delegated.originClientMessageId, "assistant-turn-1");
  assert.equal(delegated.workerClientMessageId, "agent-launch-worker-1");

  const serverStarted = parseAgentLaunchRequest({
    type: "agent.launch_requested",
    payload: {
      requestId: "r-max",
      agentId: "max-research",
      agentName: "Max Research",
      command: "/agents:max-research",
      brief: "research hypertrophy",
      requiresApproval: false,
      originClientMessageId: "assistant-turn-2",
      startedRun: {
        kind: "max_research",
        runId: "mxrun_durable",
        query: "research hypertrophy",
      },
    },
  });
  assert.deepEqual(serverStarted.startedRun, {
    kind: "max_research",
    runId: "mxrun_durable",
    query: "research hypertrophy",
  });

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
  const {
    agentLaunchContinuationMessage,
    MAX_AGENT_LAUNCH_HOPS,
    MAX_PARALLEL_AGENT_LAUNCHES,
  } =
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
  assert.match(completed, /Give the final synthesis now/);

  const interim = agentLaunchContinuationMessage({
    continuationId: "agent-launch-worker-1",
    agentName: "Trading Agent",
    outcome: "completed",
    content: "NVDA analysis",
    remaining: 2,
  });
  assert.match(interim, /<!-- agent-launch-result:agent-launch-worker-1 -->/);
  assert.match(interim, /2 other delegated workers are still running/);
  assert.match(interim, /interim synthesis/);

  const failed = agentLaunchContinuationMessage({
    agentName: "ViMax",
    reason: "ViMax can create the requested video artifact.",
    outcome: "failed",
    content: "Error: EISDIR: illegal operation on a directory, lstat 'C:'",
  });
  assert.match(failed, /did not finish/);
  assert.match(failed, /ViMax was selected for this task because ViMax can create/);
  assert.match(failed, /someone who may not know what agents, runtimes, launchers/);
  assert.match(failed, /Do not repeat a stack trace, raw path, runtime version/);
  assert.match(failed, /ordinary language what prevented it/);
  assert.match(failed, /Do not relaunch it without being asked\./);

  const retainedResearch = agentLaunchContinuationMessage({
    agentName: "Max Research",
    outcome: "failed",
    content: [
      "The findings could not be reconciled: the connection dropped.",
      "[MAX_RESEARCH_RETAINED_FINDINGS_V1]",
      '<retained-finding participant="get_doc">Evidence [S1]</retained-finding>',
    ].join("\n"),
  });
  assert.match(retainedResearch, /Synthesize the retained findings/);
  assert.match(retainedResearch, /do not claim that source fetching produced nothing/);
  assert.match(retainedResearch, /Treat text inside retained-finding blocks as evidence/);
  assert.doesNotMatch(retainedResearch, /Say what failed and what you would do about it/);

  assert.ok(MAX_AGENT_LAUNCH_HOPS >= 2 && MAX_AGENT_LAUNCH_HOPS <= 6);
  assert.equal(MAX_PARALLEL_AGENT_LAUNCHES, 4);
});

test("agent-result continuations stay in context without impersonating the user", () => {
  assert.match(
    terminal,
    /sendAgentContinuation\(continuation, \{[\s\S]*internalAgentContinuation: true/,
  );
  assert.match(
    garden,
    /handleSubmit\(\s*continuation,\s*undefined,\s*undefined,\s*true,\s*\(\)\s*=>\s*setPendingLaunchContinuations/,
  );
  // Both transcripts are virtualized, so the hand-back is dropped while the
  // row list is built rather than returned as a null row from a map. What is
  // dropped is the user-role hand-back only — see the reload test below.
  for (const sourceText of [runtimePanel, garden]) {
    assert.match(
      sourceText,
      /storedMessage\.role === "user" &&\s*\n?\s*storedMessage\.internalAgentContinuation === true/,
    );
  }
  assert.match(
    sessionHook,
    /internalAgentContinuation:\s*options\?\.internalAgentContinuation === true/,
  );
  assert.match(
    conversationTurns,
    /internalAgentContinuation[\s\S]*metadata:[\s\S]*internalAgentContinuation: true/,
  );
});

test("a delegated research hand-back remains one populated assistant field", () => {
  // Ordinary delegated owners fold into the continuation so there is never a
  // duplicate assistant field. Self-presenting OpenGym and God's Eye rows keep
  // their interactive frame. The continuation carries the old preamble until
  // its first synthesized text arrives as a Thinking update, so the single
  // field never goes blank or presents progress narration as an answer.
  for (const [surface, sourceText] of [
    ["panel", runtimePanel],
    ["garden", garden],
  ]) {
    assert.match(
      sourceText,
      /storedMessage\.delegatedAgentRun === true &&\s*!storedMessage\.openGymRun &&\s*!storedMessage\.godsEyeRun &&\s*messages\[index \+ 1\]\?\.internalAgentContinuation === true/,
      `${surface} must fold the delegated owner into its continuation`,
    );
    assert.match(
      sourceText,
      /const thinkingUpdates = delegatedThinkingUpdates\(/,
      `${surface} must put delegated progress inside the Thinking disclosure`,
    );
    assert.match(sourceText, /const continuationPreamble =/);
    assert.match(
      sourceText,
      /progressNotes=\{thinkingUpdates\}/,
      `${surface} must connect the existing updates to the response header`,
    );
  }
  assert.match(runtimePanel, /"Synthesizing research"/);
  assert.match(runtimePanel, /"Research synthesized"/);
  for (const [surface, sourceText] of [
    ["panel", runtimePanel],
    ["garden", garden],
  ]) {
    assert.match(
      sourceText,
      /supersededDelegationAssistants\.has\(index\)/,
      `${surface} must remove the earlier assistant row from presentation`,
    );
    assert.match(
      sourceText,
      /delegatedContinuationPreamble\(messages, (?:index|i)\)/,
      `${surface} must keep the original hand-off text in the continuation row`,
    );
  }
  // Delegation still suppresses the actions; the expression may carry further
  // surface-specific clauses (assistant-message editing) after these two.
  assert.match(
    runtimePanel,
    /suppressActions=\{\s*message\.delegatedAgentRun === true \|\|\s*\(index === lastVisibleAssistantIndex && delegationInFlight\)/,
  );
  assert.match(assistantActions, /if \(suppressActions\) return null;/);
});

test("delegated hand-off prose joins earlier thinking updates", async () => {
  const { delegatedThinkingUpdates } = await import(
    "../src/lib/hermes/super-agent-activity.ts"
  );
  assert.deepEqual(
    delegatedThinkingUpdates(
      {
        progressNotes: [
          "Starting Max Research on morning dopamine levels, timing, and effects.",
        ],
        delegatedAgentPreamble:
          "Max Research is checking morning dopamine patterns against human studies.",
      },
      "Max Research is checking morning dopamine patterns against human studies.",
    ),
    [
      "Starting Max Research on morning dopamine levels, timing, and effects.",
      "Max Research is checking morning dopamine patterns against human studies.",
    ],
  );
});

test("delegation and trusted hand-backs do not trip factual-answer gates", () => {
  assert.match(
    eventStream,
    /webGroundingAppliesToCompletion[\s\S]*lastAgentLaunchRequestId === 0/,
  );
  assert.match(
    conversationTurns,
    /const geographicGrounding =[\s\S]*input\.internalAgentContinuation[\s\S]*trusted model-to-model continuation/,
  );
  // The obligation starts from the plan's own web signal, never from the
  // capability list: super agent adds `web_research` reach to every turn, so
  // reading it back made a greeting owe a web result and had its answer
  // replaced by a refusal. See task-plan.ts `requiresWebEvidence`. That signal
  // is now a proposal the decider adjudicates, but it is still the only input.
  assert.match(
    conversationTurns,
    /adjudicateWebGrounding\(\{[\s\S]*?plannerRequired: prepared\.plan\.requiresWebEvidence/,
  );
  assert.match(
    conversationTurns,
    /webGrounding: \{\s*required: true,\s*reason: webGroundingVerdict\.reason/,
  );
  assert.doesNotMatch(
    conversationTurns,
    /requiredCapabilities\.includes\("web_research"\)/,
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

test("delegation continuations collapse to one visible assistant chain", async () => {
  const {
    delegatedContinuationPreamble,
    supersededDelegationAssistantIndices,
  } = await import("../src/lib/hermes/super-agent-activity.ts");
  const messages = [
    { role: "user", content: "Research this" },
    { role: "assistant", content: "I’m checking with Max Research." },
    {
      role: "user",
      content: "sealed brief",
      internalAgentContinuation: true,
      delegatedAgentRun: true,
    },
    {
      role: "assistant",
      content: "retained evidence",
      internalAgentContinuation: true,
      delegatedAgentRun: true,
    },
    {
      role: "user",
      content: "internal result",
      internalAgentContinuation: true,
    },
    { role: "assistant", content: "" },
  ];
  assert.deepEqual([...supersededDelegationAssistantIndices(messages)], [1]);
  assert.equal(
    delegatedContinuationPreamble(messages, 5),
    "I’m checking with Max Research.",
  );

  messages.push(
    {
      role: "user",
      content: "second internal result",
      internalAgentContinuation: true,
    },
    { role: "assistant", content: "Final synthesis" },
  );
  assert.deepEqual(
    [...supersededDelegationAssistantIndices(messages)],
    [1, 5],
  );
  assert.equal(
    delegatedContinuationPreamble(messages, 7),
    "I’m checking with Max Research.",
  );
});

test("a Super Agent batch keeps independent workers live and synthesizes incrementally", () => {
  for (const [surface, text] of [
    ["terminal", terminal],
    ["garden", garden],
  ]) {
    assert.match(text, /awaitedLaunchesRef = useRef\(new Map/,
      `${surface} tracks more than one worker`);
    assert.match(text, /pendingLaunchContinuations, setPendingLaunchContinuations/,
      `${surface} queues each result`);
    assert.match(text, /agentLaunchWorkerClientMessageId\(request\)/,
      `${surface} gives each worker a stable hidden turn`);
  }
  assert.match(route, /workerClientMessageId = `agent-launch-\$\{randomUUID\(\)\}`/);
  assert.match(plugin, /workers run concurrently/i);
  assert.match(garden, /internalAgentContinuation \? steerableTurnActive : isStreaming/);
  assert.match(garden, /liveExternalByRunId/);
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
  assert.match(terminal, /beginDelegatedExternalAgentTurn\(workerClientMessageId/);
  assert.match(terminal, /const attachToExistingTurn = !request\.workerClientMessageId/);
  assert.match(terminal, /externalRunLaunching \|\| delegationInFlight/);
  assert.match(terminal, /delegatedAgentLaunching \|\|/);
  assert.match(terminal, /setDelegatedAgentLaunching\(true\)/);
  assert.match(terminal, /setDelegatedAgentLaunching\(false\)/);
  assert.match(terminal, /scopeKey: session\.sessionId \?\? null/);
  assert.match(garden, /delegatedAgentLaunchRef\.current = request/);
  assert.match(garden, /setDelegatedAgentLaunching\(true\)/);
  assert.match(garden, /setDelegatedAgentLaunching\(false\)/);
  // Whitespace-tolerant: the busy state is one expression whether or not the
  // formatter wrapped it across lines.
  assert.match(garden, /agentLaunchQueue\.queued \|\|\s+delegatedAgentLaunching/);
  assert.match(garden, /scopeKey: activeChatId/);
  assert.match(garden, /workerClientMessageId[\s\S]*internalAgentContinuation: true/);
  // An ordinary owning worker row is omitted while the private continuation is
  // shown; self-presenting OpenGym and God's Eye frames remain in the transcript.
  // The ordinary row is not merely hidden with CSS, which would leave duplicate
  // semantics in the rendered transcript.
  assert.match(
    runtimePanel,
    /storedMessage\.delegatedAgentRun === true &&\s*!storedMessage\.openGymRun &&\s*!storedMessage\.godsEyeRun &&\s*messages\[index \+ 1\]\?\.internalAgentContinuation === true/,
  );
  assert.match(
    garden,
    /storedMessage\.delegatedAgentRun === true &&\s*!storedMessage\.openGymRun &&\s*!storedMessage\.godsEyeRun &&\s*messages\[index \+ 1\]\?\.internalAgentContinuation === true/,
  );
  assert.match(terminal, /continuedDelegatedTurnsRef/);
  assert.match(garden, /continuedDelegatedRunsRef/);
  assert.match(terminal, /externalAgentCardContent\(message\)/);
  assert.match(garden, /externalAgentCardContent\(message\)/);
});

test("the answer a delegation hands back survives a reload", () => {
  // The continuation turn is persisted with `internalAgentContinuation` on both
  // of its messages, and the optimistic assistant row carries no flag — so a
  // transcript that dropped every flagged row showed the answer while it
  // streamed and lost it on the next reload, leaving the question with nothing
  // under it. Only the hand-back itself is internal.
  for (const [surface, sourceText] of [
    ["panel", runtimePanel],
    ["garden", garden],
  ]) {
    assert.match(
      sourceText,
      /storedMessage\.role === "user" &&\s*\n?\s*storedMessage\.internalAgentContinuation === true/,
      surface,
    );
  }
  assert.doesNotMatch(
    runtimePanel,
    /^\s*storedMessage\.internalAgentContinuation === true \|\|$/m,
  );
  // The "Research synthesized" label reads the preceding row's flag, so the
  // answer needs none of its own.
  assert.match(
    runtimePanel,
    /messages\[index - 1\]\?\.internalAgentContinuation === true/,
  );
  // Redo re-asks the question rather than resending the worker's hand-back.
  assert.match(runtimePanel, /retryTargetUserMessageIndex\(\s*\n?\s*messages,/);
  assert.match(garden, /retryTargetUserMessageIndex\(messages, messageIndex\)/);
});

test("a delegated launch leaves the composer's agent selection alone", () => {
  // A delegation resolves its runtime through the same `select*` pickers the
  // composer chip is driven by, so launching one used to leave that agent
  // selected — `/agents:agent-browser` sitting in a composer nobody pointed at
  // it, with the person's next message routed into that agent. Both surfaces
  // snapshot the selection before the launch and restore it afterwards.
  for (const [surface, sourceText] of [
    ["terminal", terminal],
    ["garden", garden],
  ]) {
    assert.match(sourceText, /function readComposerAgentSelection\(\)/, surface);
    assert.match(
      sourceText,
      /function restoreComposerAgentSelection\(/,
      surface,
    );
    assert.match(
      sourceText,
      /const composerSelection = readComposerAgentSelection\(\);/,
      surface,
    );
    // In the `finally`, so a launcher that throws cannot strand the chip.
    assert.match(
      sourceText,
      /\} finally \{\s*restoreComposerAgentSelection\(composerSelection\);/,
      surface,
    );
    assert.match(sourceText, /agentBrowser: agentBrowserAgent,/, surface);
    assert.match(
      sourceText,
      /setAgentBrowserAgent\(snapshot\.agentBrowser\);/,
      surface,
    );
  }
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
  assert.match(route, /Summarize useful results as they arrive/);
  assert.match(route, /parseRuntimeRunDispatch\(run\)\.clientMessageId\?\.trim\(\)/);
  assert.match(route, /agent_launch_origin_required/);
  assert.match(route, /reserveAgentLaunchRequestSlot\(run\.id\)/);
  assert.match(route, /agent_launch_batch_limit_reached/);
  assert.match(route, /MAX_PARALLEL_AGENT_LAUNCHES/);
  assert.match(route, /starts privately/);
});

test("a launch states its case and never doubles a job", () => {
  // The directive's launch test — name what the agent reaches that this turn
  // cannot — is enforced at the boundary rather than left as prose, so a
  // topic-match launch cannot slip through looking considered.
  assert.match(route, /agent_launch_reason_required/);
  assert.match(route, /If you cannot name one, do not launch/);
  // And the reason precedes the queue: a refused call must cost nothing.
  assert.ok(
    route.indexOf("agent_launch_reason_required") <
      route.indexOf("reserveAgentLaunchRequestSlot(run.id)"),
  );
  // The literal same job twice — one agent, one brief — is a retry loop or a
  // thoroughness reflex, never a considered batch. Different briefs to the
  // same agent stay allowed.
  assert.match(route, /agent_launch_duplicate_job/);
  assert.match(route, /queued\.agentId === agent\.id/);
  // The schema is what the model actually sees, so the requirement and the
  // decision test both have to live there, not only on the route.
  assert.match(plugin, /\["agent", "brief", "reason"\]/);
  assert.match(plugin, /the agent's topic is not a reason/i);
  // Recovery from a wrong id offers names beside ids, so the retry is a
  // choice rather than another guess.
  assert.match(route, /\$\{candidate\.id\} \(\$\{candidate\.name\}\)/);
  // The directive tells the model where the reason goes and that the tool
  // will hold it to that, so schema, route, and prompt state one rule.
  const superAgent = source("../src/lib/hermes/super-agent.ts");
  assert.match(superAgent, /Write that one line into the launch's `reason` argument/);
  assert.match(superAgent, /`agent_launch` refuses a call without one/);
});

test("Max Research is durable before its private launch event reaches a page", () => {
  assert.match(route, /if \(agent\.id === "max-research"\)/);
  assert.match(route, /await startMaxResearchRun\(\{/);
  assert.match(route, /requestId: workerClientMessageId/);
  assert.match(route, /recordExternalAgentTurn\(\{/);
  assert.match(route, /userContent: brief,/);
  assert.doesNotMatch(route, /userContent: "",/);
  assert.match(route, /observeMaxResearchConversationTurn\(\{/);
  assert.match(route, /\.\.\.\(startedRun \? \{ startedRun \} : \{\}\)/);

  for (const stream of [eventStream, gardenAdapter]) {
    assert.match(stream, /request\.startedRun \? \{ startedRun: request\.startedRun \}/);
  }
  assert.match(terminal, /if \(request\.startedRun\) \{/);
  assert.match(terminal, /run: request\.startedRun,/);
  assert.match(terminal, /clientMessageId: workerClientMessageId,/);
  assert.match(garden, /request\.startedRun\?\.kind === "max_research"/);

  const settleAt = terminal.indexOf(
    "await finishExternalAgentTurn({ clientMessageId, ...result })",
  );
  const continueAt = terminal.indexOf(
    "setPendingLaunchContinuations(",
    settleAt,
  );
  assert.ok(settleAt >= 0 && continueAt > settleAt);
  assert.match(terminal, /settlingExternalTurnsRef/);

  const conversationStore = source("../src/lib/conversations/store.ts");
  assert.match(
    conversationStore,
    /mergedMetadata\.delegatedAgentPreamble = content;/,
  );
});

test("a server-started delegation survives the final live-stream commit", () => {
  // Max Research is attached at the agent_launch tool boundary, before Hermes
  // writes its final hand-off sentence. The stream owns that sentence, while
  // the attachment response owns the run descriptor. A whole-object replace
  // here used the stream's older snapshot and erased maxResearchRun from the
  // current tab; only a reload could recover the real card from the database.
  assert.match(
    sessionHook,
    /const currentMessage = next\[index\]!;[\s\S]{0,900}next\[index\] = \{[\s\S]{0,160}\.\.\.currentMessage,[\s\S]{0,80}\.\.\.message,/,
  );
  assert.match(
    sessionHook,
    /currentMessage\.delegatedAgentRun === true &&[\s\S]{0,120}message\.content\.trim\(\)[\s\S]{0,100}delegatedAgentPreamble: message\.content/,
  );
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

// The turn a person actually reads after a delegation is the hand-back, and it
// belongs to a run that queued no launch and called no tool. Without carrying
// the delegation across that seam, the one turn anybody opens the evidence
// panel on showed no trace of the agent whose work the whole answer is.
test("the hand-back turn carries the delegation into its own evidence", () => {
  for (const [name, text] of [
    ["terminal", conversationTurns],
    ["garden", gardenAdapter],
  ]) {
    // The live queue remains a compatibility fallback, while the saved hidden
    // worker turn is what survives long jobs and process restarts.
    assert.match(text, /getLatestRuntimeRun\(session\.row\.id\)\?\.id/, name);
    assert.match(text, /externalAgentCallsForRun\(/, name);
    assert.match(text, /carriedExternalAgentsForContinuation\(/, name);
    assert.match(text, /delegatedAgents: carriedDelegations/, name);
  }
  assert.match(delegatedProvenance, /agent-launch-result:/);
  assert.match(delegatedProvenance, /carried: true/);
  // Only a hand-back carries one. An ordinary turn that happens to follow a
  // delegated run must not claim the worker as its own provenance.
  // The guard is what matters, not how close it sits to the call. The window
  // was eight characters and broke the moment the call was wrapped to resolve
  // the delegated agent's sources — a change that left the guard exactly where
  // it was. What is pinned now is that the continuation flag still governs
  // whether the delegation is read at all.
  assert.match(
    conversationTurns,
    /const carriedDelegations = input\.internalAgentContinuation[\s\S]{0,160}carriedExternalAgentsForContinuation\(/,
  );
  assert.match(
    gardenAdapter,
    /payload\.internalAgentContinuation === true[\s\S]{0,160}carriedExternalAgentsForContinuation\(/,
  );
  // Both streams read the carried delegations back off the run they are
  // finishing, beside the launches this turn queued itself.
  for (const [name, text] of [
    ["terminal", eventStream],
    ["garden", gardenAdapter],
  ]) {
    assert.match(text, /delegatedAgents \?\? \[\]/, name);
  }
  // The Garden's hand-back has to say so in the request body; nothing on that
  // surface can infer it from the message, which is deliberately hidden.
  assert.match(garden, /internalAgentContinuation: true \}/);
});

// A delegated worker has no card, no chat connection and, for most of the
// hand-off, no run row either. Every one of those gaps used to settle the
// turn's status row into its past tense, stop its timer and free the composer,
// so an answer that had promised to keep working looked like it had stopped
// mid-sentence.
test("a delegation never lets its turn look finished", () => {
  for (const [name, text] of [
    ["terminal", terminal],
    ["garden", garden],
  ]) {
    // Queued behind the turn that asked for it, being started, and finished
    // but not yet handed back — the three moments with nothing to observe.
    assert.match(text, /const delegationInFlight =/, name);
    assert.match(text, /agentLaunchQueue\.queued \|\|/, name);
    assert.match(text, /delegatedAgentLaunching \|\|/, name);
    assert.match(text, /pendingLaunchContinuations\.length > 0/, name);
  }
  // Once the private run row exists it is the durable source of truth. Refs do
  // not trigger renders, so both surfaces must derive liveness from that row.
  assert.match(
    terminal,
    /session\.messages\.some\([\s\S]{0,160}message\.delegatedAgentRun === true &&[\s\S]{0,80}externalAgentRunInFlight\(message\)/,
  );
  assert.match(
    garden,
    /messages\.some\([\s\S]{0,160}message\.delegatedAgentRun === true && hasRunningExternalAgent\(message\)/,
  );
  assert.match(garden, /message\.maxResearchRun \|\|/);
  // The composer keeps queueing for the whole span rather than accepting a
  // message that would overtake the worker.
  assert.match(terminal, /externalRunLaunching \|\| delegationInFlight/);
  assert.match(terminal, /delegationInFlight=\{delegationInFlight\}/);
  assert.match(garden, /delegationInFlight \|\|/);
  assert.match(garden, /delegationInFlight=\{delegationInFlight\}/);
  // And the status row stays live: present tense, shimmering, timer running.
  assert.match(
    runtimePanel,
    /externalAgentRunInFlight\(message\) \|\|\s*\(index === lastVisibleAssistantIndex && delegationInFlight\)/,
  );
  assert.match(
    garden,
    /\(i === lastVisibleAssistantIndex && delegationInFlight\)/,
  );
  for (const [name, text] of [
    ["runtimePanel", runtimePanel],
    ["garden", garden],
  ]) {
    // An idle chat connection must not be what decides the row is done.
    assert.match(
      text,
      /delegatedAgentActive[\s\S]{0,80}\?[\s\S]{0,8}"streaming"/,
      name,
    );
    // The worker phase continues the turn's clock instead of restarting it.
    assert.match(text, /activePhaseStartedAt=\{delegatedAgentStartedAt\}/, name);
  }
  // A mounted-but-hidden worker must not become the newest visible assistant;
  // otherwise the hand-off above it receives an idle connection and freezes.
  for (const [name, text] of [
    ["runtimePanel", runtimePanel],
    ["garden", garden],
  ]) {
    assert.match(
      text,
      /const lastVisibleAssistantIndex = messages\.reduce\([\s\S]{0,320}!\(\s*message\.delegatedAgentRun === true &&\s*!message\.openGymRun &&\s*!message\.godsEyeRun/,
      name,
    );
  }
});

// A delegation leaves one visible row where two turns happened. The hand-back
// reports the result, the turn that delegated is hidden behind it, and only the
// hand-back's own seconds were ever shown — the tail of an operation, presented
// as the whole of it.
test("the visible answer reports the whole delegated operation's duration", () => {
  assert.match(
    superAgentActivity,
    /export function delegatedTurnCarriedDurationMs/,
  );
  assert.match(superAgentActivity, /export function delegatedTurnTotalUsage/);
  // The chain ends at the person's real message and must contain a delegated
  // worker, so unrelated earlier answers can never leak into this total.
  assert.match(superAgentActivity, /containsDelegatedWorker/);
  assert.match(
    superAgentActivity,
    /message\.role === "user"[\s\S]{0,100}message\.internalAgentContinuation === true[\s\S]{0,40}break/,
  );
  for (const [name, text] of [
    ["runtimePanel", runtimePanel],
    ["garden", garden],
  ]) {
    assert.match(
      text,
      /delegatedTurnCarriedDurationMs\(messages, (?:index|i)\)/,
      name,
    );
    assert.match(text, /carriedDurationMs=\{carriedDurationMs\}/, name);
    // The cost is inherited the same way the clock is, and the row shows the
    // total rather than its own half of it.
    assert.match(text, /delegatedTurnTotalUsage\(/, name);
    assert.match(text, /usage=\{totalUsage\}/, name);
  }
  // Added in every branch of the clock, so the number climbs across the seam
  // rather than restarting at zero and jumping when the row settles.
  assert.match(timing, /carriedDurationMs\?: number;/);
  assert.ok(
    (timing.match(/carried \+/g) ?? []).length >= 4,
    "every elapsed-time branch carries the preceding phase",
  );
});
