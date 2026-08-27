import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";
import { createSealedRuntimeV2QuartzPublishExecutor } from "./runtime-v2-quartz-publish-executor.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
const MAX_FAILURE_MESSAGE_BYTES = 8 * 1024;
const HEARTBEAT_INTERVAL_MS = 5_000;
const SANITIZED_RUNTIME_FAILURE_MESSAGE = "Quartz publication failed.";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const ENTRYPOINT_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function sealedQuartzSourceRoot() {
  const value = process.env.BREADBOARD_QUARTZ_SOURCE_ROOT?.trim() ?? "";
  if (!value || !path.isAbsolute(value) || value.includes("\0")) {
    fail("The sealed Quartz source root is invalid.");
  }
  return value;
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
    fail("The Quartz worker identity is invalid.");
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
    value.conversationId !== null
  ) {
    fail("Quartz publication requires exact authenticated user-global authority.");
  }
  return { userId: value.userId, gardenId: null, conversationId: null };
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
    fail("The Quartz worker start manifest contains an invalid relative path.");
  }
  const resolved = path.resolve(dataRoot, ...segments);
  if (!pathWithin(dataRoot, resolved)) {
    fail("The Quartz worker start manifest path escapes the Runtime data root.");
  }
  return resolved;
}

function validateRequest(value) {
  if (
    !hasExactKeys(value, [
      "operation",
      "reasons",
      "concurrency",
      "timeoutMs",
      "buildEnvironment",
    ]) ||
    value.operation !== "publish" ||
    !Array.isArray(value.reasons) ||
    !isRecord(value.buildEnvironment)
  ) {
    fail("The Quartz publication request is invalid.");
  }
  for (const field of ["userId", "gardenId", "conversationId"]) {
    if (Object.hasOwn(value, field)) {
      fail(`The Quartz request must not duplicate authenticated ${field}.`);
    }
  }
  return value;
}

export function loadRuntimeV2QuartzPublishLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The Quartz worker requires exactly the fixed start.json argument.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(
    path.resolve(launchDirectory),
  );
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The Quartz worker start manifest",
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
    fail("The Quartz worker start manifest is invalid.");
  }
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  if (!Array.isArray(manifest.inputBlobs) || manifest.inputBlobs.length !== 0) {
    fail("The Quartz worker does not accept input blobs.");
  }
  const expected = expectedWorkerPaths(identity);
  for (const field of [
    "inputManifestPath",
    "workspacePath",
    "checkpointPath",
    "resultPath",
  ]) {
    if (manifest[field] !== expected[field]) {
      fail(`The Quartz worker ${field} is not fenced to its identity.`);
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
    fail("The Quartz worker launch directory is not bound to its identity.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("The Quartz worker private workspace is unavailable.");
  }
  return {
    dataRoot,
    identity,
    executionScope,
    workspacePath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
    request: validateRequest(
      readBoundedJson(
        resolveDataPath(dataRoot, manifest.inputManifestPath),
        MAX_INPUT_MANIFEST_BYTES,
        "The canonical Quartz publication request",
      ),
    ),
  };
}

export function parseRuntimeV2QuartzStopRecord(line) {
  const bytes = Buffer.from(line, "utf8");
  if (
    bytes.byteLength < 2 ||
    bytes.byteLength > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) {
    fail("The Quartz worker stop record is invalid.");
  }
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The Quartz worker stop record is not valid JSON.");
  }
  if (
    !hasExactKeys(value, ["type", "force"]) ||
    value.type !== "stop" ||
    value.force !== false
  ) {
    fail("The Quartz worker stop record is invalid.");
  }
  return value;
}

function startStopInput(onStop, onProtocolFault) {
  let buffered = "";
  let requested = false;
  let poisoned = false;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (poisoned) return;
    buffered += chunk;
    if (Buffer.byteLength(buffered, "utf8") > MAX_STOP_RECORD_BYTES) {
      poisoned = true;
      onProtocolFault(new Error("The Quartz worker stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2QuartzStopRecord(line);
      if (requested || remainder.length > 0) {
        fail("The Quartz worker received more than one stop record.");
      }
      requested = true;
      onStop();
    } catch (error) {
      poisoned = true;
      onProtocolFault(error);
    }
  });
  process.stdin.resume();
  return {
    requested: () => requested,
    close() {
      process.stdin.removeAllListeners("data");
      process.stdin.pause();
    },
  };
}

function fsyncOutputDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(directoryPath, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !isRecord(error) ||
      !["EACCES", "EINVAL", "EPERM"].includes(String(error.code))
    ) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeResultOnce(filePath, bytes) {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The durable Quartz publication result exceeded its bound.");
  }
  const parent = path.dirname(filePath);
  if (!fs.lstatSync(parent).isDirectory() || fs.existsSync(filePath)) {
    fail("The durable Quartz publication result path is unavailable.");
  }
  const temporaryPath = `${filePath}.pending.${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    const resultDescriptor = fs.openSync(
      filePath,
      process.platform === "win32" ? "r+" : "r",
    );
    try {
      fs.fsyncSync(resultDescriptor);
    } finally {
      fs.closeSync(resultDescriptor);
    }
    fsyncOutputDirectory(parent);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function serializeResult(identity, completionSequence, value) {
  return Buffer.from(
    `${JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      identity,
      completionSequence,
      result: value,
    })}\n`,
    "utf8",
  );
}

function redirectApplicationStdout() {
  const diagnosticWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) =>
    diagnosticWrite(chunk, encoding, callback);
}

function boundedFailureMessage(error) {
  const raw =
    error && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : String(error);
  const bytes = Buffer.from(raw || SANITIZED_RUNTIME_FAILURE_MESSAGE, "utf8");
  if (bytes.byteLength <= MAX_FAILURE_MESSAGE_BYTES) return bytes.toString("utf8");
  return bytes
    .subarray(0, MAX_FAILURE_MESSAGE_BYTES)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
}

async function runRuntimeV2QuartzPublishWorker() {
  redirectApplicationStdout();
  const launch = loadRuntimeV2QuartzPublishLaunch();
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "quartz-publish",
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
  const abortController = new AbortController();
  let protocolFault = null;
  let heartbeat = null;
  const stop = startStopInput(
    () => {
      events.cancellationAcknowledged();
      abortController.abort(new Error("Quartz publication was canceled."));
    },
    (error) => {
      protocolFault = error;
      abortController.abort(error);
      console.error("[runtime-v2-quartz-worker] Invalid supervisor input:", error);
    },
  );
  events.ready();
  try {
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    await new Promise((resolve) => setImmediate(resolve));
    if (stop.requested()) return;
    const execute = createSealedRuntimeV2QuartzPublishExecutor({
      identity: launch.identity,
      dataRoot: launch.dataRoot,
      contentPath: path.join(launch.dataRoot, "quartz", "content"),
      sourceRoot: sealedQuartzSourceRoot(),
      workspacePath: launch.workspacePath,
      signal: abortController.signal,
    });
    events.progress("preparing", 1, 3);
    const value = await execute({
      reasons: launch.request.reasons,
      concurrency: launch.request.concurrency,
      timeoutMs: launch.request.timeoutMs,
      buildEnvironment: launch.request.buildEnvironment,
    });
    await new Promise((resolve) => setImmediate(resolve));
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;
    events.progress("publishing", 2, 3);
    await heartbeat.stop();
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;
    events.progress("complete", 3, 3);
    const completionSequence = events.nextSequence();
    const result = serializeResult(launch.identity, completionSequence, value);
    writeResultOnce(launch.resultPath, result);
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (stop.requested()) return;
    events.failed("QUARTZ_PUBLISH_FAILED", SANITIZED_RUNTIME_FAILURE_MESSAGE);
    process.exitCode = 1;
    console.error("[runtime-v2-quartz-worker] Quartz publication failed:", error);
  } finally {
    try {
      await heartbeat?.stop();
    } catch (error) {
      process.exitCode = 1;
      console.error("[runtime-v2-quartz-worker] Heartbeat shutdown failed:", error);
    }
    stop.close();
  }
}

const invokedAsEntrypoint =
  typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT_PATH);
if (invokedAsEntrypoint) {
  void runRuntimeV2QuartzPublishWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[runtime-v2-quartz-worker] Startup failed: ${boundedFailureMessage(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
