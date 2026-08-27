import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  agentReachSetupFailure,
  executeAgentReachSetup,
  expectedAgentReachSetupInputCount,
  validateAgentReachSetupRequest,
} from "./runtime-v2-agent-reach-setup-executor.mjs";
import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 8 * 1024;
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 48 * 1024;
const MAX_STOP_RECORD_BYTES = 1_024;
const HEARTBEAT_INTERVAL_MS = 5_000;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ENTRYPOINT_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
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
    metadata.size > maximumBytes ||
    !samePath(fs.realpathSync.native(filePath), filePath)
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
    !exactRecord(value, ["jobId", "attempt", "workerInstanceId"]) ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) fail("The Agent Reach setup worker identity is invalid.");
  return value;
}

function validateExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) fail("Agent Reach setup requires authenticated user-global scope.");
  return value;
}

function expectedPaths(identity) {
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
  const segments = typeof relativePath === "string" ? relativePath.split("/") : [];
  if (
    segments.length < 2 ||
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"),
    )
  ) fail("The Agent Reach setup start manifest contains an invalid relative path.");
  const resolved = path.resolve(dataRoot, ...segments);
  if (!pathWithin(dataRoot, resolved)) fail("The Agent Reach setup path escaped Runtime data.");
  return resolved;
}

function validateInputBlob(value, identity) {
  const match = isRecord(value) && typeof value.relativePath === "string"
    ? /^runtime\/jobs\/([A-Za-z0-9_-]{1,128})\/inputs\/([A-Za-z0-9_-]{1,128})\/payload$/u.exec(
        value.relativePath,
      )
    : null;
  if (
    !exactRecord(value, [
      "blobId",
      "relativePath",
      "sizeBytes",
      "sha256",
      "displayName",
      "mediaType",
    ]) ||
    !IDENTIFIER.test(value.blobId) ||
    !match ||
    match[1] !== identity.jobId ||
    match[2] !== value.blobId ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > MAX_SECRET_BYTES ||
    !SHA256.test(value.sha256) ||
    value.displayName !== "agent-reach-credential.txt" ||
    value.mediaType !== "application/x-breadboard-secret"
  ) fail("The sealed Agent Reach credential is invalid.");
  return value;
}

function applicationLayout() {
  const dashboardRoot = path.dirname(path.dirname(ENTRYPOINT_PATH));
  const appRoot = path.dirname(dashboardRoot);
  for (const [candidate, label] of [
    [appRoot, "The Breadboard application root"],
    [path.dirname(ENTRYPOINT_PATH), "The dashboard worker scripts"],
  ]) {
    const metadata = fs.lstatSync(candidate);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(candidate), candidate)
    ) fail(`${label} is unavailable.`);
  }
  return {
    appRoot: fs.realpathSync.native(appRoot),
    dashboardScriptsRoot: fs.realpathSync.native(path.dirname(ENTRYPOINT_PATH)),
  };
}

export function loadRuntimeV2AgentReachSetupLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The Agent Reach setup worker requires exactly start.json.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The Agent Reach setup start manifest",
  );
  if (
    !exactRecord(manifest, [
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
    !Array.isArray(manifest.inputBlobs)
  ) fail("The Agent Reach setup start manifest has an unsupported shape.");
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  const expected = expectedPaths(identity);
  for (const field of ["inputManifestPath", "workspacePath", "checkpointPath", "resultPath"]) {
    if (manifest[field] !== expected[field]) {
      fail(`The Agent Reach setup ${field} is not identity-bound.`);
    }
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (!samePath(canonicalLaunchDirectory, resolveDataPath(dataRoot, expected.attemptRoot))) {
    fail("The Agent Reach setup launch directory is not identity-bound.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (
    !workspaceMetadata.isDirectory() ||
    workspaceMetadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(workspacePath), workspacePath)
  ) fail("The Agent Reach private setup workspace is unavailable.");
  const request = validateAgentReachSetupRequest(
    readBoundedJson(
      resolveDataPath(dataRoot, manifest.inputManifestPath),
      MAX_INPUT_MANIFEST_BYTES,
      "The canonical Agent Reach setup request",
    ),
  );
  if (manifest.inputBlobs.length !== expectedAgentReachSetupInputCount(request)) {
    fail("The Agent Reach setup worker received the wrong number of inputs.");
  }
  const inputBlobs = manifest.inputBlobs.map((blob) => validateInputBlob(blob, identity));
  return {
    dataRoot,
    identity,
    executionScope,
    request,
    inputBlobs,
    workspacePath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
  };
}

async function verifyInputBlob(launch, blob, signal) {
  const target = resolveDataPath(launch.dataRoot, blob.relativePath);
  const before = fs.lstatSync(target);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size !== blob.sizeBytes ||
    !samePath(fs.realpathSync.native(target), target)
  ) fail("The sealed Agent Reach credential is unavailable.");
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(target, { highWaterMark: 16 * 1024 });
    const abort = () => stream.destroy(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    stream.once("end", () => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
    if (signal.aborted) abort();
  });
  const after = fs.lstatSync(target);
  if (
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    hash.digest("hex") !== blob.sha256
  ) fail("The sealed Agent Reach credential failed its integrity check.");
  return target;
}

export function parseRuntimeV2AgentReachSetupStopRecord(line) {
  if (
    typeof line !== "string" ||
    Buffer.byteLength(line, "utf8") > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) fail("The Agent Reach setup stop record is invalid.");
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The Agent Reach setup stop record is invalid JSON.");
  }
  if (!exactRecord(value, ["type", "force"]) || value.type !== "stop" || value.force !== false) {
    fail("The Agent Reach setup stop record is invalid.");
  }
  return value;
}

function stopInput(onStop, onFault) {
  let buffered = "";
  let requested = false;
  let poisoned = false;
  const onData = (chunk) => {
    if (poisoned) return;
    buffered += chunk;
    if (Buffer.byteLength(buffered, "utf8") > MAX_STOP_RECORD_BYTES) {
      poisoned = true;
      onFault(new Error("The Agent Reach setup stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2AgentReachSetupStopRecord(line);
      if (requested || remainder) fail("The Agent Reach setup worker received extra stop data.");
      requested = true;
      onStop();
    } catch (error) {
      poisoned = true;
      onFault(error);
    }
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  process.stdin.resume();
  return {
    requested: () => requested,
    close() {
      process.stdin.off("data", onData);
      process.stdin.pause();
    },
  };
}

function writeResultOnce(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The Agent Reach setup result exceeded its bound.");
  }
  const parent = path.dirname(filePath);
  const metadata = fs.lstatSync(parent);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(parent), parent) ||
    fs.existsSync(filePath)
  ) fail("The Agent Reach setup result path is unavailable.");
  const pending = `${filePath}.pending.${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(pending, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(pending, filePath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(pending, { force: true });
    throw error;
  }
}

export async function runRuntimeV2AgentReachSetupWorker() {
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  const launch = loadRuntimeV2AgentReachSetupLaunch();
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "agent-reach-setup",
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
  const abort = new AbortController();
  let heartbeat = null;
  let fault = null;
  let acknowledged = false;
  const acknowledge = () => {
    if (!acknowledged) {
      acknowledged = true;
      events.cancellationAcknowledged();
    }
    abort.abort(new DOMException("Runtime cancellation requested", "AbortError"));
  };
  const stop = stopInput(acknowledge, (error) => {
    fault = error;
    acknowledge();
  });
  try {
    events.ready();
    if (stop.requested()) return;
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    events.progress("verifying", 0, 3);
    const inputPath = launch.inputBlobs.length
      ? await verifyInputBlob(launch, launch.inputBlobs[0], abort.signal)
      : null;
    const layout = applicationLayout();
    events.progress("preparing", 1, 3);
    let result;
    try {
      result = await executeAgentReachSetup(launch.request, {
        dataRoot: launch.dataRoot,
        appRoot: layout.appRoot,
        dashboardScriptsRoot: layout.dashboardScriptsRoot,
        workspacePath: launch.workspacePath,
        inputPath,
        signal: abort.signal,
      });
    } catch (error) {
      if (abort.signal.aborted) throw error;
      result = agentReachSetupFailure(error);
    }
    events.progress("finalizing", 2, 3);
    await heartbeat.stop();
    heartbeat = null;
    await new Promise((resolve) => setImmediate(resolve));
    if (fault) throw fault;
    if (stop.requested()) return;
    events.progress("complete", 3, 3);
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
      events.failed("AGENT_REACH_SETUP_FAILED", "The Agent Reach setup worker stopped unexpectedly.");
      process.exitCode = 1;
      console.error("[runtime-v2-agent-reach-setup-worker] Setup failed:", error);
    }
  } finally {
    try { await heartbeat?.stop(); } catch { process.exitCode = 1; }
    stop.close();
  }
}

const invokedAsEntrypoint =
  typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT_PATH);
if (invokedAsEntrypoint) {
  void runRuntimeV2AgentReachSetupWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[runtime-v2-agent-reach-setup-worker] Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
