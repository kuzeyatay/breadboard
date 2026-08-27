import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_REACH_COOKIE_BROWSERS,
  AGENT_REACH_COOKIE_PLATFORMS,
  AGENT_REACH_CREDENTIAL_KEYS,
  AGENT_REACH_INSTALL_TARGETS,
  executeAgentReachSetup,
  expectedAgentReachSetupInputCount,
  runAgentReachSetupCommand,
  validateAgentReachSetupRequest,
} from "../scripts/runtime-v2-agent-reach-setup-executor.mjs";
import {
  loadRuntimeV2AgentReachSetupLaunch,
  parseRuntimeV2AgentReachSetupStopRecord,
} from "../scripts/runtime-v2-agent-reach-setup-worker.mjs";

const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));

function source(relativePath) {
  return fs.readFileSync(path.join(dashboardRoot, ...relativePath.split("/")), "utf8");
}

function launchFixture(request, secret = null) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-reach-setup-v2-"));
  const jobId = "agent_reach_setup_job_1";
  const workerInstanceId = "worker_1";
  const jobRoot = path.join(dataRoot, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  const workspacePath = path.join(attemptRoot, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  const inputBlobs = [];
  if (secret !== null) {
    const blobId = "credential_1";
    const payload = Buffer.from(secret, "utf8");
    const relativePath = `runtime/jobs/${jobId}/inputs/${blobId}/payload`;
    const payloadPath = path.join(dataRoot, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(payloadPath), { recursive: true });
    fs.writeFileSync(payloadPath, payload);
    inputBlobs.push({
      blobId,
      relativePath,
      sizeBytes: payload.byteLength,
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
      displayName: "agent-reach-credential.txt",
      mediaType: "application/x-breadboard-secret",
    });
  }
  const manifest = {
    protocolVersion: 1,
    identity: { jobId, attempt: 1, workerInstanceId },
    executionScope: { userId: 7, gardenId: null, conversationId: null },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs,
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  };
  fs.writeFileSync(path.join(attemptRoot, "start.json"), `${JSON.stringify(manifest)}\n`);
  return { dataRoot, attemptRoot, manifest };
}

function fakeChild(onKill) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    onKill?.();
    setImmediate(() => child.emit("close", null));
    return true;
  };
  child.unref = () => undefined;
  return child;
}

test("Agent Reach setup accepts only its closed operation registries", () => {
  const install = { protocolVersion: 1, operation: "install", target: "exa" };
  const configure = { protocolVersion: 1, operation: "configure", key: "groq-key" };
  const cookies = {
    protocolVersion: 1,
    operation: "import-cookies",
    browser: "chrome",
    platform: "bilibili",
  };
  const doctor = { protocolVersion: 1, operation: "doctor", force: true };
  assert.deepEqual(validateAgentReachSetupRequest(install), install);
  assert.deepEqual(validateAgentReachSetupRequest(configure), configure);
  assert.deepEqual(validateAgentReachSetupRequest(cookies), cookies);
  assert.deepEqual(validateAgentReachSetupRequest(doctor), doctor);
  assert.equal(expectedAgentReachSetupInputCount(install), 0);
  assert.equal(expectedAgentReachSetupInputCount(configure), 1);
  assert.equal(expectedAgentReachSetupInputCount(cookies), 0);
  assert.equal(expectedAgentReachSetupInputCount(doctor), 0);
  assert.throws(
    () => validateAgentReachSetupRequest({ ...install, target: "npm", argv: ["install"] }),
    /request is invalid/i,
  );
  assert.throws(
    () => validateAgentReachSetupRequest({ ...configure, secret: "must-not-be-json" }),
    /request is invalid/i,
  );
  assert.throws(
    () => validateAgentReachSetupRequest({ ...cookies, browser: "arbitrary" }),
    /request is invalid/i,
  );
});

test("Agent Reach doctor observes only the managed Runtime layout", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-reach-doctor-"));
  const dataRoot = path.join(root, "data");
  const appRoot = path.join(root, "app");
  const workspacePath = path.join(dataRoot, "runtime", "jobs", "job", "workspace");
  const dashboardScriptsRoot = path.join(appRoot, "dashboard", "scripts");
  const sourceRoot = path.join(dataRoot, "runtime-v2", "toolchains", "agent-reach", "source");
  const python = path.join(
    dataRoot,
    "runtime-v2",
    "services",
    "agent-reach",
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  for (const directory of [
    path.join(appRoot, "agent-reach", "agent_reach"),
    path.join(sourceRoot, "agent_reach"),
    path.dirname(python),
    workspacePath,
    dashboardScriptsRoot,
  ]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(appRoot, "agent-reach", "agent_reach", "cli.py"), "# app source\n");
  fs.writeFileSync(path.join(sourceRoot, "agent_reach", "cli.py"), "# managed source\n");
  fs.writeFileSync(python, "managed python\n");
  let launch = null;
  try {
    const result = await executeAgentReachSetup(
      { protocolVersion: 1, operation: "doctor", force: true },
      {
        dataRoot,
        appRoot,
        workspacePath,
        dashboardScriptsRoot,
        platform: process.platform,
        env: { PATH: "", PATHEXT: ".EXE" },
        signal: new AbortController().signal,
        spawnImpl(command, argv, options) {
          launch = { command, argv, options };
          const child = fakeChild();
          setImmediate(() => {
            child.stdout.write(JSON.stringify({
              youtube: {
                name: "YouTube",
                status: "ok",
                message: "ready",
                tier: 0,
                backends: ["yt-dlp"],
                active_backend: "yt-dlp",
              },
            }));
            setImmediate(() => child.emit("close", 0));
          });
          return child;
        },
      },
    );
    assert.equal(path.resolve(launch.command), path.resolve(python));
    assert.deepEqual(launch.argv, ["-m", "agent_reach.cli", "doctor", "--json"]);
    assert.equal(result.available, true);
    assert.equal(result.channels[0].channel, "youtube");
    assert.equal(result.channels[0].activeBackend, "yt-dlp");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Agent Reach setup worker binds scope, identity, workspace, and sealed input metadata", () => {
  const request = { protocolVersion: 1, operation: "configure", key: "github-token" };
  const fixture = launchFixture(request, "sealed-example-token");
  try {
    const launch = loadRuntimeV2AgentReachSetupLaunch(["start.json"], fixture.attemptRoot);
    assert.deepEqual(launch.request, request);
    assert.equal(launch.executionScope.userId, 7);
    assert.equal(launch.inputBlobs.length, 1);
    assert.equal(launch.inputBlobs[0].mediaType, "application/x-breadboard-secret");

    fs.writeFileSync(
      path.join(fixture.attemptRoot, "start.json"),
      `${JSON.stringify({
        ...fixture.manifest,
        executionScope: { userId: 7, gardenId: 2, conversationId: null },
      })}\n`,
    );
    assert.throws(
      () => loadRuntimeV2AgentReachSetupLaunch(["start.json"], fixture.attemptRoot),
      /user-global scope/i,
    );
  } finally {
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});

test("Agent Reach setup worker rejects missing, extra, and mislabeled secret blobs", () => {
  for (const [request, secret, mutation, pattern] of [
    [
      { protocolVersion: 1, operation: "configure", key: "proxy" },
      null,
      (manifest) => manifest,
      /wrong number of inputs/i,
    ],
    [
      { protocolVersion: 1, operation: "install", target: "exa" },
      "extra",
      (manifest) => manifest,
      /wrong number of inputs/i,
    ],
    [
      { protocolVersion: 1, operation: "configure", key: "proxy" },
      "secret",
      (manifest) => ({
        ...manifest,
        inputBlobs: manifest.inputBlobs.map((blob) => ({ ...blob, displayName: "request.txt" })),
      }),
      /sealed Agent Reach credential is invalid/i,
    ],
  ]) {
    const fixture = launchFixture(request, secret);
    try {
      fs.writeFileSync(
        path.join(fixture.attemptRoot, "start.json"),
        `${JSON.stringify(mutation(fixture.manifest))}\n`,
      );
      assert.throws(
        () => loadRuntimeV2AgentReachSetupLaunch(["start.json"], fixture.attemptRoot),
        pattern,
      );
    } finally {
      fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
    }
  }
});

test("Agent Reach setup worker accepts exactly one graceful stop record", () => {
  assert.deepEqual(parseRuntimeV2AgentReachSetupStopRecord('{"type":"stop","force":false}\n'), {
    type: "stop",
    force: false,
  });
  assert.throws(
    () => parseRuntimeV2AgentReachSetupStopRecord('{"type":"stop","force":true}\n'),
    /invalid/i,
  );
  assert.throws(() => parseRuntimeV2AgentReachSetupStopRecord("not-json\n"), /invalid/i);
});

test("Agent Reach setup command cancellation kills the attached child and bounds output", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-reach-command-"));
  const executable = path.join(root, process.platform === "win32" ? "tool.exe" : "tool");
  fs.writeFileSync(executable, "fixed executable");
  try {
    const abort = new AbortController();
    let killed = false;
    const cancellingChild = fakeChild(() => { killed = true; });
    const cancelled = runAgentReachSetupCommand(executable, ["fixed"], {
      cwd: root,
      env: { PATH: root, PATHEXT: ".EXE" },
      signal: abort.signal,
      timeoutMs: 5_000,
      spawnImpl: () => cancellingChild,
    });
    abort.abort(new DOMException("cancelled", "AbortError"));
    await assert.rejects(cancelled, /cancelled/i);
    assert.equal(killed, true);

    const noisyChild = fakeChild();
    const bounded = runAgentReachSetupCommand(executable, ["fixed"], {
      cwd: root,
      env: { PATH: root, PATHEXT: ".EXE" },
      signal: new AbortController().signal,
      timeoutMs: 5_000,
      spawnImpl: () => noisyChild,
    });
    noisyChild.stdout.write("x".repeat(128 * 1024));
    noisyChild.stderr.write("y".repeat(128 * 1024));
    noisyChild.emit("close", 0);
    const result = await bounded;
    assert.ok(Buffer.byteLength(result.stdout, "utf8") <= 32 * 1024);
    assert.ok(Buffer.byteLength(result.stderr, "utf8") <= 32 * 1024);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard and Runtime Agent Reach setup registries stay in parity", async () => {
  const setup = await import("../src/lib/agent-reach/setup.ts");
  const catalog = setup.setupCatalog();
  assert.deepEqual(catalog.installs.map((entry) => entry.id), AGENT_REACH_INSTALL_TARGETS);
  assert.deepEqual(catalog.credentials.map((entry) => entry.key).sort(), [...AGENT_REACH_CREDENTIAL_KEYS].sort());
  assert.deepEqual(catalog.browsers, AGENT_REACH_COOKIE_BROWSERS);
  assert.deepEqual(catalog.platforms, AGENT_REACH_COOKIE_PLATFORMS);
});

test("Next Agent Reach setup has no subprocess or credential-in-JSON fallback", () => {
  const setup = source("src/lib/agent-reach/setup.ts");
  const route = source("src/app/api/agent-reach/setup/route.ts");
  const client = source("src/lib/runtime-v2/agent-reach-setup-job.ts");
  const health = source("src/app/api/agent-reach/health/route.ts");
  const executor = source("scripts/runtime-v2-agent-reach-setup-executor.mjs");
  const helper = source("scripts/runtime-v2-agent-reach-configure.py");
  assert.doesNotMatch(setup, /node:child_process|from ["']child_process["']|\bspawn\s*\(/u);
  assert.match(setup, /runAgentReachSetupJob/u);
  assert.match(route, /install\(body\.target, userId, request\.signal\)/u);
  assert.match(route, /configure\(body\.key, body\.value, userId, request\.signal\)/u);
  assert.match(client, /reserveRuntimeJobInput/u);
  assert.match(client, /uploadRuntimeJobInput/u);
  assert.match(client, /application\/x-breadboard-secret/u);
  assert.match(client, /runAgentReachDoctorJob/u);
  assert.match(health, /runAgentReachDoctorJob/u);
  assert.doesNotMatch(health, /agent-reach\/runtime|\bdoctor\s*\(/u);
  assert.doesNotMatch(client, /requestPayload:\s*\{[^}]*secret/su);
  assert.match(executor, /\[helper, "configure", request\.key, context\.inputPath\]/u);
  assert.match(executor, /DOCKER_CLI_PATH/u);
  assert.doesNotMatch(helper, /print\(\s*(value|payload)(?:\[[^\n]*\])?\s*[,)]/u);
});
