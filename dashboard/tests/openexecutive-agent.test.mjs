import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  OPENEXECUTIVE_COMMAND,
  openExecutiveUserMessage,
  parseOpenExecutiveRequest,
  taskFromOpenExecutiveCommand,
} from "../src/lib/openexecutive/identity.ts";
import { openExecutiveSettingsFrom } from "../src/lib/openexecutive/settings.ts";
import {
  expectedRuntimeV2OuterAgentInputCount,
  validateRuntimeV2OpenExecutiveRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

test("OpenExecutive has one stackable slash command and bounded request flags", () => {
  assert.equal(OPENEXECUTIVE_COMMAND, "/agents:openexecutive");
  assert.equal(
    taskFromOpenExecutiveCommand(
      "/company-context /agents:openexecutive --committee decide whether to launch",
    ),
    "/company-context --committee decide whether to launch",
  );
  assert.equal(taskFromOpenExecutiveCommand("/agents:openexecutive"), "");
  assert.equal(taskFromOpenExecutiveCommand("ask the executives"), null);
  assert.equal(
    openExecutiveUserMessage("decide whether to launch"),
    "/agents:openexecutive decide whether to launch",
  );
  assert.deepEqual(
    parseOpenExecutiveRequest(
      "--iterations 99 --committee decide whether to launch",
      { maxIterations: 8, committeeReview: false },
    ),
    {
      task: "decide whether to launch",
      maxIterations: 30,
      committeeReview: true,
    },
  );
  assert.equal(
    parseOpenExecutiveRequest("--no-committee assess the acquisition", {
      committeeReview: true,
    }).committeeReview,
    false,
  );
  assert.deepEqual(
    openExecutiveSettingsFrom({ maxIterations: 999, committeeReview: "sometimes" }),
    { maxIterations: 30, committeeReview: false },
  );
  assert.equal(openExecutiveSettingsFrom({ maxIterations: "unknown" }).maxIterations, 15);
});

test("the Runtime V2 adapter seals the executive request and accepts no blobs", () => {
  const request = {
    task: "Assess the acquisition.",
    model: "chat-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    maxIterations: 12,
    committeeReview: true,
    conversationContext: "User: The target is profitable.",
  };
  assert.equal(validateRuntimeV2OpenExecutiveRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("openexecutive", request), 0);
  for (const forged of [
    { ...request, executable: "python.exe" },
    { ...request, apiKey: "renderer-secret" },
    { ...request, maxIterations: 0 },
    { ...request, maxIterations: 31 },
    { ...request, committeeReview: "yes" },
    { ...request, baseUrl: "file:///secrets" },
  ]) {
    assert.throws(() => validateRuntimeV2OpenExecutiveRequest(forged), /invalid/u);
  }
});

test("OpenExecutive is registered, persisted, and rendered on both chat surfaces", async () => {
  const { runtimeAgentById, runtimeAgentByToken } = await import(
    "../src/lib/hermes/capability-combinations.ts"
  );
  const profile = runtimeAgentById("openexecutive");
  assert.ok(profile);
  assert.equal(profile.command, OPENEXECUTIVE_COMMAND);
  assert.equal(runtimeAgentByToken("agents:openexecutive")?.id, "openexecutive");
  assert.deepEqual([...profile.surfaces].sort(), ["dashboard_terminal", "garden_chat"]);

  const { EXTERNAL_AGENT_RUN_KINDS, parseExternalAgentRun, externalAgentMessageFields } =
    await import("../src/lib/conversations/external-agent-runs.ts");
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("openexecutive"));
  const run = parseExternalAgentRun({
    kind: "openexecutive",
    runId: "oerun_1",
    task: "Assess the acquisition.",
  });
  assert.deepEqual(run, {
    kind: "openexecutive",
    runId: "oerun_1",
    task: "Assess the acquisition.",
  });
  assert.deepEqual(
    externalAgentMessageFields({
      externalAgent: true,
      externalAgentRun: run,
      externalAgentOutcome: "running",
    }).openExecutiveRun,
    { runId: "oerun_1", task: "Assess the acquisition." },
  );

  for (const body of [
    read("src/app/components/hermes/dashboard-agent-terminal.tsx"),
    read("src/app/gardens/[clusterSlug]/workspace-client.tsx"),
  ]) {
    assert.match(body, /taskFromOpenExecutiveCommand/);
    assert.match(body, /\/api\/openexecutive\/runs/);
    assert.match(body, /openexecutive|openExecutiveRun/);
  }
  assert.match(read("src/app/components/hermes/agent-runtime-panel.tsx"), /InlineOpenExecutiveRun/);
  assert.match(read("src/app/components/hermes/command-hub.tsx"), /OPENEXECUTIVE_COMMAND/);
});

test("the bridge stays inside the worker and routes every model call through ChatMock", () => {
  const manager = read("src/lib/openexecutive/run-manager.ts");
  const bridge = read("../scripts/openexecutive-bridge.py");
  assert.match(manager, /startOuterAgentRun/);
  assert.match(manager, /kind: "openexecutive"/);
  assert.match(manager, /startRuntimeWorkerRun/);
  assert.match(bridge, /LOCAL_MODELS_ENABLED/);
  assert.match(bridge, /LOCAL_BASE_URL/);
  assert.match(bridge, /ENABLE_WEB_SEARCH.*false/s);
  assert.match(bridge, /MCP_ENABLED.*false/s);
  assert.doesNotMatch(read("src/app/api/openexecutive/runs/route.ts"), /node:child_process|spawn\s*\(/u);
});

test("the real bridge streams the OpenExecutive protocol against a stub orchestrator", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openexecutive-bridge-"));
  const packageRoot = path.join(root, "packages", "core", "openexecutive");
  const writeModule = (relative, body) => {
    const target = path.join(packageRoot, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };
  try {
    writeModule("knowledge/retriever.py", "def retrieve(**_kwargs):\n    return 'stub knowledge'\n");
    writeModule(
      "memory/episodic.py",
      "def initialize_db():\n    return None\n\ndef format_for_prompt():\n    return 'stub memory'\n",
    );
    writeModule(
      "onboarding/profile_builder.py",
      "class Profile:\n    def is_empty(self):\n        return True\n\ndef load_or_create_profile():\n    return Profile()\n",
    );
    writeModule(
      "orchestrator/session.py",
      "class Session:\n    def __init__(self, company_profile=None):\n        self.company_profile = company_profile\n",
    );
    writeModule(
      "orchestrator/executive.py",
      [
        "class Executive:",
        "    _THINKING = '\\x01'",
        "    async def stream_chat(self, **kwargs):",
        "        yield self._THINKING",
        "        yield 'Executive stub answer'",
        "    async def stream_chat_with_committee(self, **kwargs):",
        "        yield {'type': 'committee_review'}",
        "        yield 'Committee stub answer'",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      process.env.PYTHON ?? (process.platform === "win32" ? "python.exe" : "python3"),
      [path.resolve(dashboardRoot, "..", "scripts", "openexecutive-bridge.py")],
      {
        encoding: "utf8",
        input: JSON.stringify({
          root,
          stateRoot: path.join(root, "state"),
          task: "Assess the launch.",
          conversationContext: "The budget is fixed.",
          model: "stub-model",
          reasoningEffort: "none",
          baseUrl: "http://127.0.0.1:8765/v1",
          apiKey: "local",
          maxIterations: 4,
          committeeReview: true,
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const events = result.stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.type), [
      "progress",
      "progress",
      "progress",
      "delta",
      "completed",
    ]);
    assert.equal(events.at(-1).summary, "Committee stub answer");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
