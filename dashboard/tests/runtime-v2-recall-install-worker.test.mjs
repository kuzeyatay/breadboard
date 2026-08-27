import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  RECALL_CLI_PACKAGE,
  RECALL_CLI_VERSION,
  buildRecallInstallPlan,
  executeRecallInstall,
} from "../scripts/runtime-v2-recall-install-executor.mjs";
import {
  loadRuntimeV2RecallInstallLaunch,
  parseRuntimeV2RecallInstallStopRecord,
} from "../scripts/runtime-v2-recall-install-worker.mjs";
import {
  RECALL_CLI_PACKAGE as CONFIG_PACKAGE,
  RECALL_CLI_VERSION as CONFIG_VERSION,
} from "../src/lib/recall/config.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-recall-install-worker.mjs",
);

function fixture() {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-recall-install-"),
  );
  const identity = {
    jobId: "job_recall_install",
    attempt: 1,
    workerInstanceId: "worker_recall_install",
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    "1",
    identity.workerInstanceId,
  );
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(
    path.join(jobRoot, "input.json"),
    `${JSON.stringify({ protocolVersion: 1, action: "install" })}\n`,
  );
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: { userId: 17, gardenId: null, conversationId: null },
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
  );
  return { dataRoot, identity, jobRoot, attemptRoot };
}

function installPinnedFixture(
  dataRoot,
  platform = process.platform,
  arch = process.arch,
) {
  const plan = buildRecallInstallPlan({
    dataRoot,
    platform,
    arch,
    env: process.env,
  });
  fs.mkdirSync(path.dirname(plan.binaryPath), { recursive: true });
  fs.writeFileSync(plan.binaryPath, "bounded-test-binary");
  fs.mkdirSync(path.dirname(plan.versionPath), { recursive: true });
  fs.writeFileSync(
    plan.versionPath,
    JSON.stringify({ version: RECALL_CLI_VERSION }),
  );
  return plan;
}

test("the worker's pinned package identity cannot drift from Recall config", () => {
  assert.equal(RECALL_CLI_PACKAGE, CONFIG_PACKAGE);
  assert.equal(RECALL_CLI_VERSION, CONFIG_VERSION);
});

test("the install plan is fixed, contained, non-detached, and strips Runtime secrets", () => {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-recall-plan-"),
  );
  try {
    const plan = buildRecallInstallPlan({
      dataRoot,
      platform: "win32",
      arch: "x64",
      env: {
        PATH: "C:\\Windows\\System32",
        SystemRoot: "C:\\Windows",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "must-not-escape",
        OPENAI_API_KEY: "must-not-escape-either",
      },
    });
    assert.equal(plan.command, "npm.cmd");
    assert.deepEqual(plan.args, [
      "install",
      "screenpipe@0.4.37",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ]);
    assert.equal(plan.shell, true);
    assert.equal(plan.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
    assert.equal(plan.env.OPENAI_API_KEY, undefined);
    assert.ok(plan.home.startsWith(dataRoot));
    assert.ok(plan.binaryPath.startsWith(dataRoot));
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("launch manifests bind authenticated user scope, identity paths, and zero blobs", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.dataRoot, { recursive: true, force: true }));
  const launch = loadRuntimeV2RecallInstallLaunch(
    ["start.json"],
    current.attemptRoot,
  );
  assert.equal(launch.identity.jobId, current.identity.jobId);
  assert.equal(launch.executionScope.userId, 17);
  assert.deepEqual(launch.request, { protocolVersion: 1, action: "install" });

  const manifestPath = path.join(current.attemptRoot, "start.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.inputBlobs = [{ blobId: "forged" }];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => loadRuntimeV2RecallInstallLaunch(["start.json"], current.attemptRoot),
    /unsupported shape/u,
  );
});

test("the cancellation record is exact and bounded", () => {
  assert.deepEqual(
    parseRuntimeV2RecallInstallStopRecord('{"type":"stop","force":false}\n'),
    { type: "stop", force: false },
  );
  assert.throws(
    () =>
      parseRuntimeV2RecallInstallStopRecord('{"type":"stop","force":true}\n'),
    /invalid/u,
  );
  assert.throws(
    () =>
      parseRuntimeV2RecallInstallStopRecord(
        '{"type":"stop","force":false,"extra":1}\n',
      ),
    /invalid/u,
  );
});

test("an already-installed pinned binary completes without launching npm", async (t) => {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-recall-existing-"),
  );
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const plan = installPinnedFixture(dataRoot);
  const result = await executeRecallInstall({
    dataRoot,
    signal: new AbortController().signal,
    spawnImpl: () => {
      throw new Error(
        "npm must not launch for an already installed pinned binary",
      );
    },
  });
  assert.deepEqual(result, {
    installed: true,
    version: RECALL_CLI_VERSION,
    changed: false,
  });
  assert.equal(
    JSON.parse(fs.readFileSync(plan.statusPath, "utf8")).phase,
    "installed",
  );
});

test("a fresh install launches one attached fixed npm child with a scrubbed environment", async (t) => {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-recall-fresh-"),
  );
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let launch = null;
  const spawnImpl = (command, args, options) => {
    launch = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      installPinnedFixture(dataRoot);
      child.emit("close", 0);
    });
    return child;
  };
  const result = await executeRecallInstall({
    dataRoot,
    signal: new AbortController().signal,
    env: {
      ...process.env,
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "secret-runtime-token",
      OPENAI_API_KEY: "secret-provider-token",
    },
    spawnImpl,
  });
  assert.equal(result.changed, true);
  assert.equal(launch.options.detached, false);
  assert.deepEqual(launch.args, [
    "install",
    `${RECALL_CLI_PACKAGE}@${RECALL_CLI_VERSION}`,
    "--no-audit",
    "--no-fund",
    "--loglevel=error",
  ]);
  assert.equal(
    launch.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN,
    undefined,
  );
  assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
});

test("cancellation terminates the attached npm root and records interruption", async (t) => {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-recall-cancel-"),
  );
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const controller = new AbortController();
  let killed = false;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
      setImmediate(() => child.emit("close", null));
      return true;
    };
    setImmediate(() =>
      controller.abort(new DOMException("cancelled", "AbortError")),
    );
    return child;
  };
  await assert.rejects(
    executeRecallInstall({ dataRoot, signal: controller.signal, spawnImpl }),
    /cancelled/u,
  );
  assert.equal(killed, true);
  const plan = buildRecallInstallPlan({ dataRoot });
  assert.equal(
    JSON.parse(fs.readFileSync(plan.statusPath, "utf8")).phase,
    "interrupted",
  );
});

test("one fresh worker emits a fenced terminal event, writes its result, and exits", async (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.dataRoot, { recursive: true, force: true }));
  installPinnedFixture(current.dataRoot);
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: current.attemptRoot,
    env: { ...process.env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-32 * 1024);
  });
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The fresh Recall install worker did not exit."));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  const events = stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(events[0].type, "ready");
  assert.equal(events.at(-1).type, "complete");
  for (const event of events)
    assert.deepEqual(event.identity, current.identity);
  const result = JSON.parse(
    fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"),
  );
  assert.equal(result.result.installed, true);
  assert.equal(result.result.changed, false);
  assert.equal(result.completionSequence, events.at(-1).sequence);
});

test("Recall Next sources have no installer spawn, detach, unref, or process signal fallback", () => {
  const install = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "recall", "install.ts"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(
      dashboardRoot,
      "src",
      "app",
      "api",
      "recall",
      "install",
      "route.ts",
    ),
    "utf8",
  );
  for (const source of [install, route]) {
    assert.doesNotMatch(
      source,
      /child_process|\bspawn\s*\(|process\.kill\s*\(|detached\s*:\s*true|\.unref\s*\(/u,
    );
  }
  assert.match(install, /jobType:\s*"recall-install"/u);
  assert.match(route, /await startInstall\(userId, config\)/u);
});
