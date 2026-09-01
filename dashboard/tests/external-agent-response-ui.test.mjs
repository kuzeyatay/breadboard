import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const responseMeta = source(
  "../src/app/components/assistant-response-meta.tsx",
);
const runtime = source(
  "../src/app/components/hermes/agent-runtime-panel.tsx",
);
const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const globalStyles = source("../src/app/globals.css");

const widgets = [
  {
    name: "Agent TARS",
    source: source(
      "../src/app/components/hermes/inline-browser-run.tsx",
    ),
    card: "bb-agent-run-card",
  },
  {
    name: "Agent Browser",
    source: source(
      "../src/app/components/hermes/inline-agent-browser-run.tsx",
    ),
    card: "bb-agent-run-card",
  },
  {
    name: "Deep Research",
    source: source(
      "../src/app/components/hermes/inline-deep-research-run.tsx",
    ),
    card: "bb-agent-run-card",
  },
  {
    name: "OpenPlanter",
    source: source(
      "../src/app/components/hermes/inline-openplanter-run.tsx",
    ),
    card: "bb-agent-run-card",
  },
  {
    name: "OpenCode",
    source: source(
      "../src/app/components/hermes/inline-opencode-run.tsx",
    ),
    card: "bb-agent-run-card",
  },
];

test("every external agent uses the shared Breadboard neumorphic run-card system", () => {
  for (const widget of widgets) {
    assert.match(widget.source, /bb-agent-run-card/,
      `${widget.name} must use the shared raised paper shell`);
    assert.match(widget.source, /bb-agent-run-(?:icon|inset|panel)/,
      `${widget.name} must include tactile inner depth`);
  }
  for (const primitive of [
    "bb-agent-run-card",
    "bb-agent-run-header",
    "bb-agent-run-led",
    "bb-agent-run-pill",
    "bb-agent-run-inset",
    "bb-agent-run-panel",
    "bb-agent-run-row",
    "bb-agent-run-output",
  ]) {
    assert.match(globalStyles, new RegExp(`\\.${primitive}\\b`));
  }
});

test("shared response metadata defaults to an honest token state and can hide absent telemetry", () => {
  // "Thinking" while the run is going, "Thought" once it is over.
  assert.match(responseMeta, /label = "Thinking"/);
  assert.match(responseMeta, /\? "Thought" : label/);
  assert.match(responseMeta, /thinking-shimmer/);
  assert.match(responseMeta, /↓ counting tokens/);
  assert.doesNotMatch(responseMeta, /tokens unavailable/);
  assert.match(responseMeta, /usage\?\.totalTokens \?\? totalTokens/);
  assert.match(responseMeta, /showTokenUsage = true/);
  assert.match(
    responseMeta,
    /aria-label=\{`\$\{agentName\} \$\{displayLabel\.toLowerCase\(\)\}\$\{tokenLabel \? " and token usage" : ""\}`\}/,
  );
});

test("every external agent places thinking metadata above its response widget", () => {
  for (const widget of widgets) {
    assert.match(widget.source, /import AssistantResponseMeta/);
    const metaIndex = widget.source.indexOf("<AssistantResponseMeta");
    const cardIndex = widget.source.indexOf(widget.card, metaIndex);
    assert.ok(metaIndex >= 0, `${widget.name} must render response metadata`);
    assert.ok(
      cardIndex > metaIndex,
      `${widget.name} thinking metadata must be above its run widget`,
    );
    assert.match(widget.source, /active=\{!terminal\}/);
    assert.match(widget.source, /failed=\{terminal && status !== "completed"\}/);
  }
});

test("every external agent has standard actions below every terminal outcome", () => {
  for (const widget of widgets) {
    assert.match(
      widget.source,
      /const TERMINAL(?:_STATUSES)? = new Set\(\[[\s\S]{0,100}"completed"[\s\S]{0,100}"failed"[\s\S]{0,100}"aborted"/,
      `${widget.name} must treat success, failure, and interruption as terminal`,
    );
    assert.match(widget.source, /const terminalContent =/);
    assert.match(widget.source, /status === "aborted"/);
    assert.match(widget.source, /status === "failed"|status === "failed" \|\| status === "runtime_lost"/);
    assert.match(widget.source, /onRetry\?: \(\) => void/);
    assert.match(
      widget.source,
      /terminal \? \([\s\S]{0,240}<AssistantMessageActions content=\{terminalContent\} onRetry=\{onRetry\}/,
      `${widget.name} must render the standard action bar for terminal content`,
    );

    const cardIndex = widget.source.indexOf(widget.card);
    const actionsIndex = widget.source.lastIndexOf("<AssistantMessageActions");
    assert.ok(
      actionsIndex > cardIndex,
      `${widget.name} actions must be below its message body`,
    );
  }
});

function componentBlock(host, componentName) {
  const start = host.indexOf(`<${componentName}`);
  assert.ok(start >= 0, `${componentName} must be rendered by its host`);
  return host.slice(start, start + 1_200);
}

test("Terminal wires retry into every external agent response", () => {
  for (const componentName of [
    "InlineBrowserRun",
    "InlineAgentBrowserRun",
    "InlineDeepResearchRun",
    "InlineOpenPlanterRun",
    "InlineOpenCodeRun",
  ]) {
    const block = componentBlock(runtime, componentName);
    assert.match(block, /onRetry=\{/);
    assert.match(block, /retryAssistantAsBranch\(index\)/);
  }
});

test("every external agent answers the send with a thinking row before its run exists", () => {
  // Starting an external run costs a round trip. Until its card mounts, the
  // previewed Thinking row is the only sign the message was received, so every
  // launcher has to preview before it posts the run.
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const launchers = [
    ["const launchBrowserRun", '/api/ui-tars/agents/'],
    ["const launchAgentBrowserRun", "/api/agent-browser/agents/"],
    ["const launchOpenPlanterRun", '"/api/openplanter/runs"'],
    ["const launchAgentReachRun", '"/api/agent-reach/runs"'],
    ["const launchCareerOpsRun", '"/api/career-ops/runs"'],
    ["const launchSocialsManagerRun", '"/api/socials-manager/runs"'],
    ["const launchHardwareBlueprintRun", '"/api/hardware-blueprint/runs"'],
  ];
  for (const [launcher, runEndpoint] of launchers) {
    const start = terminal.indexOf(launcher);
    assert.ok(start > 0, `${launcher} is gone`);
    const preview = terminal.indexOf("previewExternalAgentTurn({", start);
    const post = terminal.indexOf(runEndpoint, start);
    assert.ok(preview > start, `${launcher} never previews its turn`);
    assert.ok(post > preview, `${launcher} previews only after starting the run`);
  }

  for (const hook of [
    "use-codex-agent.ts",
    "use-opencode-agent.ts",
    "use-ruflo-agent.ts",
    "use-deep-research-agent.ts",
    "use-workflow-automation.ts",
  ]) {
    const launcher = source(`../src/app/components/hermes/${hook}`);
    const preview = launcher.indexOf("previewExternalAgentTurn({");
    assert.ok(preview > 0, `${hook} never previews its turn`);
    // The run request is the first fetch after the preview; a launcher that
    // previewed late would have its request before it instead.
    const post = launcher.indexOf("await fetch(", preview);
    assert.ok(post > preview, `${hook} previews only after starting the run`);
  }

  // The preview is a user message plus the pending assistant row, and the row
  // is what the shared thinking metadata renders against.
  const session = source("../src/app/components/hermes/use-agent-session.ts");
  const previewBody = session.slice(
    session.indexOf("const previewExternalAgentTurn = useCallback"),
  );
  assert.match(previewBody.slice(0, 4_000), /external-thinking-\$\{clientMessageId\}/);
  assert.match(previewBody.slice(0, 1_800), /setConnection\("streaming"\)/);
  assert.doesNotMatch(session, /showThinking/);

  // The row also has to carry the moment the person pressed send. Handed an
  // empty activity list it renders with no elapsed time at all, so the whole
  // launch round trip reads as a turn where nothing happened.
  assert.match(
    previewBody.slice(0, 2_600),
    /setActivities\(\[\s*\{[^}]*kind: "reasoning"[^}]*startedAt: createdAt/,
  );

  // And the clock is retired with the row, so a start failure — which has no
  // inline card to take the measurement over — cannot inherit the wait as its
  // own duration.
  const appendBody = session.slice(
    session.indexOf("const appendExternalAgentTurn = useCallback"),
  );
  const teardown = appendBody.slice(
    appendBody.indexOf("} finally {"),
    appendBody.indexOf("} finally {") + 900,
  );
  assert.match(teardown, /setConnection\("idle"\)/);
  assert.match(teardown, /setActivities\(\[\]\)/);
});

test("Garden workspace wires retry into every external agent it hosts", () => {
  for (const componentName of [
    "InlineAgentBrowserRun",
    "InlineDeepResearchRun",
    "InlineOpenPlanterRun",
    "InlineOpenCodeRun",
  ]) {
    const block = componentBlock(workspace, componentName);
    assert.match(block, /onRetry=\{/);
    assert.match(block, /onRetryAssistant\(i\)/);
  }
});
