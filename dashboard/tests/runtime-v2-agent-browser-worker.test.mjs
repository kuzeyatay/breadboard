import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadRuntimeV2AgentBrowserLaunch,
  parseRuntimeV2AgentBrowserStopRecord,
} from "../scripts/runtime-v2-agent-browser-worker.mjs";
import {
  parseRuntimeV2AgentBrowserAuthProbe,
  sealRuntimeV2AgentBrowserCommand,
} from "../scripts/runtime-v2-agent-browser-executor.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-agent-browser-worker.mjs",
);

function fixture(
  modelBaseUrl,
  scope = {
    userId: 7,
    gardenId: null,
    conversationId: `abr_${"b".repeat(32)}`,
  },
  options = {},
) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-browser-worker-"));
  const identity = {
    jobId: `job_${"a".repeat(64)}`,
    attempt: 1,
    workerInstanceId: "worker_agent_browser_test",
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  const workspacePath = path.join(attemptRoot, "workspace");
  const fakePackage = path.join(dataRoot, "fake-agent-browser", "bin");
  const entry = path.join(fakePackage, "agent-browser.js");
  const browser = path.join(dataRoot, "fake-browser", "chrome.exe");
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(fakePackage, { recursive: true });
  fs.mkdirSync(path.dirname(browser), { recursive: true });
  fs.writeFileSync(
    entry,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      "const args = process.argv.slice(2);",
      'const tabIndex = args.indexOf("tab");',
      'const desktopTarget = `about:blank#breadboard-browser-agent=${process.env.AGENT_BROWSER_SESSION}`;',
      'if (tabIndex >= 0 && process.env.AGENT_BROWSER_CDP && args[tabIndex + 1] === "--json") {',
      '  process.stdout.write(JSON.stringify({ success: true, data: { tabs: [{ active: true, label: null, tabId: "t1", title: "Breadboard", type: "page", url: "http://127.0.0.1/dashboard" }, { active: false, label: null, tabId: "t2", title: "Agent Browser", type: "page", url: desktopTarget }] }, error: null }) + "\\n");',
      '} else if (tabIndex >= 0 && process.env.AGENT_BROWSER_CDP && args[tabIndex + 1] === "t2") {',
      '  fs.writeFileSync(path.join(process.env.HOME, "desktop-connect.json"), JSON.stringify({ args, cdp: process.env.AGENT_BROWSER_CDP, executable: process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? null, profile: process.env.AGENT_BROWSER_PROFILE ?? null }));',
      '  process.stdout.write("switched\\n");',
      '} else if (args.includes("get") && args.includes("url") && process.env.AGENT_BROWSER_CDP) {',
      '  process.stdout.write(desktopTarget + "\\n");',
      '} else if (args[0] === "screenshot") {',
      "  fs.writeFileSync(args[1], Buffer.from([137,80,78,71,13,10,26,10,1]));",
      '} else if (args.includes("eval") && ' + JSON.stringify(options.authRequired === true) + ') {',
      '  process.stdout.write(JSON.stringify(JSON.stringify({ required: true, url: "https://accounts.example.com/login", origin: "https://accounts.example.com", title: "Sign in" })) + "\\n");',
      '} else if (args[0] !== "close") {',
      '  process.stdout.write("command completed\\n");',
      "}",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(browser, "fake browser", "utf8");
  fs.writeFileSync(
    path.join(jobRoot, "input.json"),
    `${JSON.stringify({
      task: "Open the example page",
      provider: "chatmock",
      model: "test-model",
      modelBaseUrl,
      maxSteps: 4,
      timeoutMs: 20_000,
      approvalMode: "sensitive_actions",
      allowedDomains: [],
      engine: "chrome",
      browserMode: options.browserMode ?? "external",
      agentBrowserEntry: entry,
      browserExecutable: options.browserMode === "desktop" ? null : browser,
      profilePath: null,
    })}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: scope,
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
    "utf8",
  );
  return {
    dataRoot,
    identity,
    attemptRoot,
    artifactRoot: path.join(dataRoot, "agent-browser-artifacts", identity.jobId),
    workspacePath,
  };
}

function publishDesktopBrowserReceipt(current, cdpPort = 9_333) {
  const directory = path.join(current.dataRoot, "browser-agent-sessions");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, `${current.identity.jobId}.json`),
    `${JSON.stringify({
      protocolVersion: 1,
      runId: current.identity.jobId,
      cdpPort,
      targetUrl: `about:blank#breadboard-browser-agent=${current.identity.jobId}`,
      createdAt: new Date().toISOString(),
    })}\n`,
    "utf8",
  );
}

async function modelServer(handler) {
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body = `${body}${chunk}`;
    const value = await handler(JSON.parse(body));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function launchWorker(current) {
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: current.attemptRoot,
    env:
      process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
        : {},
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let protocolBuffer = "";
  let protocolError = null;
  const protocolEvents = [];
  const protocolWaiters = new Set();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`;
    protocolBuffer = `${protocolBuffer}${chunk}`;
    let newline;
    while ((newline = protocolBuffer.indexOf("\n")) >= 0) {
      const line = protocolBuffer.slice(0, newline).replace(/\r$/u, "");
      protocolBuffer = protocolBuffer.slice(newline + 1);
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
        protocolEvents.push(event);
      } catch (error) {
        protocolError = error;
      }
      for (const waiter of [...protocolWaiters]) {
        try {
          if (protocolError) {
            protocolWaiters.delete(waiter);
            waiter.reject(protocolError);
          } else if (waiter.predicate(event)) {
            protocolWaiters.delete(waiter);
            waiter.resolve(event);
          }
        } catch (error) {
          protocolWaiters.delete(waiter);
          waiter.reject(error);
        }
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Agent Browser worker did not exit.\n${stderr}`));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
  const waitForProtocolEvent = (predicate) => {
    const existing = protocolEvents.find(predicate);
    if (existing) return Promise.resolve(existing);
    if (protocolError) return Promise.reject(protocolError);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      protocolWaiters.add(waiter);
      void completed.then(
        (exit) => {
          if (!protocolWaiters.delete(waiter)) return;
          reject(new Error(`Agent Browser worker exited before the expected protocol event.\n${exit.stderr}`));
        },
        (error) => {
          if (!protocolWaiters.delete(waiter)) return;
          reject(error);
        },
      );
    });
  };
  return { child, completed, waitForProtocolEvent };
}

test("Agent Browser worker accepts only its exact user + agent scope and fixed paths", async () => {
  const server = await modelServer(() => ({ choices: [{ message: { role: "assistant", content: "done" } }] }));
  const valid = fixture(server.url);
  const wrongScope = fixture(server.url, {
    userId: 7,
    gardenId: "garden-1",
    conversationId: `abr_${"b".repeat(32)}`,
  });
  try {
    const launch = loadRuntimeV2AgentBrowserLaunch(["start.json"], valid.attemptRoot);
    assert.deepEqual(launch.executionScope, {
      userId: 7,
      gardenId: null,
      conversationId: `abr_${"b".repeat(32)}`,
    });
    assert.equal(launch.request.task, "Open the example page");
    assert.throws(
      () => loadRuntimeV2AgentBrowserLaunch(["start.json"], wrongScope.attemptRoot),
      /exact authenticated user and agent authority/u,
    );
    assert.throws(
      () => loadRuntimeV2AgentBrowserLaunch(["not-start.json"], valid.attemptRoot),
      /exactly start\.json/u,
    );
  } finally {
    fs.rmSync(valid.dataRoot, { recursive: true, force: true });
    fs.rmSync(wrongScope.dataRoot, { recursive: true, force: true });
    await server.close();
  }
});

test("Agent Browser worker stop input is exact and bounded", () => {
  assert.deepEqual(parseRuntimeV2AgentBrowserStopRecord('{"type":"stop","force":false}\n'), {
    type: "stop",
    force: false,
  });
  for (const value of [
    '{"type":"stop","force":true}\n',
    '{"type":"stop","force":false,"jobId":"forged"}\n',
    '{"type":"stop","force":false}',
    "{}\n",
  ]) {
    assert.throws(() => parseRuntimeV2AgentBrowserStopRecord(value), /stop record/u);
  }
});

test("desktop mode selects the visible Breadboard target without Edge or an external profile", async () => {
  const server = await modelServer(() => ({
    choices: [{ message: { role: "assistant", content: "done" } }],
  }));
  const current = fixture(server.url, undefined, { browserMode: "desktop" });
  publishDesktopBrowserReceipt(current);
  try {
    const launched = launchWorker(current);
    launched.child.stdin.end();
    const exit = await launched.completed;
    assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 0, signal: null }, exit.stderr);
    const connected = JSON.parse(
      fs.readFileSync(
        path.join(current.workspacePath, "runtime-home", "desktop-connect.json"),
        "utf8",
      ),
    );
    assert.equal(connected.cdp, "9333");
    assert.equal(connected.executable, null);
    assert.equal(connected.profile, null);
    assert.ok(connected.args.includes("t2"));
    assert.equal(connected.args.includes("--url"), false);
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
    await server.close();
  }
});

test("model commands cannot escape the sealed Runtime session or private workspace", () => {
  assert.deepEqual(
    sealRuntimeV2AgentBrowserCommand("agent-browser open https://example.com --json"),
    ["open", "https://example.com"],
  );
  for (const command of [
    "agent-browser --session sibling click @e1",
    "agent-browser open https://example.com --profile Default",
    "agent-browser connect 9222",
    "agent-browser close --all",
    "agent-browser upload @e1 C:\\Users\\person\\secret.txt",
    "agent-browser open file:///etc/passwd",
  ]) {
    assert.throws(
      () => sealRuntimeV2AgentBrowserCommand(command),
      /sealed browser-action surface|Runtime authority|sibling Runtime session|local worker file/u,
    );
  }
});

test("sign-in probes accept only a bounded, self-consistent web origin", () => {
  const payload = {
    required: true,
    url: "https://accounts.example.com/login?continue=%2Finbox",
    origin: "https://accounts.example.com",
    title: "Sign in",
  };
  assert.deepEqual(
    parseRuntimeV2AgentBrowserAuthProbe(JSON.stringify(JSON.stringify(payload))),
    {
      url: payload.url,
      origin: payload.origin,
      title: payload.title,
    },
  );
  assert.equal(
    parseRuntimeV2AgentBrowserAuthProbe(JSON.stringify({ ...payload, required: false })),
    null,
  );
  assert.equal(
    parseRuntimeV2AgentBrowserAuthProbe(
      JSON.stringify({ ...payload, origin: "https://lookalike.example" }),
    ),
    null,
  );
  assert.equal(
    parseRuntimeV2AgentBrowserAuthProbe(
      JSON.stringify({ ...payload, url: "file:///C:/Users/person/secret.txt" }),
    ),
    null,
  );
});

test("a detected sign-in page stops before a second model step and emits a durable handoff", async () => {
  let calls = 0;
  const server = await modelServer(() => {
    calls += 1;
    return {
      choices: [{
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "tool-auth",
            type: "function",
            function: {
              name: "agent_browser",
              arguments: JSON.stringify({ command: "agent-browser open https://example.com/inbox" }),
            },
          }],
        },
      }],
    };
  });
  const current = fixture(server.url, undefined, { authRequired: true });
  try {
    const launched = launchWorker(current);
    launched.child.stdin.end();
    const exit = await launched.completed;
    assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 1, signal: null }, exit.stderr);
    assert.equal(calls, 1);
    const artifact = JSON.parse(
      fs.readFileSync(path.join(current.artifactRoot, "run.json"), "utf8"),
    );
    assert.equal(artifact.status, "failed");
    const auth = artifact.events.find((event) => event.type === "auth.required");
    assert.deepEqual(auth?.payload, {
      url: "https://accounts.example.com/login",
      origin: "https://accounts.example.com",
      title: "Sign in",
    });
    assert.equal(artifact.events.at(-1)?.type, "run.failed");
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
    await server.close();
  }
});

test("one fresh worker owns the CLI, screenshots, durable replay, result, and exit", async () => {
  let calls = 0;
  const server = await modelServer(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        choices: [{
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "tool-1",
              type: "function",
              function: {
                name: "agent_browser",
                arguments: JSON.stringify({ command: "agent-browser open https://example.com" }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_800));
    return {
      choices: [{ message: { role: "assistant", content: "Example opened." } }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    };
  });
  const current = fixture(server.url);
  try {
    const launched = launchWorker(current);
    launched.child.stdin.end();
    const exit = await launched.completed;
    assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 0, signal: null }, exit.stderr);
    const protocolEvents = exit.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    assert.equal(protocolEvents[0]?.type, "ready");
    assert.ok(protocolEvents.some((event) => event.type === "checkpoint"));
    assert.equal(protocolEvents.at(-1)?.type, "complete");
    assert.ok(protocolEvents.every((event, index) => event.sequence === index + 1));

    const artifact = JSON.parse(fs.readFileSync(path.join(current.artifactRoot, "run.json"), "utf8"));
    assert.equal(artifact.status, "completed");
    assert.equal(artifact.scope.userId, 7);
    assert.equal(artifact.scope.agentId, `abr_${"b".repeat(32)}`);
    assert.ok(artifact.events.some((event) => event.type === "action.completed"));
    assert.ok(
      artifact.events.some((event) => event.type === "observation.screenshot"),
      JSON.stringify(artifact.events.map((event) => event.type)),
    );
    assert.equal(artifact.events.at(-1).type, "run.completed");
    const screenshot = artifact.events.findLast((event) => event.type === "observation.screenshot");
    assert.ok(
      fs.statSync(path.join(current.artifactRoot, "screenshots", `s${screenshot.payload.screenshotId}.png`)).size > 0,
    );
    const result = JSON.parse(
      fs.readFileSync(path.join(current.dataRoot, "runtime", "jobs", current.identity.jobId, "result.json"), "utf8"),
    );
    assert.deepEqual(result.identity, current.identity);
    assert.equal(result.completionSequence, protocolEvents.at(-1).sequence);
    assert.equal(result.run.status, "completed");
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
    await server.close();
  }
});

test("Runtime cancellation survives an approval wait and publishes no successful result", async () => {
  const server = await modelServer(() => ({
    choices: [{
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "tool-sensitive",
          type: "function",
          function: {
            name: "agent_browser",
            arguments: JSON.stringify({ command: "agent-browser click @e1" }),
          },
        }],
      },
    }],
  }));
  const current = fixture(server.url);
  try {
    const launched = launchWorker(current);
    const approvalWait = await launched.waitForProtocolEvent(
      (event) => event.type === "progress" && event.stage === "awaiting-approval",
    );
    assert.deepEqual(
      { current: approvalWait.current, total: approvalWait.total },
      { current: 0, total: 1 },
    );
    launched.child.stdin.write('{"type":"stop","force":false}\n');
    const exit = await launched.completed;
    assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 0, signal: null }, exit.stderr);
    const protocolEvents = exit.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    assert.ok(protocolEvents.some((event) => event.type === "cancellation-acknowledged"));
    assert.ok(!protocolEvents.some((event) => event.type === "complete"));
    const artifact = JSON.parse(fs.readFileSync(path.join(current.artifactRoot, "run.json"), "utf8"));
    assert.equal(artifact.status, "aborted");
    assert.equal(artifact.pendingApproval, null);
    assert.ok(artifact.events.some((event) => event.type === "approval.requested"));
    assert.equal(artifact.events.at(-1).type, "run.aborted");
    assert.equal(
      fs.existsSync(path.join(current.dataRoot, "runtime", "jobs", current.identity.jobId, "result.json")),
      false,
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
    await server.close();
  }
});

test("Next has no browser/agent subprocess fallback after the Runtime V2 cutover", () => {
  const manager = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "agent-browser", "run-manager.ts"),
    "utf8",
  );
  const service = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "agent-browser", "service.ts"),
    "utf8",
  );
  const executor = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-agent-browser-executor.mjs"),
    "utf8",
  );
  assert.doesNotMatch(manager, /node:child_process|\bspawn\s*\(/u);
  assert.doesNotMatch(service, /node:child_process|\bspawn\s*\(/u);
  assert.match(manager, /submitRuntimeJob/u);
  assert.match(manager, /cancelRuntimeJob/u);
  assert.match(manager, /jobType: JOB_TYPE/u);
  assert.match(manager, /conversationId: agentId/u);
  assert.match(executor, /from "node:child_process"/u);
  assert.match(executor, /process\.argv\.length !== 3/u);
  assert.match(executor, /MAX_SCREENSHOT_TOTAL_BYTES/u);
  assert.match(executor, /agent-browser-artifacts/u);
});
