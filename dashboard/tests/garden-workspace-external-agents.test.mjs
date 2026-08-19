import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const { assistantExternalAgentRunId } = await import(
  "../src/lib/conversations/external-agent-runs.ts"
);

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const listRoute = source("../src/app/api/chat-sessions/route.ts");
const updateRoute = source(
  "../src/app/api/chat-sessions/[sessionId]/route.ts",
);

test("the main garden workspace exposes and launches every restored runtime agent", () => {
  for (const callback of [
    "onSelectAgentBrowser",
    "onSelectDeepResearch",
    "onSelectOpenCode",
    "onSelectOpenPlanter",
  ]) {
    assert.match(workspace, new RegExp(`${callback}=\\{`));
  }

  assert.match(workspace, /taskFromAgentBrowserCommand\(text\)/);
  assert.match(workspace, /taskFromDeepResearchCommand\(text\)/);
  assert.match(workspace, /taskFromOpenCodeCommand\(text\)/);
  assert.match(workspace, /taskFromOpenPlanterCommand\(text\)/);
  assert.match(workspace, /fetch\("\/api\/deep-research\/runs"/);
  assert.match(workspace, /fetch\("\/api\/opencode\/runs"/);
  assert.match(workspace, /fetch\("\/api\/openplanter\/runs"/);
  assert.match(
    workspace,
    /`\/api\/opencode\/health\?gardenSlug=\$\{encodeURIComponent\(clusterSlug\)\}`/,
  );
  assert.match(workspace, /gardenSlug: clusterSlug/);
  assert.match(
    workspace,
    /`\/api\/agent-browser\/agents\/\$\{encodeURIComponent\(selection\.id\)\}\/runs`/,
  );
});

test("garden chat renders all specialized run widgets inline", () => {
  assert.match(workspace, /<InlineAgentBrowserRun/);
  assert.match(workspace, /<InlineDeepResearchRun/);
  assert.match(workspace, /<InlineOpenCodeRun/);
  assert.match(workspace, /<InlineOpenPlanterRun/);
  assert.match(workspace, /onExternalAgentTerminal=\{handleExternalAgentTerminal\}/);
});

test("a finished run only claims the assistant half of its turn", () => {
  const run = {
    runId: "cxrun_1",
    task: "is the learn pipeline too fragile?",
    gardenSlug: "breadboard-dev",
    repository: "breadboard",
  };
  // Restored history used to hand the descriptor to both halves of the turn.
  const restored = [
    { role: "user", content: "/agents:codex is the learn pipeline too fragile?", codexRun: run },
    { role: "assistant", content: "", codexRun: run, externalAgentOutcome: "running" },
  ];

  assert.equal(assistantExternalAgentRunId(restored[0]), null);
  assert.equal(assistantExternalAgentRunId(restored[1]), "cxrun_1");

  const rewritten = restored.map((message) =>
    assistantExternalAgentRunId(message) === "cxrun_1"
      ? { ...message, content: "The Learn pipeline is not inherently fragile." }
      : message,
  );
  assert.equal(
    rewritten[0].content,
    "/agents:codex is the learn pipeline too fragile?",
  );
  assert.equal(rewritten[1].content, "The Learn pipeline is not inherently fragile.");
});

test("garden chat resolves a terminal run through the assistant-only matcher", () => {
  assert.match(workspace, /const ownsRun = \(message: Message\) =>\s*\n?\s*assistantExternalAgentRunId\(message\) === runId;/);
  assert.match(workspace, /candidate\.messages\.some\(ownsRun\)/);
  // No raw descriptor comparison may survive in the terminal handler.
  const handler = workspace.slice(
    workspace.indexOf("function handleExternalAgentTerminal"),
    workspace.indexOf("async function handleSubmit"),
  );
  assert.doesNotMatch(handler, /codexRun\?\.runId === runId/);
});

test("restored history never hands a run descriptor to a user message", () => {
  assert.match(
    listRoute,
    /function parseExternalAgentFields\(\s*value: string \| null,\s*role: ChatRole,/,
  );
  assert.match(listRoute, /if \(!value \|\| role !== "assistant"\) return \{\};/);
  assert.match(
    listRoute,
    /parseExternalAgentFields\(\s*message\.tool_calls,\s*message\.role,\s*\)/,
  );
});

test("the run card shows only the agent name and closes itself when the run lands", () => {
  const card = source("../src/app/components/hermes/inline-opencode-run.tsx");
  // Just the agent name in the header — no repository, no echoed prompt.
  assert.doesNotMatch(card, /\{agentName\} · \{repository\}/);
  assert.doesNotMatch(card, /repository: string;/);
  assert.match(card, /<p[^>]*>\{agentName\}<\/p>/);
  // A live run shows its most recent steps; a finished one collapses to the
  // status line on its own, with no expander for the reader to operate.
  assert.match(card, /persistedActivity\?: ExternalAgentActivityEntry\[\];/);
  assert.match(
    card,
    /const visibleTimeline = terminal \? \[\] : timeline\.slice\(-VISIBLE_ACTIVITY\)/,
  );
  assert.match(card, /\{visibleTimeline\.length \?/);
  assert.doesNotMatch(card, /activityOpen/);
  assert.doesNotMatch(card, /"Hide" : "Show"/);
  // The duration and tokens are reported with the outcome and read back from
  // the saved turn, so a refreshed card keeps the meta row it earned.
  assert.match(card, /persistedUsage\?: ChatTokenUsage;/);
  assert.match(card, /usageWithDuration\(usageRef\.current, measured\)/);
  for (const consumer of [workspace, source("../src/app/components/hermes/agent-runtime-panel.tsx")]) {
    assert.match(consumer, /persistedActivity=\{(msg|message)\.externalAgentActivity\}/);
    assert.match(consumer, /persistedUsage=\{(msg|message)\.usage\}/);
    assert.doesNotMatch(consumer, /repository=\{(msg|message)\.codexRun\.repository\}/);
  }
});

test("legacy garden chat history preserves external agent descriptors and outcomes", () => {
  assert.match(updateRoute, /metadata\.externalAgent = true/);
  assert.match(updateRoute, /metadata\.externalAgentRun = message\.externalAgentRun/);
  assert.match(updateRoute, /metadata\.externalAgentOutcome/);
  assert.match(updateRoute, /metadata\.delegatedAgentPreamble/);
  // Every kind is derived from the registry here, so no agent can be left
  // out of the save path and lose its card on the next reload.
  assert.match(updateRoute, /EXTERNAL_AGENT_RUN_KINDS\.map/);
  assert.match(updateRoute, /EXTERNAL_AGENT_RUN_FIELD_BY_KIND\[kind\]/);
  assert.match(listRoute, /externalAgentMessageFields/);
  assert.match(listRoute, /delegatedAgentPresentation\(message\.content, externalAgent\)/);
});

test("delegated workers stay hidden and preserve their Super Agent message across Garden saves", () => {
  assert.match(workspace, /message\.delegatedAgentPreamble\?\.trim\(\)/);
  assert.match(workspace, /delegatedAgentPreamble: message\.content/);
  assert.match(workspace, /content: message\.content/);
  assert.match(workspace, /externalAgentResult: result\.content/);
  assert.match(workspace, /msg\.delegatedAgentPreamble/);
  assert.match(workspace, /msg\.delegatedAgentRun \? "hidden" : "contents"/);
  assert.match(updateRoute, /delegatedAgentPreamble\?: string/);
  assert.match(updateRoute, /externalAgentResult\?: string/);
  assert.match(updateRoute, /delegatedAgentRun = true/);
});
