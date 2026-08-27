import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveRuntimeTerminalShell,
  validateTerminalCommandRequest,
} from "../scripts/runtime-v2-terminal-command-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-terminal-command-worker.mjs",
);
let fixtureSequence = 0;

function command(text) {
  return process.platform === "win32"
    ? `Write-Output '${text.replaceAll("'", "''")}'`
    : `printf '%s\\n' '${text.replaceAll("'", "'\\''")}'`;
}

function slowCommand() {
  return process.platform === "win32"
    ? "Start-Sleep -Seconds 30; Write-Output finished"
    : "sleep 30; printf 'finished\\n'";
}

function fixture(t, request) {
  const sequence = ++fixtureSequence;
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-terminal-worker-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const identity = {
    jobId: `job_terminal_${sequence}`,
    attempt: 1,
    workerInstanceId: `worker_terminal_${sequence}`,
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(path.join(attemptRoot, "start.json"), `${JSON.stringify({
    protocolVersion: 1,
    identity,
    executionScope: {
      userId: 7,
      gardenId: null,
      conversationId: "conv_terminal_worker",
    },
    inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
    inputBlobs: [],
    workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${identity.jobId}/result.json`,
  })}\n`);
  return { dataRoot, identity, jobRoot, attemptRoot };
}

async function runWorker(current, { stopAfterCheckpoint = false } = {}) {
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: current.attemptRoot,
    env: { ...process.env },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pid = child.pid;
  let stdout = "";
  let stderr = "";
  let buffered = "";
  let stopSent = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line && stopAfterCheckpoint && !stopSent) {
        const event = JSON.parse(line);
        if (event.type === "checkpoint") {
          stopSent = true;
          child.stdin.end('{"type":"stop","force":false}\n');
        }
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  if (!stopAfterCheckpoint) child.stdin.end();
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("The fresh Terminal worker did not exit."));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  const events = stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  return { pid, exit, events, stderr };
}

test("Terminal worker accepts only the closed command request and fixed shell", () => {
  const valid = {
    command: command("ok"),
    workspaceRoot: dashboardRoot,
    maxRuntimeMs: 30_000,
  };
  assert.equal(validateTerminalCommandRequest(valid), valid);
  assert.throws(
    () => validateTerminalCommandRequest({ ...valid, workspaceRoot: "relative" }),
    /canonical Terminal command request/,
  );
  assert.throws(
    () => validateTerminalCommandRequest({ ...valid, executable: "arbitrary.exe" }),
    /canonical Terminal command request/,
  );
  const shell = resolveRuntimeTerminalShell();
  assert.equal(path.isAbsolute(shell), true);
  assert.equal(fs.existsSync(shell), true);

  const compatibility = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "hermes", "terminal-execution.ts"),
    "utf8",
  );
  assert.doesNotMatch(compatibility, /node:child_process|\bspawn\s*\(/u);
  assert.match(compatibility, /submitRuntimeJob/);
  assert.match(compatibility, /terminal-command-node/);
});

test("each Terminal command uses a fresh one-job worker and fenced output", async (t) => {
  const first = fixture(t, {
    command: command("runtime-terminal-first"),
    workspaceRoot: dashboardRoot,
    maxRuntimeMs: 30_000,
  });
  const second = fixture(t, {
    command: command("runtime-terminal-second"),
    workspaceRoot: dashboardRoot,
    maxRuntimeMs: 30_000,
  });
  const one = await runWorker(first);
  const two = await runWorker(second);
  assert.equal(one.exit.code, 0, one.stderr);
  assert.equal(two.exit.code, 0, two.stderr);
  assert.notEqual(one.pid, two.pid);
  for (const [current, run, expected] of [
    [first, one, "runtime-terminal-first"],
    [second, two, "runtime-terminal-second"],
  ]) {
    assert.deepEqual(run.events.map((event) => event.type), [
      "ready",
      "checkpoint",
      "complete",
    ]);
    assert.ok(run.events.every((event) =>
      JSON.stringify(event.identity) === JSON.stringify(current.identity)));
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(current.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.deepEqual(checkpoint.identity, current.identity);
    assert.equal(checkpoint.snapshot.running, true);
    const result = JSON.parse(
      fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"),
    );
    assert.deepEqual(result.identity, current.identity);
    assert.equal(result.completionSequence, run.events.at(-1).sequence);
    assert.equal(result.result.running, false);
    assert.equal(result.result.commandId, null);
    assert.equal(result.result.exitCode, 0);
    assert.match(result.result.stdout, new RegExp(expected));
  }
});

test("Terminal worker acknowledges Runtime cancellation and leaves no result", async (t) => {
  const current = fixture(t, {
    command: slowCommand(),
    workspaceRoot: dashboardRoot,
    maxRuntimeMs: 30_000,
  });
  const run = await runWorker(current, { stopAfterCheckpoint: true });
  assert.equal(run.exit.code, 0, run.stderr);
  assert.deepEqual(run.events.map((event) => event.type), [
    "ready",
    "checkpoint",
    "cancellation-acknowledged",
  ]);
  assert.equal(fs.existsSync(path.join(current.jobRoot, "result.json")), false);
});

test("Terminal worker enforces the command-specific wall-clock ceiling", async (t) => {
  const current = fixture(t, {
    command: slowCommand(),
    workspaceRoot: dashboardRoot,
    maxRuntimeMs: 1_200,
  });
  const run = await runWorker(current);
  assert.equal(run.exit.code, 0, run.stderr);
  const result = JSON.parse(
    fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"),
  ).result;
  assert.equal(result.running, false);
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.elapsedMs < 10_000, `elapsed ${result.elapsedMs}ms`);
});
