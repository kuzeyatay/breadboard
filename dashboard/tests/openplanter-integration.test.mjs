import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const identity = await import("../src/lib/openplanter/identity.ts");

test("OpenPlanter slash command parsing is canonical and case-insensitive", () => {
  assert.equal(
    identity.taskFromOpenPlanterCommand("/agents:openplanter map the evidence"),
    "map the evidence",
  );
  assert.equal(
    identity.taskFromOpenPlanterCommand("  /AGENTS:OPENPLANTER   compare sources  "),
    "compare sources",
  );
  assert.equal(identity.taskFromOpenPlanterCommand("/agents:openplanter"), "");
  assert.equal(identity.taskFromOpenPlanterCommand("/agents:agent-tars task"), null);
  assert.equal(
    identity.openPlanterUserMessage("map the evidence"),
    "/agents:openplanter map the evidence",
  );
});

test("OpenPlanter runs through ChatMock and persists as an external chat turn", () => {
  const route = source("src/app/api/openplanter/runs/route.ts");
  const manager = source("src/lib/openplanter/run-manager.ts");
  const runner = source("scripts/openplanter-chatmock-runner.py");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");

  assert.match(route, /resolveChatmockBaseUrl\(request\)/);
  assert.match(route, /chatmockApiKeyValue\(\)/);
  assert.match(manager, /openplanter-chatmock-runner\.py/);
  assert.match(runner, /config\.provider = "openai"/);
  assert.match(runner, /config\.openai_base_url = config\.base_url/);
  assert.match(terminal, /taskFromOpenPlanterCommand\(text\)/);
  assert.match(terminal, /kind: "openplanter"/);
  assert.match(terminal, /appendExternalAgentTurn\(/);
});

test("OpenPlanter renders graph, trail, output, and final-result widgets inline", () => {
  const widget = source("src/app/components/hermes/inline-openplanter-run.tsx");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");

  assert.match(widget, /Knowledge graph/);
  assert.match(widget, /Investigation trail/);
  assert.match(widget, /Outputs/);
  assert.match(widget, /Investigation result/);
  assert.match(widget, /graph\.updated/);
  assert.match(widget, /artifacts\.updated/);
  assert.match(widget, /bb-agent-run-inset/);
  assert.match(panel, /<InlineOpenPlanterRun/);
});

test("normal Hermes chats keep thinking metadata and response action buttons", () => {
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const activity = source("src/app/components/hermes/activity-panel.tsx");
  const responseMeta = source("src/app/components/assistant-response-meta.tsx");

  assert.match(panel, /AssistantMessageActions/);
  assert.match(activity, /AssistantResponseMeta/);
  assert.match(responseMeta, />Thinking</);
  assert.match(responseMeta, /tokens unavailable/);
  assert.match(activity, /Permission required/);
});
