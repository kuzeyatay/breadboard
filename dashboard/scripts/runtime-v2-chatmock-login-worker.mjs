import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeChatmockLogin,
  validateChatmockLoginRequest,
} from "./runtime-v2-chatmock-login-executor.mjs";
import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 8 * 1024;
const MAX_CHECKPOINT_BYTES = 32 * 1024;
const MAX_RESULT_BYTES = 32 * 1024;
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
    !exactRecord(value, ["jobId", "attempt", "workerInstanceId"]) ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) fail("The ChatMock login worker identity is invalid.");
  return value;
}

function validateExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) fail("The ChatMock login worker requires authenticated user-global scope.");
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
  const segments = typeof relativePath === "string" ? relativePath.split("/") : [];
  if (
    segments.length < 2 ||
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"),
    )
  ) fail("The ChatMock login start manifest contains an invalid relative path.");
  const resolved = path.resolve(dataRoot, ...segments);
  if (!pathWithin(dataRoot, resolved)) fail("The ChatMock login path escaped Runtime data.");
  return resolved;
}

function applicationLayout() {
  const dashboardMarkerRoot = path.dirname(path.dirname(ENTRYPOINT_PATH));
  const appRoot = path.dirname(dashboardMarkerRoot);
  const development = fs.existsSync(
    path.join(dashboardMarkerRoot, "src", "lib", "runtime-paths.ts"),
  );
  const metadata = fs.lstatSync(appRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("The Breadboard application root is unavailable.");
  }
  return { appRoot: fs.realpathSync.native(appRoot), development };
}

function configureWorkerEnvironment(launch, layout) {
  process.env.BREADBOARD_DATA_DIR = launch.dataRoot;
  process.env.BREADBOARD_REPO_ROOT = layout.appRoot;
  process.env.NODE_ENV = layout.development ? "development" : "production";
}

export function loadRuntimeV2ChatmockLoginLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The ChatMock login worker requires exactly start.json.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The ChatMock login start manifest",
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
    !Array.isArray(manifest.inputBlobs) ||
    manifest.inputBlobs.length !== 0
  ) fail("The ChatMock login start manifest has an unsupported shape.");
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  const expected = expectedWorkerPaths(identity);
  for (const field of ["inputManifestPath", "workspacePath", "checkpointPath", "resultPath"]) {
    if (manifest[field] !== expected[field]) {
      fail(`The ChatMock login ${field} is not identity-bound.`);
    }
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (!samePath(canonicalLaunchDirectory, resolveDataPath(dataRoot, expected.attemptRoot))) {
    fail("The ChatMock login launch directory is not identity-bound.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (
    !workspaceMetadata.isDirectory() ||
    workspaceMetadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(workspacePath), workspacePath)
  ) fail("The ChatMock login private workspace is unavailable.");
  return {
    dataRoot,
    identity,
    executionScope,
    request: validateChatmockLoginRequest(
      readBoundedJson(
        resolveDataPath(dataRoot, manifest.inputManifestPath),
        MAX_INPUT_MANIFEST_BYTES,
        "The canonical ChatMock login request",
      ),
    ),
    checkpointPath: resolveDataPath(dataRoot, manifest.checkpointPath),
    checkpointRelativePath: manifest.checkpointPath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
  };
}

export function parseRuntimeV2ChatmockLoginStopRecord(line) {
  if (
    typeof line !== "string" ||
    Buffer.byteLength(line, "utf8") > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) fail("The ChatMock login stop record is invalid.");
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The ChatMock login stop record is invalid JSON.");
  }
  if (!exactRecord(value, ["type", "force"]) || value.type !== "stop" || value.force !== false) {
    fail("The ChatMock login stop record is invalid.");
  }
  return value;
}

function startStopInput(onStop, onFault) {
  let buffered = "";
  let requested = false;
  let poisoned = false;
  const onData = (chunk) => {
    if (poisoned) return;
    buffered += chunk;
    if (Buffer.byteLength(buffered, "utf8") > MAX_STOP_RECORD_BYTES) {
      poisoned = true;
      onFault(new Error("The ChatMock login stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2ChatmockLoginStopRecord(line);
      if (requested || remainder) fail("The ChatMock login worker received extra stop data.");
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

function writeAtomicJson(filePath, value, maximumBytes, replace) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    fail("The ChatMock login protocol output exceeded its bound.");
  }
  const parent = path.dirname(filePath);
  const metadata = fs.lstatSync(parent);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(parent), parent)
  ) fail("The ChatMock login output directory is unavailable.");
  if (!replace && fs.existsSync(filePath)) fail("The ChatMock login result already exists.");
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

export async function runRuntimeV2ChatmockLoginWorker() {
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  const launch = loadRuntimeV2ChatmockLoginLaunch();
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "chatmock-login",
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
  const abort = new AbortController();
  let heartbeat = null;
  let fault = null;
  let acknowledged = false;
  let checkpointPublished = false;
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
    const layout = applicationLayout();
    configureWorkerEnvironment(launch, layout);
    const checkpoint = (snapshot) => {
      writeAtomicJson(
        launch.checkpointPath,
        { protocolVersion: PROTOCOL_VERSION, identity: launch.identity, snapshot },
        MAX_CHECKPOINT_BYTES,
        true,
      );
      if (!checkpointPublished) {
        checkpointPublished = true;
        events.checkpoint("checkpoint", launch.checkpointRelativePath);
      }
      const current = snapshot.status === "awaiting_authorization"
        ? snapshot.authorizationUrl ? 2 : 1
        : 3;
      events.progress("authorization", current, 3);
    };
    events.progress("starting", 0, 3);
    const result = await executeChatmockLogin(launch.request, {
      appRoot: layout.appRoot,
      signal: abort.signal,
      onState: checkpoint,
    });
    await heartbeat.stop();
    heartbeat = null;
    await new Promise((resolve) => setImmediate(resolve));
    if (fault) throw fault;
    if (stop.requested()) return;
    const completionSequence = events.nextSequence();
    writeAtomicJson(
      launch.resultPath,
      {
        protocolVersion: PROTOCOL_VERSION,
        identity: launch.identity,
        completionSequence,
        result,
      },
      MAX_RESULT_BYTES,
      false,
    );
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (!stop.requested()) {
      events.failed("CHATMOCK_LOGIN_FAILED", "The ChatMock sign-in worker stopped unexpectedly.");
      process.exitCode = 1;
      console.error("[runtime-v2-chatmock-login-worker] Sign-in failed:", error);
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
  void runRuntimeV2ChatmockLoginWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[runtime-v2-chatmock-login-worker] Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
