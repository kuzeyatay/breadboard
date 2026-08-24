import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function requiredPath(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by the parent fixture.`);
  return path.resolve(value);
}

const dashboardRoot = requiredPath("LEARN_WORKER_TEST_DASHBOARD_ROOT");
const realWorkerPath = requiredPath("LEARN_WORKER_TEST_REAL_WORKER_PATH");
const hookPath = requiredPath("LEARN_WORKER_TEST_HOOK_PATH");
const contentPath = requiredPath("QUARTZ_CONTENT_PATH");
const infoPath = requiredPath("LEARN_WORKER_TEST_INFO_PATH");
const startGatePath = process.env.LEARN_WORKER_TEST_START_GATE_PATH?.trim();
const runtimeRoot = path.resolve(dashboardRoot, "..", ".runtime", "learn-workers");
fs.mkdirSync(runtimeRoot, { recursive: true });

if (startGatePath) {
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const timer = setInterval(() => {
      if (fs.existsSync(startGatePath)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("The parent fixture was not released into its outer job."));
      }
    }, 25);
  });
}

const requestId = randomUUID();
const nonce = randomUUID();
const receiptPath = path.join(runtimeRoot, `learn-worker-${requestId}.ready.json`);
const concurrencyPath = path.join(runtimeRoot, "learn-worker.active.json");
const logPath = path.join(runtimeRoot, `learn-worker-${requestId}.log`);
const startupPath = path.join(runtimeRoot, `learn-worker-${requestId}.start.json`);
const startMessage = {
  protocolVersion: 1,
  type: "start",
  requestId,
  receiptPath,
  concurrencyPath,
  concurrencyNonce: nonce,
  request: {
    operation: "humanizer",
    gardenId: "generic-parent-death-garden",
    userId: 1,
    contentPath,
    enabled: true,
  },
  label: "parent-death fixture",
};
fs.writeFileSync(
  concurrencyPath,
  `${JSON.stringify({
    protocolVersion: 1,
    requestId,
    nonce,
    pid: process.pid,
    state: "launching",
  })}\n`,
  "utf8",
);

function publishInfo(childPid, message) {
  fs.writeFileSync(
    infoPath,
    `${JSON.stringify({ childPid, message, receiptPath, concurrencyPath })}\n`,
    "utf8",
  );
}

if (process.platform === "win32") {
  fs.writeFileSync(startupPath, `${JSON.stringify(startMessage)}\n`, "utf8");
  const { launchWindowsBreakawayProcess } = await import(
    "../../scripts/windows-breakaway-process.mjs"
  );
  const child = launchWindowsBreakawayProcess({
    applicationPath: process.execPath,
    args: [
      "--import",
      pathToFileURL(hookPath).href,
      realWorkerPath,
      "--breadboard-learn-start-file",
      startupPath,
    ],
    cwd: dashboardRoot,
    logPath,
  });
  const timer = setInterval(() => {
    let message;
    try {
      message = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    } catch {
      let status;
      try {
        status = child.status();
      } catch (error) {
        clearInterval(timer);
        console.error(error);
        process.exitCode = 1;
        return;
      }
      if (status.alive) return;
      clearInterval(timer);
      process.exitCode = 1;
      return;
    }
    if (message?.type !== "ready" || message.requestId !== requestId) return;
    clearInterval(timer);
    publishInfo(child.pid, message);
    child.close();
  }, 25);
} else {
  const logFd = fs.openSync(logPath, "a");
  let child;
  try {
    child = fork(realWorkerPath, [], {
      cwd: dashboardRoot,
      detached: true,
      windowsHide: true,
      execArgv: ["--import", pathToFileURL(hookPath).href],
      env: { ...process.env, QUARTZ_CONTENT_PATH: contentPath },
      stdio: ["ignore", logFd, logFd, "ipc"],
    });
  } finally {
    fs.closeSync(logFd);
  }

  fs.writeFileSync(
    concurrencyPath,
    `${JSON.stringify({
      protocolVersion: 1,
      requestId,
      nonce,
      pid: child.pid,
      state: "running",
    })}\n`,
    "utf8",
  );

  child.on("message", (message) => {
    if (message?.type !== "ready" || message.requestId !== requestId) return;
    publishInfo(child.pid, message);
  });

  child.send(startMessage);
}

// The test kills this parent only after the durable ready receipt is visible.
setInterval(() => {}, 60_000);
