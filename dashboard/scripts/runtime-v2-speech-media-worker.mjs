import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeSpeechMedia,
  expectedSpeechMediaInputCount,
  validateSpeechMediaRequest,
} from "./runtime-v2-speech-media-executor.mjs";
import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_CHECKPOINT_BYTES = 64 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
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
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) fail("The speech/media worker identity is invalid.");
  return value;
}

function validNullableScope(value) {
  return value === null ||
    (typeof value === "string" &&
      value.trim() === value &&
      value.length > 0 &&
      Buffer.byteLength(value, "utf8") <= 256 &&
      !/\p{Cc}/u.test(value));
}

function validateExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    !validNullableScope(value.gardenId) ||
    !validNullableScope(value.conversationId)
  ) fail("The speech/media worker requires authenticated user scope.");
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
    typeof relativePath !== "string" ||
    relativePath.includes("\\") ||
    relativePath.split("/").length < 2 ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) fail("The speech/media worker received an invalid Runtime-relative path.");
  const resolved = path.resolve(dataRoot, ...relativePath.split("/"));
  if (!pathWithin(dataRoot, resolved)) fail("The speech/media worker path escaped the Runtime data root.");
  return resolved;
}

function validateInputBlob(value, identity) {
  const match = isRecord(value) && typeof value.relativePath === "string"
    ? /^runtime\/jobs\/([A-Za-z0-9_-]{1,128})\/inputs\/([A-Za-z0-9_-]{1,128})\/payload$/u.exec(value.relativePath)
    : null;
  if (
    !exactRecord(value, [
      "blobId", "relativePath", "sizeBytes", "sha256", "displayName", "mediaType",
    ]) ||
    !IDENTIFIER.test(value.blobId) ||
    !match ||
    match[1] !== identity.jobId ||
    match[2] !== value.blobId ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > MAX_INPUT_BYTES ||
    !SHA256.test(value.sha256) ||
    typeof value.displayName !== "string" ||
    !value.displayName ||
    value.displayName !== path.basename(value.displayName) ||
    /[\\/\u0000]/u.test(value.displayName) ||
    Buffer.byteLength(value.displayName, "utf8") > 512 ||
    (value.mediaType !== null &&
      (typeof value.mediaType !== "string" || Buffer.byteLength(value.mediaType, "utf8") > 256))
  ) fail("The sealed speech/media input is invalid.");
  return value;
}

export function loadRuntimeV2SpeechMediaLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The speech/media worker requires exactly the fixed start.json argument.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The speech/media start manifest",
  );
  if (
    !exactRecord(manifest, [
      "protocolVersion", "identity", "executionScope", "inputManifestPath", "inputBlobs",
      "workspacePath", "checkpointPath", "resultPath",
    ]) ||
    manifest.protocolVersion !== PROTOCOL_VERSION
  ) fail("The speech/media start manifest has an unsupported shape.");
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  const expected = expectedPaths(identity);
  for (const field of ["inputManifestPath", "workspacePath", "checkpointPath", "resultPath"]) {
    if (manifest[field] !== expected[field]) fail(`The speech/media ${field} is not identity-bound.`);
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (!samePath(canonicalLaunchDirectory, resolveDataPath(dataRoot, expected.attemptRoot))) {
    fail("The speech/media launch directory is not identity-bound.");
  }
  const workspacePath = resolveDataPath(dataRoot, expected.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("The speech/media private workspace is unavailable.");
  }
  const request = validateSpeechMediaRequest(readBoundedJson(
    resolveDataPath(dataRoot, expected.inputManifestPath),
    MAX_INPUT_MANIFEST_BYTES,
    "The canonical speech/media request",
  ));
  if (
    !Array.isArray(manifest.inputBlobs) ||
    manifest.inputBlobs.length !== expectedSpeechMediaInputCount(request)
  ) fail("The speech/media worker received the wrong number of inputs.");
  const inputBlobs = manifest.inputBlobs.map((value) => validateInputBlob(value, identity));
  if (new Set(inputBlobs.map((value) => value.blobId)).size !== inputBlobs.length) {
    fail("The speech/media worker received duplicate inputs.");
  }
  return {
    dataRoot,
    identity,
    executionScope,
    request,
    inputBlobs,
    workspacePath,
    checkpointPath: resolveDataPath(dataRoot, expected.checkpointPath),
    checkpointRelativePath: expected.checkpointPath,
    resultPath: resolveDataPath(dataRoot, expected.resultPath),
    resultRelativePath: expected.resultPath,
  };
}

async function verifyInputBlob(launch, blob, signal) {
  const target = resolveDataPath(launch.dataRoot, blob.relativePath);
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== blob.sizeBytes) {
    fail("The sealed speech/media input is unavailable.");
  }
  const canonical = fs.realpathSync.native(target);
  if (!samePath(canonical, target)) fail("The sealed speech/media input is indirect.");
  const digest = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(canonical, { highWaterMark: 1024 * 1024 });
    const abort = () => stream.destroy(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    stream.on("data", (chunk) => digest.update(chunk));
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
  const after = fs.lstatSync(canonical);
  if (
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    digest.digest("hex") !== blob.sha256
  ) fail("The sealed speech/media input failed its streaming integrity check.");
  return canonical;
}

export function parseRuntimeV2SpeechMediaStopRecord(value) {
  if (Buffer.byteLength(value, "utf8") > MAX_STOP_RECORD_BYTES || !value.endsWith("\n")) {
    fail("The speech/media stop record is invalid.");
  }
  let parsed;
  try {
    parsed = JSON.parse(value.slice(0, -1));
  } catch {
    fail("The speech/media stop record is invalid.");
  }
  if (!exactRecord(parsed, ["type", "force"]) || parsed.type !== "stop" || parsed.force !== false) {
    fail("The speech/media stop record is invalid.");
  }
  return parsed;
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
      onFault(new Error("The speech/media stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const record = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2SpeechMediaStopRecord(record);
      if (requested || remainder) fail("The speech/media stop record is invalid.");
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

function writeAtomicJson(filePath, value, maximumBytes, { replace = false } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    fail("The speech/media protocol output exceeded its bound.");
  }
  const parent = path.dirname(filePath);
  const metadata = fs.lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(fs.realpathSync.native(parent), parent)) {
    fail("The speech/media protocol output directory is unavailable.");
  }
  if (!replace && fs.existsSync(filePath)) fail("The speech/media result already exists.");
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

function sourceLayout() {
  const dashboardRoot = path.dirname(path.dirname(ENTRYPOINT_PATH));
  const appRoot = path.dirname(dashboardRoot);
  const developmentSource = path.join(dashboardRoot, "src", "lib", "video-use", "filters.ts");
  const packagedSource = path.join(
    appRoot,
    "dashboard-standalone",
    "dashboard",
    "worker-src",
    "lib",
    "video-use",
    "filters.ts",
  );
  const filtersPath = fs.existsSync(developmentSource) ? developmentSource : packagedSource;
  if (!fs.existsSync(filtersPath) || !fs.lstatSync(filtersPath).isFile()) {
    fail("The staged Video Use filter contract is unavailable.");
  }
  return { filtersPath };
}

async function runRuntimeV2SpeechMediaWorker() {
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  const launch = loadRuntimeV2SpeechMediaLaunch();
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "media-processing",
    heartbeatIntervalMs: 5_000,
  });
  const abort = new AbortController();
  let heartbeat = null;
  let fault = null;
  let acknowledged = false;
  let checkpointPublished = false;
  let resultPublished = false;
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
    const checkpoint = (snapshot) => {
      writeAtomicJson(
        launch.checkpointPath,
        { protocolVersion: PROTOCOL_VERSION, identity: launch.identity, snapshot },
        MAX_CHECKPOINT_BYTES,
        { replace: true },
      );
      if (!checkpointPublished) {
        checkpointPublished = true;
        events.checkpoint("checkpoint", launch.checkpointRelativePath);
      }
    };
    const inputPaths = [];
    for (const [index, blob] of launch.inputBlobs.entries()) {
      checkpoint({
        operation: launch.request.operation,
        stage: "verifying-input",
        input: index + 1,
        inputs: launch.inputBlobs.length,
      });
      inputPaths.push(await verifyInputBlob(launch, blob, abort.signal));
    }
    if (stop.requested()) return;
    const result = await executeSpeechMedia(launch.request, {
      dataRoot: launch.dataRoot,
      workspacePath: launch.workspacePath,
      executionScope: launch.executionScope,
      inputPaths,
      signal: abort.signal,
      checkpoint,
      env: process.env,
      sourceLayout,
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
    );
    events.complete(launch.resultRelativePath);
    resultPublished = true;
  } catch (error) {
    if (!stop.requested()) {
      events.failed("SPEECH_MEDIA_WORKER_FAILED", "Runtime media processing failed.");
      process.exitCode = 1;
      console.error("[runtime-v2-speech-media-worker] execution failed:", error);
    }
  } finally {
    try { await heartbeat?.stop(); } catch { process.exitCode = 1; }
    if (!resultPublished) {
      fs.rmSync(path.join(launch.workspacePath, "media-stage"), { recursive: true, force: true });
    }
    stop.close();
  }
}

const launchedAsEntry = process.argv[1] && samePath(process.argv[1], ENTRYPOINT_PATH);
if (launchedAsEntry) {
  void runRuntimeV2SpeechMediaWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(2, `[runtime-v2-speech-media-worker] startup failed: ${String(error)}\n`);
  });
}
