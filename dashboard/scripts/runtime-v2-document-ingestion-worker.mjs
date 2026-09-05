import { createHash } from "node:crypto";
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
const MAX_CHECKPOINT_BYTES = 8 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
const MAX_FAILURE_MESSAGE_BYTES = 8 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PROGRESS_CHECKPOINTS = 512;
const HEARTBEAT_INTERVAL_MS = 5_000;
const SANITIZED_RUNTIME_FAILURE_MESSAGE = "Runtime job execution failed.";
const PUBLIC_INGEST_VISION_WARNING =
  "Vision processing was incomplete for this document.";
const PUBLIC_INGEST_DOCUMENT_WARNING =
  "Some document content or page previews could not be processed.";
const PUBLIC_INGEST_MAP_WARNING =
  "Map generation failed, so the source was saved without extracted lesson topics. You can retry with Learn after upload.";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const VLM_TASKS = new Set([
  "doc_parse",
  "structured_parse",
  "layout_parse",
  "chart_parse",
  "formula",
  "table",
]);
const TEST_INGESTION_FAULT_POINTS = new Set([
  "after-garden-mutations",
  "after-result-prepare",
  "after-result-write",
  "after-garden-commit",
  "after-terminal-event",
]);
const ENTRYPOINT_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function triggerTestIngestionFault(point) {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.BREADBOARD_RUNTIME_V2_FAULT_INJECTION === "test-only" &&
    process.env.BREADBOARD_RUNTIME_V2_INGEST_FAULT_POINT === point &&
    TEST_INGESTION_FAULT_POINTS.has(point)
  ) {
    fs.writeSync(
      2,
      `[runtime-v2-ingestion-worker] injected abrupt exit at ${point}\n`,
    );
    process.exit(86);
  }
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
      value.trim().length > 0 &&
      Buffer.byteLength(value, "utf8") <= 256 &&
      !/\p{Cc}/u.test(value))
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
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\"),
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

function boundedText(value, maximumBytes) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value)
  );
}

function validateFileName(value) {
  if (
    !boundedText(value, 512) ||
    value === "." ||
    value === ".." ||
    value !== path.basename(value) ||
    /[\\/]/u.test(value)
  ) {
    fail("The canonical ingestion blob filename is invalid.");
  }
  return value;
}

function validateChatmockBaseUrl(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 2048) {
    fail("The canonical ingestion model endpoint is invalid.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("The canonical ingestion model endpoint is invalid.");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname.replace(/\/+$/u, "") !== "/v1"
  ) {
    fail(
      "The canonical ingestion model endpoint must be a normalized HTTP(S) /v1 service.",
    );
  }
  return parsed.toString().replace(/\/+$/u, "");
}

export function validateRuntimeV2DocumentIngestionRequest(
  value,
  executionScope,
) {
  if (
    !hasExactKeys(value, [
      "sourceLabel",
      "isHandwriting",
      "parseWithVlm",
      "parseWithAnydoc",
      "vlmTask",
      "generateMap",
      "model",
      "chatmockBaseUrl",
      "maximumUploadBytes",
    ])
  ) {
    fail("The canonical document-ingestion request is invalid.");
  }
  const scope = validateExecutionScope(executionScope);
  if (scope.userId === null || scope.gardenId === null) {
    fail("Document ingestion requires an authenticated user and garden scope.");
  }
  for (const field of [
    "blob",
    "userId",
    "gardenId",
    "conversationId",
    "path",
    "filePath",
  ]) {
    if (Object.hasOwn(value, field)) {
      fail(`The ingestion request must not carry caller-selected ${field}.`);
    }
  }
  if (
    !Number.isSafeInteger(value.maximumUploadBytes) ||
    value.maximumUploadBytes < 16 * 1024 * 1024 ||
    value.maximumUploadBytes > MAX_UPLOAD_BYTES
  ) {
    fail("The canonical ingestion upload limit is invalid.");
  }
  const sourceLabel =
    value.sourceLabel === null
      ? "upload"
      : boundedText(value.sourceLabel, 256)
        ? value.sourceLabel.trim()
        : fail("The canonical ingestion source label is invalid.");
  if (
    typeof value.isHandwriting !== "boolean" ||
    typeof value.parseWithVlm !== "boolean" ||
    typeof value.parseWithAnydoc !== "boolean" ||
    !VLM_TASKS.has(value.vlmTask) ||
    typeof value.generateMap !== "boolean"
  ) {
    fail("The canonical document-ingestion options are invalid.");
  }
  if (!boundedText(value.model, 256)) {
    fail("The canonical ingestion model is invalid.");
  }
  const model = value.model.trim();
  let chatmockBaseUrl = null;
  if (value.generateMap) {
    chatmockBaseUrl = validateChatmockBaseUrl(value.chatmockBaseUrl);
  } else if (value.chatmockBaseUrl !== null) {
    fail("A non-generating ingestion request must not carry a model endpoint.");
  }
  return {
    sourceLabel,
    isHandwriting: value.isHandwriting,
    parseWithVlm: value.parseWithVlm,
    parseWithAnydoc: value.parseWithAnydoc,
    vlmTask: value.vlmTask,
    generateMap: value.generateMap,
    model,
    chatmockBaseUrl,
    maximumUploadBytes: value.maximumUploadBytes,
  };
}

function validateWorkerInputBlob(
  value,
  maximumUploadBytes,
  expectedJobId = null,
) {
  const pathMatch =
    isRecord(value) && typeof value.relativePath === "string"
      ? /^runtime\/jobs\/([A-Za-z0-9_-]{1,128})\/inputs\/([A-Za-z0-9_-]{1,128})\/payload$/u.exec(
          value.relativePath,
        )
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
    (expectedJobId !== null && !IDENTIFIER.test(expectedJobId)) ||
    pathMatch === null ||
    pathMatch[2] !== value.blobId ||
    (expectedJobId !== null && pathMatch[1] !== expectedJobId) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > maximumUploadBytes ||
    value.sizeBytes > MAX_UPLOAD_BYTES ||
    !SHA256.test(value.sha256) ||
    (value.mediaType !== null && !boundedText(value.mediaType, 256))
  ) {
    fail("The authoritative ingestion input blob is invalid.");
  }
  return {
    blobId: value.blobId,
    relativePath: value.relativePath,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    displayName: validateFileName(value.displayName),
    mediaType: value.mediaType ?? "application/octet-stream",
  };
}

export function loadRuntimeV2DocumentIngestionLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail(
      "The Runtime V2 ingestion worker requires exactly the fixed start.json argument.",
    );
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(
    path.resolve(launchDirectory),
  );
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
    fail(
      "The worker start manifest has an unsupported shape or protocol version.",
    );
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
      fail(
        `The worker start manifest ${field} is not bound to its exact identity.`,
      );
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
    fail("The worker launch directory is not bound to its start identity.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  if (!fs.lstatSync(workspacePath).isDirectory()) {
    fail("The Runtime V2 private worker workspace is unavailable.");
  }
  const request = validateRuntimeV2DocumentIngestionRequest(
    readBoundedJson(
      resolveDataPath(dataRoot, manifest.inputManifestPath),
      MAX_INPUT_MANIFEST_BYTES,
      "The canonical document-ingestion request",
    ),
    executionScope,
  );
  if (!Array.isArray(manifest.inputBlobs) || manifest.inputBlobs.length !== 1) {
    fail("Document ingestion requires exactly one authoritative input blob.");
  }
  const inputBlob = validateWorkerInputBlob(
    manifest.inputBlobs[0],
    request.maximumUploadBytes,
    identity.jobId,
  );
  return {
    dataRoot,
    identity,
    executionScope,
    workspacePath,
    checkpointPath: resolveDataPath(dataRoot, manifest.checkpointPath),
    checkpointRelativePath: manifest.checkpointPath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
    inputBlob,
    request,
  };
}

export function canonicalRuntimeV2IngestBlobPath(
  dataRoot,
  inputBlob,
  expectedJobId = null,
) {
  const validated = validateWorkerInputBlob(
    inputBlob,
    MAX_UPLOAD_BYTES,
    expectedJobId,
  );
  return resolveDataPath(dataRoot, validated.relativePath);
}

function hashOpenFile(descriptor, sizeBytes) {
  const digest = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let offset = 0;
  while (offset < sizeBytes) {
    const length = Math.min(chunk.byteLength, sizeBytes - offset);
    const read = fs.readSync(descriptor, chunk, 0, length, offset);
    if (read < 1)
      fail("The canonical ingestion blob ended before its declared size.");
    digest.update(chunk.subarray(0, read));
    offset += read;
  }
  return digest.digest("hex");
}

export function openCanonicalRuntimeV2IngestBlob(launch) {
  const blobPath = canonicalRuntimeV2IngestBlobPath(
    launch.dataRoot,
    launch.inputBlob,
    launch.identity.jobId,
  );
  const metadata = fs.lstatSync(blobPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail("The canonical ingestion blob is not a regular file.");
  }
  const realBlobPath = fs.realpathSync.native(blobPath);
  if (!samePath(realBlobPath, blobPath)) {
    fail("The canonical ingestion blob contains an indirect path.");
  }
  const descriptor = fs.openSync(realBlobPath, "r");
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.size !== launch.inputBlob.sizeBytes ||
      opened.size > launch.request.maximumUploadBytes ||
      opened.size > MAX_UPLOAD_BYTES
    ) {
      fail(
        "The canonical ingestion blob size does not match its bounded metadata.",
      );
    }
    if (hashOpenFile(descriptor, opened.size) !== launch.inputBlob.sha256) {
      fail("The canonical ingestion blob digest does not match its metadata.");
    }
    const checked = fs.fstatSync(descriptor);
    if (checked.size !== opened.size || checked.mtimeMs !== opened.mtimeMs) {
      fail("The canonical ingestion blob changed while it was verified.");
    }
    let cachedBytes = null;
    return {
      blobPath: realBlobPath,
      file: {
        name: launch.inputBlob.displayName,
        type: launch.inputBlob.mediaType,
        size: opened.size,
        async readBuffer() {
          if (!cachedBytes) {
            cachedBytes = fs.readFileSync(descriptor);
            if (cachedBytes.byteLength !== opened.size) {
              fail("The canonical ingestion blob changed while it was read.");
            }
          }
          return cachedBytes;
        },
        async text() {
          return (await this.readBuffer()).toString("utf8");
        },
      },
      close() {
        fs.closeSync(descriptor);
      },
    };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
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
    path.join(developmentSourceRoot, "lib", "runtime-v2", "ingest-executor.ts"),
  );
  const dashboardRoot = development
    ? dashboardMarkerRoot
    : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  const quartzSourceRoot = path.join(
    appRoot,
    development ? "quartz" : "quartz-template",
  );
  for (const relativePath of [
    path.join("lib", "runtime-v2", "ingest-executor.ts"),
    path.join("lib", "knowledge.ts"),
    path.join("lib", "ingest-token-usage.ts"),
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, relativePath))) {
      fail("The staged Runtime V2 ingestion source closure is unavailable.");
    }
  }
  return {
    appRoot,
    dashboardRoot,
    development,
    quartzSourceRoot,
    sourceRoot,
  };
}

function trustedQuartzSourceRoot(layout) {
  const testOverride =
    process.env.BREADBOARD_RUNTIME_V2_TEST_QUARTZ_SOURCE_ROOT?.trim() ?? "";
  if (!testOverride) return layout.quartzSourceRoot;
  if (
    process.env.BREADBOARD_RUNTIME_V2_FAULT_INJECTION !== "test-only" ||
    !path.isAbsolute(testOverride) ||
    testOverride.includes("\0")
  ) {
    fail("The Runtime V2 ingestion Quartz test source is invalid.");
  }
  return testOverride;
}

function configureTrustedIngestionEnvironment(launch, layout) {
  const historicalDevelopmentData =
    layout.development && samePath(launch.dataRoot, layout.appRoot);
  const contentPath = path.join(launch.dataRoot, "quartz", "content");
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData
    ? ""
    : launch.dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = layout.development
    ? layout.dashboardRoot
    : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = layout.sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = layout.appRoot;
  process.env.QUARTZ_CONTENT_PATH = contentPath;
  process.env.COUNCIL_LEDGER_DIR = path.join(
    launch.dataRoot,
    ".breadboard",
    "council-runs",
  );
  process.env.NODE_ENV = layout.development ? "development" : "production";
  // Keep the domain writer's legacy publication hook disabled until the
  // external ingestion transaction commits and seals. The sealed worker then
  // enables its explicitly attested Quartz descendant for that one boundary.
  process.env.QUARTZ_AUTO_PUBLISH = "0";
  // A disposable ingestion worker may only probe the endpoint synthesized by
  // its sealed Runtime profile. The native dispatcher owns the conditional
  // vlm-ocr service lease and never delegates process lifecycle to this worker.
  process.env.VLM_OCR_AUTO_START = "0";
  if (launch.request.chatmockBaseUrl) {
    process.env.OPENAI_BASE_URL = launch.request.chatmockBaseUrl;
    process.env.CHATMOCK_BASE_URL = launch.request.chatmockBaseUrl;
    process.env.OPENAI_API_KEY = "local";
  }
  return contentPath;
}

function redirectApplicationStdout() {
  const diagnosticWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) =>
    diagnosticWrite(chunk, encoding, callback);
}

export function createRuntimeV2IngestionEventWriter(
  identity,
  { heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS } = {},
) {
  return createRuntimeV2WorkerEventWriter(identity, {
    heartbeatStage: "processing",
    heartbeatIntervalMs,
  });
}

export function parseRuntimeV2IngestionStopRecord(line) {
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
  if (
    !hasExactKeys(parsed, ["type", "force"]) ||
    parsed.type !== "stop" ||
    parsed.force !== false
  ) {
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
      onProtocolFault(
        new Error("The Runtime V2 worker stop record exceeded its bound."),
      );
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2IngestionStopRecord(line);
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

function boundedUtf8(value, maximumBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return bytes.toString("utf8");
  return bytes
    .subarray(0, maximumBytes)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
}

function boundedFailureMessage(error) {
  const raw =
    error && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : String(error);
  return boundedUtf8(
    raw || "Document ingestion failed.",
    MAX_FAILURE_MESSAGE_BYTES,
  );
}

function sanitizeRuntimeV2IngestionResultWarnings(value) {
  if (!isRecord(value)) {
    fail("The document-ingestion executor returned an invalid result.");
  }
  const sanitized = { ...value };
  for (const [field, publicMessage] of [
    ["visionError", PUBLIC_INGEST_VISION_WARNING],
    ["screenshotWarning", PUBLIC_INGEST_DOCUMENT_WARNING],
    ["mapGenerationWarning", PUBLIC_INGEST_MAP_WARNING],
  ]) {
    const warning = value[field];
    if (warning === undefined || warning === "") {
      delete sanitized[field];
    } else if (typeof warning === "string") {
      sanitized[field] = publicMessage;
    } else {
      fail("The document-ingestion executor returned an invalid warning.");
    }
  }
  return sanitized;
}

function cleanupCreatedFiles(filePaths) {
  for (const filePath of [...filePaths].reverse()) {
    try {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    } catch {
      // Best-effort rollback is followed by process-tree termination.
    }
  }
}

export function shouldCleanupCreatedIngestionAssets(transactionOutcome) {
  return transactionOutcome === "none" || transactionOutcome === "rolled-back";
}

function yieldForSupervisorInput() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fsyncRuntimeV2OutputDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(directoryPath, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !error ||
      typeof error !== "object" ||
      !["EACCES", "EINVAL", "EPERM"].includes(String(error.code))
    ) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function fsyncRuntimeV2OutputFile(filePath) {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail("The Runtime V2 durable output is not a direct regular file.");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      process.platform === "win32" ? "r+" : "r",
    );
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

const TRANSIENT_ATOMIC_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const ATOMIC_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400, 800];

function sleepSync(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function isTransientAtomicRenameError(error) {
  return TRANSIENT_ATOMIC_RENAME_CODES.has(error?.code);
}

export function atomicWrite(
  filePath,
  bytes,
  replace,
  {
    renameSync = fs.renameSync,
    fsyncOutputFile = fsyncRuntimeV2OutputFile,
    waitSync = sleepSync,
  } = {},
) {
  const parent = path.dirname(filePath);
  if (!fs.lstatSync(parent).isDirectory()) {
    fail("The Runtime V2 durable output directory is unavailable.");
  }
  const temporaryPath = `${filePath}.pending.${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (!replace && fs.existsSync(filePath)) {
      fail("The durable ingestion result already exists.");
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(temporaryPath, filePath);
        break;
      } catch (error) {
        if (
          !isTransientAtomicRenameError(error) ||
          attempt >= ATOMIC_RENAME_RETRY_DELAYS_MS.length
        ) {
          throw error;
        }
        waitSync(ATOMIC_RENAME_RETRY_DELAYS_MS[attempt]);
      }
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        fsyncOutputFile(filePath);
        break;
      } catch (error) {
        if (
          !isTransientAtomicRenameError(error) ||
          attempt >= ATOMIC_RENAME_RETRY_DELAYS_MS.length
        ) {
          throw error;
        }
        waitSync(ATOMIC_RENAME_RETRY_DELAYS_MS[attempt]);
      }
    }
    fsyncRuntimeV2OutputDirectory(parent);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function progressPhase(step) {
  if (/finishing|complete/iu.test(step))
    return { stage: "finalizing", current: 4 };
  if (/saving|refreshing|publishing/iu.test(step))
    return { stage: "persisting", current: 3 };
  if (
    /reading|extracting|rendering|parsing|transcribing|formatting|checking/iu.test(
      step,
    )
  ) {
    return { stage: "processing", current: 2 };
  }
  return { stage: "working", current: 1 };
}

function createProgressReporter(launch, events, isStopped) {
  let lastPhase = 0;
  let writes = 0;
  let revision = 0;
  let checkpointAnnounced = false;
  let step = "Preparing the staged document…";
  let stage = "preparing";
  let tokenUsage = null;
  let failure = null;
  const persist = (terminalFailure = false) => {
    if (isStopped()) return;
    const now = Date.now();
    if (
      writes >= MAX_PROGRESS_CHECKPOINTS ||
      (!terminalFailure && writes >= MAX_PROGRESS_CHECKPOINTS - 1)
    )
      return;
    revision += 1;
    const bytes = Buffer.from(
      `${JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        identity: launch.identity,
        stage,
        step,
        tokenUsage,
        failure,
        revision,
        updatedAt: now,
      })}\n`,
      "utf8",
    );
    if (bytes.byteLength > MAX_CHECKPOINT_BYTES) {
      fail("The ingestion progress checkpoint exceeded its bound.");
    }
    atomicWrite(launch.checkpointPath, bytes, true);
    writes += 1;
    if (!checkpointAnnounced) {
      events.checkpoint("checkpoint", launch.checkpointRelativePath);
      checkpointAnnounced = true;
    }
  };
  const note = (rawStep) => {
    if (isStopped()) return;
    step = boundedUtf8(String(rawStep || "Processing document"), 4 * 1024);
    const phase = progressPhase(step);
    stage = phase.stage;
    if (phase.current > lastPhase) {
      lastPhase = phase.current;
      events.progress(phase.stage, phase.current, 4);
    }
    persist();
  };
  const usage = (nextUsage) => {
    if (isStopped()) return;
    tokenUsage = nextUsage;
    persist();
  };
  const failed = (error) => {
    if (isStopped()) return;
    failure = {
      error: SANITIZED_RUNTIME_FAILURE_MESSAGE,
      visionError:
        error instanceof Error && error.name === "ChatmockVisionError"
          ? PUBLIC_INGEST_VISION_WARNING
          : null,
    };
    persist(true);
  };
  return { note, usage, failed };
}

export function serializeRuntimeV2DocumentIngestionResult({
  identity,
  completionSequence,
  value,
}) {
  const bytes = Buffer.from(
    `${JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      identity,
      completionSequence,
      result: sanitizeRuntimeV2IngestionResultWarnings(value),
    })}\n`,
    "utf8",
  );
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The durable ingestion result exceeded its bounded envelope.");
  }
  return bytes;
}

export function parseRecoverableRuntimeV2DocumentIngestionResult(
  bytes,
  expectedJobId,
) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_RESULT_BYTES
  ) {
    fail("The recoverable ingestion result is outside its bounded size.");
  }
  let envelope;
  try {
    envelope = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("The recoverable ingestion result is not valid JSON.");
  }
  if (
    !hasExactKeys(envelope, [
      "protocolVersion",
      "identity",
      "completionSequence",
      "result",
    ]) ||
    envelope.protocolVersion !== PROTOCOL_VERSION ||
    !Number.isSafeInteger(envelope.completionSequence) ||
    envelope.completionSequence < 1
  ) {
    fail("The recoverable ingestion result has an invalid envelope.");
  }
  const identity = validateIdentity(envelope.identity);
  if (identity.jobId !== expectedJobId || !isRecord(envelope.result)) {
    fail("The recoverable ingestion result is fenced to another job.");
  }
  return sanitizeRuntimeV2IngestionResultWarnings(envelope.result);
}

async function runRuntimeV2DocumentIngestionWorker() {
  redirectApplicationStdout();
  const launch = loadRuntimeV2DocumentIngestionLaunch();
  const layout = sourceLayout();
  const contentPath = configureTrustedIngestionEnvironment(launch, layout);
  const events = createRuntimeV2IngestionEventWriter(launch.identity);
  const abortController = new AbortController();
  let protocolFault = null;
  let openedBlob = null;
  let completed = false;
  let heartbeat = null;
  const stop = startStopInput(
    () => {
      events.cancellationAcknowledged();
      abortController.abort(new Error("Document ingestion was canceled."));
    },
    (error) => {
      protocolFault = error;
      abortController.abort(error);
      console.error(
        "[runtime-v2-ingestion-worker] Invalid supervisor input:",
        error,
      );
    },
  );
  events.ready();
  const createdFilePaths = [];
  const createdMarkdownPaths = [];
  const deferredCheckpointCleanupPaths = [];
  let knowledgeWriteTransaction = null;
  let knowledgeWriteTransactionOutcome = "none";
  const rollbackKnowledgeWrites = () => {
    if (
      !knowledgeWriteTransaction ||
      knowledgeWriteTransactionOutcome !== "active"
    )
      return null;
    try {
      knowledgeWriteTransaction.rollback();
      knowledgeWriteTransactionOutcome = "rolled-back";
      return null;
    } catch (error) {
      return error;
    }
  };
  const startedAt = Date.now();
  let progress = null;

  try {
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    await yieldForSupervisorInput();
    if (stop.requested()) return;
    progress = createProgressReporter(launch, events, () => stop.requested());
    progress.note("Preparing the staged document…");
    openedBlob = openCanonicalRuntimeV2IngestBlob(launch);
    await yieldForSupervisorInput();
    if (stop.requested()) return;

    await import(
      pathToFileURL(
        path.join(
          path.dirname(ENTRYPOINT_PATH),
          "learn-worker-import-hook.mjs",
        ),
      ).href
    );
    const [
      ingestModule,
      knowledgeModule,
      tokenUsageModule,
      quartzPublishModule,
    ] = await Promise.all([
      import(
        pathToFileURL(
          path.join(
            layout.sourceRoot,
            "lib",
            "runtime-v2",
            "ingest-executor.ts",
          ),
        ).href
      ),
      import(
        pathToFileURL(path.join(layout.sourceRoot, "lib", "knowledge.ts")).href
      ),
      import(
        pathToFileURL(
          path.join(layout.sourceRoot, "lib", "ingest-token-usage.ts"),
        ).href
      ),
      import(
        pathToFileURL(path.join(layout.sourceRoot, "lib", "quartz-publish.ts"))
          .href
      ),
    ]);
    if (
      typeof ingestModule.runIngest !== "function" ||
      typeof knowledgeModule.createChatmockClient !== "function" ||
      typeof knowledgeModule.createKnowledgeWriteTransaction !== "function" ||
      typeof knowledgeModule.knowledgeWriteTransactionRegistryRoot !==
        "function" ||
      typeof knowledgeModule.recoverKnowledgeWriteTransactions !== "function" ||
      typeof knowledgeModule.recoverCommittedKnowledgeWriteTransaction !==
        "function" ||
      typeof tokenUsageModule.attachIngestTokenUsageTracking !== "function" ||
      typeof tokenUsageModule.emptyIngestTokenUsage !== "function" ||
      typeof quartzPublishModule.publishQuartzAfterMutation !== "function" ||
      typeof quartzPublishModule.installSealedRuntimeV2QuartzPublishExecutor !==
        "function"
    ) {
      fail("The Runtime V2 ingestion execution exports are unavailable.");
    }
    quartzPublishModule.installSealedRuntimeV2QuartzPublishExecutor(
      createSealedRuntimeV2QuartzPublishExecutor({
        identity: launch.identity,
        dataRoot: launch.dataRoot,
        contentPath,
        sourceRoot: trustedQuartzSourceRoot(layout),
        workspacePath: launch.workspacePath,
        signal: abortController.signal,
      }),
    );
    const publishCommittedIngestion = async () => {
      process.env.QUARTZ_AUTO_PUBLISH = "1";
      try {
        await quartzPublishModule.publishQuartzAfterMutation(
          `ingest knowledge into ${launch.executionScope.gardenId}`,
          {
            requireSuccess: true,
            gardenSlug: launch.executionScope.gardenId,
          },
        );
      } finally {
        // `writeDocumentKnowledge` must remain unable to publish before the
        // external durable transaction crosses result -> commit -> seal.
        process.env.QUARTZ_AUTO_PUBLISH = "0";
      }
    };
    await yieldForSupervisorInput();
    if (stop.requested()) return;

    const request = launch.request;
    const transactionRegistryRoot =
      knowledgeModule.knowledgeWriteTransactionRegistryRoot(
        launch.dataRoot,
        contentPath,
        launch.executionScope.gardenId,
      );
    const recoveries = knowledgeModule.recoverKnowledgeWriteTransactions(
      contentPath,
      launch.executionScope.gardenId,
      transactionRegistryRoot,
      path.join(launch.dataRoot, "runtime", "jobs"),
    );
    const journalRecovery = recoveries.find(
      (recovery) => recovery.transactionId === launch.identity.jobId,
    );
    const committedRecovery =
      knowledgeModule.recoverCommittedKnowledgeWriteTransaction(
        contentPath,
        launch.executionScope.gardenId,
        transactionRegistryRoot,
        launch.identity.jobId,
        launch.resultPath,
      );
    const currentRecovery = committedRecovery ?? journalRecovery;
    if (currentRecovery?.outcome === "committed") {
      if (!currentRecovery.transaction) {
        fail("The committed ingestion transaction cannot be reconciled.");
      }
      knowledgeWriteTransaction = currentRecovery.transaction;
      knowledgeWriteTransactionOutcome = "committed";
      const recoveredValue = parseRecoverableRuntimeV2DocumentIngestionResult(
        knowledgeWriteTransaction.readCommittedResult(),
        launch.identity.jobId,
      );
      progress.note("Finishing document ingestion…");
      // The prior attempt already crossed its irreversible garden/result
      // boundary. Release that commit before publishing; publication failure
      // must leave the committed pair available for another fenced recovery.
      knowledgeWriteTransaction.seal();
      await publishCommittedIngestion();
      await heartbeat.stop();
      if (stop.requested()) return;
      if (protocolFault) throw protocolFault;
      const completionSequence = events.nextSequence();
      const result = serializeRuntimeV2DocumentIngestionResult({
        identity: launch.identity,
        completionSequence,
        value: recoveredValue,
      });
      const replacementRecovery =
        knowledgeModule.recoverCommittedKnowledgeWriteTransaction(
          contentPath,
          launch.executionScope.gardenId,
          transactionRegistryRoot,
          launch.identity.jobId,
          launch.resultPath,
        );
      if (
        replacementRecovery?.outcome !== "committed" ||
        !replacementRecovery.transaction
      ) {
        fail("The committed ingestion result cannot be fenced for completion.");
      }
      knowledgeWriteTransaction = replacementRecovery.transaction;
      knowledgeWriteTransaction.prepareResultReplacement(
        createHash("sha256").update(result).digest("hex"),
      );
      atomicWrite(launch.resultPath, result, true);
      triggerTestIngestionFault("after-result-write");
      knowledgeWriteTransaction.commit();
      knowledgeWriteTransaction.seal();
      triggerTestIngestionFault("after-garden-commit");
      events.complete(launch.resultRelativePath);
      completed = true;
      triggerTestIngestionFault("after-terminal-event");
      return;
    }
    if (fs.existsSync(launch.resultPath)) {
      fail(
        "The durable ingestion result exists without a committed garden transaction.",
      );
    }
    knowledgeWriteTransaction = knowledgeModule.createKnowledgeWriteTransaction(
      contentPath,
      launch.executionScope.gardenId,
      {
        registryRoot: transactionRegistryRoot,
        transactionId: launch.identity.jobId,
        resultPath: launch.resultPath,
        retainCommittedJournal: true,
      },
    );
    knowledgeWriteTransactionOutcome = "active";
    let tokenUsage = tokenUsageModule.emptyIngestTokenUsage();
    progress.usage({ ...tokenUsage, model: request.model });
    const client = request.generateMap
      ? tokenUsageModule.attachIngestTokenUsageTracking(
          knowledgeModule.createChatmockClient(request.chatmockBaseUrl),
          (nextUsage) => {
            tokenUsage = nextUsage;
            progress.usage({ ...tokenUsage, model: request.model });
          },
        )
      : undefined;
    const filename = launch.inputBlob.displayName;
    const ext = path.extname(filename).toLowerCase().replace(".", "");
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    const syntheticRequest = new Request("http://127.0.0.1/runtime-v2/ingest", {
      signal: abortController.signal,
    });
    const value = await ingestModule.runIngest({
      request: syntheticRequest,
      client,
      contentPath,
      file: openedBlob.file,
      normalizedClusterSlug: launch.executionScope.gardenId,
      filename,
      ext,
      nameWithoutExt,
      source: request.sourceLabel,
      model: request.model ?? "",
      isHandwriting: request.isHandwriting,
      parseWithVlm: request.parseWithVlm,
      parseWithAnydoc: request.parseWithAnydoc,
      vlmTask: request.vlmTask,
      generateMap: request.generateMap,
      createdFilePaths,
      createdMarkdownPaths,
      knowledgeWriteTransaction,
      deferredCheckpointCleanupPaths,
      emit: (step) => progress.note(step),
    });
    triggerTestIngestionFault("after-garden-mutations");
    // A parser can complete a long synchronous phase before Node services its
    // stdin queue. Give an already-written stop record authority before a
    // result is committed, so cancellation cannot lose to a microtask-only
    // completion tail.
    await yieldForSupervisorInput();
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;
    progress.note("Finishing document ingestion…");
    const resultValue = {
      ...value,
      durationMs: Date.now() - startedAt,
      tokenUsage: { ...tokenUsage, model: request.model ?? undefined },
    };
    // This first envelope is the durable garden commit point. Its sequence is
    // reconciled after the potentially long Quartz build while heartbeats are
    // still active.
    const provisionalResult = serializeRuntimeV2DocumentIngestionResult({
      identity: launch.identity,
      completionSequence: events.nextSequence(),
      value: resultValue,
    });
    knowledgeWriteTransaction.prepareResult(
      createHash("sha256").update(provisionalResult).digest("hex"),
    );
    triggerTestIngestionFault("after-result-prepare");
    atomicWrite(launch.resultPath, provisionalResult, false);
    triggerTestIngestionFault("after-result-write");
    knowledgeWriteTransaction.commit();
    knowledgeWriteTransactionOutcome = "committed";
    knowledgeWriteTransaction.seal();
    // Checkpoints are rollback inputs, so deleting them before the external
    // garden/result transaction commits turns a late persistence failure into
    // a full OCR/extraction restart. Cleanup is intentionally best-effort only
    // after the durable commit boundary has been crossed.
    for (const checkpointPath of deferredCheckpointCleanupPaths.splice(0)) {
      try {
        fs.rmSync(checkpointPath, { force: true });
      } catch (error) {
        console.warn(
          `[runtime-v2-ingestion-worker] Checkpoint cleanup deferred: ${boundedFailureMessage(error)}`,
        );
      }
    }
    triggerTestIngestionFault("after-garden-commit");
    await publishCommittedIngestion();
    await heartbeat.stop();
    // Joining the heartbeat thread yields to stdin once more. A stop record
    // received during that join still owns the outcome; after this check the
    // result reconciliation and terminal event are one synchronous tail.
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;
    const completionSequence = events.nextSequence();
    const result = serializeRuntimeV2DocumentIngestionResult({
      identity: launch.identity,
      completionSequence,
      value: resultValue,
    });
    const replacementRecovery =
      knowledgeModule.recoverCommittedKnowledgeWriteTransaction(
        contentPath,
        launch.executionScope.gardenId,
        transactionRegistryRoot,
        launch.identity.jobId,
        launch.resultPath,
      );
    if (
      replacementRecovery?.outcome !== "committed" ||
      !replacementRecovery.transaction
    ) {
      fail("The committed ingestion result cannot be fenced for completion.");
    }
    knowledgeWriteTransaction = replacementRecovery.transaction;
    knowledgeWriteTransaction.prepareResultReplacement(
      createHash("sha256").update(result).digest("hex"),
    );
    atomicWrite(launch.resultPath, result, true);
    knowledgeWriteTransaction.commit();
    knowledgeWriteTransaction.seal();
    events.complete(launch.resultRelativePath);
    completed = true;
    triggerTestIngestionFault("after-terminal-event");
  } catch (error) {
    if (stop.requested()) {
      return;
    }
    const rollbackError = rollbackKnowledgeWrites();
    if (shouldCleanupCreatedIngestionAssets(knowledgeWriteTransactionOutcome)) {
      cleanupCreatedFiles(createdFilePaths);
    }
    const failure = rollbackError
      ? new AggregateError(
          [error, rollbackError],
          "Document ingestion failed and its garden rollback was incomplete.",
        )
      : error;
    progress?.failed(failure);
    events.failed("INGEST_WORKER_FAILED", SANITIZED_RUNTIME_FAILURE_MESSAGE);
    process.exitCode = 1;
    console.error(
      "[runtime-v2-ingestion-worker] Document ingestion failed:",
      failure,
    );
  } finally {
    try {
      await heartbeat?.stop();
    } catch (error) {
      console.error(
        "[runtime-v2-ingestion-worker] Heartbeat thread shutdown failed:",
        error,
      );
    }
    stop.close();
    if (!completed) {
      const rollbackError = rollbackKnowledgeWrites();
      if (
        shouldCleanupCreatedIngestionAssets(knowledgeWriteTransactionOutcome)
      ) {
        cleanupCreatedFiles(createdFilePaths);
      }
      if (rollbackError) {
        process.exitCode = 1;
        console.error(
          "[runtime-v2-ingestion-worker] Garden rollback failed:",
          rollbackError,
        );
      }
      if (
        knowledgeWriteTransactionOutcome === "committed" &&
        knowledgeWriteTransaction
      ) {
        try {
          knowledgeWriteTransaction.seal();
        } catch (error) {
          process.exitCode = 1;
          console.error(
            "[runtime-v2-ingestion-worker] Commit reconciliation release failed:",
            error,
          );
        }
      }
    }
    // Rust owns the adopted input lifecycle. The worker closes its descriptor;
    // the runtime removes the canonical upload only after terminal tree exit.
    openedBlob?.close();
  }
}

const invokedAsEntrypoint =
  typeof process.argv[1] === "string" &&
  samePath(process.argv[1], ENTRYPOINT_PATH);
if (invokedAsEntrypoint) {
  void runRuntimeV2DocumentIngestionWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(
      2,
      `[runtime-v2-ingestion-worker] Startup failed: ${boundedFailureMessage(error)}\n`,
      undefined,
      "utf8",
    );
  });
}
