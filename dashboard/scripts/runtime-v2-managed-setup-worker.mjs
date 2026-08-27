import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeManagedSetup,
  managedSetupFailure,
  validateManagedSetupRequest,
} from "./runtime-v2-managed-setup-executor.mjs";
import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 8 * 1024;
const MAX_RESULT_BYTES = 48 * 1024;
const MAX_STOP_RECORD_BYTES = 1_024;
const HEARTBEAT_INTERVAL_MS = 5_000;
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
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function readBoundedJson(filePath, maximumBytes, label) {
  const metadata = fs.lstatSync(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) fail(`${label} is not a bounded direct regular file.`);
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
  ) fail("The managed setup worker identity is invalid.");
  return value;
}

function validateExecutionScope(value) {
  if (
    !hasExactKeys(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) fail("The managed setup worker scope is invalid.");
  return value;
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
    segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))
  ) fail("The managed setup start manifest contains an invalid relative path.");
  const resolved = path.resolve(dataRoot, ...segments);
  if (!pathWithin(dataRoot, resolved)) fail("The managed setup path escaped Runtime data.");
  return resolved;
}

function applicationLayout() {
  const dashboardMarkerRoot = path.dirname(path.dirname(ENTRYPOINT_PATH));
  const appRoot = path.dirname(dashboardMarkerRoot);
  const metadata = fs.lstatSync(appRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("The Breadboard application root is unavailable.");
  }
  const developmentSourceRoot = path.join(dashboardMarkerRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const development = fs.existsSync(path.join(developmentSourceRoot, "lib", "runtime-paths.ts"));
  const dashboardRoot = development ? dashboardMarkerRoot : packagedDashboardRoot;
  return {
    appRoot: fs.realpathSync.native(appRoot),
    dashboardRoot,
    development,
  };
}

function configureWorkerEnvironment(launch, layout) {
  process.env.BREADBOARD_DATA_DIR = launch.dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = layout.development
    ? layout.dashboardRoot
    : "";
  process.env.BREADBOARD_REPO_ROOT = layout.appRoot;
  process.env.NODE_ENV = layout.development ? "development" : "production";
}

export function loadRuntimeV2ManagedSetupLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The managed setup worker requires exactly start.json.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The managed setup worker start manifest",
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
    manifest.protocolVersion !== PROTOCOL_VERSION ||
    !Array.isArray(manifest.inputBlobs) ||
    manifest.inputBlobs.length !== 0
  ) fail("The managed setup worker start manifest has an unsupported shape.");
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  const expected = expectedWorkerPaths(identity);
  for (const field of ["inputManifestPath", "workspacePath", "checkpointPath", "resultPath"]) {
    if (manifest[field] !== expected[field]) {
      fail(`The managed setup ${field} is not identity-bound.`);
    }
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (!samePath(canonicalLaunchDirectory, resolveDataPath(dataRoot, expected.attemptRoot))) {
    fail("The managed setup launch directory is not identity-bound.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("The managed setup private workspace is unavailable.");
  }
  return {
    dataRoot,
    identity,
    executionScope,
    request: validateManagedSetupRequest(
      readBoundedJson(
        resolveDataPath(dataRoot, manifest.inputManifestPath),
        MAX_INPUT_MANIFEST_BYTES,
        "The canonical managed setup request",
      ),
    ),
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
  };
}

export function parseRuntimeV2ManagedSetupStopRecord(line) {
  if (
    typeof line !== "string" ||
    Buffer.byteLength(line, "utf8") > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) fail("The managed setup stop record is invalid.");
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The managed setup stop record is invalid JSON.");
  }
  if (!hasExactKeys(value, ["type", "force"]) || value.type !== "stop" || value.force !== false) {
    fail("The managed setup stop record is invalid.");
  }
  return value;
}

function startStopInput(onStop, onFault) {
  let buffered = "";
  let stopped = false;
  let poisoned = false;
  process.stdin.setEncoding("utf8");
  const onData = (chunk) => {
    if (poisoned) return;
    buffered += chunk;
    if (Buffer.byteLength(buffered, "utf8") > MAX_STOP_RECORD_BYTES) {
      poisoned = true;
      onFault(new Error("The managed setup stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2ManagedSetupStopRecord(line);
      if (stopped || remainder) fail("The managed setup worker received more than one stop record.");
      stopped = true;
      onStop();
    } catch (error) {
      poisoned = true;
      onFault(error);
    }
  };
  process.stdin.on("data", onData);
  process.stdin.resume();
  return {
    requested: () => stopped,
    close: () => {
      process.stdin.off("data", onData);
      process.stdin.pause();
    },
  };
}

function writeResultOnce(resultPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The managed setup result exceeded its bound.");
  }
  if (fs.existsSync(resultPath)) fail("The durable managed setup result already exists.");
  const temporary = `${resultPath}.pending.${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, resultPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export async function runRuntimeV2ManagedSetupWorker() {
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  const launch = loadRuntimeV2ManagedSetupLaunch();
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "setup",
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
  const abort = new AbortController();
  let fault = null;
  let heartbeat = null;
  let acknowledged = false;
  const acknowledge = () => {
    if (!acknowledged) {
      acknowledged = true;
      events.cancellationAcknowledged();
    }
    abort.abort(new DOMException("Runtime cancellation requested", "AbortError"));
  };
  const stop = startStopInput(acknowledge, (error) => {
    fault = error;
    acknowledge();
  });
  try {
    events.ready();
    if (stop.requested()) return;
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    events.progress("preparing", 0, 3);
    const layout = applicationLayout();
    configureWorkerEnvironment(launch, layout);
    events.progress("installing", 1, 3);
    let result;
    try {
      result = await executeManagedSetup(launch.request, {
        dataRoot: launch.dataRoot,
        appRoot: layout.appRoot,
        signal: abort.signal,
      });
    } catch (error) {
      if (abort.signal.aborted) throw error;
      result = managedSetupFailure(error);
    }
    events.progress("verifying", 2, 3);
    await heartbeat.stop();
    heartbeat = null;
    await new Promise((resolve) => setImmediate(resolve));
    if (fault) throw fault;
    if (stop.requested()) return;
    events.progress("finalizing", 3, 3);
    const completionSequence = events.nextSequence();
    writeResultOnce(launch.resultPath, {
      protocolVersion: PROTOCOL_VERSION,
      identity: launch.identity,
      completionSequence,
      result,
    });
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (!stop.requested()) {
      events.failed("MANAGED_SETUP_FAILED", "The setup worker stopped before it finished.");
      process.exitCode = 1;
      console.error("[runtime-v2-managed-setup-worker] Setup failed:", error);
    }
  } finally {
    try {
      await heartbeat?.stop();
    } catch {
      process.exitCode = 1;
    }
    stop.close();
  }
}

const invokedAsEntrypoint =
  typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT_PATH);
if (invokedAsEntrypoint) {
  void runRuntimeV2ManagedSetupWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[runtime-v2-managed-setup-worker] Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
