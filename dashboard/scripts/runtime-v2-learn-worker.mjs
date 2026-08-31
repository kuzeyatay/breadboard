import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";
import { createSealedRuntimeV2QuartzPublishExecutor } from "./runtime-v2-quartz-publish-executor.mjs";

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
const OPERATIONS = new Set([
  "plan",
  "generate",
  "confirm",
  "confirm_generate",
  "repair",
  "rebuild",
  "humanizer",
  "recovery",
]);
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
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function readBoundedJson(filePath, maximumBytes, label) {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} is not a regular file.`);
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
    fail("The worker start identity is invalid.");
  }
  return {
    jobId: value.jobId,
    attempt: value.attempt,
    workerInstanceId: value.workerInstanceId,
  };
}

function validNullableScopeId(value) {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      Buffer.byteLength(value, "utf8") <= 256 &&
      /^[\x21-\x7E]+$/u.test(value))
  );
}

function validateExecutionScope(value) {
  if (
    !hasExactKeys(value, ["userId", "gardenId", "conversationId"]) ||
    (value.userId !== null &&
      (!Number.isSafeInteger(value.userId) || value.userId < 1)) ||
    !validNullableScopeId(value.gardenId) ||
    !validNullableScopeId(value.conversationId)
  ) {
    fail("The worker execution scope is invalid.");
  }
  return {
    userId: value.userId,
    gardenId: value.gardenId,
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
    fail("The worker start manifest path escapes the Runtime V2 data root.");
  }
  return resolved;
}

export function loadRuntimeV2LearnLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The Runtime V2 Learn worker requires exactly the fixed start.json argument.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const startPath = path.join(canonicalLaunchDirectory, START_MANIFEST_FILE);
  const manifest = readBoundedJson(
    startPath,
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
    fail("The worker start manifest has an unsupported shape or protocol version.");
  }
  const identity = validateIdentity(manifest.identity);
  if (!Array.isArray(manifest.inputBlobs) || manifest.inputBlobs.length !== 0) {
    fail("The Runtime V2 Learn worker does not accept input blobs.");
  }
  const executionScope = validateExecutionScope(manifest.executionScope);
  const expected = expectedWorkerPaths(identity);
  for (const field of [
    "inputManifestPath",
    "workspacePath",
    "checkpointPath",
    "resultPath",
  ]) {
    if (manifest[field] !== expected[field]) {
      fail(`The worker start manifest ${field} is not bound to its exact identity.`);
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
    fail("The worker launch directory is not bound to its start identity.");
  }

  const inputPath = resolveDataPath(dataRoot, manifest.inputManifestPath);
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const resultPath = resolveDataPath(dataRoot, manifest.resultPath);
  if (!fs.lstatSync(workspacePath).isDirectory()) {
    fail("The Runtime V2 private worker workspace is unavailable.");
  }
  return {
    dataRoot,
    identity,
    executionScope,
    inputPath,
    workspacePath,
    resultPath,
    resultRelativePath: manifest.resultPath,
    request: readBoundedJson(
      inputPath,
      MAX_INPUT_MANIFEST_BYTES,
      "The canonical Learn request",
    ),
  };
}

export function bindRuntimeV2LearnRequest(
  value,
  executionScope,
  authoritativeContentPath,
) {
  if (!isRecord(value)) fail("The Runtime V2 Learn request is invalid.");
  for (const field of ["userId", "gardenId", "conversationId"]) {
    if (Object.hasOwn(value, field)) {
      fail(`The Learn request must not duplicate authenticated ${field}.`);
    }
  }
  const scope = validateExecutionScope(executionScope);
  if (value.operation === "recovery") {
    if (
      !hasExactKeys(value, ["operation"]) ||
      scope.userId !== null ||
      scope.gardenId !== null ||
      scope.conversationId !== null
    ) {
      fail("Learn recovery requires the unscoped native scheduler authority.");
    }
    return validateRuntimeV2LearnRequest(
      { operation: "recovery", contentPath: authoritativeContentPath },
      authoritativeContentPath,
    );
  }
  if (scope.userId === null || scope.gardenId === null) {
    fail("Learn requires an authenticated user and garden scope.");
  }
  return validateRuntimeV2LearnRequest(
    {
      ...value,
      userId: scope.userId,
      gardenId: scope.gardenId,
      contentPath: value.contentPath ?? authoritativeContentPath,
    },
    authoritativeContentPath,
  );
}

function optionalStringArray(candidate) {
  return (
    candidate === undefined ||
    (Array.isArray(candidate) &&
      candidate.every((entry) => typeof entry === "string" && entry.trim()))
  );
}

function nonEmptyUniqueStringArray(candidate) {
  return (
    Array.isArray(candidate) &&
    candidate.length > 0 &&
    candidate.every((entry) => typeof entry === "string" && entry.trim()) &&
    new Set(candidate.map((entry) => entry.trim())).size === candidate.length
  );
}

function optionalString(candidate) {
  return (
    candidate === undefined ||
    (typeof candidate === "string" && Boolean(candidate.trim()))
  );
}

function optionalLearnUserInstruction(candidate) {
  return (
    candidate === undefined ||
    (typeof candidate === "string" &&
      Boolean(candidate.trim()) &&
      candidate.trim().length <= 4_000)
  );
}

function nullableNonEmptyString(candidate) {
  return candidate === null || (typeof candidate === "string" && Boolean(candidate.trim()));
}

export function validateRuntimeV2LearnRequest(value, authoritativeContentPath) {
  if (!isRecord(value) || !OPERATIONS.has(value.operation)) {
    fail("The Runtime V2 Learn request is invalid.");
  }
  if (value.operation === "recovery") {
    if (
      !hasExactKeys(value, ["operation", "contentPath"]) ||
      typeof value.contentPath !== "string" ||
      !samePath(value.contentPath, authoritativeContentPath)
    ) {
      fail("The Runtime V2 Learn recovery request is invalid.");
    }
    return value;
  }
  if (
    typeof value.gardenId !== "string" ||
    !value.gardenId.trim() ||
    !Number.isSafeInteger(value.userId) ||
    value.userId <= 0 ||
    typeof value.contentPath !== "string" ||
    !samePath(value.contentPath, authoritativeContentPath)
  ) {
    fail("The Learn request is missing or mismatches its garden data authority.");
  }
  if (
    value.operation !== "humanizer" &&
    value.operation !== "confirm" &&
    (typeof value.baseURL !== "string" ||
      !value.baseURL.trim() ||
      typeof value.model !== "string" ||
      !value.model.trim())
  ) {
    fail("The Learn worker model request is incomplete.");
  }
  switch (value.operation) {
    case "plan":
      if (
        !nonEmptyUniqueStringArray(value.includedSourceIds) ||
        !nullableNonEmptyString(value.syllabusSourceId) ||
        (typeof value.syllabusSourceId === "string" &&
          value.includedSourceIds.some(
            (sourceId) => sourceId.trim() === value.syllabusSourceId.trim(),
          )) ||
        typeof value.sourceOnly !== "boolean" ||
        typeof value.includeSourceSnapshots !== "boolean" ||
        typeof value.autoConfirmTopicMap !== "boolean" ||
        !optionalLearnUserInstruction(value.userInstruction)
      ) {
        fail("The Learn planning request is invalid.");
      }
      break;
    case "generate":
      if (
        typeof value.expectedModel !== "string" ||
        !value.expectedModel.trim() ||
        value.model !== value.expectedModel.trim() ||
        typeof value.requestedConfirmedLearningMapId !== "string" ||
        !value.requestedConfirmedLearningMapId.trim() ||
        !optionalStringArray(value.includedSourceIds) ||
        typeof value.sourceOnly !== "boolean" ||
        typeof value.includeSourceSnapshots !== "boolean"
      ) {
        fail("The Learn generation request is invalid.");
      }
      break;
    case "confirm":
      if (
        typeof value.expectedModel !== "string" ||
        !value.expectedModel.trim() ||
        typeof value.proposedLearningMapId !== "string" ||
        !value.proposedLearningMapId.trim()
      ) {
        fail("The Learn confirmation request is invalid.");
      }
      break;
    case "confirm_generate":
      if (
        typeof value.expectedModel !== "string" ||
        !value.expectedModel.trim() ||
        value.model !== value.expectedModel.trim() ||
        typeof value.proposedLearningMapId !== "string" ||
        !value.proposedLearningMapId.trim() ||
        typeof value.sourceOnly !== "boolean" ||
        typeof value.includeSourceSnapshots !== "boolean"
      ) {
        fail("The Learn confirmation-and-generation request is invalid.");
      }
      break;
    case "repair":
      if (
        !isRecord(value.request) ||
        value.request.gardenId !== value.gardenId ||
        value.request.mode !== "repair"
      ) {
        fail("The Learn repair request is invalid.");
      }
      break;
    case "rebuild":
      if (
        !optionalStringArray(value.includedSourceIds) ||
        !optionalString(value.syllabusSourceId) ||
        typeof value.sourceOnly !== "boolean" ||
        typeof value.includeSourceSnapshots !== "boolean" ||
        !optionalLearnUserInstruction(value.userInstruction)
      ) {
        fail("The Learn rebuild request is invalid.");
      }
      break;
    case "humanizer":
      if (
        typeof value.enabled !== "boolean" ||
        !optionalString(value.expectedVersionId)
      ) {
        fail("The Learn humanizer request is invalid.");
      }
      break;
    case "recovery":
      break;
  }
  return value;
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
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "learn-operation-executor.ts"),
  );
  const dashboardRoot = development ? dashboardMarkerRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  const quartzSourceRoot = path.join(
    appRoot,
    development ? "quartz" : "quartz-template",
  );
  if (
    !fs.existsSync(path.join(sourceRoot, "lib", "learn-operation-executor.ts")) ||
    !fs.existsSync(path.join(sourceRoot, "lib", "learn.ts"))
  ) {
    fail("The staged Runtime V2 Learn source closure is unavailable.");
  }
  return {
    appRoot,
    dashboardRoot,
    development,
    quartzSourceRoot,
    sourceRoot,
  };
}

function configureTrustedLearnEnvironment(launch, request) {
  const layout = sourceLayout();
  const authoritativeContentPath = path.join(launch.dataRoot, "quartz", "content");
  const scopedRequest = bindRuntimeV2LearnRequest(
    request,
    launch.executionScope,
    authoritativeContentPath,
  );
  const historicalDevelopmentData =
    layout.development && samePath(launch.dataRoot, layout.appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData
    ? ""
    : launch.dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = layout.development
    ? layout.dashboardRoot
    : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = layout.sourceRoot;
  process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = layout.dashboardRoot;
  process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = path.join(
    launch.dataRoot,
    "runtime",
    "learn-workers",
  );
  process.env.BREADBOARD_REPO_ROOT = layout.appRoot;
  process.env.QUARTZ_CONTENT_PATH = authoritativeContentPath;
  process.env.QUARTZ_AUTO_PUBLISH = "1";
  process.env.COUNCIL_LEDGER_DIR = path.join(
    launch.dataRoot,
    ".breadboard",
    "council-runs",
  );
  process.env.NODE_ENV = layout.development ? "development" : "production";
  if (typeof scopedRequest.baseURL === "string" && scopedRequest.baseURL.trim()) {
    process.env.OPENAI_BASE_URL = scopedRequest.baseURL.trim();
    process.env.CHATMOCK_BASE_URL = scopedRequest.baseURL.trim();
    process.env.OPENAI_API_KEY = "local";
  }
  return { layout, request: scopedRequest };
}

function redirectApplicationStdout() {
  const diagnosticWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) =>
    diagnosticWrite(chunk, encoding, callback);
}

export function parseRuntimeV2StopRecord(line) {
  const bytes = Buffer.from(line, "utf8");
  if (
    bytes.byteLength < 2 ||
    bytes.byteLength > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) {
    fail("The Runtime V2 worker stop record is invalid.");
  }
  let parsed;
  try {
    parsed = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The Runtime V2 worker stop record is not valid JSON.");
  }
  if (!hasExactKeys(parsed, ["type", "force"]) || parsed.type !== "stop" || parsed.force !== false) {
    fail("The Runtime V2 worker stop record is invalid.");
  }
  return parsed;
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
      onProtocolFault(new Error("The Runtime V2 worker stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2StopRecord(line);
      if (remainder.length > 0 || stopRequested) {
        fail("The Runtime V2 worker received more than one stop record.");
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
  const bytes = Buffer.from(raw || "Learn execution failed.", "utf8");
  if (bytes.byteLength <= MAX_FAILURE_MESSAGE_BYTES) return bytes.toString("utf8");
  return bytes.subarray(0, MAX_FAILURE_MESSAGE_BYTES).toString("utf8").replace(/\uFFFD+$/u, "");
}

function failureCode(error) {
  const name = error && typeof error === "object" ? error.name : "";
  if (name === "LearnPipelineConflictError" || name === "LearnRepairPendingMapError") {
    return "LEARN_CONFLICT";
  }
  return "LEARN_WORKER_FAILED";
}

export function serializeRuntimeV2LearnResult({
  identity,
  completionSequence,
  operation,
  learnJobId,
  value,
}) {
  const bytes = Buffer.from(
    `${JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      identity,
      completionSequence,
      result: {
        operation,
        learnJobId: learnJobId ?? null,
        value: value ?? null,
      },
    })}\n`,
    "utf8",
  );
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The durable Learn result exceeded its bounded envelope.");
  }
  return bytes;
}

function writeResultOnce(resultPath, bytes) {
  const parent = path.dirname(resultPath);
  if (!fs.lstatSync(parent).isDirectory()) {
    fail("The durable Learn result directory is unavailable.");
  }
  try {
    fs.lstatSync(resultPath);
    fail("The durable Learn result already exists.");
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

async function runRuntimeV2LearnWorker() {
  redirectApplicationStdout();
  const launch = loadRuntimeV2LearnLaunch();
  const { layout, request } = configureTrustedLearnEnvironment(
    launch,
    launch.request,
  );
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: `learn-${request.operation}`,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
  let learnJobId = null;
  let cancelLearn = null;
  let cancellationTask = null;
  let protocolFault = null;
  let heartbeat = null;
  const quartzAbortController = new AbortController();
  const requestLearnCancellation = () => {
    if (!cancelLearn || !learnJobId || cancellationTask) return cancellationTask;
    cancellationTask = Promise.resolve(
      cancelLearn({
        gardenId: request.gardenId,
        contentPath: request.contentPath,
        expectedJobId: learnJobId,
      }),
    ).catch((error) => {
      console.error("[runtime-v2-learn-worker] Durable Learn cancellation failed:", error);
    });
    return cancellationTask;
  };
  const stop = startStopInput(
    () => {
      events.cancellationAcknowledged();
      quartzAbortController.abort(new Error("Learn Quartz publication was canceled."));
      void requestLearnCancellation();
    },
    (error) => {
      protocolFault = error;
      console.error("[runtime-v2-learn-worker] Invalid supervisor input:", error);
    },
  );

  events.ready();

  try {
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    if (stop.requested()) return;
    await import(pathToFileURL(path.join(path.dirname(ENTRYPOINT_PATH), "learn-worker-import-hook.mjs")).href);
    const quartzPublishModule = await import(
      pathToFileURL(path.join(layout.sourceRoot, "lib", "quartz-publish.ts")).href
    );
    if (typeof quartzPublishModule.installSealedRuntimeV2QuartzPublishExecutor !== "function") {
      fail("The sealed Runtime V2 Quartz publication bridge is unavailable.");
    }
    quartzPublishModule.installSealedRuntimeV2QuartzPublishExecutor(
      createSealedRuntimeV2QuartzPublishExecutor({
        identity: launch.identity,
        dataRoot: launch.dataRoot,
        contentPath: request.contentPath,
        sourceRoot: layout.quartzSourceRoot,
        workspacePath: launch.workspacePath,
        signal: quartzAbortController.signal,
      }),
    );
    const learnUrl = pathToFileURL(path.join(layout.sourceRoot, "lib", "learn.ts")).href;
    let value;
    if (request.operation === "recovery") {
      const learnModule = await import(learnUrl);
      if (typeof learnModule.recoverAbandonedLearnJobs !== "function") {
        fail("The Runtime V2 Learn recovery export is unavailable.");
      }
      value = await learnModule.recoverAbandonedLearnJobs({
        contentPath: request.contentPath,
      });
    } else {
      const executorUrl = pathToFileURL(
        path.join(layout.sourceRoot, "lib", "learn-operation-executor.ts"),
      ).href;
      const bindingUrl = pathToFileURL(
        path.join(layout.sourceRoot, "lib", "runtime-v2", "learn-binding.ts"),
      ).href;
      const [{ executeAdmittedLearnOperation }, learnModule, bindingModule] = await Promise.all([
        import(executorUrl),
        import(learnUrl),
        import(bindingUrl),
      ]);
      if (
        typeof executeAdmittedLearnOperation !== "function" ||
        typeof learnModule.cancelLatestLearnJob !== "function" ||
        typeof bindingModule.writeRuntimeV2LearnBinding !== "function"
      ) {
        fail("The Runtime V2 Learn execution exports are unavailable.");
      }
      cancelLearn = learnModule.cancelLatestLearnJob;
      if (stop.requested()) return;

      value = await executeAdmittedLearnOperation(
        request,
        async (jobId) => {
          if (typeof jobId !== "string" || !jobId.trim()) {
            fail("Learn reached its durable handoff without a job identity.");
          }
          bindingModule.writeRuntimeV2LearnBinding({
            contentPath: request.contentPath,
            gardenId: request.gardenId,
            userId: request.userId,
            runtimeJobId: launch.identity.jobId,
            learnJobId: jobId,
          });
          learnJobId = jobId;
          if (stop.requested()) await requestLearnCancellation();
        },
      );
    }
    if (cancellationTask) await cancellationTask;
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;

    await heartbeat.stop();
    if (cancellationTask) await cancellationTask;
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;
    const completionSequence = events.nextSequence();
    const result = serializeRuntimeV2LearnResult({
      identity: launch.identity,
      completionSequence,
      operation: request.operation,
      learnJobId,
      value,
    });
    writeResultOnce(launch.resultPath, result);
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (stop.requested()) {
      if (cancellationTask) await cancellationTask;
      return;
    }
    events.failed(failureCode(error), SANITIZED_RUNTIME_FAILURE_MESSAGE);
    process.exitCode = 1;
    console.error("[runtime-v2-learn-worker] Learn execution failed:", error);
  } finally {
    try {
      await heartbeat?.stop();
    } catch (error) {
      console.error(
        "[runtime-v2-learn-worker] Heartbeat thread shutdown failed:",
        error,
      );
    }
    stop.close();
  }
}

const invokedAsEntrypoint =
  typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT_PATH);
if (invokedAsEntrypoint) {
  void runRuntimeV2LearnWorker().catch((error) => {
    // Startup failures before an identity is trusted cannot emit a fenced
    // worker event. A nonzero exit lets the native owner classify that exact
    // attempt without accepting attacker-controlled stdout.
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[runtime-v2-learn-worker] Startup failed: ${boundedFailureMessage(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
