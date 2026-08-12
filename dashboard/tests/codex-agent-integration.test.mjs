import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const identity = await import("../src/lib/codex/identity.ts");
const externalRuns = await import("../src/lib/conversations/external-agent-runs.ts");

test("Codex has a canonical Agents command", () => {
  assert.equal(identity.taskFromCodexCommand("/agents:codex fix the tests"), "fix the tests");
  assert.equal(identity.taskFromCodexCommand("/REACT /AGENTS:CODEX repair"), "/REACT repair");
  assert.equal(identity.taskFromCodexCommand("/agents:codex"), "");
  assert.equal(identity.taskFromCodexCommand("/agents:opencode task"), null);
  assert.equal(identity.codexUserMessage("ship it"), "/agents:codex ship it");
});

test("Codex is an external coding agent and never a conversational runtime", () => {
  const contracts = source("src/lib/agent-runtime/contracts.ts");
  const runtime = source("src/lib/agent-runtime/runtime.ts");
  const config = source("src/lib/agent-runtime/config.ts");
  assert.doesNotMatch(contracts, /RUNTIME_KINDS = \[[^\]]*codex/);
  assert.doesNotMatch(runtime, /CodexRuntimeAdapter/);
  assert.doesNotMatch(config, /CODEX_BASE_URL|loopbackWebSocketUrl/);
});

test("Codex appears beside OpenCode in Agents across Terminal and Garden chat", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const codexHook = source("src/app/components/hermes/use-codex-agent.ts");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/components/hermes/garden-agent-chat.tsx");
  const workspace = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(hub, /id="codex-entry"/);
  assert.match(hub, /\{CODEX_COMMAND\}/);
  assert.match(hub, /Uses Codex to read, edit, and test the local project/);
  for (const host of [terminal, garden, workspace]) {
    assert.match(host, /onSelectCodex/);
    assert.match(host, /taskFromCodexCommand/);
  }
  for (const host of [codexHook, workspace]) {
    assert.doesNotMatch(host, /Codex connected to/);
    assert.match(host, /Codex is unavailable/);
  }
});

test("Codex runs per task in the connected repository with ChatMock pinned", () => {
  const manager = source("src/lib/codex/run-manager.ts");
  const route = source("src/app/api/codex/runs/route.ts");
  assert.match(manager, /"exec",\s*\n\s*"--json"/);
  assert.match(
    manager,
    /process\.platform === "win32" \? "danger-full-access" : "workspace-write"/s,
  );
  assert.match(manager, /"--sandbox",\s*\n\s*sandboxMode/);
  assert.match(manager, /model_provider="chatmock"/);
  assert.match(manager, /model_providers\.chatmock\.wire_api="responses"/);
  assert.match(manager, /"--ignore-user-config"/);
  assert.match(route, /resolveConnectedRepository\(userId, gardenSlug\)/);
  assert.match(route, /executionTarget: "codex"/);
  assert.match(route, /resolveChatmockBaseUrl\(request\)/);
});

test("ChatMock adapts subscription models to the Responses-only Codex CLI", () => {
  const routes = source("../chatmock/chatmock/routes_openai.py");
  const adapter = source("../chatmock/chatmock/external_responses.py");
  assert.match(routes, /external_responses_response\(responses_model, payload/);
  assert.match(adapter, /def responses_to_chat_payload/);
  assert.match(adapter, /"type": "function_call"/);
  assert.match(adapter, /"type": "response\.completed"/);
});

test("Codex run descriptors persist independently from OpenCode", () => {
  const run = {
    kind: "codex",
    runId: "cxrun_test",
    task: "Fix the build",
    gardenSlug: "breadboard",
    repository: "breadboard",
  };
  assert.deepEqual(externalRuns.parseExternalAgentRun(run), run);
  const fields = externalRuns.externalAgentMessageFields({
    externalAgent: true,
    externalAgentRun: run,
    externalAgentOutcome: "running",
  });
  assert.deepEqual(fields.codexRun, {
    runId: "cxrun_test",
    task: "Fix the build",
    gardenSlug: "breadboard",
    repository: "breadboard",
  });
  assert.equal(fields.openCodeRun, undefined);
});

test("Codex Garden turns are durable before the launch response and finish without a mounted tab", () => {
  const route = source("src/app/api/codex/runs/route.ts");
  const manager = source("src/lib/codex/run-manager.ts");
  const codexHook = source("src/app/components/hermes/use-codex-agent.ts");
  const workspace = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const turns = source("src/lib/conversations/external-agent-turns.ts");

  assert.match(route, /recordExternalAgentTurn\(\{/);
  assert.match(route, /setRunTerminalHandler\(userId, run\.runId/);
  assert.match(route, /finishExternalAgentTurn\(\{/);
  assert.match(route, /turnPersisted: Boolean\(conversation\)/);
  assert.match(manager, /if \(run\.terminalResult\) handler\(run\.terminalResult\)/);
  assert.match(codexHook, /conversationId = await session\.ensureConversation\(\)/);
  assert.match(codexHook, /conversationId,[\s\S]*?clientMessageId,/);
  assert.match(workspace, /chatSessionId: prepared\.session\.id/);
  assert.match(workspace, /clientMessageId,/);
  assert.match(workspace, /visibilitychange/);
  assert.match(turns, /UPDATE chat_messages[\s\S]*?WHERE canonical_message_id = \?/);
});
