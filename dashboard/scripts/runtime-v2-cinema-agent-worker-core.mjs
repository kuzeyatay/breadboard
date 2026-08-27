import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  executeRuntimeV2CinemaAdapter,
  RUNTIME_V2_CINEMA_ADAPTERS,
  validateRuntimeV2CinemaRequest,
} from "./runtime-v2-cinema-agent-adapters.mjs";
import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 512 * 1024;
const MAX_CHECKPOINT_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024 + 32 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
const MAX_FAILURE_MESSAGE_BYTES = 8 * 1024;
const MAX_EVENTS = 3_000;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const EVENT_TYPE = /^[a-z][a-z0-9_.-]{0,79}$/u;
const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);
const TERMINAL_EVENTS = new Set(["run.completed", "run.failed", "run.aborted"]);
const ENTRYPOINT_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
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
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximumBytes) {
    fail(`${label} is not a bounded direct regular file.`);
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
    !exactRecord(value, ["jobId", "attempt", "workerInstanceId"]) ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) || value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) fail("The cinema Runtime worker identity is invalid.");
  return value;
}

function validNullableScope(value) {
  return value === null || (
    typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 256 && !/\p{Cc}/u.test(value)
  );
}

function validateExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    !validNullableScope(value.gardenId) || !validNullableScope(value.conversationId)
  ) fail("The cinema Runtime worker requires authenticated user scope.");
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
  if (
    typeof relativePath !== "string" || relativePath.includes("\\") ||
    relativePath.split("/").length < 2 ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) fail("The cinema Runtime worker received an invalid Runtime-relative path.");
  const resolved = path.resolve(dataRoot, ...relativePath.split("/"));
  if (!pathWithin(dataRoot, resolved)) fail("The cinema Runtime worker path escaped its data root.");
  return resolved;
}

export function loadRuntimeV2CinemaLaunch({
  agentKind,
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
}) {
  const adapter = RUNTIME_V2_CINEMA_ADAPTERS[agentKind];
  if (!adapter) fail("The cinema Runtime adapter is not registered.");
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The cinema Runtime worker requires exactly the fixed start.json argument.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The cinema Runtime start manifest",
  );
  if (
    !exactRecord(manifest, [
      "protocolVersion", "identity", "executionScope", "inputManifestPath", "inputBlobs",
      "workspacePath", "checkpointPath", "resultPath",
    ]) ||
    manifest.protocolVersion !== PROTOCOL_VERSION
  ) fail("The cinema Runtime start manifest has an unsupported shape.");
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  const expected = expectedPaths(identity);
  for (const field of ["inputManifestPath", "workspacePath", "checkpointPath", "resultPath"]) {
    if (manifest[field] !== expected[field]) fail(`The cinema Runtime ${field} is not identity-bound.`);
  }
  if (!Array.isArray(manifest.inputBlobs) || manifest.inputBlobs.length !== 0) {
    fail("The cinema Runtime profile does not accept renderer-supplied blobs.");
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (!samePath(canonicalLaunchDirectory, resolveDataPath(dataRoot, expected.attemptRoot))) {
    fail("The cinema Runtime launch directory is not identity-bound.");
  }
  const workspacePath = resolveDataPath(dataRoot, expected.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("The cinema Runtime private workspace is unavailable.");
  }
  const request = validateRuntimeV2CinemaRequest(agentKind, readBoundedJson(
    resolveDataPath(dataRoot, expected.inputManifestPath),
    MAX_INPUT_MANIFEST_BYTES,
    "The canonical cinema Runtime request",
  ));
  return {
    dataRoot,
    identity,
    executionScope,
    request,
    workspacePath,
    checkpointPath: resolveDataPath(dataRoot, expected.checkpointPath),
    checkpointRelativePath: expected.checkpointPath,
    resultPath: resolveDataPath(dataRoot, expected.resultPath),
    resultRelativePath: expected.resultPath,
  };
}

export function parseRuntimeV2CinemaStopRecord(line) {
  if (Buffer.byteLength(line, "utf8") > MAX_STOP_RECORD_BYTES || !line.endsWith("\n")) {
    fail("The cinema Runtime stop record is invalid.");
  }
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The cinema Runtime stop record is invalid JSON.");
  }
  if (!exactRecord(value, ["type", "force"]) || value.type !== "stop" || value.force !== false) {
    fail("The cinema Runtime stop record is invalid.");
  }
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
      onFault(new Error("The cinema Runtime stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2CinemaStopRecord(line);
      if (requested || remainder) fail("The cinema Runtime worker received more than one stop record.");
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

function trustedPath(name, kind) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  if (!path.isAbsolute(raw) || /[\u0000\r\n]/u.test(raw)) fail(`The trusted ${name} path is invalid.`);
  const resolved = path.resolve(raw);
  const metadata = fs.lstatSync(resolved);
  if (metadata.isSymbolicLink() || (kind === "file" ? !metadata.isFile() : !metadata.isDirectory())) {
    fail(`The trusted ${name} path is unavailable.`);
  }
  if (!samePath(fs.realpathSync.native(resolved), resolved)) fail(`The trusted ${name} path is indirect.`);
  return resolved;
}

function sourceLayout(dataRoot, agentKind) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT_PATH));
  const derivedAppRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(derivedAppRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(path.join(developmentSourceRoot, "lib", "db.ts"));
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  if (!fs.existsSync(path.join(sourceRoot, "lib", "db.ts"))) {
    fail("The staged cinema Runtime source closure is unavailable.");
  }
  const configuredAppRoot = trustedPath("BREADBOARD_RUNTIME_V2_APP_ROOT", "directory");
  const appRoot = configuredAppRoot ?? derivedAppRoot;
  const historicalDevelopmentData = development && samePath(dataRoot, appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = dashboardRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.QUARTZ_CONTENT_PATH ||= path.join(dataRoot, "quartz", "content");
  process.env.NODE_ENV = development ? "development" : "production";
  process.env.BREADBOARD_RUNTIME_V2_CINEMA_WORKER = agentKind;

  const ffmpeg = trustedPath(
    agentKind === "vimax"
      ? "BREADBOARD_RUNTIME_V2_VIMAX_FFMPEG_PATH"
      : "BREADBOARD_RUNTIME_V2_VOX_FFMPEG_PATH",
    "file",
  );
  if (ffmpeg) process.env.VIMAX_FFMPEG_PATH = ffmpeg;
  if (agentKind === "vox-director") {
    const root = trustedPath("BREADBOARD_RUNTIME_V2_VOX_ROOT", "directory");
    const python = trustedPath("BREADBOARD_RUNTIME_V2_VOX_PYTHON_PATH", "file");
    const ffprobe = trustedPath("BREADBOARD_RUNTIME_V2_VOX_FFPROBE_PATH", "file");
    const music = trustedPath("BREADBOARD_RUNTIME_V2_VOX_MUSIC_DIR", "directory");
    if (root) process.env.VOX_DIRECTOR_ROOT = root;
    if (python) process.env.VOX_DIRECTOR_PYTHON = python;
    if (ffprobe) process.env.BREADBOARD_RUNTIME_V2_VOX_FFPROBE_PATH = ffprobe;
    if (music) process.env.VOX_DIRECTOR_MUSIC_DIR = music;
  }
  process.chdir(dashboardRoot);
  return { sourceRoot };
}

function atomicReplace(filePath, bytes, maximumBytes, label) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    fail(`${label} exceeded its bounded envelope.`);
  }
  const parent = path.dirname(filePath);
  const metadata = fs.lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(`${label} parent is unavailable.`);
  const temporary = `${filePath}.pending.${process.pid}.${randomUUID()}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function writeResultOnce(resultPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength > MAX_RESULT_BYTES || fs.existsSync(resultPath)) {
    fail("The cinema Runtime result is unavailable or exceeded its bound.");
  }
  atomicReplace(resultPath, bytes, MAX_RESULT_BYTES, "The cinema Runtime result");
}

function projectionBytes(current) {
  while (true) {
    const projection = {
      protocolVersion: PROTOCOL_VERSION,
      identity: current.identity,
      scope: current.executionScope,
      agentKind: current.agentKind,
      status: current.status,
      events: current.events,
    };
    const bytes = Buffer.from(`${JSON.stringify(projection)}\n`, "utf8");
    if (bytes.byteLength <= MAX_CHECKPOINT_BYTES) return { projection, bytes };
    if (current.events.length <= 1) fail("The cinema Runtime checkpoint exceeded its bound.");
    current.events.shift();
  }
}

function persistProjection(current) {
  const { bytes } = projectionBytes(current);
  atomicReplace(current.checkpointPath, bytes, MAX_CHECKPOINT_BYTES, "The cinema Runtime checkpoint");
  if (!current.checkpointPublished) {
    current.checkpointPublished = true;
    current.onFirstCheckpoint();
  }
}

function validateApplicationEvent(event, prior) {
  if (
    !exactRecord(event, ["sequenceNumber", "type", "payload", "at"]) ||
    !Number.isSafeInteger(event.sequenceNumber) || event.sequenceNumber <= prior ||
    !EVENT_TYPE.test(event.type) || !isRecord(event.payload) ||
    typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at))
  ) fail("The cinema Runtime application event stream is invalid.");
  return event;
}

function updateProjection(current, nextEvents, status) {
  if (TERMINAL_STATUSES.has(current.status)) return;
  if (status !== undefined) {
    if (!["queued", "running", "completed", "failed", "aborted"].includes(status)) {
      fail("The cinema Runtime application status is invalid.");
    }
    current.status = status;
  }
  let prior = current.lastSequence;
  for (const candidate of nextEvents) {
    const event = validateApplicationEvent(candidate, prior);
    prior = event.sequenceNumber;
    current.events.push(event);
    if (event.type === "run.completed") current.status = "completed";
    if (event.type === "run.failed") current.status = "failed";
    if (event.type === "run.aborted") current.status = "aborted";
  }
  current.lastSequence = prior;
  if (current.events.length > MAX_EVENTS) current.events.splice(0, current.events.length - MAX_EVENTS);
  persistProjection(current);
}

function boundedFailureMessage(error) {
  const raw = error && typeof error === "object" && typeof error.message === "string"
    ? error.message
    : String(error || "Cinema Runtime execution failed.");
  const bytes = Buffer.from(raw, "utf8");
  return bytes.byteLength <= MAX_FAILURE_MESSAGE_BYTES
    ? bytes.toString("utf8")
    : bytes.subarray(0, MAX_FAILURE_MESSAGE_BYTES).toString("utf8").replace(/\uFFFD+$/u, "");
}

function finalizeProjection(current, status, error) {
  const terminal = current.events.findLast((event) => TERMINAL_EVENTS.has(event.type));
  if (terminal) {
    current.status = terminal.type === "run.completed"
      ? "completed"
      : terminal.type === "run.aborted" ? "aborted" : "failed";
    persistProjection(current);
    return;
  }
  const type = status === "completed" ? "run.completed" : status === "aborted" ? "run.aborted" : "run.failed";
  const payload = status === "aborted"
    ? { summary: current.agentKind === "vimax" ? "The ViMax run was stopped." : "The Vox Director run was stopped." }
    : status === "completed"
      ? { summary: "The cinema worker completed without a final application event." }
      : { error: boundedFailureMessage(error) };
  updateProjection(current, [{
    sequenceNumber: current.lastSequence + 1,
    type,
    payload,
    at: new Date().toISOString(),
  }], status);
}

export async function runRuntimeV2CinemaAgentWorker(agentKind) {
  const adapter = RUNTIME_V2_CINEMA_ADAPTERS[agentKind];
  if (!adapter) fail("The cinema Runtime adapter is not registered.");
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  const launch = loadRuntimeV2CinemaLaunch({ agentKind });
  const { sourceRoot } = sourceLayout(launch.dataRoot, agentKind);
  await import(pathToFileURL(path.join(path.dirname(ENTRYPOINT_PATH), "learn-worker-import-hook.mjs")).href);
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: agentKind === "vimax" ? "vimax-production" : "vox-director-production",
    heartbeatIntervalMs: 5_000,
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
  const stop = startStopInput(acknowledge, (error) => {
    fault = error;
    acknowledge();
  });
  const current = {
    agentKind,
    identity: launch.identity,
    executionScope: launch.executionScope,
    checkpointPath: launch.checkpointPath,
    checkpointPublished: false,
    onFirstCheckpoint: () => events.checkpoint("checkpoint", launch.checkpointRelativePath),
    status: "queued",
    lastSequence: 0,
    events: [],
  };
  try {
    events.ready();
    if (stop.requested()) return;
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    if (launch.request.operation === "run") persistProjection(current);
    const outcome = await executeRuntimeV2CinemaAdapter({
      agentKind,
      launch,
      sourceRoot,
      signal: abort.signal,
      update: (nextEvents, status) => updateProjection(current, nextEvents, status),
    });
    await heartbeat.stop();
    heartbeat = null;
    await new Promise((resolve) => setImmediate(resolve));
    if (fault) throw fault;
    if (stop.requested() || outcome.status === "aborted") {
      if (launch.request.operation === "run") finalizeProjection(current, "aborted");
      return;
    }
    if (outcome.status === "failed") {
      if (launch.request.operation === "run") finalizeProjection(current, "failed");
      events.failed("WORKER_FAILED", "Cinema Runtime execution failed.");
      process.exitCode = 1;
      return;
    }
    const completionSequence = events.nextSequence();
    if (launch.request.operation === "health") {
      writeResultOnce(launch.resultPath, {
        protocolVersion: PROTOCOL_VERSION,
        identity: launch.identity,
        completionSequence,
        health: outcome.health,
      });
    } else {
      finalizeProjection(current, "completed");
      writeResultOnce(launch.resultPath, {
        protocolVersion: PROTOCOL_VERSION,
        identity: launch.identity,
        completionSequence,
        run: projectionBytes(current).projection,
      });
    }
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (stop.requested()) {
      if (launch.request.operation === "run") finalizeProjection(current, "aborted");
      return;
    }
    if (launch.request.operation === "run") finalizeProjection(current, "failed", error);
    events.failed("WORKER_FAILED", "Cinema Runtime execution failed.");
    process.exitCode = 1;
    console.error(`[runtime-v2-${agentKind}-worker] execution failed:`, error);
  } finally {
    try {
      await heartbeat?.stop();
    } catch {
      process.exitCode = 1;
    }
    stop.close();
  }
}
