import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  describeChatmockLoginExit,
  executeChatmockLogin,
  extractChatmockAuthorizationUrl,
  validateChatmockLoginRequest,
} from "../scripts/runtime-v2-chatmock-login-executor.mjs";
import {
  loadRuntimeV2ChatmockLoginLaunch,
  parseRuntimeV2ChatmockLoginStopRecord,
} from "../scripts/runtime-v2-chatmock-login-worker.mjs";

const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));

function source(relativePath) {
  return fs.readFileSync(path.join(dashboardRoot, ...relativePath.split("/")), "utf8");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-chatmock-login-v2-"));
  const appRoot = path.join(root, "app");
  const chatmockRoot = path.join(appRoot, "chatmock");
  const runtimeBin = path.join(root, "runtime", "python");
  fs.mkdirSync(chatmockRoot, { recursive: true });
  fs.mkdirSync(runtimeBin, { recursive: true });
  fs.writeFileSync(path.join(chatmockRoot, "chatmock.py"), "# fixed entry\n");
  fs.writeFileSync(path.join(runtimeBin, "python.exe"), "runtime python\n");
  return { root, appRoot, runtimeBin };
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

test("ChatMock login accepts only the closed Runtime request", () => {
  assert.deepEqual(validateChatmockLoginRequest({ protocolVersion: 1, operation: "login" }), {
    protocolVersion: 1,
    operation: "login",
  });
  assert.throws(
    () => validateChatmockLoginRequest({ protocolVersion: 1, operation: "login", argv: [] }),
    /request is invalid/i,
  );
  assert.throws(
    () => validateChatmockLoginRequest({ protocolVersion: 1, operation: "logout" }),
    /request is invalid/i,
  );
});

test("ChatMock login worker launch is identity-bound and refuses input blobs", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-chatmock-launch-"));
  const jobId = "login_job_1";
  const workerInstanceId = "worker_1";
  const jobRoot = path.join(dataRoot, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(
    path.join(jobRoot, "input.json"),
    `${JSON.stringify({ protocolVersion: 1, operation: "login" })}\n`,
  );
  const manifest = {
    protocolVersion: 1,
    identity: { jobId, attempt: 1, workerInstanceId },
    executionScope: { userId: 7, gardenId: null, conversationId: null },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs: [],
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  };
  fs.writeFileSync(path.join(attemptRoot, "start.json"), `${JSON.stringify(manifest)}\n`);
  const launch = loadRuntimeV2ChatmockLoginLaunch(["start.json"], attemptRoot);
  assert.equal(launch.identity.jobId, jobId);
  assert.equal(launch.executionScope.userId, 7);
  assert.equal(launch.request.operation, "login");

  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({ ...manifest, inputBlobs: [{ blobId: "secret" }] })}\n`,
  );
  assert.throws(
    () => loadRuntimeV2ChatmockLoginLaunch(["start.json"], attemptRoot),
    /unsupported shape/i,
  );
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("ChatMock login worker accepts exactly one graceful stop record", () => {
  assert.deepEqual(parseRuntimeV2ChatmockLoginStopRecord('{"type":"stop","force":false}\n'), {
    type: "stop",
    force: false,
  });
  assert.throws(
    () => parseRuntimeV2ChatmockLoginStopRecord('{"type":"stop","force":true}\n'),
    /invalid/i,
  );
  assert.throws(() => parseRuntimeV2ChatmockLoginStopRecord("not-json\n"), /invalid/i);
});

test("ChatMock login executor launches only the staged source with fixed argv and reports URL progress", async () => {
  const { root, appRoot, runtimeBin } = fixture();
  const states = [];
  let launch = null;
  const child = fakeChild();
  const resultPromise = executeChatmockLogin(
    { protocolVersion: 1, operation: "login" },
    {
      appRoot,
      platform: "win32",
      env: { PATH: runtimeBin },
      signal: new AbortController().signal,
      onState: (state) => states.push(structuredClone(state)),
      spawnImpl(command, argv, options) {
        launch = { command, argv, options };
        setImmediate(() => {
          child.stdout.write(
            "https://auth.openai.com/oauth/authorize?client_id=app_x&code_challenge=abc&state=s\n",
          );
          setImmediate(() => child.emit("close", 0));
        });
        return child;
      },
    },
  );
  const result = await resultPromise;
  assert.equal(path.basename(launch.command).toLowerCase(), "python.exe");
  assert.deepEqual(launch.argv, [path.join(appRoot, "chatmock", "chatmock.py"), "login", "--no-browser"]);
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.detached, false);
  assert.equal(launch.options.env.PYTHONIOENCODING, "utf-8");
  assert.ok(states.some((state) => state.authorizationUrl?.includes("code_challenge=abc")));
  assert.equal(result.status, "completed");
  fs.rmSync(root, { recursive: true, force: true });
});

test("ChatMock login cancellation kills its attached child and returns cancelled", async () => {
  const { root, appRoot, runtimeBin } = fixture();
  const abort = new AbortController();
  let killed = false;
  const child = fakeChild(() => {
    killed = true;
  });
  const resultPromise = executeChatmockLogin(
    { protocolVersion: 1, operation: "login" },
    {
      appRoot,
      platform: "win32",
      env: { PATH: runtimeBin },
      signal: abort.signal,
      onState: () => undefined,
      spawnImpl: () => child,
    },
  );
  abort.abort(new DOMException("cancelled", "AbortError"));
  const result = await resultPromise;
  assert.equal(killed, true);
  assert.equal(result.status, "cancelled");
  assert.equal(result.authorizationUrl, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("ChatMock login URL and failure parsing stay bounded to the expected protocol", () => {
  assert.equal(
    extractChatmockAuthorizationUrl(
      "https://auth.openai.com/oauth/authorize?client_id=app_x&code_challenge=abc",
    ),
    "https://auth.openai.com/oauth/authorize?client_id=app_x&code_challenge=abc",
  );
  assert.equal(extractChatmockAuthorizationUrl("https://example.com/help"), null);
  assert.match(describeChatmockLoginExit(13, ""), /1455 is already in use/);
});

test("Next routes submit, poll, and cancel Runtime login without a subprocess fallback", () => {
  const client = source("src/lib/chatmock-login.ts");
  const route = source("src/app/api/chatmock/account/login/route.ts");
  assert.doesNotMatch(client, /node:child_process|from ["']child_process["']|\bspawn\s*\(/u);
  assert.match(client, /jobType:\s*["']chatmock-login["']/u);
  assert.match(client, /workerKind !== ["']chatmock-login-node["']/u);
  assert.match(client, /cancelRuntimeJob/u);
  assert.match(route, /startChatmockLogin\(userId, request\.signal\)/u);
  assert.match(route, /refreshChatmockLoginState\(userId\)/u);
  assert.match(route, /await cancelChatmockLogin\(userId\)/u);
});
