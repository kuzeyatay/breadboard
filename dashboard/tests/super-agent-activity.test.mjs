import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  delegatedAgentActivityLabel,
  delegatedAgentActivityLabelForMessage,
  delegatedAgentCompletedLabel,
  delegatedAgentCompletedLabelForMessage,
  delegatedAgentStartedAtForMessage,
  delegatedTurnCarriedDurationMs,
  delegatedTurnTotalUsage,
  supersededDelegationAssistantIndices,
  superAgentActivityLabelForTool,
} from "../src/lib/hermes/super-agent-activity.ts";

const session = fs.readFileSync(
  new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
  "utf8",
);
const presentation = fs.readFileSync(
  new URL("../src/lib/hermes/session-presentation.ts", import.meta.url),
  "utf8",
);
const activityPanel = fs.readFileSync(
  new URL("../src/app/components/hermes/activity-panel.tsx", import.meta.url),
  "utf8",
);
const transcriptSurfaces = [
  "../src/app/components/hermes/agent-runtime-panel.tsx",
  "../src/app/garden/garden-assistant.tsx",
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8"));

test("Super Agent orchestration tools have dedicated live states", () => {
  assert.equal(superAgentActivityLabelForTool("agent_launch"), "Choosing an agent");
  assert.equal(superAgentActivityLabelForTool("skill-open"), "Opening skill");
  assert.equal(superAgentActivityLabelForTool("workflow_run"), "Running automation");
  assert.equal(superAgentActivityLabelForTool("workflow_create"), "Creating automation");
  assert.equal(superAgentActivityLabelForTool("mcp_call"), "Using connected service");
  assert.equal(
    superAgentActivityLabelForTool("capability_search"),
    "Searching capabilities",
  );
  assert.equal(superAgentActivityLabelForTool("research_begin"), "Planning research");
  assert.equal(
    superAgentActivityLabelForTool("research_status"),
    "Checking research coverage",
  );
  assert.equal(superAgentActivityLabelForTool("web_search"), undefined);
});

test("the mode names delegated agents after the shared Thinking beat", () => {
  assert.match(session, /label: "Thinking"/);
  assert.equal(
    delegatedAgentActivityLabel("Deep Research"),
    "Delegating to Deep Research agent",
  );
  assert.equal(
    delegatedAgentCompletedLabel("Deep Research"),
    "Delegated to Deep Research agent",
  );
  assert.equal(
    delegatedAgentCompletedLabel("Research agent"),
    "Delegated to Research agent",
  );
});

test("completed delegation labels survive message restoration", () => {
  assert.equal(
    delegatedAgentCompletedLabelForMessage({
      verification: {
        externalAgents: [
          {
            agentName: "Deep Research",
            requestedAt: "2026-08-20T13:17:30.000Z",
          },
        ],
      },
    }),
    "Delegated to Deep Research agent",
  );
  assert.equal(
    delegatedAgentCompletedLabelForMessage({
      externalAgentName: "Coding Agent",
    }),
    "Delegated to Coding Agent",
  );
  assert.equal(delegatedAgentCompletedLabelForMessage({}), undefined);
  assert.equal(
    delegatedAgentStartedAtForMessage({
      externalAgentStartedAt: "2026-08-20T13:18:00.000Z",
      verification: {
        externalAgents: [
          {
            agentName: "Deep Research",
            requestedAt: "2026-08-20T13:17:30.000Z",
          },
        ],
      },
    }),
    "2026-08-20T13:18:00.000Z",
  );
});

test("completed agent hand-offs replace Thought on every transcript surface", () => {
  assert.match(
    activityPanel,
    /completedLabel \?\?[\s\S]{0,100}completedActivityLabel \?\?[\s\S]{0,30}"Thinking"/,
  );
  assert.match(
    session,
    /completedLabel: delegatedAgentCompletedLabel\(request\.agentName\)/,
  );
  for (const transcript of transcriptSurfaces) {
    assert.match(transcript, /completedLabel=\{/);
    assert.match(transcript, /delegatedAgentCompletedLabelForMessage/);
  }
});

test("delegated workers keep the shared shimmer and elapsed timer while active", () => {
  assert.match(activityPanel, /shimmer=\{responseActive\}/);
  assert.match(
    transcriptSurfaces[0],
    /connection=\{delegatedAgentActive \? "streaming" : "idle"\}/,
  );
  assert.match(
    transcriptSurfaces[0],
    /activePhaseStartedAt=\{delegatedAgentStartedAt\}/,
  );
  assert.match(transcriptSurfaces[0], /stateLabel=\{delegatedAgentLabel\}/);
  assert.match(
    transcriptSurfaces[2],
    /activePhaseStartedAt=\{delegatedAgentStartedAt\}/,
  );
  assert.match(transcriptSurfaces[2], /stateLabel=\{delegatedAgentLabel\}/);
});

test("orchestration labels are gated by the captured per-message mode", () => {
  assert.match(session, /const superAgentEnabled = isSuperAgentEnabled\(\)/);
  assert.match(session, /superAgent: superAgentEnabled/);
  assert.match(
    session,
    /superAgentEnabled[\s\S]{0,120}?superAgentActivityLabelForTool\(toolName\)/,
  );
  assert.match(session, /superAgentEnabled && \(payload\.label \?\? "Thinking"\)/);
  assert.match(session, /delegatedAgentActivityLabel\(request\.agentName\)/);
  assert.match(session, /delegatedAgentCompletedLabel\(request\.agentName\)/);
  assert.match(session, /subagentStatus === "thinking"[\s\S]{0,100}?"Consulting specialist"/);
  assert.match(
    presentation,
    /superAgent: dispatch\.capabilities\?\.superAgent === true/,
  );
  assert.match(session, /superAgent: restoredRun\.superAgent === true/);
  assert.match(session, /runToResume\.superAgent/);
});

test("a delegated worker still running reads in the present tense", () => {
  // The worker's card is hidden, so this row is the only thing on screen that
  // says the turn has not finished. Past tense here is what made a live
  // delegation look like an answer that stopped mid-thought.
  assert.equal(
    delegatedAgentActivityLabelForMessage({
      externalAgentName: "Deep Research",
    }),
    "Delegating to Deep Research agent",
  );
  assert.equal(
    delegatedAgentActivityLabelForMessage({
      verification: { externalAgents: [{ agentName: "Deep Research" }] },
    }),
    "Delegating to Deep Research agent",
  );
  assert.equal(delegatedAgentActivityLabelForMessage({}), undefined);
  const [runtimePanel, , garden] = transcriptSurfaces;
  for (const surface of [runtimePanel, garden]) {
    assert.match(surface, /delegatedAgentActivityLabelForMessage\(/);
    assert.match(surface, /completedLabel=\{delegatedAgentCompleted\}/);
  }
});

test("a research run that outlives its service ends the turn instead of hanging", () => {
  const card = fs.readFileSync(
    new URL(
      "../src/app/components/hermes/inline-deep-research-run.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  // Marking the card failed locally leaves the durable turn on "running",
  // which locks the composer and -- for a delegated run, whose card is not even
  // drawn -- strands the conversation with no visible reason.
  const recovery = card.slice(card.indexOf("eventSource.onerror"));
  assert.match(recovery, /run_not_found/);
  assert.match(
    recovery,
    /reportedTerminalRef\.current = true;[\s\S]{0,200}onTerminalRef\.current\?\.\(\{[\s\S]{0,40}outcome: "failed"/,
  );
});

test("a delegated launch never selects Deep Research in the composer", () => {
  const terminal = fs.readFileSync(
    new URL(
      "../src/app/components/hermes/dashboard-agent-terminal.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const garden = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  // The chip routes whatever the person types next. A launch the model chose
  // must not claim it, least of all for the seconds a launch takes to settle.
  assert.doesNotMatch(
    terminal,
    /if \(!deepResearch\.agent\) await deepResearch\.select\(\);/,
  );
  assert.doesNotMatch(
    garden,
    /if \(!deepResearchAgent\) await selectDeepResearch\(\);/,
  );
});

const usage = (overrides = {}) => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  ...overrides,
});

// This is the durable shape of a Super Agent -> God's Eye -> synthesis chain.
// The visible synthesis owns the whole wait, not just the adjacent worker and
// not just its own final model call.
const delegatedPhases = [
  { role: "user", content: "Show aircraft over the Netherlands" },
  {
    role: "assistant",
    content: "Opening a live aircraft view now.",
    responseDurationMs: 30_229,
    usage: usage({
      inputTokens: 142_329,
      outputTokens: 355,
      totalTokens: 142_684,
      apiCalls: 4,
    }),
  },
  {
    role: "user",
    content: "/agents:gods-eye …",
    internalAgentContinuation: true,
    delegatedAgentRun: true,
  },
  {
    role: "assistant",
    content: "",
    internalAgentContinuation: true,
    delegatedAgentRun: true,
    godsEyeRun: { runId: "gerun_test" },
    responseDurationMs: 7_699,
  },
  {
    role: "user",
    content: "God's Eye finished …",
    internalAgentContinuation: true,
  },
  {
    role: "assistant",
    content: "The live view shows aircraft over the Netherlands.",
    responseDurationMs: 18_797,
    usage: usage({
      inputTokens: 38_940,
      outputTokens: 376,
      totalTokens: 39_316,
      apiCalls: 1,
      scope: "turn",
      // Window occupancy is measured, not accumulated: the last response's
      // reading is the true one and summing would invent a number.
      contextUsedTokens: 38_940,
      contextLimitTokens: 1_050_000,
      responseDurationMs: 18_797,
    }),
  },
];

test("the hand-back inherits every hidden phase's time", () => {
  assert.equal(
    delegatedTurnCarriedDurationMs(delegatedPhases, 5),
    30_229 + 7_699,
  );
});

test("only an internal delegation chain is inherited from", () => {
  const ordinary = [
    { role: "user", content: "Question" },
    { role: "assistant", content: "Answer", responseDurationMs: 297_000 },
  ];
  assert.equal(delegatedTurnCarriedDurationMs(ordinary, 1), undefined);
  const own = usage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  assert.deepEqual(delegatedTurnTotalUsage(ordinary, 1, own), own);
});

test("the hand-back reports what every hidden model phase cost", () => {
  const total = delegatedTurnTotalUsage(
    delegatedPhases,
    5,
    delegatedPhases[5].usage,
  );
  assert.equal(total.totalTokens, 182_000);
  assert.equal(total.inputTokens, 181_269);
  assert.equal(total.outputTokens, 731);
  assert.equal(total.apiCalls, 5);
  assert.equal(total.scope, "turn");
  assert.equal(total.contextUsedTokens, 38_940);
  assert.equal(total.contextLimitTokens, 1_050_000);
  // The delegation's share of the clock rides on carriedDurationMs instead, so
  // this stays the row's own duration and is never counted twice.
  assert.equal(total.responseDurationMs, 18_797);
});

// A legacy cumulative snapshot already covers rows this would add to it.
test("a session-scoped snapshot is not summed into the hand-back", () => {
  const own = usage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  const phases = delegatedPhases.map((message) => ({ ...message }));
  phases[1] = {
    ...phases[1],
    usage: usage({ totalTokens: 900_000, scope: "session" }),
  };
  const total = delegatedTurnTotalUsage(
    phases,
    5,
    own,
  );
  assert.equal(total.totalTokens, 15);
});

test("a self-presenting delegation is not superseded by its synthesis", () => {
  assert.deepEqual(
    [...supersededDelegationAssistantIndices(delegatedPhases)],
    [1],
  );
});
