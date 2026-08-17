import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const identity = await import("../src/lib/opencode/identity.ts");
const runManager = await import("../src/lib/opencode/run-manager.ts");

test("OpenCode slash command parsing is canonical and case-insensitive", () => {
  assert.equal(
    identity.taskFromOpenCodeCommand("/agents:opencode add a health check"),
    "add a health check",
  );
  assert.equal(
    identity.taskFromOpenCodeCommand("  /AGENTS:OPENCODE   fix the tests  "),
    "fix the tests",
  );
  assert.equal(identity.taskFromOpenCodeCommand("/agents:opencode"), "");
  assert.equal(
    identity.taskFromOpenCodeCommand(
      "/react-repair /agents:opencode fix the tests",
    ),
    "/react-repair fix the tests",
  );
  assert.equal(identity.taskFromOpenCodeCommand("/agents:openplanter task"), null);
  assert.equal(
    identity.openCodeUserMessage("add a health check"),
    "/agents:opencode add a health check",
  );
});

test("OpenCode recognizes transient provider failures that are safe to resume", () => {
  for (const message of [
    "Our servers are currently overloaded. Please try again later.",
    "429 Too Many Requests",
    "503 Service Unavailable",
    "Gateway timeout (504)",
  ]) {
    assert.equal(runManager.isTransientOpenCodeFailure(message), true, message);
  }
  assert.equal(
    runManager.isTransientOpenCodeFailure("TypeScript compilation failed"),
    false,
  );
});

test("OpenCode is configured for ChatMock with repository-scoped codebase memory", () => {
  const config = JSON.parse(source("../opencode-config/opencode.json"));
  const provider = config.provider.chatmock;
  const memory = config.mcp.codebase_memory;

  assert.equal(config.default_agent, "breadboard");
  assert.equal(config.model, "chatmock/{env:CHATMOCK_MODEL}");
  assert.equal(provider.npm, "@ai-sdk/openai-compatible");
  assert.equal(provider.options.baseURL, "{env:CHATMOCK_BASE_URL}");
  assert.equal(provider.options.apiKey, "{env:CHATMOCK_API_KEY}");
  for (const model of Object.values(provider.models)) {
    assert.equal(model.attachment, true);
    assert.deepEqual(model.modalities.input, ["text", "image"]);
  }
  assert.deepEqual(memory.command, [
    "npx",
    "-y",
    "codebase-memory-mcp@0.8.1",
  ]);
  assert.equal(memory.timeout, 600_000);
  assert.match(config.agent.breadboard.prompt, /Call codebase_memory_list_projects once/);
  assert.match(config.agent.breadboard.prompt, /at most once per run/);
  assert.match(config.agent.breadboard.prompt, /continue with targeted filesystem search/);
  assert.equal(config.agent.breadboard.permission.external_directory, "deny");
  assert.equal(config.agent.breadboard.permission.bash["git push"], "deny");
});

test("OpenCode declares the requested model, including provider-prefixed ids", () => {
  const base = JSON.parse(source("../opencode-config/opencode.json"));

  // The picker's provider-prefixed ids are the ones the static map can never
  // hold; without this, OpenCode fails the run with "Unexpected server error".
  const prefixed = runManager.withRequestedModel(base, "cliproxy/claude-opus-5");
  assert.equal(prefixed.changed, true);
  const added = prefixed.config.provider.chatmock.models["cliproxy/claude-opus-5"];
  assert.equal(added.name, "cliproxy/claude-opus-5");
  assert.equal(added.attachment, true);
  assert.deepEqual(added.modalities.input, ["text", "image"]);
  for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) {
    assert.equal(added.variants[effort].reasoningEffort, effort);
  }
  // Deriving a config must never mutate the checked-in one.
  assert.equal(
    Object.hasOwn(base.provider.chatmock.models, "cliproxy/claude-opus-5"),
    false,
  );

  const declared = runManager.withRequestedModel(base, "gpt-5.6-sol");
  assert.equal(declared.changed, false);
  assert.equal(declared.config, base);
});

test("OpenCode launches in the connected Garden repository without a shell", () => {
  const route = source("src/app/api/opencode/runs/route.ts");
  const repository = source("src/lib/opencode/repository.ts");
  const manager = source("src/lib/opencode/run-manager.ts");
  const inlineRun = source(
    "src/app/components/hermes/inline-opencode-run.tsx",
  );

  assert.match(route, /resolveConnectedRepository\(userId, gardenSlug\)/);
  assert.match(route, /resolveCommandMessage\(/);
  assert.match(route, /executionTarget: "opencode"/);
  // The resolved skill text is still what the agent runs; it now arrives
  // behind the chat the task was typed into.
  assert.match(route, /instruction: withConversationContext\(\n\s+resolved\.text,/);
  assert.match(route, /resolveChatmockBaseUrl\(request\)/);
  assert.match(manager, /opencode-ai@\$\{version\}/);
  assert.match(manager, /OPENCODE_CONFIG: runConfig\.path/);
  assert.match(manager, /CHATMOCK_BASE_URL: input\.baseUrl/);
  assert.match(manager, /BREADBOARD_OPENCODE_REPO: input\.repositoryPath/);
  assert.match(manager, /CBM_ALLOWED_ROOT: input\.repositoryPath/);
  assert.match(manager, /"--dir",\s*input\.repositoryPath/);
  assert.match(manager, /stdio: \["pipe", "pipe", "pipe"\]/);
  assert.match(
    manager,
    /child\.stdin\.end\(resumeSessionId \? resumeInstruction\(input\.task\) : instruction\)/,
  );
  assert.match(manager, /materializeImageAttachments/);
  assert.match(manager, /materialized\.paths\.flatMap\(\(filePath\) => \["--file", filePath\]\)/);
  assert.match(manager, /resumeSessionId\s*\? \[\]\s*:\s*materialized\.paths\.flatMap/);
  assert.match(manager, /Inspect each image with OpenCode's image\/file reader/);
  assert.match(manager, /run\.cleanup\?\.\(\)/);
  assert.match(manager, /run\.toolCount === 0 && run\.output\.length === 0/);
  assert.match(manager, /"run\.retrying"/);
  assert.match(manager, /"--session", resumeSessionId/);
  assert.match(manager, /isTransientOpenCodeFailure\(error\)/);
  assert.match(manager, /MAX_LAUNCH_ATTEMPTS = 4/);
  assert.match(manager, /Continue the existing task from the current session/);
  assert.match(manager, /Do not repeat completed edits/);
  assert.match(manager, /runtimeError \|\|/);
  assert.match(inlineRun, /"run\.retrying"/);
  assert.match(manager, /OPENCODE_DISABLE_EXTERNAL_SKILLS: "1"/);
  assert.match(manager, /OPENCODE_DISABLE_PROJECT_CONFIG: "1"/);
  assert.match(manager, /OPENCODE_PURE: "1"/);
  assert.doesNotMatch(manager, /"--",\s*input\.task/);
  assert.doesNotMatch(manager, /shell:\s*true/);
  assert.match(repository, /WHERE user_id = \? AND slug = \?/);
  assert.match(repository, /path\.join\(repositoryPath, "\.git"\)/);
});

test("Garden cards connect repositories using the private desktop folder picker", () => {
  const actions = source("src/app/actions/clusters.ts");
  const cards = source("src/app/dashboard/dashboard-client.tsx");
  const database = source("src/lib/db.ts");

  assert.match(database, /repo_path TEXT/);
  assert.match(actions, /setClusterRepository/);
  assert.match(actions, /WHERE id = \? AND user_id = \?/);
  assert.match(actions, /const \{ repo_path: repoPath, \.\.\.safeRow \} = row/);
  assert.match(cards, /breadboardDesktop\?: \{ pickFolder:/);
  assert.match(cards, /await desktop\.pickFolder\(\)/);
  assert.match(cards, /aria-label=\{/);
  assert.match(cards, /Connect a local repository/);
  assert.match(cards, /backgroundColor: "var\(--paper-surface\)"/);
  assert.doesNotMatch(cards, /\.repo_path/);
});

test("OpenCode appears in Agents and renders durable inline run output", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const terminal = source(
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  const launcher = source(
    "src/app/components/hermes/use-opencode-agent.ts",
  );
  const session = source(
    "src/app/components/hermes/use-agent-session.ts",
  );
  const composer = source("src/app/components/assistant-composer.tsx");
  const garden = source("src/app/components/hermes/garden-agent-chat.tsx");
  const gardenWorkspace = source(
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  );
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const widget = source(
    "src/app/components/hermes/inline-opencode-run.tsx",
  );

  assert.match(hub, /id="opencode-entry"/);
  assert.match(hub, /\{OPENCODE_COMMAND\}/);
  assert.match(terminal, /useOpenCodeAgent/);
  assert.match(launcher, /kind: "opencode"/);
  assert.match(launcher, /appendExternalAgentTurn/);
  assert.match(launcher, /session\.previewExternalAgentTurn\(/);
  assert.match(session, /const previewExternalAgentTurn = useCallback/);
  assert.match(launcher, /attachments: imageAttachments/);
  assert.match(launcher, /attachments: persistedAttachments/);
  assert.match(
    composer,
    /item\.requiresOpenCode[\s\S]*OPENCODE_COMMAND[\s\S]*item\.token/,
  );
  assert.match(garden, /useOpenCodeAgent/);
  assert.match(garden, /gardenSlug/);
  assert.match(gardenWorkspace, /onSelectOpenCode/);
  assert.match(gardenWorkspace, /taskFromOpenCodeCommand\(text\)/);
  assert.match(gardenWorkspace, /gardenSlug: clusterSlug/);
  assert.match(gardenWorkspace, /attachments: attachments\.filter/);
  assert.match(gardenWorkspace, /opencode-pending-/);
  assert.match(terminal, /launchOpenCodeRun\([\s\S]*pendingAttachments/);
  assert.match(gardenWorkspace, /<InlineOpenCodeRun/);
  assert.match(panel, /message\.openCodeRun/);
  assert.match(panel, /<InlineOpenCodeRun/);
  assert.doesNotMatch(widget, /ChatMock .* codebase-memory-mcp/);
  assert.doesNotMatch(widget, />\s*Stop\s*</);
  assert.doesNotMatch(widget, /summary=\{reasoning\.at/);
  assert.match(widget, /event\.type === "text\.completed"/);
  assert.match(widget, /type ActivityEvent = ReasoningEvent \| ToolEvent/);
  assert.match(widget, /aria-label=\{`\$\{agentName\} activity timeline`\}/);
  assert.match(widget, /grid-cols-\[8px_minmax\(0,1fr\)\]/);
  assert.match(widget, /!terminal && item\.key === timeline\[timeline\.length - 1\]\?\.key[\s\S]*motion-safe:animate-pulse/);
  assert.match(widget, /item\.kind === "tool"[\s\S]*bg-\[var\(--botanical-2\)\][\s\S]*bg-\[var\(--ink-muted\)\]/);
  assert.match(widget, /<\/div>\s*\{result \? \(/);
  assert.doesNotMatch(widget, /bb-agent-run-output/);
  assert.match(widget, /notifyTaskCompleted/);
  assert.match(widget, /onTerminal/);
});
