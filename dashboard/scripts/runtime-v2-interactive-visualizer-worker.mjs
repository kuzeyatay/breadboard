import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { executeInteractiveVisualizerPublication } from
  "./runtime-v2-interactive-visualizer-executor.mjs";
import { createRuntimeV2WorkerEventWriter } from
  "./runtime-v2-worker-events.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 8 * 1024;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
const HEARTBEAT_INTERVAL_MS = 5_000;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
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
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative));
}

function readBoundedJson(filePath, maximumBytes, label) {
  const metadata = fs.lstatSync(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
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

function boundedText(value, maximumBytes = 512) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function validateIdentity(value) {
  if (
    !hasExactKeys(value, ["jobId", "attempt", "workerInstanceId"]) ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) {
    fail("The interactive visualizer worker identity is invalid.");
  }
  return value;
}

function validateExecutionScope(value) {
  if (
    !hasExactKeys(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    (value.gardenId !== null && !boundedText(value.gardenId, 256)) ||
    !boundedText(value.conversationId, 256)
  ) {
    fail("Interactive visualizer processing requires exact conversation scope.");
  }
  return value;
}

function expectedWorkerPaths(identity) {
  const jobRoot = `runtime/jobs/${identity.jobId}`;
  const attemptRoot =
    `${jobRoot}/attempts/${identity.attempt}/${identity.workerInstanceId}`;
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
    typeof relativePath !== "string" ||
    relativePath.includes("\\") ||
    relativePath.split("/").length < 2 ||
    relativePath.split("/").some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    fail("The interactive visualizer worker path is invalid.");
  }
  const resolved = path.resolve(dataRoot, ...relativePath.split("/"));
  if (!pathWithin(dataRoot, resolved)) {
    fail("The interactive visualizer worker path escaped the data root.");
  }
  return resolved;
}

function validateRequest(value) {
  if (
    !hasExactKeys(value, ["protocolVersion", "operation", "runtimeSessionId"]) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.operation !== "compile-test" ||
    !Number.isSafeInteger(value.runtimeSessionId) ||
    value.runtimeSessionId < 1
  ) {
    fail("The canonical interactive visualizer request is invalid.");
  }
  return value;
}

function validateInputBlob(value, identity) {
  const match = isRecord(value) && typeof value.relativePath === "string"
    ? /^runtime\/jobs\/([A-Za-z0-9_-]{1,128})\/inputs\/([A-Za-z0-9_-]{1,128})\/payload$/u
      .exec(value.relativePath)
    : null;
  if (
    !hasExactKeys(value, [
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
    value.sizeBytes > MAX_SOURCE_BYTES ||
    !SHA256.test(value.sha256) ||
    value.displayName !== "interactive-visualizer-source.json" ||
    value.mediaType !== "application/vnd.breadboard.interactive-visualizer+json"
  ) {
    fail("The authoritative interactive visualizer input blob is invalid.");
  }
  return value;
}

export function loadRuntimeV2InteractiveVisualizerLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The interactive visualizer worker requires exactly start.json.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(
    path.resolve(launchDirectory),
  );
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The interactive visualizer start manifest",
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
    fail("The interactive visualizer start manifest is invalid.");
  }
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  const expected = expectedWorkerPaths(identity);
  for (const field of [
    "inputManifestPath",
    "workspacePath",
    "checkpointPath",
    "resultPath",
  ]) {
    if (manifest[field] !== expected[field]) {
      fail(`The interactive visualizer ${field} is not identity-bound.`);
    }
  }
  let dataRoot = canonicalLaunchDirectory;
  for (
    let index = 0;
    index < expected.attemptRoot.split("/").length;
    index += 1
  ) {
    dataRoot = path.dirname(dataRoot);
  }
  if (
    !samePath(
      canonicalLaunchDirectory,
      resolveDataPath(dataRoot, expected.attemptRoot),
    )
  ) {
    fail("The interactive visualizer launch directory is not identity-bound.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspace = fs.lstatSync(workspacePath);
  if (!workspace.isDirectory() || workspace.isSymbolicLink()) {
    fail("The interactive visualizer private workspace is unavailable.");
  }
  const request = validateRequest(readBoundedJson(
    resolveDataPath(dataRoot, manifest.inputManifestPath),
    MAX_INPUT_MANIFEST_BYTES,
    "The canonical interactive visualizer request",
  ));
  if (!Array.isArray(manifest.inputBlobs) || manifest.inputBlobs.length !== 1) {
    fail("The interactive visualizer worker requires one sealed source blob.");
  }
  const inputBlob = validateInputBlob(manifest.inputBlobs[0], identity);
  return {
    dataRoot,
    identity,
    executionScope,
    request,
    inputBlob,
    workspacePath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
  };
}

export function parseRuntimeV2InteractiveVisualizerStopRecord(line) {
  if (
    typeof line !== "string" ||
    Buffer.byteLength(line, "utf8") < 2 ||
    Buffer.byteLength(line, "utf8") > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) {
    fail("The interactive visualizer stop record is invalid.");
  }
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The interactive visualizer stop record is not valid JSON.");
  }
  if (
    !hasExactKeys(value, ["type", "force"]) ||
    value.type !== "stop" ||
    value.force !== false
  ) {
    fail("The interactive visualizer stop record is invalid.");
  }
  return value;
}

function startStopInput(onStop, onFault) {
  let buffered = "";
  let requested = false;
  let poisoned = false;
  process.stdin.setEncoding("utf8");
  const onData = (chunk) => {
    if (poisoned) return;
    buffered += chunk;
    if (Buffer.byteLength(buffered, "utf8") > MAX_STOP_RECORD_BYTES) {
      poisoned = true;
      onFault(new Error("The interactive visualizer stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2InteractiveVisualizerStopRecord(line);
      if (requested || remainder) {
        fail("The interactive visualizer worker received multiple stop records.");
      }
      requested = true;
      onStop();
    } catch (error) {
      poisoned = true;
      onFault(error);
    }
  };
  process.stdin.on("data", onData);
  process.stdin.resume();
  return {
    requested: () => requested,
    close: () => {
      process.stdin.off("data", onData);
      process.stdin.pause();
    },
  };
}

function sourceLayout() {
  const dashboardMarkerRoot = path.dirname(path.dirname(ENTRYPOINT_PATH));
  const appRoot = path.dirname(dashboardMarkerRoot);
  const developmentSourceRoot = path.join(dashboardMarkerRoot, "src");
  const packagedDashboardRoot = path.join(
    appRoot,
    "dashboard-standalone",
    "dashboard",
  );
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(path.join(
    developmentSourceRoot,
    "lib",
    "hermes",
    "interactive-visualizer-validator.ts",
  ));
  const dashboardRoot = development ? dashboardMarkerRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const name of [
    "interactive-visualizer-validator.ts",
    "interactive-visualizer-custom.ts",
    "interactive-visualizer-runtime.ts",
    "interactive-visualizer-config.ts",
  ]) {
    const source = path.join(sourceRoot, "lib", "hermes", name);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
      fail("The staged interactive visualizer source closure is unavailable.");
    }
  }
  return { appRoot, dashboardRoot, development, sourceRoot };
}

function configureWorkerEnvironment(launch, layout) {
  const historicalDevelopmentData =
    layout.development && samePath(launch.dataRoot, layout.appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData
    ? ""
    : launch.dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = layout.development
    ? layout.dashboardRoot
    : "";
  process.env.BREADBOARD_REPO_ROOT = layout.appRoot;
  process.env.NODE_ENV = layout.development ? "development" : "production";
}

function databasePath(launch, layout) {
  const candidates = layout.development && samePath(launch.dataRoot, layout.appRoot)
    ? [path.join(launch.dataRoot, "dashboard", "db", "brain.db")]
    : [path.join(launch.dataRoot, "database", "brain.db")];
  const target = candidates.find((candidate) => {
    try {
      const metadata = fs.lstatSync(candidate);
      return metadata.isFile() && !metadata.isSymbolicLink();
    } catch {
      return false;
    }
  });
  if (!target) {
    fail("The authoritative Breadboard database is unavailable to the visualizer worker.");
  }
  return fs.realpathSync.native(target);
}

function validateRuntimeSessionAuthority(launch, layout) {
  const database = new DatabaseSync(databasePath(launch, layout), {
    readOnly: true,
  });
  let row;
  try {
    row = database.prepare(`
      SELECT s.user_id AS userId, s.garden_id AS gardenId,
             s.surface AS surface, c.public_id AS conversationPublicId
      FROM hermes_runtime_sessions s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.id = ?
      LIMIT 1
    `).get(launch.request.runtimeSessionId);
  } finally {
    database.close();
  }
  if (
    !isRecord(row) ||
    row.userId !== launch.executionScope.userId ||
    row.gardenId !== launch.executionScope.gardenId ||
    row.conversationPublicId !== launch.executionScope.conversationId ||
    !["dashboard_terminal", "garden_chat"].includes(row.surface)
  ) {
    fail("The visualizer runtime session does not match its authenticated job scope.");
  }
}

function canonicalSource(launch) {
  const sourcePath = resolveDataPath(
    launch.dataRoot,
    launch.inputBlob.relativePath,
  );
  const metadata = fs.lstatSync(sourcePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== launch.inputBlob.sizeBytes ||
    !samePath(fs.realpathSync.native(sourcePath), sourcePath)
  ) {
    fail("The sealed interactive visualizer source is unavailable.");
  }
  const bytes = fs.readFileSync(sourcePath);
  if (
    bytes.byteLength !== metadata.size ||
    createHash("sha256").update(bytes).digest("hex") !== launch.inputBlob.sha256
  ) {
    fail("The sealed interactive visualizer source digest changed.");
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("The sealed interactive visualizer source is not valid JSON.");
  }
  if (
    !hasExactKeys(value, ["protocolVersion", "plan", "package"]) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    !isRecord(value.plan) ||
    !isRecord(value.package)
  ) {
    fail("The sealed interactive visualizer source has an invalid shape.");
  }
  return value;
}

async function loadModules(layout) {
  const load = (name) => import(pathToFileURL(path.join(
    layout.sourceRoot,
    "lib",
    "hermes",
    name,
  )).href);
  const [validator, custom, runtime, config] = await Promise.all([
    load("interactive-visualizer-validator.ts"),
    load("interactive-visualizer-custom.ts"),
    load("interactive-visualizer-runtime.ts"),
    load("interactive-visualizer-config.ts"),
  ]);
  return { validator, custom, runtime, config };
}

function relativeDataPath(dataRoot, filePath) {
  if (!pathWithin(dataRoot, filePath)) {
    fail("The interactive visualizer output escaped the Runtime data root.");
  }
  return path.relative(dataRoot, filePath).split(path.sep).join("/");
}

function writeResultOnce(resultPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The interactive visualizer result exceeded its bound.");
  }
  try {
    fs.lstatSync(resultPath);
    fail("The durable interactive visualizer result already exists.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
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

function redirectApplicationStdout() {
  const diagnosticWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) =>
    diagnosticWrite(chunk, encoding, callback);
}

export async function runRuntimeV2InteractiveVisualizerWorker() {
  redirectApplicationStdout();
  const launch = loadRuntimeV2InteractiveVisualizerLaunch();
  const layout = sourceLayout();
  configureWorkerEnvironment(launch, layout);
  validateRuntimeSessionAuthority(launch, layout);
  const source = canonicalSource(launch);
  const modules = await loadModules(layout);
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "processing",
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
  const abort = new AbortController();
  let heartbeat = null;
  let protocolFault = null;
  let acknowledged = false;
  const acknowledge = () => {
    if (!acknowledged) {
      acknowledged = true;
      events.cancellationAcknowledged();
    }
    abort.abort(new Error("Interactive visualizer processing was cancelled."));
  };
  const stop = startStopInput(acknowledge, (error) => {
    protocolFault = error;
    acknowledge();
  });
  events.ready();
  try {
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    await new Promise((resolve) => setImmediate(resolve));
    if (stop.requested()) return;
    const outputDir = path.join(
      launch.workspacePath,
      "interactive-visualizer-output",
    );
    const config = modules.config.interactiveVisualizerConfig();
    const result = await executeInteractiveVisualizerPublication({
      plan: source.plan,
      packageValue: source.package,
      outputDir,
      modules,
      timeoutMs: config.browserScenarioTimeoutMs,
      signal: abort.signal,
      onStage: (stage, current, total) => events.progress(stage, current, total),
    });
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;
    await heartbeat.stop();
    heartbeat = null;
    const outputRelativePath = result.outputPath
      ? relativeDataPath(launch.dataRoot, result.outputPath)
      : null;
    if (outputRelativePath) events.artifact("artifact", outputRelativePath);
    const completionSequence = events.nextSequence();
    writeResultOnce(launch.resultPath, {
      protocolVersion: PROTOCOL_VERSION,
      identity: launch.identity,
      completionSequence,
      result: {
        status: result.status,
        validation: result.validation,
        manifest: result.manifest,
        sourceHash: result.sourceHash,
        tests: result.tests,
        bundleHash: result.bundleHash,
        outputRelativePath,
        customPackage: result.customPackage,
      },
    });
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (!stop.requested()) {
      events.failed(
        "INTERACTIVE_VISUALIZER_FAILED",
        "Interactive visualizer processing failed.",
      );
      process.exitCode = 1;
      console.error("[runtime-v2-interactive-visualizer-worker] Failed:", error);
    }
  } finally {
    try {
      await heartbeat?.stop();
    } catch (error) {
      process.exitCode = 1;
      console.error(
        "[runtime-v2-interactive-visualizer-worker] Heartbeat shutdown failed:",
        error,
      );
    }
    stop.close();
  }
}

const invokedAsEntrypoint =
  typeof process.argv[1] === "string" &&
  samePath(process.argv[1], ENTRYPOINT_PATH);
if (invokedAsEntrypoint) {
  void runRuntimeV2InteractiveVisualizerWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[runtime-v2-interactive-visualizer-worker] Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
