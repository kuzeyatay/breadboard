import { spawnSync } from "node:child_process";
import {
  MessageChannel,
  receiveMessageOnPort,
  Worker,
} from "node:worker_threads";

const GENERATED_VISUAL_BROWSER_CLEANUP_GRACE_MS = 5_000;
const GENERATED_VISUAL_BROWSER_WORKER_START_TIMEOUT_MS = 5_000;

export type GeneratedVisualBrowserCompletion =
  | "process_exit"
  | "observed_dom"
  | "observed_capture";

export interface GeneratedVisualObservedBrowserResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: { message?: string; code?: string | number };
  durationMs: number;
  timedOut: boolean;
  completion?: GeneratedVisualBrowserCompletion;
  browserExitedNaturally: boolean;
  cleanupMethod: "natural-exit" | "taskkill-tree" | "process-group-sigkill" | "process-kill";
  cleanupConfirmed: boolean;
}

export interface GeneratedVisualObservedBrowserInput {
  executable: string;
  args: string[];
  timeoutMs: number;
}

/**
 * The generated-visual API is intentionally synchronous, but `spawnSync` can
 * only observe browser-process exit. Edge occasionally finishes both headless
 * outputs and then stalls during teardown, which turns a completed capture into
 * an ETIMEDOUT. A worker lets us observe the two actual completion receipts
 * (the serialized DOM and Edge's exact screenshot byte count), terminate the
 * now-disposable process tree, and still return synchronously to the caller.
 */
const GENERATED_VISUAL_BROWSER_WORKER_SOURCE = String.raw`
"use strict";
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { workerData } = require("node:worker_threads");

const state = new Int32Array(workerData.state);
const resultPort = workerData.resultPort;
const input = workerData.input;
Atomics.store(state, 2, 1);
Atomics.notify(state, 2, 1);
const startedAt = Date.now();
const maxOutputBytes = 16 * 1024 * 1024;
const cleanupGraceMs = 2_500;
let stdout = "";
let stderr = "";
let stdoutBytes = 0;
let stderrBytes = 0;
let child = null;
let childClosed = false;
let exitStatus = null;
let exitSignal = null;
let completion;
let timedOut = false;
let failure;
let cleanupStarted = false;
let cleanupMethod = "process-kill";
let cleanupRequested = false;
let cleanupRequestSucceeded = false;
let cleanupTimer;
let operationTimer;
let delivered = false;
let bodyObserved = false;
let htmlCloseObserved = false;

function durationMs() {
  return Math.max(0, Date.now() - startedAt);
}

function stringifyError(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code !== "ESRCH";
  }
}

function terminateTree(pid) {
  cleanupRequested = true;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    cleanupMethod = "taskkill-tree";
    const killed = spawnSync(
      "taskkill",
      ["/pid", String(pid), "/T", "/F"],
      { encoding: "utf8", windowsHide: true, timeout: 2_000 },
    );
    return killed.status === 0 || !processExists(pid);
  }
  try {
    cleanupMethod = "process-group-sigkill";
    process.kill(-pid, "SIGKILL");
    return true;
  } catch (groupError) {
    try {
      cleanupMethod = "process-kill";
      process.kill(pid, "SIGKILL");
      return true;
    } catch (processError) {
      return !processExists(pid);
    }
  }
}

function clearTimers() {
  if (operationTimer) clearTimeout(operationTimer);
  if (cleanupTimer) clearTimeout(cleanupTimer);
}

function deliver(result) {
  if (delivered) return;
  delivered = true;
  clearTimers();
  try {
    resultPort.postMessage(result);
  } finally {
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0, 1);
    resultPort.close();
  }
}

function finishAfterCleanup() {
  const cleanupConfirmed = childClosed ||
    (cleanupRequestSucceeded && !processExists(child && child.pid));
  const observedCompletion = completion === "observed_dom" || completion === "observed_capture";
  const cleanupFailure = cleanupRequested && !cleanupConfirmed;
  const error = failure ?? (cleanupFailure
    ? { code: "ECLEANUP", message: "Browser process tree did not confirm cleanup" }
    : undefined);
  const terminalFailure = Boolean(error) || timedOut || cleanupFailure;
  const successfulObservedCompletion = observedCompletion && !terminalFailure;
  deliver({
    status: successfulObservedCompletion
      ? 0
      : (terminalFailure ? null : exitStatus),
    signal: successfulObservedCompletion
      ? null
      : (timedOut ? (exitSignal || "SIGTERM") : exitSignal),
    stdout,
    stderr,
    ...(error ? { error } : {}),
    durationMs: durationMs(),
    timedOut,
    ...(completion ? { completion } : {}),
    browserExitedNaturally: !cleanupRequested && childClosed,
    cleanupMethod: cleanupRequested ? cleanupMethod : "natural-exit",
    cleanupConfirmed,
  });
}

function beginCleanup() {
  if (cleanupStarted || delivered) return;
  cleanupStarted = true;
  cleanupRequestSucceeded = terminateTree(child && child.pid);
  if (childClosed || (cleanupRequestSucceeded && !processExists(child && child.pid))) {
    finishAfterCleanup();
    return;
  }
  cleanupTimer = setTimeout(finishAfterCleanup, cleanupGraceMs);
}

function completeDomObserved() {
  return bodyObserved && htmlCloseObserved;
}

function screenshotReceipt() {
  const screenshotArg = input.args.find((arg) => arg.startsWith("--screenshot="));
  if (!screenshotArg) return undefined;
  const screenshotPath = screenshotArg.slice("--screenshot=".length);
  const receipts = Array.from(stderr.matchAll(/(\d+)\s+bytes written to file\b/gi));
  const receipt = receipts.at(-1);
  if (!receipt) return false;
  const expectedBytes = Number(receipt[1]);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) return false;
  try {
    const stats = fs.statSync(screenshotPath);
    return stats.isFile() && stats.size === expectedBytes;
  } catch {
    return false;
  }
}

function observeCompletion() {
  if (cleanupStarted || delivered || !completeDomObserved()) return;
  const screenshotComplete = screenshotReceipt();
  if (screenshotComplete === undefined) {
    completion = "observed_dom";
    beginCleanup();
  } else if (screenshotComplete) {
    completion = "observed_capture";
    beginCleanup();
  }
}

function appendOutput(channel, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  const bytes = Buffer.byteLength(text);
  if (channel === "stdout") {
    stdoutBytes += bytes;
    if (stdoutBytes <= maxOutputBytes) {
      stdout += text;
      const inspectionTail = stdout.slice(-4_096).toLowerCase();
      bodyObserved ||= inspectionTail.includes("<body");
      htmlCloseObserved ||= inspectionTail.includes("</html>");
    }
  } else {
    stderrBytes += bytes;
    if (stderrBytes <= maxOutputBytes) stderr += text;
  }
  if (stdoutBytes > maxOutputBytes || stderrBytes > maxOutputBytes) {
    failure = {
      code: "ENOBUFS",
      message: "Browser output exceeded the bounded diagnostic buffer",
    };
    beginCleanup();
    return;
  }
  observeCompletion();
}

function failBeforeSpawn(error) {
  failure = {
    code: error && error.code ? String(error.code) : "ESPAWN",
    message: stringifyError(error),
  };
  deliver({
    status: null,
    signal: null,
    stdout,
    stderr,
    error: failure,
    durationMs: durationMs(),
    timedOut: false,
    browserExitedNaturally: false,
    cleanupMethod: "process-kill",
    cleanupConfirmed: true,
  });
}

try {
  child = spawn(input.executable, input.args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  Atomics.store(state, 1, child.pid || 0);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
  child.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
  child.once("error", (error) => {
    if (!cleanupStarted && !delivered) failBeforeSpawn(error);
  });
  child.once("close", (status, signal) => {
    childClosed = true;
    exitStatus = status;
    exitSignal = signal;
    if (cleanupStarted) {
      finishAfterCleanup();
      return;
    }
    completion = "process_exit";
    finishAfterCleanup();
  });
  operationTimer = setTimeout(() => {
    if (cleanupStarted || delivered) return;
    timedOut = true;
    failure = {
      code: "ETIMEDOUT",
      message: "Browser did not produce complete observable output before its deadline",
    };
    beginCleanup();
  }, input.timeoutMs);
} catch (error) {
  failBeforeSpawn(error);
}
`;

function killSupervisorBrowserProcess(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2_000,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The worker or browser already exited.
    }
  }
}

/** Run one isolated browser command while observing output completion rather
 * than conflating successful capture with graceful browser teardown. */
export function runObservedGeneratedVisualBrowserProcess(
  input: GeneratedVisualObservedBrowserInput,
): GeneratedVisualObservedBrowserResult {
  const startedAt = Date.now();
  const stateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
  const state = new Int32Array(stateBuffer);
  const { port1, port2 } = new MessageChannel();
  let worker: Worker;
  try {
    worker = new Worker(GENERATED_VISUAL_BROWSER_WORKER_SOURCE, {
      eval: true,
      workerData: {
        input,
        state: stateBuffer,
        resultPort: port2,
      },
      transferList: [port2],
    });
    worker.unref();
    port1.unref();
  } catch (error) {
    port1.close();
    port2.close();
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: {
        code: "EWORKER",
        message: error instanceof Error ? error.message : "Could not start browser supervisor",
      },
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut: false,
      browserExitedNaturally: false,
      cleanupMethod: "process-kill",
      cleanupConfirmed: true,
    };
  }

  Atomics.wait(
    state,
    2,
    0,
    GENERATED_VISUAL_BROWSER_WORKER_START_TIMEOUT_MS,
  );
  if (Atomics.load(state, 2) !== 1) {
    port1.close();
    void worker.terminate();
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: {
        code: "EWORKERSTARTTIMEOUT",
        message: "Browser supervisor worker did not start before its deadline",
      },
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut: false,
      browserExitedNaturally: false,
      cleanupMethod: "process-kill",
      cleanupConfirmed: true,
    };
  }
  Atomics.wait(
    state,
    0,
    0,
    input.timeoutMs + GENERATED_VISUAL_BROWSER_CLEANUP_GRACE_MS,
  );
  const message = receiveMessageOnPort(port1)?.message as
    | GeneratedVisualObservedBrowserResult
    | undefined;
  port1.close();
  if (Atomics.load(state, 0) !== 1 || !message) {
    const browserPid = Atomics.load(state, 1);
    killSupervisorBrowserProcess(browserPid);
    void worker.terminate();
    return {
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      error: {
        code: "ESUPERVISORTIMEOUT",
        message: "Browser supervisor did not finish bounded process-tree cleanup",
      },
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut: true,
      browserExitedNaturally: false,
      cleanupMethod: process.platform === "win32"
        ? "taskkill-tree"
        : "process-group-sigkill",
      cleanupConfirmed: false,
    };
  }
  void worker.terminate();
  return message;
}
