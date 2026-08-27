import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";
import {
  createSealedRuntimeV2AgentBrowserExecutor,
  validateRuntimeV2AgentBrowserRequest,
} from "./runtime-v2-agent-browser-executor.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
const MAX_FAILURE_MESSAGE_BYTES = 8 * 1024;
const HEARTBEAT_INTERVAL_MS = 5_000;
const SANITIZED_RUNTIME_FAILURE_MESSAGE = "Runtime job execution failed.";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const ENTRYPOINT_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function readBoundedJson(filePath, maximumBytes, label) {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} is not a direct regular file.`);
  }
  if (metadata.size < 1 || metadata.size > maximumBytes) {
    fail(`${label} is outside its bounded size.`);
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) {
    fail(`${label} changed while it was being read.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function validateIdentity(value) {
  if (
    !hasExactKeys(value, ["jobId", "attempt", "workerInstanceId"]) ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) {
    fail("The Runtime V2 Agent Browser worker identity is invalid.");
  }
  return {
    jobId: value.jobId,
    attempt: value.attempt,
    workerInstanceId: value.workerInstanceId,
  };
}

function validateExecutionScope(value) {
  if (
    !hasExactKeys(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    typeof value.conversationId !== "string" ||
    Buffer.byteLength(value.conversationId, "utf8") > 256 ||
    !/^abr_[0-9a-f]{32}$/u.test(value.conversationId)
  ) {
    fail("Agent Browser requires exact authenticated user and agent authority.");
  }
  return {
    userId: value.userId,
    gardenId: null,
    conversationId: value.conversationId,
  };
}

function expectedWorkerPaths(identity) {
  const jobRoot = `runtime/jobs/${identity.jobId}`;
  const attemptRoot = `${jobRoot}/attempts/${identity.attempt}/${identity.workerInstanceId}`;
  return {
    attemptRoot,
    inputManifestPath: `${jobRoot}/input.json`,
    workspacePath: `${attemptRoot}/workspace`,
    checkpointPath: `${jobRoot}/checkpoint.json`,
    resultPath: `${jobRoot}/result.json`,
  };
}

function resolveDataPath(dataRoot, relativePath) {
  const segments = relativePath.split("/");
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || segment.includes("\\"),
    )
  ) {
    fail("The worker start manifest contains an invalid relative path.");
  }
  const resolved = path.resolve(dataRoot, ...segments);
  if (!pathWithin(dataRoot, resolved)) {
    fail("The worker start manifest path escaped the Runtime V2 data root.");
  }
  return resolved;
}

export function loadRuntimeV2AgentBrowserLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The Runtime V2 Agent Browser worker requires exactly start.json.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The worker start manifest",
  );
  if (
    !hasExactKeys(manifest, [
      "protocolVersion",
      "identity",
      "executionScope",
      "inputManifestPath",
      "inputBlobs",
      "workspacePath",
      "checkpointPath",
      "resultPath",
    ]) ||
    manifest.protocolVersion !== PROTOCOL_VERSION
  ) {
    fail("The Agent Browser start manifest has an unsupported shape.");
  }
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  if (!Array.isArray(manifest.inputBlobs) || manifest.inputBlobs.length !== 0) {
    fail("The Runtime V2 Agent Browser worker does not accept input blobs.");
  }
  const expected = expectedWorkerPaths(identity);
  for (const field of [
    "inputManifestPath",
    "workspacePath",
    "checkpointPath",
    "resultPath",
  ]) {
    if (manifest[field] !== expected[field]) {
      fail(`The Agent Browser ${field} is not bound to its exact worker identity.`);
    }
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (
    !samePath(
      canonicalLaunchDirectory,
      resolveDataPath(dataRoot, expected.attemptRoot),
    )
  ) {
    fail("The Agent Browser launch directory is not bound to its start identity.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("The Agent Browser private worker workspace is unavailable.");
  }
  const inputPath = resolveDataPath(dataRoot, manifest.inputManifestPath);
  return {
    dataRoot,
    identity,
    executionScope,
    workspacePath,
    checkpointPath: resolveDataPath(dataRoot, manifest.checkpointPath),
    checkpointRelativePath: manifest.checkpointPath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
    request: validateRuntimeV2AgentBrowserRequest(
      readBoundedJson(
        inputPath,
        MAX_INPUT_MANIFEST_BYTES,
        "The canonical Agent Browser request",
      ),
    ),
  };
}

export function parseRuntimeV2AgentBrowserStopRecord(line) {
  if (
    typeof line !== "string" ||
    Buffer.byteLength(line, "utf8") > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) {
    fail("The Runtime V2 Agent Browser stop record is invalid.");
  }
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The Runtime V2 Agent Browser stop record is not valid JSON.");
  }
  if (
    !hasExactKeys(value, ["type", "force"]) ||
    value.type !== "stop" ||
    value.force !== false
  ) {
    fail("The Runtime V2 Agent Browser stop record is invalid.");
  }
  return value;
}

function startStopInput(onStop, onProtocolFault) {
  let buffered = "";
  let stopRequested = false;
  let poisoned = false;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (poisoned) return;
    buffered += chunk;
    if (Buffer.byteLength(buffered, "utf8") > MAX_STOP_RECORD_BYTES) {
      poisoned = true;
      onProtocolFault(new Error("The Agent Browser stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2AgentBrowserStopRecord(line);
      if (remainder.length > 0 || stopRequested) {
        fail("The Agent Browser worker received more than one stop record.");
      }
      stopRequested = true;
      onStop();
    } catch (error) {
      poisoned = true;
      onProtocolFault(error);
    }
  });
  process.stdin.resume();
  return {
    requested: () => stopRequested,
    close: () => {
      process.stdin.removeAllListeners("data");
      process.stdin.pause();
    },
  };
}

function boundedFailureMessage(error) {
  const raw =
    error && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : String(error);
  const bytes = Buffer.from(raw || "Agent Browser execution failed.", "utf8");
  if (bytes.byteLength <= MAX_FAILURE_MESSAGE_BYTES) return bytes.toString("utf8");
  return bytes
    .subarray(0, MAX_FAILURE_MESSAGE_BYTES)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
}

function writeResultOnce(resultPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The durable Agent Browser result exceeded its bounded envelope.");
  }
  const parent = path.dirname(resultPath);
  const metadata = fs.lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("The durable Agent Browser result directory is unavailable.");
  }
  try {
    fs.lstatSync(resultPath);
    fail("The durable Agent Browser result already exists.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryPath = `${resultPath}.pending.${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, resultPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function yieldForSupervisorInput() {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function runRuntimeV2AgentBrowserWorker() {
  // Runtime protocol owns stdout. Keep all application diagnostics on stderr.
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  const launch = loadRuntimeV2AgentBrowserLaunch();
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "browser-automation",
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
  const abortController = new AbortController();
  let executor = null;
  let heartbeat = null;
  let protocolFault = null;
  let cancellationAcknowledged = false;
  const acknowledgeCancellation = () => {
    if (!cancellationAcknowledged) {
      cancellationAcknowledged = true;
      events.cancellationAcknowledged();
    }
    abortController.abort(new DOMException("Runtime cancellation requested", "AbortError"));
    executor?.terminateChildren();
  };
  const stop = startStopInput(acknowledgeCancellation, (error) => {
    protocolFault = error;
    abortController.abort(error);
    executor?.terminateChildren();
  });
  try {
    events.ready();
    if (stop.requested()) return;
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    executor = createSealedRuntimeV2AgentBrowserExecutor({
      identity: launch.identity,
      executionScope: launch.executionScope,
      dataRoot: launch.dataRoot,
      workspacePath: launch.workspacePath,
      checkpointPath: launch.checkpointPath,
      request: launch.request,
      signal: abortController.signal,
      onFirstCheckpoint: () =>
        events.checkpoint("checkpoint", launch.checkpointRelativePath),
      onApprovalWait: () => events.progress("awaiting-approval", 0, 1),
    });
    const outcome = await executor.run();
    await heartbeat.stop();
    heartbeat = null;
    await yieldForSupervisorInput();
    if (protocolFault) throw protocolFault;
    if (stop.requested() || outcome.status === "aborted") {
      executor.finalize("aborted", {});
      return;
    }
    if (outcome.status === "failed") {
      executor.finalize("failed", outcome.payload);
      events.failed("AGENT_BROWSER_WORKER_FAILED", SANITIZED_RUNTIME_FAILURE_MESSAGE);
      process.exitCode = 1;
      return;
    }
    executor.finalize("completed", outcome.payload);
    const completionSequence = events.nextSequence();
    writeResultOnce(launch.resultPath, {
      protocolVersion: PROTOCOL_VERSION,
      identity: launch.identity,
      completionSequence,
      run: executor.projection(),
    });
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (stop.requested()) {
      executor?.finalize("aborted", {});
      return;
    }
    executor?.finalize("failed", {
      message: boundedFailureMessage(error),
    });
    events.failed("AGENT_BROWSER_WORKER_FAILED", SANITIZED_RUNTIME_FAILURE_MESSAGE);
    process.exitCode = 1;
    console.error("[runtime-v2-agent-browser-worker] Execution failed:", error);
  } finally {
    executor?.terminateChildren();
    try {
      await heartbeat?.stop();
    } catch (error) {
      process.exitCode = 1;
      console.error(
        "[runtime-v2-agent-browser-worker] Heartbeat shutdown failed:",
        error,
      );
    }
    stop.close();
  }
}

const invokedAsEntrypoint =
  typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT_PATH);
if (invokedAsEntrypoint) {
  void runRuntimeV2AgentBrowserWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[runtime-v2-agent-browser-worker] Startup failed: ${boundedFailureMessage(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
