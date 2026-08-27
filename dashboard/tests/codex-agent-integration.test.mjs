import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const identity = await import("../src/lib/codex/identity.ts");
const runManager = await import("../src/lib/codex/run-manager.ts");
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

test("Codex discovers the official VS Code extension binary outside PATH", () => {
  const extensions = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-codex-extension-"),
  );
  try {
    const oldBinary = path.join(
      extensions,
      "openai.chatgpt-26.700.1-win32-x64",
      "bin",
      "windows-x86_64",
      "codex.exe",
    );
    const newBinary = path.join(
      extensions,
      "openai.chatgpt-26.810.41047-win32-x64",
      "bin",
      "windows-x86_64",
      "codex.exe",
    );
    for (const binary of [oldBinary, newBinary]) {
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(binary, "fixture");
    }

    assert.deepEqual(
      runManager.codexExtensionBinaryCandidates(
        { VSCODE_EXTENSIONS: extensions, USERPROFILE: "", HOME: "" },
        "win32",
        "x64",
      ),
      [newBinary, oldBinary],
    );
  } finally {
    fs.rmSync(extensions, { recursive: true, force: true });
  }
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
  assert.match(
    codexHook,
    /conversationId = await session\.ensureConversation\(clientMessageId\)/,
  );
  assert.match(codexHook, /conversationId,[\s\S]*?clientMessageId,/);
  assert.match(workspace, /chatSessionId: prepared\.session\.id/);
  assert.match(workspace, /clientMessageId,/);
  assert.match(workspace, /visibilitychange/);
  assert.match(turns, /UPDATE chat_messages[\s\S]*?WHERE canonical_message_id = \?/);
});

test("Codex preambles land on the timeline, never in the saved chat message", () => {
  const manager = source("src/lib/codex/run-manager.ts");
  // An agent message is held until the run says what it was, so the narration
  // Codex emits before reaching for a tool never becomes a chat message.
  assert.match(manager, /pendingMessage: string;/);
  assert.match(manager, /commitPendingMessage\(run\);\s*\n\s*run\.pendingMessage = message;/);
  // Demotion happens past the kind filter, so only a real tool call can take a
  // message away from the answer: bookkeeping items — a todo list, a plan —
  // must not turn the run's last word into narration.
  assert.match(
    manager,
    /demotePendingMessage\(run\);\s*\n\s*run\.toolCount \+= 1;\s*\n\s*emit\(run, "tool\.completed"/,
  );
  assert.match(manager, /function demotePendingMessage[\s\S]*?emit\(run, "reasoning\.completed"/);
  assert.match(manager, /function commitPendingMessage[\s\S]*?emit\(run, "text\.completed"/);
  // Only the message still pending when the run ends is the answer.
  assert.match(manager, /if \(code === 0\) \{\s*\n\s*commitPendingMessage\(run\);/);
  assert.match(manager, /demotePendingMessage\(run\);\s*\n\s*emit\(run, "run\.failed"/);
  assert.match(manager, /demotePendingMessage\(run\);\s*\n\s*emit\(run, "run\.aborted"/);
  // The old shape wrote every message straight into the run's output.
  assert.doesNotMatch(
    manager,
    /const message = text\(item\.text, 100_000\)\.trim\(\);\s*\n\s*if \(!message\) return;\s*\n\s*run\.output\.push/,
  );
  // A run whose every message was a preamble still answers with the last thing
  // it said. "Codex completed the task." is the last resort, not the ending.
  assert.match(manager, /run\.lastNarration = message;/);
  assert.match(
    manager,
    /run\.output\.join\("\\n\\n"\)\.trim\(\) \|\|\s*\n\s*run\.lastNarration\.trim\(\) \|\|\s*\n\s*"Codex completed the task\."/,
  );
});

test("an inline run card can be reopened after it lands", () => {
  const card = source("src/app/components/hermes/inline-opencode-run.tsx");
  // The timeline folds away when the run finishes, but the toggle stays, so the
  // whole run is one click away for as long as the message exists.
  assert.match(card, /aria-expanded=\{activityOpen\}/);
  assert.match(card, /setActivityOpen\(\(open\) => !open\)/);
  // Each terminal frame folds the timeline as part of the same state
  // transition. Keeping this explicit avoids a follow-up effect briefly
  // rendering a finished card expanded.
  assert.match(
    card,
    /setStatus\("completed"\);\s*\n\s*setActivityOpen\(false\);/,
  );
  assert.match(card, /setStatus\(outcome\);\s*\n\s*setActivityOpen\(false\);/);
  // Live: the tail only. Reopened: everything, and nothing clamped.
  assert.match(
    card,
    /const visibleTimeline = !activityOpen\s*\n\s*\? \[\]\s*\n\s*: terminal\s*\n\s*\? timeline\s*\n\s*: timeline\.slice\(-VISIBLE_ACTIVITY\)/,
  );
  assert.match(card, /terminal \? "" : "line-clamp-3"/);
});

test("a run card resumed after a reload keeps counting from the real start", () => {
  const card = source("src/app/components/hermes/inline-opencode-run.tsx");
  // The stopwatch is dated from the replayed event stream rather than from the
  // moment the tab reopened, and the start can still move backwards after the
  // timer is already ticking.
  assert.match(card, /const at = Date\.parse\(event\.at\);/);
  assert.match(card, /startedAtRef\.current === null \|\| at < startedAtRef\.current/);
  assert.match(card, /const startedAt = startedAtRef\.current \?\? Date\.now\(\);/);
  assert.doesNotMatch(card, /setInterval\(\s*\(\) => setElapsed/);
  // A finished run reports how long it took, so the meta row survives a reload.
  assert.match(card, /responseDurationMs: Math\.max\(0, Math\.round\(durationMs\)\)/);
  assert.match(card, /\.\.\.\(reportedUsage \? \{ usage: reportedUsage \} : \{\}\)/);
  assert.match(card, /useState\(\s*\(\) => \(persistedUsage\?\.responseDurationMs \?\? 0\) \/ 1_000,\s*\)/);
});

test("a transcript stays busy while any inline agent card is still running", () => {
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const workspace = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(
    panel,
    /const transcriptResponding =\s*\n\s*\(activeRun \|\| streaming \|\| externalRunActive\) &&/,
  );
  assert.match(
    panel,
    /externalRunLaunching \|\|\s*\n\s*delegationInFlight \|\|\s*\n\s*messages\.some\(externalAgentRunInFlight\)/,
  );
  assert.match(workspace, /hasRunningExternalAgentInActiveChat;/);
  // An all-zero usage record carries a duration, not a token count of nothing.
  const meta = source("src/app/components/assistant-response-meta.tsx");
  assert.match(meta, /const noTokenReport =/);
  assert.match(meta, /sessionSnapshot \|\| noTokenReport \? undefined : reportedTokens/);
});
