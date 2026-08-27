import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const repoSource = (relativePath) =>
  fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const identity = await import("../src/lib/ruflo/identity.ts");
const runManager = await import("../src/lib/ruflo/run-manager.ts");
const runtime = await import("../src/lib/ruflo/runtime.ts");

test("Ruflo slash command parsing is canonical and case-insensitive", () => {
  assert.equal(
    identity.taskFromRufloCommand("/agents:ruflo refactor the auth module"),
    "refactor the auth module",
  );
  assert.equal(
    identity.taskFromRufloCommand("  /AGENTS:RUFLO   audit the API  "),
    "audit the API",
  );
  assert.equal(identity.taskFromRufloCommand("/agents:ruflo"), "");
  assert.equal(
    identity.taskFromRufloCommand("/react-repair /agents:ruflo fix the tests"),
    "/react-repair fix the tests",
  );
  assert.equal(identity.taskFromRufloCommand("/agents:opencode task"), null);
  assert.equal(identity.taskFromRufloCommand("/agents:ruflobot task"), null);
  assert.equal(
    identity.rufloUserMessage("audit the API"),
    "/agents:ruflo audit the API",
  );
});

test("Ruflo reads its hive configuration back out of the CLI's decorated output", () => {
  const stdout = [
    "[1m🧠 Hive Mind Configuration[0m",
    "  Swarm ID: [36mswarm-mabc123[0m",
    "  Objective: Add a health check",
    "  Queen Type: strategic",
    "  Worker Count: 6",
    "  Worker Types: researcher, coder, tester",
    "  Consensus: byzantine",
    "✔ Hive Mind prompt saved to: .hive-mind/sessions/hive-mind-prompt-swarm-mabc123.txt",
  ].join("\n");
  const plan = runManager.parseSwarmPlan(stdout);

  assert.equal(plan.swarmId, "swarm-mabc123");
  assert.equal(plan.queenType, "strategic");
  assert.equal(plan.workerCount, 6);
  assert.deepEqual(plan.workerTypes, ["researcher", "coder", "tester"]);
  assert.equal(plan.consensus, "byzantine");
  assert.equal(
    plan.promptFile,
    ".hive-mind/sessions/hive-mind-prompt-swarm-mabc123.txt",
  );
});

test("Ruflo falls back to safe defaults when the CLI reports nothing useful", () => {
  const plan = runManager.parseSwarmPlan("no hive here");
  assert.equal(plan.swarmId, "unknown");
  assert.equal(plan.queenType, "strategic");
  assert.equal(plan.consensus, "byzantine");
  assert.equal(plan.workerCount, 0);
  assert.equal(plan.promptFile, "");
  // `spawn` never echoes a topology, so it must stay empty and let the caller's
  // requested topology win rather than being overwritten by a default.
  assert.equal(plan.topology, "");
});

test("Ruflo parses the real `hive-mind spawn` output verbatim", () => {
  // Captured from `@claude-flow/cli@3.34.0 hive-mind spawn --claude --non-interactive
  // --dry-run --queen-type tactical --consensus raft --topology mesh` on
  // Windows. Note the CLI reports topology only inside the prompt preview.
  const stdout = [
    "[INFO] Spawning 4 worker agent(s)...",
    "",
    "[OK] Spawned 4 agent(s)",
    "  Total workers in hive: 4",
    "",
    "🧠 Hive Mind Configuration",
    "  - Swarm ID: hive-1785569352669",
    "  - Objective: Add a health check endpoint",
    "  - Queen Type: tactical",
    "  - Worker Count: 4",
    "  - Worker Types: worker",
    "  - Consensus: raft",
    "  - MCP Tools: Full Claude-Flow integration enabled",
    "",
    "[OK] Hive Mind prompt saved to: .hive-mind\\sessions\\hive-mind-prompt-hive-1785569352669.txt",
    "",
    "[INFO] Dry run - would execute Claude Code with prompt:",
    "Prompt length: 3969 characters",
    "",
    "First 500 characters of prompt:",
    "🧠 HIVE MIND COLLECTIVE INTELLIGENCE SYSTEM",
    "",
    "HIVE MIND CONFIGURATION:",
    "📌 Swarm ID: hive-1785569352669",
    "🎯 Objective: Add a health check endpoint",
    "👑 Queen Type: tactical",
    "🐝 Worker Count: 4",
    "🔗 Topology: mesh",
    "🤝 Consensus Algorithm: raft",
    "",
    "Full prompt saved to: .hive-mind\\sessions\\hive-mind-prompt-hive-1785569352669.txt",
  ].join("\n");
  const plan = runManager.parseSwarmPlan(stdout);

  assert.equal(plan.swarmId, "hive-1785569352669");
  assert.equal(plan.queenType, "tactical");
  assert.equal(plan.workerCount, 4);
  assert.deepEqual(plan.workerTypes, ["worker"]);
  assert.equal(plan.consensus, "raft");
  assert.equal(plan.topology, "mesh");
  assert.equal(
    plan.promptFile,
    ".hive-mind\\sessions\\hive-mind-prompt-hive-1785569352669.txt",
  );
});

test("Ruflo bounds the worker count a client can request", () => {
  assert.equal(runManager.clampWorkerCount(undefined), runManager.DEFAULT_WORKER_COUNT);
  assert.equal(runManager.clampWorkerCount("not a number"), runManager.DEFAULT_WORKER_COUNT);
  assert.equal(runManager.clampWorkerCount(0), runManager.MIN_WORKER_COUNT);
  assert.equal(runManager.clampWorkerCount(-40), runManager.MIN_WORKER_COUNT);
  assert.equal(runManager.clampWorkerCount(9_000), runManager.MAX_WORKER_COUNT);
  assert.equal(runManager.clampWorkerCount(4), 4);
});

test("Ruflo materializes attached screenshots for Claude and removes them", () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-ruflo-attachment-test-"),
  );
  let materialized;
  try {
    const bytes = Buffer.from("ruflo image fixture");
    materialized = runManager.materializeRufloImageAttachments(repository, [
      {
        type: "image",
        name: "screenshot.png",
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      },
    ]);
    assert.equal(materialized.paths.length, 1);
    assert.deepEqual(fs.readFileSync(materialized.paths[0]), bytes);

    const instruction = runManager.rufloImageInstruction(
      repository,
      materialized.paths,
    );
    assert.match(instruction, /Claude Code's Read tool/);
    assert.match(instruction, /screenshot-1\.png/);
    assert.match(instruction, /read-only run inputs/);

    const attachmentDirectory = path.dirname(materialized.paths[0]);
    materialized.cleanup();
    assert.equal(fs.existsSync(attachmentDirectory), false);
    materialized = undefined;
  } finally {
    materialized?.cleanup();
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("Ruflo carries image attachments through the chat, route, and swarm objective", () => {
  const launcher = source("src/app/components/hermes/use-ruflo-agent.ts");
  const terminal = source(
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  const gardenWorkspace = source(
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  );
  const route = source("src/app/api/ruflo/runs/route.ts");
  const manager = source("src/lib/ruflo/run-manager.ts");

  assert.match(launcher, /async \(task: string, attachments: readonly ChatAttachment\[\] = \[\]\)/);
  assert.match(launcher, /chatMessageAttachments\(attachments\)/);
  assert.match(launcher, /attachments: imageAttachments/);
  assert.match(launcher, /attachments: persistedAttachments/);
  assert.match(
    terminal,
    /rufloTask\s*\|\|\s*"Review the attached screenshot and implement the requested fix\."/,
  );
  assert.match(terminal, /await launchRufloRun\([\s\S]*?pendingAttachments/);
  assert.match(
    terminal,
    /const rufloTask = taskFromRufloCommand\(text\)[\s\S]*?const pendingAttachments = chatAttachments[\s\S]*?setChatAttachments\(\[\]\)[\s\S]*?const selected = ruflo\.agent \?\? \(await selectRuflo\(\)\)[\s\S]*?await launchRufloRun\([\s\S]*?pendingAttachments/,
  );
  assert.match(
    gardenWorkspace,
    /async function launchRuflo\([\s\S]*?attachments: readonly ChatAttachment\[\] = \[\]/,
  );
  assert.match(
    gardenWorkspace,
    /fetch\("\/api\/ruflo\/runs"[\s\S]*?attachments: attachments\.filter/,
  );
  assert.match(
    gardenWorkspace,
    /const rufloAttachments = pendingAttachments[\s\S]*?await launchRuflo\([\s\S]*?rufloAttachments/,
  );
  assert.match(
    gardenWorkspace,
    /const rufloTask = taskFromRufloCommand\(text\)[\s\S]*?const rufloAttachments = pendingAttachments[\s\S]*?setChatAttachments\(\[\]\)[\s\S]*?if \(!rufloAgent\) await selectRuflo\(\)[\s\S]*?await launchRuflo\([\s\S]*?rufloAttachments/,
  );

  assert.match(route, /normalizeChatMessageAttachments\(body\.attachments\)/);
  assert.match(route, /\.filter\(\(attachment\) => attachment\.type === "image"\)/);
  assert.match(route, /attachments,/);
  assert.match(manager, /materializeRufloImageAttachments/);
  assert.match(manager, /\[baseObjective, attachmentContext\]/);
  assert.match(manager, /part\.replace\(\/\\s\+\/g, " "\)/);
  assert.match(manager, /\[prompt, attachmentContext[,\]]/);
  assert.match(manager, /spawnExecutor\(executorPrompt\)/);
  assert.match(manager, /attachmentCount: materialized\.paths\.length/);
});

test("Ruflo reports what is missing instead of failing silently", () => {
  const withoutClone = runtime.runtimeAvailability({ RUFLO_ROOT: "" });
  // The repo ships the clone, so this only asserts the shape of the contract.
  assert.equal(typeof withoutClone.available, "boolean");
  assert.equal(typeof withoutClone.installed, "boolean");
  if (!withoutClone.available) assert.equal(typeof withoutClone.reason, "string");
});

test("Ruflo health discovers its planner and Claude statically", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-ruflo-static-health-"));
  const root = path.join(dir, "ruflo");
  const planner = path.join(root, "configured-planner.mjs");
  const bin = path.join(dir, "claude-package", "bin");
  const claude = path.join(bin, process.platform === "win32" ? "claude.EXE" : "claude");
  const marker = path.join(dir, "executed.txt");
  try {
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.mkdirSync(path.join(root, "v3", "@claude-flow", "cli"), { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "3.34.0" }));
    fs.writeFileSync(path.join(root, "bin", "cli.js"), "// source checkout marker\n");
    fs.writeFileSync(path.join(root, "v3", "@claude-flow", "cli", "package.json"), "{}");
    fs.writeFileSync(
      planner,
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "planner ran");`,
    );
    fs.writeFileSync(
      path.join(dir, "claude-package", "package.json"),
      JSON.stringify({ name: "@anthropic-ai/claude-code", version: "9.8.7" }),
    );
    fs.writeFileSync(claude, `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`);
    if (process.platform !== "win32") fs.chmodSync(claude, 0o755);

    const availability = runtime.runtimeAvailability({
      RUFLO_ROOT: root,
      RUFLO_BIN: planner,
      PATH: bin,
      PATHEXT: ".EXE",
    });
    assert.deepEqual(availability, {
      available: true,
      installed: true,
      version: "3.34.0",
      source: "configured",
      executor: { available: true, version: "9.8.7" },
    });
    assert.equal(fs.existsSync(marker), false, "health must not execute either toolchain");

    const resolverSource = source("src/lib/ruflo/runtime.ts");
    assert.doesNotMatch(resolverSource, /node:child_process|spawnSync\s*\(|["']--version["']/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("packaged Ruflo and Claude receipts are resolved without global tools", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-ruflo-packaged-health-"));
  const root = path.join(dir, "app-services", "ruflo");
  const bin = path.join(dir, "bin");
  const planner = path.join(root, "bin", "cli.js");
  const claude = path.join(bin, process.platform === "win32" ? "claude.exe" : "claude");
  try {
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.mkdirSync(path.join(root, "dist", "src"), { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@claude-flow/cli", version: "3.34.0" }),
    );
    fs.writeFileSync(planner, "// packaged planner\n");
    fs.writeFileSync(path.join(root, "dist", "src", "index.js"), "// packaged dist\n");
    fs.writeFileSync(claude, "packaged claude fixture\n");
    fs.writeFileSync(
      path.join(bin, "claude-runtime-artifact.json"),
      JSON.stringify({ claudeCode: { version: "2.1.239" } }),
    );
    if (process.platform !== "win32") fs.chmodSync(claude, 0o755);

    assert.equal(runtime.resolveRufloRoot({ RUFLO_ROOT: root }), root);
    assert.deepEqual(
      runtime.runtimeAvailability({
        RUFLO_ROOT: root,
        RUFLO_BIN: planner,
        RUFLO_CLAUDE_BIN: claude,
        PATH: "",
      }),
      {
        available: true,
        installed: true,
        version: "3.34.0",
        source: "configured",
        executor: { available: true, version: "2.1.239" },
      },
    );
    const resolverSource = source("src/lib/ruflo/runtime.ts");
    assert.match(resolverSource, /`@claude-flow\/cli@\$\{version\}`/u);
    assert.doesNotMatch(resolverSource, /`ruflo@\$\{version\}`/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop packaging freezes the complete Ruflo runtime closure", () => {
  const prepare = repoSource("desktop/scripts/prepare-app-resources.mjs");
  const verify = repoSource("desktop/scripts/verify-package.mjs");
  const environment = repoSource("native/runtime-core/src/service_environment.rs");
  const receipt = JSON.parse(
    repoSource("desktop/runtime-v2/vendor/ruflo/runtime-artifact.json"),
  );
  const lock = JSON.parse(repoSource("desktop/runtime-v2/vendor/ruflo/package-lock.json"));
  const lockedCli = lock.packages["node_modules/@claude-flow/cli"];

  assert.equal(receipt.ruflo.package, "@claude-flow/cli");
  assert.equal(receipt.ruflo.version, "3.34.0");
  assert.equal(lockedCli.version, receipt.ruflo.version);
  assert.equal(lockedCli.integrity, receipt.ruflo.npmIntegrity);
  assert.deepEqual(receipt.ruflo.omittedDependencyClasses, ["dev", "optional"]);
  assert.match(prepare, /"ci",\s*\n\s*"--omit=dev",\s*\n\s*"--omit=optional"/u);
  assert.match(prepare, /copyTree\(installedModules, path\.join\(target, "node_modules"\)\)/u);
  assert.match(prepare, /Preserve npm's package boundary verbatim/u);
  assert.match(prepare, /BREADBOARD_DEPENDENCY_LOCK\.json/u);
  assert.match(prepare, /claude-runtime-artifact\.json/u);
  assert.match(verify, /const rufloReceipt = path\.join\(rufloRoot, "runtime-artifact\.json"\)/u);
  assert.match(verify, /PINNED_RUFLO_RUNTIME/u);
  assert.match(verify, /pinned Claude Code executor/u);
  assert.match(environment, /"RUFLO_ROOT", paths\.app_root\(\)\.join\("ruflo"\)/u);
  assert.match(environment, /paths\.runtime_root\(\)\.join\("bin"\)\.join\("claude\.exe"\)/u);
});

test("Ruflo plans with its own CLI and executes through Claude Code", () => {
  const manager = source("src/lib/ruflo/run-manager.ts");
  const resolver = source("src/lib/ruflo/runtime.ts");
  const route = source("src/app/api/ruflo/runs/route.ts");

  // Phase 1 — Ruflo initializes the hive (spawn refuses without it), then
  // plans it, but must never launch Claude Code itself.
  assert.match(manager, /"hive-mind",\s*\n\s*"init"/);
  assert.match(manager, /"hive-mind",\s*\n\s*"spawn"/);
  assert.match(manager, /\[ERROR\]/);
  assert.match(manager, /"--dry-run"/);
  assert.match(manager, /"--non-interactive"/);
  assert.match(manager, /"--claude"/);
  assert.match(manager, /"--queen-type"/);
  assert.match(manager, /"--consensus"/);
  assert.match(manager, /cwd: run\.repositoryPath/);

  // Phase 2 — Breadboard owns the Claude Code process and its event stream.
  assert.match(manager, /"--output-format",\s*\n\s*"stream-json"/);
  assert.match(manager, /"--verbose"/);
  assert.match(manager, /`--mcp-config=\$\{mcp\.configPath\}`/);
  assert.match(manager, /child\.stdin\.end\(prompt\)/);
  assert.match(manager, /ingestClaudeFrame/);
  assert.match(manager, /frame\.type === "result"/);

  // Permissions stay bounded unless the operator opts in explicitly.
  assert.match(manager, /RUFLO_DANGEROUSLY_SKIP_PERMISSIONS/);
  assert.match(manager, /\["--permission-mode", "acceptEdits"\]/);

  // The generated MCP config lives outside the user's repository.
  assert.match(manager, /os\.tmpdir\(\), "breadboard-ruflo"/);
  assert.match(manager, /mcpServers/);
  assert.match(manager, /run\.cleanup\?\.\(\)/);

  // Spawns are shell-free so an objective is never parsed as a command line.
  assert.doesNotMatch(manager, /shell:\s*true/);
  // The resolver only mentions `shell: true` in prose explaining why it is
  // avoided; assert on the spawn options it actually passes.
  assert.doesNotMatch(resolver, /^\s*shell:\s*true,?$/m);
  assert.match(resolver, /process\.execPath/);
  assert.match(resolver, /npx-cli\.js/);
  assert.match(resolver, /RUFLO_CLAUDE_BIN/);

  assert.match(route, /resolveConnectedRepository\(userId, gardenSlug\)/);
  assert.match(route, /executionTarget: "ruflo"/);
  // The resolved skill text is still what the swarm runs; it now arrives
  // behind the chat the objective was typed into.
  assert.match(route, /instruction: withConversationContext\(\r?\n\s+resolved\.text,/);
});

test("Coding skills may run through Codex, Ruflo, or OpenCode", () => {
  const commands = source("src/lib/hermes/commands.ts");
  assert.match(commands, /"hermes" \| "codex" \| "opencode" \| "ruflo"/);
  assert.match(
    commands,
    /executionTarget !== "codex" &&\s*\n\s*effectiveContext\.executionTarget !== "opencode" &&\s*\n\s*effectiveContext\.executionTarget !== "ruflo"/,
  );
});

test("Ruflo runs are a durable external-agent kind", () => {
  const runs = source("src/lib/conversations/external-agent-runs.ts");
  const chatSessions = source("src/app/api/chat-sessions/[sessionId]/route.ts");

  // Membership, not position: new agent kinds are appended after this one.
  assert.match(runs, /EXTERNAL_AGENT_RUN_KINDS = \[[^\]]*"ruflo",[^\]]*\] as const/s);
  assert.match(runs, /candidate\.kind === "codex"[\s\S]*candidate\.kind === "opencode"[\s\S]*candidate\.kind === "ruflo"/);
  assert.match(runs, /if \(run\.kind === "ruflo"\)/);
  // The Garden save path walks the registry rather than naming agents one
  // by one, so restorability is now "the registry maps this kind to a field".
  assert.match(runs, /ruflo: "rufloRun"/);
  assert.match(chatSessions, /EXTERNAL_AGENT_RUN_FIELD_BY_KIND\[kind\]/);
});

test("Ruflo appears in Agents and renders durable inline run output", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const terminal = source(
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  const launcher = source("src/app/components/hermes/use-ruflo-agent.ts");
  const composer = source("src/app/components/assistant-composer.tsx");
  const garden = source("src/app/components/hermes/garden-agent-chat.tsx");
  const gardenWorkspace = source(
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  );
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const widget = source("src/app/components/hermes/inline-ruflo-run.tsx");

  assert.match(hub, /id="ruflo-entry"/);
  assert.match(hub, /\{RUFLO_COMMAND\}/);
  assert.match(hub, /showRuflo/);
  assert.match(composer, /onSelectRuflo \? \(\) => insertCommandToken\(RUFLO_COMMAND\)/);
  assert.match(terminal, /useRufloAgent/);
  assert.match(terminal, /taskFromRufloCommand\(text\)/);
  assert.match(garden, /useRufloAgent/);
  assert.match(garden, /taskFromRufloCommand\(text\)/);
  assert.match(launcher, /kind: "ruflo"/);
  assert.match(launcher, /session\.previewExternalAgentTurn\(/);
  assert.match(launcher, /appendExternalAgentTurn/);
  assert.match(gardenWorkspace, /onSelectRuflo/);
  assert.match(gardenWorkspace, /taskFromRufloCommand\(text\)/);
  assert.match(gardenWorkspace, /gardenSlug: clusterSlug/);
  assert.match(gardenWorkspace, /rufloRun: \{[\s\S]*?externalAgentOutcome: "running"/);
  assert.match(gardenWorkspace, /<InlineRufloRun/);
  assert.match(panel, /message\.rufloRun/);
  assert.match(panel, /<InlineRufloRun/);

  // The card carries the same visual grammar as the other inline run cards,
  // plus the hive configuration strip that is specific to Ruflo.
  assert.match(widget, /bb-agent-run-card/);
  assert.match(widget, /aria-label="Ruflo swarm timeline"/);
  assert.match(widget, /aria-label="Hive mind configuration"/);
  assert.match(widget, /grid-cols-\[8px_minmax\(0,1fr\)\]/);
  assert.match(widget, /event\.type === "swarm\.configured"/);
  assert.match(widget, /event\.type === "text\.completed"/);
  assert.match(widget, /notifyTaskCompleted/);
  assert.match(widget, /onTerminal/);
  assert.doesNotMatch(widget, />\s*Stop\s*</);
});
