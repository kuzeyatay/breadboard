import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  executeAgentBrowserProfileOperation,
  validateAgentBrowserProfileExecutionScope,
  validateAgentBrowserProfileRequest,
} from "../scripts/runtime-v2-agent-browser-profile-executor.mjs";

const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, ...relativePath.split("/")), "utf8");

function fixture() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-profile-v2-"));
  const browser = path.join(dataRoot, "trusted-browser.exe");
  const systemRoot = path.join(dataRoot, "Windows");
  const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
  fs.mkdirSync(path.dirname(taskkill), { recursive: true });
  fs.writeFileSync(browser, "browser\n");
  fs.writeFileSync(taskkill, "taskkill\n");
  return { dataRoot, browser, systemRoot, taskkill };
}

function launch(dataRoot) {
  return {
    dataRoot,
    identity: { jobId: "profile_job_1", attempt: 1, workerInstanceId: "worker_1" },
    executionScope: { userId: 7, gardenId: null, conversationId: null },
    request: { protocolVersion: 1, operation: "open", startUrl: "https://example.com/" },
  };
}

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = () => true;
  return child;
}

test("browser profile accepts only a fixed user-global open request", () => {
  assert.deepEqual(
    validateAgentBrowserProfileRequest({
      protocolVersion: 1,
      operation: "open",
      startUrl: "https://example.com/",
    }),
    { protocolVersion: 1, operation: "open", startUrl: "https://example.com/" },
  );
  assert.throws(
    () => validateAgentBrowserProfileRequest({
      protocolVersion: 1,
      operation: "open",
      startUrl: "file:///etc/passwd",
    }),
    /start URL is invalid/i,
  );
  assert.throws(
    () => validateAgentBrowserProfileRequest({
      protocolVersion: 1,
      operation: "open",
      startUrl: null,
      executable: "chrome.exe",
    }),
    /request is invalid/i,
  );
  assert.deepEqual(
    validateAgentBrowserProfileExecutionScope({ userId: 7, gardenId: null, conversationId: null }),
    { userId: 7, gardenId: null, conversationId: null },
  );
});

test("Runtime owns an attached visible browser and publishes its exact fence", async () => {
  const { dataRoot, browser, systemRoot } = fixture();
  const child = fakeChild(4123);
  const calls = [];
  const checkpoints = [];
  try {
    const resultPromise = executeAgentBrowserProfileOperation(launch(dataRoot), new AbortController().signal, {
      env: {
        BREADBOARD_AGENT_BROWSER_PROFILE_BROWSER_PATH: browser,
        SystemRoot: systemRoot,
        USERPROFILE: path.join(dataRoot, "user"),
        APPDATA: path.join(dataRoot, "appdata"),
      },
      claimTimeoutMs: 0,
      readStatus: async () => null,
      checkpoint: (value) => checkpoints.push(value),
      spawnImpl(command, argv, options) {
        calls.push({ command, argv, options });
        setImmediate(() => child.emit("close", 0, null));
        return child;
      },
    });
    const result = await resultPromise;
    assert.equal(result.status, "closed");
    assert.equal(calls[0].command, browser);
    assert.equal(calls[0].options.detached, false);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.env.BREADBOARD_AGENT_BROWSER_PROFILE_BROWSER_PATH, undefined);
    assert.match(calls[0].argv[0], /^--user-data-dir=/u);
    assert.deepEqual(
      checkpoints[0],
      {
        status: "open",
        protocolVersion: 1,
        jobId: "profile_job_1",
        attempt: 1,
        workerInstanceId: "worker_1",
        userId: 7,
        pid: 4123,
        startedAt: checkpoints[0].startedAt,
        executable: browser,
      },
    );
    assert.equal(fs.existsSync(path.join(dataRoot, "agent-browser-signin.json")), false);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("Runtime cancellation asks Chromium to close and leaves native tree reaping authoritative", async () => {
  const { dataRoot, browser, systemRoot, taskkill } = fixture();
  const abort = new AbortController();
  const browserChild = fakeChild(8123);
  const calls = [];
  try {
    const resultPromise = executeAgentBrowserProfileOperation(launch(dataRoot), abort.signal, {
      env: {
        BREADBOARD_AGENT_BROWSER_PROFILE_BROWSER_PATH: browser,
        SystemRoot: systemRoot,
      },
      claimTimeoutMs: 0,
      readStatus: async () => null,
      checkpoint() { setImmediate(() => abort.abort(new DOMException("cancelled", "AbortError"))); },
      spawnImpl(command, argv, options) {
        calls.push({ command, argv, options });
        if (command === taskkill) {
          const closer = fakeChild(9001);
          setImmediate(() => {
            closer.emit("close", 0, null);
            browserChild.emit("close", null, "SIGTERM");
          });
          return closer;
        }
        return browserChild;
      },
    });
    const result = await resultPromise;
    assert.equal(result.status, "cancelled");
    assert.equal(calls[0].options.detached, false);
    assert.equal(calls[1].command, taskkill);
    assert.deepEqual(calls[1].argv, ["/PID", "8123"]);
    assert.doesNotMatch(calls[1].argv.join(" "), /\/F|\/T/u);
    assert.equal(fs.existsSync(path.join(dataRoot, "agent-browser-signin.json")), false);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("the profile API is process-free and delegates open/close to Runtime", () => {
  const route = source("src/app/api/agent-browser/browser-profile/route.ts");
  const profile = source("src/lib/agent-browser/browser-profile.ts");
  const client = source("src/lib/runtime-v2/agent-browser-profile-job.ts");
  assert.doesNotMatch(route, /node:child_process|\bspawn\s*\(|taskkill/u);
  assert.doesNotMatch(profile, /node:child_process|\bspawn\s*\(|taskkill/u);
  assert.match(route, /openAgentBrowserProfileWindow/u);
  assert.match(route, /closeAgentBrowserProfileWindow/u);
  assert.match(client, /jobType:\s*JOB_TYPE/u);
  assert.match(client, /cancelRuntimeJob/u);
  assert.match(client, /cancelRuntimeJobByIdempotencyKey/u);
  const close = client.slice(client.indexOf("export async function closeAgentBrowserProfileWindow"));
  assert.ok(
    close.indexOf("inspectRuntimeJob") < close.indexOf("cancelRuntimeJob(jobAuthority"),
    "close must verify the marker's complete Runtime fence before cancellation",
  );
  assert.match(close, /markerMatchesJob\(current, inspected, input\.userId\)/u);
});
