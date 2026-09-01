import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import AdmZip from "adm-zip";

import {
  authorizeTerminalCommand,
  cancelAuthorizedTerminalCommand,
  continueAuthorizedTerminalCommand,
  resolveCommandShell,
  resolveMaxRuntimeMs,
  runAuthorizedTerminalCommand,
} from "../src/lib/hermes/terminal-execution.ts";
import { executeTerminalCommand } from "../scripts/runtime-v2-terminal-command-worker.mjs";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { ensureArtifactSchema } from "../src/lib/hermes/artifact-schema.ts";
import {
  MAX_ARTIFACT_CONTENT_BYTES,
  addArtifactProvenance,
  artifactFile,
  createArtifact,
  createImportedArtifact,
  getArtifactForUser,
  hasReadyArtifactForRun,
  listArtifactEventsAfter,
  listArtifactsForUser,
  listArtifactVersions,
  presentArtifact,
  readArtifactSource,
  recordArtifactPipelineEvent,
  renderArtifact,
  setArtifactHighlight,
  updateArtifactContent,
} from "../src/lib/hermes/artifact-store.ts";
import { resolveSkillCompatibility } from "../src/lib/hermes/skill-compatibility.ts";
import { createOfficeRuntimeFixture } from "./helpers/office-runtime-fixture.mjs";
import { createArtifactFromUpload } from "../src/lib/hermes/artifact-upload-import.ts";
import { storedFileBlobPath } from "../src/lib/conversations/stored-file-blob-store.ts";
import { inspectArtifactImport } from "../src/lib/hermes/artifact-import.ts";

function grantFor(surface) {
  return brokerCapabilities({
    plan: planTask({ request: "Create a substantial report", authenticated: true }),
    surface,
    userId: 1,
    grants: [],
    workspaceRoot: "/runtime/session",
  });
}

const TERMINAL_TEST_AUTHORITY = {
  userId: 1,
  gardenId: null,
  conversationId: "conv_terminal_runtime_test",
};
let terminalJobSequence = 0;

function terminalSnapshot(identity, authority, state = "running") {
  const now = Date.now();
  return {
    jobId: identity.jobId,
    jobType: "terminal-command",
    workerKind: "terminal-command-node",
    resourceClass: "document-processing",
    state,
    stage: state === "running" ? "processing" : null,
    attempt: identity.attempt,
    workerInstanceId: identity.workerInstanceId,
    gardenId: authority.gardenId,
    conversationId: authority.conversationId,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    lastHeartbeatAt: now,
    lastWorkerSequence: 1,
    progressCurrent: 0,
    progressTotal: 0,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
  };
}

function inProcessTerminalRuntime() {
  const jobs = new Map();
  const copy = (value) => structuredClone(value);
  const requireJob = (authority, jobId) => {
    const entry = jobs.get(jobId);
    assert.ok(entry, `missing test Runtime job ${jobId}`);
    assert.deepEqual(authority, entry.authority);
    return entry;
  };
  return {
    async submit(authority, submission) {
      assert.equal(submission.jobType, "terminal-command");
      const sequence = ++terminalJobSequence;
      const identity = {
        jobId: `terminal_test_job_${sequence}`,
        attempt: 1,
        workerInstanceId: `terminal_test_worker_${sequence}`,
      };
      const entry = {
        authority: copy(authority),
        identity,
        job: terminalSnapshot(identity, authority),
        outputs: new Map(),
        abort: new AbortController(),
      };
      jobs.set(identity.jobId, entry);
      const execution = executeTerminalCommand(
        { identity, request: copy(submission.requestPayload) },
        entry.abort.signal,
        {
          checkpoint(snapshot) {
            entry.job.lastWorkerSequence += 1;
            entry.job.updatedAt = Date.now();
            entry.outputs.set("checkpoint", {
              jobId: identity.jobId,
              kind: "checkpoint",
              content: { protocolVersion: 1, identity, snapshot },
            });
          },
        },
      );
      void execution.then((result) => {
        entry.job.lastWorkerSequence += 1;
        entry.job.updatedAt = Date.now();
        entry.job.finishedAt = entry.job.updatedAt;
        if (entry.abort.signal.aborted) {
          entry.job.state = "cancelled";
          entry.job.stage = null;
          return;
        }
        entry.job.state = "succeeded";
        entry.job.stage = null;
        entry.outputs.set("result", {
          jobId: identity.jobId,
          kind: "result",
          content: {
            protocolVersion: 1,
            identity,
            completionSequence: entry.job.lastWorkerSequence,
            result,
          },
        });
      }, (error) => {
        entry.job.state = "failed";
        entry.job.stage = null;
        entry.job.failureCode = "WORKER_FAILED";
        entry.job.failureMessage = String(error?.message ?? error);
        entry.job.updatedAt = Date.now();
        entry.job.finishedAt = entry.job.updatedAt;
      });
      return copy(entry.job);
    },
    async inspect(authority, jobId) {
      return copy(requireJob(authority, jobId).job);
    },
    async readOutput(authority, jobId, kind) {
      const output = requireJob(authority, jobId).outputs.get(kind);
      if (!output) throw new Error(`test Runtime output ${kind} is not ready`);
      return copy(output);
    },
    async cancel(authority, jobId) {
      const entry = requireJob(authority, jobId);
      if (!["cancelled", "succeeded", "failed"].includes(entry.job.state)) {
        entry.job.state = "cancelling";
        entry.job.stage = "cancelling";
        entry.job.cancellationRequested = true;
        entry.job.updatedAt = Date.now();
        entry.abort.abort();
      }
      return copy(entry.job);
    },
  };
}

function terminalRuntimeOptions(runtimeSessionId) {
  return {
    runtimeSessionId,
    runtimeAuthority: TERMINAL_TEST_AUTHORITY,
    runtimeControl: inProcessTerminalRuntime(),
  };
}

test("dedicated Terminal authorizes ordinary inspection and focused verification", async () => {
  const runtime = terminalRuntimeOptions(8701);
  for (const command of ["pwd", "git status", "rg artifact dashboard/src", "npm run test -- focused"]) {
    assert.equal(authorizeTerminalCommand(command).allowed, true, command);
  }
  const pwd = await runAuthorizedTerminalCommand("pwd", runtime);
  assert.equal(pwd.exitCode, 0);
  assert.equal(pwd.cwd, ".");
  assert.ok(pwd.stdout.trim());
  const git = await runAuthorizedTerminalCommand("git status --short", runtime);
  assert.equal(git.exitCode, 0);
  const focused = await runAuthorizedTerminalCommand(
    "node --test --experimental-strip-types dashboard/tests/ai-models.test.mjs",
    runtime,
  );
  assert.equal(focused.exitCode, 0, focused.stderr || focused.stdout);
});

test("Terminal can inspect an explicitly authorized external folder with a read-only pipeline", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-terminal-scope-"));
  try {
    fs.writeFileSync(path.join(root, "small.txt"), "small");
    fs.writeFileSync(path.join(root, "largest.txt"), "x".repeat(64));
    const quotedRoot = `"${root.replaceAll('"', '""')}"`;
    const command = `Get-ChildItem ${quotedRoot} -File | Sort-Object Length -Descending | Select-Object -First 1 -ExpandProperty Name`;
    const options = { ...terminalRuntimeOptions(8702), authorizedRoots: [root] };
    assert.equal(authorizeTerminalCommand(command, options).allowed, true);
    if (process.platform === "win32") {
      const result = await runAuthorizedTerminalCommand(command, options);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.trim(), "largest.txt");
    }
    assert.equal(
      authorizeTerminalCommand(command, {
        authorizedRoots: [path.join(root, "different")],
      }).allowed,
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Terminal deletes only an exact server-authorized file target", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-terminal-delete-"));
  try {
    const target = path.join(root, "delete me (1).txt");
    const preserved = path.join(root, "keep.txt");
    fs.writeFileSync(target, "delete");
    fs.writeFileSync(preserved, "keep");
    const command = process.platform === "win32"
      ? `Remove-Item -LiteralPath '${target}'`
      : `rm -- '${target}'`;
    const options = {
      ...terminalRuntimeOptions(8703),
      workspaceRoot: root,
      authorizedRoots: [root],
      authorizedDeleteTargets: [target],
    };
    const authorization = authorizeTerminalCommand(command, options);
    assert.equal(authorization.allowed, true, authorization.reason);
    assert.equal(authorization.category, "delete");
    assert.equal(
      authorizeTerminalCommand(
        process.platform === "win32"
          ? `Remove-Item -LiteralPath '${preserved}'`
          : `rm -- '${preserved}'`,
        options,
      ).allowed,
      false,
    );
    const result = await runAuthorizedTerminalCommand(command, options);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(preserved), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A whole-drive scan buffers everything and prints at the very end, so the old
// fixed 120-second deadline killed it with an empty stdout and the model had to
// hand the command back to the user. Slow work now survives the wait.
function slowCommand(seconds) {
  return process.platform === "win32"
    ? `Start-Sleep -Milliseconds ${Math.round(seconds * 1000)}; Write-Output finished`
    : `sleep ${seconds}; echo finished`;
}

function withTerminalTiming(t, { sliceMs, maxCommandMs }) {
  const previous = {
    slice: process.env.BREADBOARD_TERMINAL_SLICE_MS,
    max: process.env.BREADBOARD_TERMINAL_MAX_COMMAND_MS,
  };
  process.env.BREADBOARD_TERMINAL_SLICE_MS = String(sliceMs);
  if (maxCommandMs) {
    process.env.BREADBOARD_TERMINAL_MAX_COMMAND_MS = String(maxCommandMs);
  }
  t.after(() => {
    for (const [name, value] of [
      ["BREADBOARD_TERMINAL_SLICE_MS", previous.slice],
      ["BREADBOARD_TERMINAL_MAX_COMMAND_MS", previous.max],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test("a Terminal command that outlives its slice keeps running and returns its real result", async (t) => {
  withTerminalTiming(t, { sliceMs: 200 });
  const runtimeSessionId = 8801;
  const runtime = terminalRuntimeOptions(runtimeSessionId);
  const command = slowCommand(1.4);
  const started = await runAuthorizedTerminalCommand(command, {
    ...runtime,
    approvedCommand: command,
  });
  assert.equal(started.running, true);
  assert.equal(started.timedOut, false);
  assert.equal(started.exitCode, null);
  assert.equal(started.stdout.trim(), "", "output arrives only at the end");
  assert.ok(started.commandId, "a still-running command hands back a handle");

  // The handle belongs to one runtime session and is useless to any other.
  await assert.rejects(
    () =>
      continueAuthorizedTerminalCommand(started.commandId, {
        ...runtime,
        runtimeSessionId: runtimeSessionId + 1,
      }),
    /no longer running/i,
  );

  let result = started;
  for (let attempt = 0; result.running && attempt < 40; attempt += 1) {
    result = await continueAuthorizedTerminalCommand(result.commandId, {
      ...runtime,
    });
  }
  assert.equal(result.running, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), "finished");
  assert.ok(result.elapsedMs >= 1_000, `elapsed ${result.elapsedMs}ms`);
  await assert.rejects(
    () =>
      continueAuthorizedTerminalCommand(started.commandId, runtime),
    /no longer running/i,
    "a collected command releases its handle",
  );
});

test("a Terminal command is still ended by its wall-clock ceiling", async (t) => {
  withTerminalTiming(t, { sliceMs: 5_000, maxCommandMs: 1_200 });
  const command = slowCommand(30);
  const result = await runAuthorizedTerminalCommand(command, {
    ...terminalRuntimeOptions(8802),
    approvedCommand: command,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.running, false);
  assert.equal(result.stdout.trim(), "");
  assert.ok(result.elapsedMs < 10_000, `elapsed ${result.elapsedMs}ms`);
  assert.equal(result.maxRuntimeMs, 1_200);
});

test("the model picks its own Terminal deadline, and the server clamps it", (t) => {
  const previous = process.env.BREADBOARD_TERMINAL_MAX_COMMAND_MS;
  delete process.env.BREADBOARD_TERMINAL_MAX_COMMAND_MS;
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_TERMINAL_MAX_COMMAND_MS;
    else process.env.BREADBOARD_TERMINAL_MAX_COMMAND_MS = previous;
  });
  assert.equal(
    resolveMaxRuntimeMs(45 * 60_000),
    2_700_000,
    "a scan that says it needs 45 minutes gets 45 minutes",
  );
  assert.equal(resolveMaxRuntimeMs(5_000), 5_000, "a status check can ask for a short leash");
  assert.equal(resolveMaxRuntimeMs(9 * 3_600_000), 3_600_000, "an absurd request is capped");
  assert.equal(resolveMaxRuntimeMs(10), 1_000, "a sub-second request still gets a usable floor");
  for (const absent of [undefined, null, 0, -60_000, Number.NaN, "600"]) {
    assert.equal(resolveMaxRuntimeMs(absent), 1_200_000, `no usable choice: ${String(absent)}`);
  }
  // An operator who lowers the ceiling means it; the model cannot argue past it.
  process.env.BREADBOARD_TERMINAL_MAX_COMMAND_MS = "5000";
  assert.equal(resolveMaxRuntimeMs(3_600_000), 5_000);
  assert.equal(resolveMaxRuntimeMs(), 5_000);
});

test("a Terminal command is ended by the deadline the model chose for it", async (t) => {
  withTerminalTiming(t, { sliceMs: 5_000 });
  const command = slowCommand(30);
  const result = await runAuthorizedTerminalCommand(command, {
    ...terminalRuntimeOptions(8804),
    approvedCommand: command,
    maxRuntimeMs: 1_200,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.running, false);
  assert.equal(result.maxRuntimeMs, 1_200, "the result reports the ceiling that applied");
  assert.ok(result.elapsedMs < 10_000, `elapsed ${result.elapsedMs}ms`);
});

test("the Terminal tool lets Hermes choose the timeout and collects for as long as it granted", () => {
  const plugin = fs.readFileSync(
    new URL("../../hermes-config/tool/terminal.ts", import.meta.url),
    "utf8",
  );
  assert.match(plugin, /timeoutSeconds: tool\.schema\s*\n?\s*\.number\(\)/);
  assert.match(plugin, /\.optional\(\)/);
  assert.ok(
    plugin.includes("timeoutSeconds: options.timeoutSeconds"),
    "the chosen timeout reaches the server",
  );
  assert.ok(
    plugin.includes("timeoutSeconds: args.timeoutSeconds"),
    "an approved retry keeps the timeout the model chose",
  );
  // Collection has to outlast the ceiling the server granted, or a long command
  // the model deliberately asked for would be abandoned before it finished.
  assert.ok(
    plugin.includes("grantedCeilingMs(current.data) + COLLECT_SLACK_MS"),
    "the collect budget follows the granted ceiling",
  );
  const prompt = fs.readFileSync(
    new URL("../../hermes-config/system/main-assistant.md", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /timeoutSeconds/);
});

test("cancelling a session ends its running Terminal command", async (t) => {
  withTerminalTiming(t, { sliceMs: 200 });
  const runtimeSessionId = 8803;
  const runtime = terminalRuntimeOptions(runtimeSessionId);
  const command = slowCommand(30);
  const started = await runAuthorizedTerminalCommand(command, {
    ...runtime,
    approvedCommand: command,
  });
  assert.equal(started.running, true);
  assert.equal(await cancelAuthorizedTerminalCommand(runtimeSessionId), true);
  const collected = await continueAuthorizedTerminalCommand(started.commandId, {
    ...runtime,
  });
  assert.equal(collected.running, false);
  assert.notEqual(collected.exitCode, 0);
  assert.equal(await cancelAuthorizedTerminalCommand(runtimeSessionId), false);
});

test("the command shell is pinned to an absolute path, not resolved through PATH", (t) => {
  // The installed app has failed an authorized command with
  // `spawn powershell.exe ENOENT`. libuv resolves a bare name through PATH only,
  // and this process runs with a curated environment, so the shell is addressed
  // directly under %SystemRoot%.
  const shell = resolveCommandShell();
  if (process.platform !== "win32") {
    assert.equal(shell, "/bin/sh");
    return;
  }
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  if (!systemRoot) return t.skip("no SystemRoot on this host");
  assert.ok(path.isAbsolute(shell), `expected an absolute shell path, got ${shell}`);
  assert.match(shell, /powershell\.exe$/i);
  assert.ok(fs.existsSync(shell), `${shell} should exist`);
  assert.ok(
    shell.toLowerCase().startsWith(systemRoot.toLowerCase()),
    `${shell} should live under ${systemRoot}`,
  );
});

test("Terminal policy rejects escapes, destructive operations, and executable rg flags", () => {
  for (const command of [
    "Get-Content ../secret.txt",
    "Get-Content C:\\Windows\\win.ini",
    "git reset --hard",
    "Remove-Item file.txt",
    "npm install left-pad",
    "rg --pre malicious.exe pattern .",
    "Get-Content $env:USERPROFILE",
  ]) assert.equal(authorizeTerminalCommand(command).allowed, false, command);
});

test("Terminal requests permission for any valid command outside the automatic policy", () => {
  const command = "du -sh .";
  const pending = authorizeTerminalCommand(command);
  assert.equal(pending.allowed, false);
  assert.equal(pending.approvalRequired, true);

  const approved = authorizeTerminalCommand(command, { approvedCommand: command });
  assert.equal(approved.allowed, true);
  assert.equal(approved.category, "approved");
  assert.equal(approved.approvalRequired, false);

  assert.equal(
    authorizeTerminalCommand("du -sh C:\\", { approvedCommand: command }).allowed,
    false,
    "approval must apply only to the exact command shown to the user",
  );
  assert.equal(
    authorizeTerminalCommand("npm install left-pad", {
      approvedCommand: "npm install left-pad",
    }).allowed,
    true,
    "mutating command families become available after exact approval",
  );
  assert.equal(authorizeTerminalCommand(" ", { approvedCommand: " " }).approvalRequired, false);
});

test("reading the Windows system clock reaches approval instead of a capability denial", () => {
  const command = 'Get-Date -Format "yyyy-MM-dd HH:mm:ss K"';
  const pending = authorizeTerminalCommand(command);
  assert.equal(pending.allowed, false);
  assert.equal(pending.approvalRequired, true);

  const approved = authorizeTerminalCommand(command, { approvedCommand: command });
  assert.equal(approved.allowed, true);
  assert.equal(approved.category, "approved");
  assert.equal(approved.approvalRequired, false);
});

test("Terminal executes an exact-approved write inside its active folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-terminal-write-"));
  try {
    const target = path.join(root, "write-smoke.txt");
    const command = process.platform === "win32"
      ? `Set-Content -LiteralPath '${target}' -Value 'Breadboard can write' -NoNewline`
      : `printf 'Breadboard can write' > '${target}'`;
    const pending = authorizeTerminalCommand(command, {
      workspaceRoot: root,
      authorizedRoots: [root],
    });
    assert.equal(pending.allowed, false);
    assert.equal(pending.approvalRequired, true);

    const result = await runAuthorizedTerminalCommand(command, {
      ...terminalRuntimeOptions(8704),
      workspaceRoot: root,
      authorizedRoots: [root],
      approvedCommand: command,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(fs.readFileSync(target, "utf8"), "Breadboard can write");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Terminal permits any download URL and file type only after exact-command approval", () => {
  const command = "Invoke-WebRequest -Uri 'https://example.com/builds/archive.custom?channel=stable&arch=x64' -OutFile 'C:\\Users\\me\\Downloads\\archive.custom'";
  const pending = authorizeTerminalCommand(command);
  assert.equal(pending.allowed, false);
  assert.equal(pending.approvalRequired, true);

  const approved = authorizeTerminalCommand(command, { approvedCommand: command });
  assert.equal(approved.allowed, true);
  assert.equal(approved.category, "approved");
  assert.equal(approved.approvalRequired, false);

  const alteredDestination = command.replace("archive.custom", "archive.exe");
  assert.equal(
    authorizeTerminalCommand(alteredDestination, { approvedCommand: command }).allowed,
    false,
    "download approval must not authorize a different URL or destination",
  );
});

test("surface broker keeps the permission-gated Terminal on its dedicated interactive surface", () => {
  const terminal = grantFor("dashboard_terminal").allowedTools;
  const garden = grantFor("garden_chat").allowedTools;
  const quartz = grantFor("quartz_ai").allowedTools;
  assert.equal(terminal.terminal_execute_command, true);
  assert.equal(terminal.artifact_create, true);
  assert.equal(terminal.artifact_import, true);
  assert.equal(terminal.artifact_image_generate, true);
  assert.equal(garden.terminal_execute_command, false);
  assert.equal(garden.bash, false);
  assert.equal(garden.artifact_create, true);
  assert.equal(garden.artifact_import, true);
  assert.equal(garden.artifact_image_generate, true);
  assert.equal(quartz.terminal_execute_command, false);
  assert.equal(quartz.bash, false);
  assert.equal(quartz.artifact_create, false);
  assert.equal(quartz.artifact_import, false);
  assert.equal(quartz.artifact_image_generate, false);
  assert.equal(quartz.artifact_read, false);
  const forged = brokerCapabilities({
    plan: planTask({ request: "Run git status and make a PDF", authenticated: false, isolated: true }),
    surface: "quartz_ai",
    userId: null,
    grants: [],
    workspaceRoot: "/runtime/quartz",
    isolated: true,
  });
  assert.equal(forged.allowedTools.terminal_execute_command, false);
  assert.equal(forged.allowedTools.artifact_create, false);
  const importTool = fs.readFileSync(
    new URL("../../hermes-config/tool/artifact_import.ts", import.meta.url),
    "utf8",
  );
  assert.match(importTool, /export default tool\(/);
  assert.match(importTool, /action: "artifact_import"/);
});

function artifactFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-artifacts-"));
  const filename = path.join(root, "artifacts.sqlite");
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER,
      client_message_id TEXT,
      role TEXT NOT NULL DEFAULT 'assistant',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '2025-01-01T00:00:00.000Z'
    );
    CREATE TABLE chat_sessions(
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER
    );
    CREATE TABLE chat_messages(
      id INTEGER PRIMARY KEY,
      session_id INTEGER,
      role TEXT,
      content TEXT,
      created_at TEXT,
      canonical_message_id INTEGER
    );
    INSERT INTO users VALUES (1), (2);
    INSERT INTO clusters VALUES (7, 'physics', 1), (8, 'chemistry', 1);
    INSERT INTO conversations VALUES (10, 'conv_garden', 1, 'garden_chat', 7);
    INSERT INTO conversations VALUES (11, 'conv_quartz', 1, 'quartz_ai', 7);
    INSERT INTO conversations VALUES (12, 'conv_terminal_one', 1, 'dashboard_terminal', NULL);
    INSERT INTO conversations VALUES (13, 'conv_terminal_two', 1, 'dashboard_terminal', NULL);
    INSERT INTO conversations VALUES (14, 'conv_garden_two', 1, 'garden_chat', 7);
    INSERT INTO conversations VALUES (15, 'conv_other_garden', 1, 'garden_chat', 8);
    INSERT INTO conversations VALUES (16, 'conv_other_user', 2, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (20);
    INSERT INTO hermes_runs VALUES ('run_one', 20), ('run_two', 20);
    INSERT INTO conversation_messages(id, conversation_id, client_message_id) VALUES
      (100, 10, 'client_visualizer'),
      (101, 10, 'client_visualizer_revision');
  `);
  ensureArtifactSchema(database);
  return { root, filename, storage: path.join(root, "storage"), database };
}

function createInput(fixture, overrides = {}) {
  return {
    userId: 1,
    runtimeSessionId: 20,
    hermesSessionId: "oh_session",
    conversationId: 10,
    clusterId: 7,
    runId: "run_one",
    assistantMessageId: null,
    surface: "garden_chat",
    kind: "markdown",
    rendererId: "markdown",
    title: "Study report",
    filename: "study-report.md",
    content: "# Study report\n\nGrounded content.",
    database: fixture.database,
    storageRoot: fixture.storage,
    ...overrides,
  };
}

test("required artifact completion is exact to the run, renderer, source skill, and preview", () => {
  const fixture = artifactFixture();
  try {
    const artifact = createArtifact(createInput(fixture, {
      assistantMessageId: 100,
      kind: "html",
      rendererId: "interactive-visualizer",
      sourceSkill: "interactive-visualizer-in-chat",
      title: "Spherical coordinates",
      filename: "spherical-coordinates.html",
      content: '{"plan":{"mode":"3d"}}',
    }));
    const requirement = {
      runId: "run_one",
      conversationId: 10,
      assistantClientMessageId: "client_visualizer",
      kind: "html",
      rendererId: "interactive-visualizer",
      sourceSkill: "interactive-visualizer-in-chat",
      readyEventType: "artifact.completed",
      previewRequired: true,
      database: fixture.database,
    };

    assert.equal(hasReadyArtifactForRun(requirement), false);
    fixture.database.prepare(`
      UPDATE hermes_artifacts
      SET status = 'ready', preview_location = 'preview/index.html'
      WHERE id = ?
    `).run(artifact.id);
    assert.equal(
      hasReadyArtifactForRun(requirement),
      false,
      "a ready row without this turn's publication event is not completion",
    );
    recordArtifactPipelineEvent({
      artifact: {
        ...artifact,
        status: "ready",
        preview_location: "preview/index.html",
      },
      runId: "run_one",
      assistantMessageId: 100,
      type: "artifact.failed",
      status: "ready",
      version: artifact.current_version,
      payload: { revisionPreserved: true },
      database: fixture.database,
    });
    assert.equal(
      hasReadyArtifactForRun(requirement),
      false,
      "a failed revision cannot borrow the previous ready version",
    );
    recordArtifactPipelineEvent({
      artifact: {
        ...artifact,
        status: "ready",
        preview_location: "preview/index.html",
      },
      runId: "run_one",
      assistantMessageId: 100,
      type: "artifact.completed",
      status: "ready",
      version: artifact.current_version,
      payload: {},
      database: fixture.database,
    });
    assert.equal(hasReadyArtifactForRun(requirement), true);
    assert.equal(hasReadyArtifactForRun({ ...requirement, runId: "run_two" }), false);
    assert.equal(hasReadyArtifactForRun({
      ...requirement,
      assistantClientMessageId: "client_other",
    }), false);
    recordArtifactPipelineEvent({
      artifact: {
        ...artifact,
        status: "ready",
        preview_location: "preview/index.html",
      },
      runId: "run_two",
      assistantMessageId: 101,
      type: "artifact.completed",
      status: "ready",
      version: artifact.current_version,
      payload: { operation: "revise" },
      database: fixture.database,
    });
    assert.equal(hasReadyArtifactForRun({
      ...requirement,
      runId: "run_two",
      assistantClientMessageId: "client_visualizer_revision",
    }), true, "a current-run revision of an older artifact satisfies the contract");
    assert.equal(hasReadyArtifactForRun({
      ...requirement,
      sourceSkill: "interactive-visualizer",
    }), false);

    fixture.database.prepare(`
      UPDATE hermes_artifacts SET preview_location = NULL WHERE id = ?
    `).run(artifact.id);
    assert.equal(hasReadyArtifactForRun(requirement), false);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Garden artifacts follow the visible compatibility response after an old binding was duplicated", () => {
  const fixture = artifactFixture();
  try {
    fixture.database.exec(`
      INSERT INTO conversation_messages
        (id, conversation_id, client_message_id, role, content, created_at)
      VALUES
        (102, 10, 'garden-turn', 'assistant', 'The diagram is attached.', '2025-01-01T12:00:01.000Z'),
        (103, 10, 'legacy-chat-1', 'assistant', 'The diagram is attached.', '2025-01-01T12:00:00.000Z');
      INSERT INTO chat_sessions(id, conversation_id) VALUES (1, 10);
      INSERT INTO chat_messages
        (id, session_id, role, content, created_at, canonical_message_id)
      VALUES
        (1, 1, 'assistant', 'The diagram is attached.', '2025-01-01T12:00:00.000Z', 103);
    `);
    createArtifact(createInput(fixture, {
      assistantMessageId: 102,
      title: "Garden diagram",
    }));

    const [artifact] = listArtifactsForUser({
      userId: 1,
      conversationPublicId: "conv_garden",
      database: fixture.database,
    });
    assert.equal(
      presentArtifact(artifact).assistantMessageId,
      "msg_103",
      "the inline card follows the response id currently rendered by Garden Chat",
    );

    fixture.database.prepare(
      "UPDATE chat_messages SET canonical_message_id = 102 WHERE id = 1",
    ).run();
    const [repaired] = listArtifactsForUser({
      userId: 1,
      conversationPublicId: "conv_garden",
      database: fixture.database,
    });
    assert.equal(presentArtifact(repaired).assistantMessageId, "msg_102");
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("marking an artifact stores a palette slug and leaves its place in the archive", () => {
  const fixture = artifactFixture();
  try {
    const artifact = createArtifact(createInput(fixture, {
      conversationId: 12,
      clusterId: null,
      surface: "dashboard_terminal",
      title: "Kindle-style e-reader",
    }));
    assert.equal(presentArtifact(artifact).highlight, null, "a new artifact is unmarked");

    const marked = setArtifactHighlight({
      artifactId: artifact.id,
      userId: 1,
      conversationPublicId: "conv_terminal_one",
      highlight: "sage",
      database: fixture.database,
    });
    assert.equal(marked.highlight, "sage");
    assert.equal(presentArtifact(marked).highlight, "sage");
    // The archive is ordered by updated_at, so marking must not push a
    // months-old artifact back to the top of the list.
    assert.equal(marked.updated_at, artifact.updated_at);
    assert.equal(
      listArtifactsForUser({
        userId: 1,
        sourceSurface: "dashboard_terminal",
        database: fixture.database,
      })[0].highlight,
      "sage",
    );

    // null is the eraser.
    const cleared = setArtifactHighlight({
      artifactId: artifact.id,
      userId: 1,
      conversationPublicId: "conv_terminal_one",
      highlight: null,
      database: fixture.database,
    });
    assert.equal(cleared.highlight, null);

    // A slug from an older palette presents as unmarked rather than as a color
    // the archive cannot paint.
    fixture.database
      .prepare("UPDATE hermes_artifacts SET highlight = 'ultraviolet' WHERE id = ?")
      .run(artifact.id);
    assert.equal(
      presentArtifact(getArtifactForUser({
        artifactId: artifact.id,
        userId: 1,
        conversationPublicId: "conv_terminal_one",
        database: fixture.database,
      })).highlight,
      null,
    );

    // Ownership and the conversation the artifact belongs to are both re-checked
    // in the setter, not trusted from the caller.
    for (const wrong of [
      { userId: 2, conversationPublicId: "conv_terminal_one" },
      { userId: 1, conversationPublicId: "conv_terminal_two" },
    ]) {
      assert.throws(
        () => setArtifactHighlight({
          artifactId: artifact.id,
          highlight: "rose",
          database: fixture.database,
          ...wrong,
        }),
        /Artifact not found/,
      );
    }
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact archives aggregate chats while keeping Terminal and each Garden separate", () => {
  const fixture = artifactFixture();
  try {
    const gardenOne = createArtifact(createInput(fixture, { title: "Garden one" }));
    const gardenTwo = createArtifact(createInput(fixture, {
      conversationId: 14,
      title: "Garden two",
    }));
    const otherGarden = createArtifact(createInput(fixture, {
      conversationId: 15,
      clusterId: 8,
      title: "Other garden",
    }));
    const terminalOne = createArtifact(createInput(fixture, {
      conversationId: 12,
      clusterId: null,
      surface: "dashboard_terminal",
      title: "Terminal one",
    }));
    const terminalTwo = createArtifact(createInput(fixture, {
      conversationId: 13,
      clusterId: null,
      surface: "dashboard_terminal",
      title: "Terminal two",
    }));
    createArtifact(createInput(fixture, {
      userId: 2,
      conversationId: 16,
      clusterId: null,
      surface: "dashboard_terminal",
      title: "Other user's terminal",
    }));

    const terminalArchive = listArtifactsForUser({
      userId: 1,
      sourceSurface: "dashboard_terminal",
      database: fixture.database,
    });
    assert.deepEqual(
      new Set(terminalArchive.map((artifact) => artifact.id)),
      new Set([terminalOne.id, terminalTwo.id]),
    );

    const physicsArchive = listArtifactsForUser({
      userId: 1,
      gardenSlug: "physics",
      sourceSurface: "garden_chat",
      database: fixture.database,
    });
    assert.deepEqual(
      new Set(physicsArchive.map((artifact) => artifact.id)),
      new Set([gardenOne.id, gardenTwo.id]),
    );
    assert.equal(physicsArchive.some((artifact) => artifact.id === otherGarden.id), false);

    const conversationArchive = listArtifactsForUser({
      userId: 1,
      conversationPublicId: "conv_garden",
      database: fixture.database,
    });
    assert.deepEqual(conversationArchive.map((artifact) => artifact.id), [gardenOne.id]);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact lifecycle persists, streams safe events, and preserves revisions", async () => {
  const fixture = artifactFixture();
  try {
    let artifact = createArtifact(createInput(fixture));
    assert.equal(artifact.status, "generating");
    artifact = await renderArtifact({ artifact, runId: "run_one", assistantMessageId: null, database: fixture.database, storageRoot: fixture.storage });
    assert.equal(artifact.status, "ready");
    assert.match(readArtifactSource(artifact, 1, fixture.storage, fixture.database), /^# Study report/);
    const presented = presentArtifact(artifact);
    assert.equal(presented.previewAvailable, true);
    assert.equal(presented.downloadAvailable, true);
    assert.equal(JSON.stringify(presented).includes(fixture.storage), false);
    const events = listArtifactEventsAfter({ runId: "run_one", afterId: 0, database: fixture.database });
    assert.deepEqual(events.map((event) => event.type), [
      "artifact.created", "artifact.rendering", "artifact.preview_ready", "artifact.completed",
    ]);

    artifact = updateArtifactContent({
      artifact,
      content: "# Study report\n\nRevised content.",
      mode: "replace",
      runId: "run_two",
      assistantMessageId: null,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(artifact.current_version, 2);
    artifact = await renderArtifact({ artifact, runId: "run_two", assistantMessageId: null, database: fixture.database, storageRoot: fixture.storage });
    assert.equal(listArtifactVersions(artifact.id, fixture.database).length, 2);
    assert.match(readArtifactSource(artifact, 1, fixture.storage, fixture.database), /Grounded content/);
    assert.match(readArtifactSource(artifact, 2, fixture.storage, fixture.database), /Revised content/);

    fixture.database.close();
    const reopened = new Database(fixture.filename);
    ensureArtifactSchema(reopened);
    const survived = getArtifactForUser({ artifactId: artifact.id, userId: 1, conversationPublicId: "conv_garden", database: reopened });
    assert.equal(survived.current_version, 2);
    assert.throws(() => getArtifactForUser({ artifactId: artifact.id, userId: 2, conversationPublicId: "conv_garden", database: reopened }), /not found/i);
    reopened.close();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("DOCX, PDF, and sandbox-source HTML renderers produce real files", async () => {
  const fixture = artifactFixture();
  const officeRuntime = createOfficeRuntimeFixture();
  try {
    const cases = [
      { kind: "document", rendererId: "docx", filename: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", content: "Title\nBody" },
      { kind: "pdf", rendererId: "pdf", filename: "report.pdf", mimeType: "application/pdf", content: "Title\nBody" },
      { kind: "html", rendererId: "html", filename: "report.html", mimeType: "text/html; charset=utf-8", content: "<!doctype html><main><h1>Safe preview</h1></main>" },
    ];
    let index = 0;
    for (const item of cases) {
      const runId = index === 0 ? "run_one" : "run_two";
      if (index > 1) fixture.database.prepare("INSERT INTO hermes_runs VALUES (?, 20)").run("run_three");
      const effectiveRun = index > 1 ? "run_three" : runId;
      let artifact = createArtifact(createInput(fixture, { ...item, runId: effectiveRun, title: `${item.kind} report` }));
      artifact = await renderArtifact({
        artifact,
        runId: effectiveRun,
        assistantMessageId: null,
        database: fixture.database,
        storageRoot: fixture.storage,
        officeRuntimeControl: officeRuntime.control,
      });
      const output = artifactFile({ artifact, version: 1, purpose: "download", database: fixture.database, storageRoot: fixture.storage });
      const bytes = fs.readFileSync(output.path);
      if (item.rendererId === "docx") {
        const zip = new AdmZip(bytes);
        assert.ok(zip.getEntry("word/document.xml"));
        assert.ok(zip.getEntry("[Content_Types].xml"));
      } else if (item.rendererId === "pdf") assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      else assert.match(bytes.toString("utf8"), /<main>/);
      index += 1;
    }
  } finally {
    officeRuntime.cleanup();
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// The desktop stack hands the dashboard a supervisor control endpoint. That
// control plane serves service leases but no /v1/capabilities/<id>/lease route
// (native/runtime-cli/src/control.rs routes only /v1/services and /v1/leases),
// so any capability lease is answered 404. A local render is a file write and
// must never ask for one: with the lease in place every HTML artifact stayed
// "generating" behind an opaque 500 from artifact_render.
test("HTML renders locally without consulting the supervisor control plane", async () => {
  const fixture = artifactFixture();
  const controlRequests = [];
  const controlPlane = http.createServer((request, response) => {
    controlRequests.push(`${request.method} ${request.url}`);
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not-found"}');
  });
  await new Promise((resolve) => controlPlane.listen(0, "127.0.0.1", resolve));
  const previousUrl = process.env.BREADBOARD_SUPERVISOR_CONTROL_URL;
  const previousToken = process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = `http://127.0.0.1:${controlPlane.address().port}`;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "test-control-token-0123456789-abcdefghijklmnop";
  try {
    let artifact = createArtifact(createInput(fixture, {
      kind: "html",
      rendererId: "html",
      filename: "diagram.html",
      mimeType: "text/html; charset=utf-8",
      title: "Architecture diagram",
      content: "<!doctype html><main><svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg></main>",
    }));
    artifact = await renderArtifact({
      artifact,
      runId: "run_one",
      assistantMessageId: null,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(artifact.status, "ready");
    assert.equal(artifact.error_json, null);
    const output = artifactFile({ artifact, version: 1, purpose: "download", database: fixture.database, storageRoot: fixture.storage });
    assert.match(fs.readFileSync(output.path, "utf8"), /<svg viewBox="0 0 10 10">/);
    const events = listArtifactEventsAfter({ runId: "run_one", afterId: 0, database: fixture.database });
    assert.deepEqual(events.map((event) => event.type), [
      "artifact.created", "artifact.rendering", "artifact.preview_ready", "artifact.completed",
    ]);
    assert.deepEqual(controlRequests, []);
  } finally {
    if (previousUrl === undefined) delete process.env.BREADBOARD_SUPERVISOR_CONTROL_URL;
    else process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN;
    else process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = previousToken;
    await new Promise((resolve) => controlPlane.close(resolve));
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the Next server keeps PDFKit beside its runtime font assets", () => {
  const nextConfig = fs.readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(
    nextConfig,
    /serverExternalPackages:\s*\[[^\]]*['"]pdfkit['"][^\]]*\]/,
    "PDFKit must remain external because it loads Helvetica.afm relative to its package directory",
  );
});

test("artifact validation rejects traversal, bad MIME, oversized data, and unsupported video", () => {
  const fixture = artifactFixture();
  try {
    assert.throws(() => createArtifact(createInput(fixture, { filename: "../escape.md" })), /paths|traversal/i);
    assert.throws(() => createArtifact(createInput(fixture, { mimeType: "application/pdf" })), /MIME type/i);
    assert.throws(() => createArtifact(createInput(fixture, { content: "x".repeat(MAX_ARTIFACT_CONTENT_BYTES + 1) })), /exceeds/i);
    assert.throws(() => createArtifact(createInput(fixture, { kind: "video", rendererId: "video" })), /not available/i);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("generated media imports stay inside the authorized workspace and become ready artifacts", async () => {
  const fixture = artifactFixture();
  const workspace = path.join(fixture.root, "authorized-workspace");
  const outside = path.join(fixture.root, "outside.png");
  fs.mkdirSync(workspace, { recursive: true });
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=",
    "base64",
  );
  fs.writeFileSync(path.join(workspace, "result.png"), onePixelPng);
  fs.writeFileSync(outside, onePixelPng);
  try {
    const input = createInput(fixture, {
      kind: "image",
      title: "Generated image",
      filename: "generated.png",
    });
    const imported = await createImportedArtifact({
      ...input,
      authorizedRoot: workspace,
      filePath: "result.png",
      scrubProvenance: false,
    });
    assert.equal(imported.status, "ready");
    assert.equal(imported.kind, "image");
    assert.equal(imported.renderer_id, "image-file");
    assert.equal(imported.mime_type, "image/png");
    assert.equal(imported.originating_run_id, "run_one");
    assert.equal(imported.conversation_id, 10);
    const preview = artifactFile({
      artifact: imported,
      version: 1,
      purpose: "preview",
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.deepEqual(fs.readFileSync(preview.path), onePixelPng);
    await assert.rejects(
      () => createImportedArtifact({
        ...input,
        authorizedRoot: workspace,
        filePath: outside,
        scrubProvenance: false,
      }),
      /authorized workspace/i,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a current-turn HTML upload is imported byte-for-byte without a workspace path", async () => {
  const fixture = artifactFixture();
  const filesRoot = path.join(fixture.root, "chat-files");
  const blobId = `fil_${"d".repeat(32)}`;
  const original = Buffer.from(
    "<!doctype html><html><body><main data-source=\"upload\">Original HTML</main></body></html>\n",
  );
  try {
    fixture.database.exec("ALTER TABLE conversation_messages ADD COLUMN metadata TEXT");
    const storedPath = storedFileBlobPath({ userId: 1, blobId, format: "html", root: filesRoot });
    fs.writeFileSync(storedPath, original);
    fixture.database.prepare(`
      INSERT INTO conversation_messages(
        id, conversation_id, client_message_id, role, metadata
      ) VALUES (?, ?, ?, 'user', ?)
    `).run(
      120,
      10,
      "client_upload_html",
      JSON.stringify({
        attachments: [{ type: "file", name: "landing.html", blobId, format: "html", sizeBytes: original.byteLength }],
      }),
    );

    const artifact = await createArtifactFromUpload({
      userId: 1,
      runtimeSessionId: 20,
      hermesSessionId: "oh_session",
      conversationId: 10,
      clusterId: 7,
      runId: "run_one",
      assistantMessageId: null,
      surface: "garden_chat",
      clientMessageId: "client_upload_html",
      attachmentName: "landing.html",
      sourceHermesTool: "artifact_import",
      database: fixture.database,
      storageRoot: fixture.storage,
      attachmentStorageRoots: { files: filesRoot },
    });

    assert.equal(artifact.status, "ready");
    assert.equal(artifact.kind, "html");
    assert.equal(artifact.renderer_id, "html-file");
    assert.equal(artifact.filename, "landing.html");
    assert.equal(artifact.title, "landing");
    const download = artifactFile({
      artifact,
      version: 1,
      purpose: "download",
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.deepEqual(fs.readFileSync(download.path), original);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("plain HTML and unsafe SVG uploads remain saveable with safe preview policy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-upload-profiles-"));
  try {
    const htmlPath = path.join(root, "fragment.html");
    fs.writeFileSync(htmlPath, "A valid HTML text fragment");
    assert.deepEqual(inspectArtifactImport(htmlPath, "html"), {
      rendererId: "html-file",
      mimeType: "text/html; charset=utf-8",
      extension: ".html",
      previewAvailable: true,
    });

    const svgPath = path.join(root, "external.svg");
    fs.writeFileSync(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1" /></svg>',
    );
    assert.deepEqual(inspectArtifactImport(svgPath, "diagram"), {
      rendererId: "diagram-file",
      mimeType: "image/svg+xml",
      extension: ".svg",
      previewAvailable: false,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("malformed renderer input fails safely and emits artifact.failed", async () => {
  const fixture = artifactFixture();
  try {
    const draft = createArtifact(createInput(fixture, { content: "" }));
    const failed = await renderArtifact({ artifact: draft, runId: "run_one", assistantMessageId: null, database: fixture.database, storageRoot: fixture.storage });
    assert.equal(failed.status, "failed");
    assert.match(presentArtifact(failed).error.message, /empty/i);
    assert.equal(listArtifactEventsAfter({ runId: "run_one", afterId: 0, database: fixture.database }).at(-1).type, "artifact.failed");
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a Quartz conversation cannot read an artifact even when the owner is authenticated", () => {
  const fixture = artifactFixture();
  try {
    assert.throws(() => createArtifact(createInput(fixture, { conversationId: 11 })), /scope is invalid/i);
    const artifact = createArtifact(createInput(fixture));
    fixture.database.prepare("UPDATE hermes_artifacts SET conversation_id = 11 WHERE id = ?").run(artifact.id);
    assert.throws(
      () => getArtifactForUser({ artifactId: artifact.id, userId: 1, conversationPublicId: "conv_quartz", database: fixture.database }),
      /not found/i,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("MCP provenance is structured and secret-like metadata is removed", () => {
  const fixture = artifactFixture();
  try {
    const artifact = createArtifact(createInput(fixture));
    addArtifactProvenance({ artifactId: artifact.id, version: 1, sourceKind: "mcp", sourceServer: "research", sourceTool: "search", invocationId: "call_1", resourceMetadata: { url: "https://example.test", accessToken: "never-store" }, database: fixture.database });
    const row = fixture.database.prepare("SELECT * FROM hermes_artifact_provenance WHERE artifact_id = ?").get(artifact.id);
    assert.equal(row.source_server, "research");
    assert.equal(row.source_tool, "search");
    assert.equal(JSON.parse(row.resource_metadata).accessToken, undefined);
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("skill compatibility requires a reviewed, surface-compatible execution path", () => {
  const documentManifest = `---\nname: report-writer\ndescription: Creates document artifacts\nbreadboard:\n  category: document\n  surfaces: [garden_chat, interactive_terminal]\n  requiredTools: [artifact_create, artifact_update, artifact_render]\n  requiredArtifactKinds: [document, pdf]\n  requiredRuntimes: [docx-renderer, pdf-renderer]\n---`;
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: documentManifest, surface: "garden_chat" }).availability, "ready");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: documentManifest.replace("pdf-renderer", "pptx-renderer"), surface: "garden_chat" }).availability, "unavailable");
  const mcpManifest = documentManifest.replace(/\n---$/, "\n  requiredMcpServers: [research]\n---");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: mcpManifest, surface: "garden_chat" }).availability, "unavailable");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: mcpManifest, surface: "garden_chat", connectedMcpServers: ["research"] }).availability, "ready");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_coding_conditional", manifest: documentManifest, surface: "dashboard_terminal" }).availability, "ready");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_coding_conditional", manifest: documentManifest, surface: "garden_chat" }).availability, "ready");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_coding_conditional", manifest: "---\nname: scientific-python\n---", surface: "dashboard_terminal", reviewedScientificSource: true }).availability, "ready");
  assert.equal(resolveSkillCompatibility({ classification: "eligible_general", manifest: "---\nname: vague\n---", surface: "garden_chat" }).availability, "ready");

  const environmentManifest = `---
name: generated-image
description: Creates an image artifact
metadata: {"openclaw":{"envVars":[{"name":"IMAGE_API_KEY","required":true,"description":"Image provider key."}]}}
---`;
  const missingEnvironment = resolveSkillCompatibility({
    classification: "eligible_general",
    manifest: environmentManifest,
    name: "generated-image",
    description: "Creates an image artifact",
    surface: "garden_chat",
    configuredEnvironmentVariables: [],
  });
  assert.equal(missingEnvironment.availability, "unavailable");
  assert.equal(
    missingEnvironment.requirements.find((item) => item.id === "environment:IMAGE_API_KEY")?.action,
    "configure_environment",
  );
  assert.equal(resolveSkillCompatibility({
    classification: "eligible_general",
    manifest: environmentManifest,
    name: "generated-image",
    description: "Creates an image artifact",
    surface: "garden_chat",
    configuredEnvironmentVariables: ["IMAGE_API_KEY"],
  }).availability, "ready");

  const understanding = resolveSkillCompatibility({
    classification: "eligible_general",
    manifest: "---\nname: video-understanding\ndescription: Analyze a supplied video and summarize it\n---",
    name: "video-understanding",
    description: "Analyze a supplied video and summarize it",
    surface: "garden_chat",
  });
  assert.deepEqual(understanding.contract?.requiredArtifactKinds, []);
  const generator = resolveSkillCompatibility({
    classification: "eligible_general",
    manifest: "---\nname: video-generator\ndescription: Generate and export videos\n---",
    name: "video-generator",
    description: "Generate and export videos",
    surface: "garden_chat",
  });
  assert.deepEqual(generator.contract?.requiredArtifactKinds, ["video"]);
  assert.equal(generator.availability, "ready");

  const publisherRequirements = resolveSkillCompatibility({
    classification: "eligible_general",
    manifest: `---
name: bgpt-paper-search
description: Search scientific papers
compatibility: Requires the BGPT MCP server configured in the agent host and Python 3.11+ for local helpers.
---`,
    name: "bgpt-paper-search",
    description: "Search scientific papers",
    surface: "garden_chat",
    connectedMcpServers: [],
  });
  assert.equal(publisherRequirements.availability, "unavailable");
  assert.deepEqual(publisherRequirements.contract?.requiredMcpServers, ["bgpt"]);
  assert.equal(
    publisherRequirements.requirements.find((item) => item.id === "mcp:bgpt")?.action,
    "connect_mcp",
  );
  const compatibilityNote = publisherRequirements.requirements.find(
    (item) => item.type === "compatibility",
  );
  assert.equal(
    compatibilityNote?.detail,
    "Requires the BGPT MCP server configured in the agent host and Python 3.11+ for local helpers.",
  );
  assert.equal(compatibilityNote?.action, "use_opencode");

  const repairedFrontmatter = resolveSkillCompatibility({
    classification: "eligible_general",
    manifest: `---
name: hosted-science
description: Uses a hosted service (public demo): predict a result
compatibility: Python 3.10+; the hosted path is keyless.
metadata: {"openclaw":{"envVars":[{"name":"HOSTED_API_KEY","required":false,"description":"Optional higher quota."}]}}
---`,
    name: "hosted-science",
    description: "Uses a hosted service (public demo): predict a result",
    surface: "garden_chat",
    configuredEnvironmentVariables: [],
  });
  assert.equal(
    repairedFrontmatter.contract?.compatibilityNotes[0],
    "Python 3.10+; the hosted path is keyless.",
  );
  assert.equal(
    repairedFrontmatter.contract?.requiredEnvironmentVariables[0]?.required,
    false,
  );
});

test("Garden UI places Artifacts directly below media sources and Quartz contains no artifact UI", () => {
  const workspace = fs.readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  const mediaImport = workspace.indexOf("<GardenVideoImport");
  const artifacts = workspace.indexOf("Artifacts", mediaImport);
  assert.ok(mediaImport >= 0 && artifacts > mediaImport);
  assert.ok(
    workspace.slice(mediaImport, artifacts).length < 2_000,
    "Artifacts should be the next sidebar section after media sources",
  );
  assert.match(workspace, /event\.type\.startsWith\("artifact\."\)/);
  assert.match(workspace, /new CustomEvent\(ARTIFACT_BROWSER_EVENT, \{ detail: event \}\)/);
  assert.match(workspace, /<ArtifactPanel[\s\S]*?compact[\s\S]*?hideHeader[\s\S]*?gardenSlug=\{clusterSlug\}[\s\S]*?sourceSurface="garden_chat"[\s\S]*?\/>/);
  assert.doesNotMatch(workspace, /<ArtifactPanel compact gardenSlug=\{clusterSlug\} legacyChatSessionId=/);
  const panel = fs.readFileSync(new URL("../src/app/components/hermes/artifact-panel.tsx", import.meta.url), "utf8");
  const terminal = fs.readFileSync(new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url), "utf8");
  const viewer = fs.readFileSync(new URL("../src/app/components/hermes/artifact-viewer.tsx", import.meta.url), "utf8");
  assert.match(
    terminal,
    /<ArtifactPanel[\s\S]*?compact[\s\S]*?sourceSurface="dashboard_terminal"[\s\S]*?creationConversationId=\{session\.sessionId\}[\s\S]*?ensureCreationConversation=\{session\.ensureConversation\}[\s\S]*?\/>/,
  );
  assert.match(panel, /across Terminal chats/);
  assert.match(panel, /across this garden's chats/);
  assert.match(viewer, /sandbox=\{liveDeck \? "allow-scripts" : ""\}/);
  assert.match(`${panel}\n${viewer}`, /downloadAvailable/);
  const quartzPrompt = fs.readFileSync(new URL("../../hermes-config/system/quartz-assistant.md", import.meta.url), "utf8");
  const sharedPrompt = fs.readFileSync(new URL("../../hermes-config/system/assistant.md", import.meta.url), "utf8");
  assert.doesNotMatch(`${sharedPrompt}\n${quartzPrompt}`, /artifact/i);
});
