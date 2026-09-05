import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024 + 32 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
const MAX_INPUT_BYTES = 512 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

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

function identity(value) {
  if (
    !exactRecord(value, ["jobId", "attempt", "workerInstanceId"]) ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) fail("The finite MCP worker identity is invalid.");
  return value;
}

function executionScope(value) {
  const bounded = (item) => typeof item === "string" && item.trim() &&
    Buffer.byteLength(item, "utf8") <= 256 && !/\p{Cc}/u.test(item);
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    (value.gardenId !== null && !bounded(value.gardenId)) ||
    !bounded(value.conversationId)
  ) fail("The finite MCP worker requires authenticated conversation scope.");
  return value;
}

function expectedPaths(value) {
  const jobRoot = `runtime/jobs/${value.jobId}`;
  const attemptRoot = `${jobRoot}/attempts/${value.attempt}/${value.workerInstanceId}`;
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
  ) fail("The finite MCP worker received an invalid Runtime-relative path.");
  const resolved = path.resolve(dataRoot, ...relativePath.split("/"));
  if (!pathWithin(dataRoot, resolved)) fail("The finite MCP worker path escaped the Runtime data root.");
  return resolved;
}

function inputBlob(value, launchIdentity, maximumInputBytes) {
  const match = isRecord(value) && typeof value.relativePath === "string"
    ? /^runtime\/jobs\/([A-Za-z0-9_-]{1,128})\/inputs\/([A-Za-z0-9_-]{1,128})\/payload$/u.exec(value.relativePath)
    : null;
  if (
    !exactRecord(value, ["blobId", "relativePath", "sizeBytes", "sha256", "displayName", "mediaType"]) ||
    !IDENTIFIER.test(value.blobId) ||
    !match ||
    match[1] !== launchIdentity.jobId ||
    match[2] !== value.blobId ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > maximumInputBytes ||
    !SHA256.test(value.sha256) ||
    typeof value.displayName !== "string" ||
    !value.displayName ||
    value.displayName !== path.basename(value.displayName) ||
    /[\\/\u0000]/u.test(value.displayName) ||
    Buffer.byteLength(value.displayName, "utf8") > 512 ||
    (value.mediaType !== null &&
      (typeof value.mediaType !== "string" || Buffer.byteLength(value.mediaType, "utf8") > 256))
  ) fail("The finite MCP worker input blob is invalid.");
  return value;
}

export function loadRuntimeV2FiniteMcpLaunch({
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
  validateRequest,
  validateExecutionScope = executionScope,
  expectedInputCount,
  maximumInputBytes = MAX_INPUT_BYTES,
}) {
  if (
    !Number.isSafeInteger(maximumInputBytes) ||
    maximumInputBytes < 1 ||
    maximumInputBytes > 2 * 1024 * 1024 * 1024
  ) fail("The finite MCP worker input bound is invalid.");
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The finite MCP worker requires exactly the fixed start.json argument.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The finite MCP start manifest",
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
    manifest.protocolVersion !== PROTOCOL_VERSION
  ) fail("The finite MCP start manifest has an unsupported shape.");
  const launchIdentity = identity(manifest.identity);
  const scope = validateExecutionScope(manifest.executionScope);
  const expected = expectedPaths(launchIdentity);
  for (const field of ["inputManifestPath", "workspacePath", "checkpointPath", "resultPath"]) {
    if (manifest[field] !== expected[field]) fail(`The finite MCP ${field} is not identity-bound.`);
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (!samePath(canonicalLaunchDirectory, resolveDataPath(dataRoot, expected.attemptRoot))) {
    fail("The finite MCP launch directory is not identity-bound.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("The finite MCP private workspace is unavailable.");
  }
  const request = validateRequest(readBoundedJson(
    resolveDataPath(dataRoot, manifest.inputManifestPath),
    MAX_INPUT_MANIFEST_BYTES,
    "The canonical finite MCP request",
  ));
  if (!Array.isArray(manifest.inputBlobs) || manifest.inputBlobs.length !== expectedInputCount(request)) {
    fail("The finite MCP worker received the wrong number of inputs.");
  }
  const inputBlobs = manifest.inputBlobs.map((value) =>
    inputBlob(value, launchIdentity, maximumInputBytes));
  if (new Set(inputBlobs.map((value) => value.blobId)).size !== inputBlobs.length) {
    fail("The finite MCP worker received duplicate inputs.");
  }
  return {
    dataRoot,
    identity: launchIdentity,
    executionScope: scope,
    request,
    inputBlobs,
    workspacePath,
    checkpointPath: resolveDataPath(dataRoot, manifest.checkpointPath),
    checkpointRelativePath: manifest.checkpointPath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
  };
}

export function canonicalRuntimeInput(launch, index) {
  const blob = launch.inputBlobs[index];
  if (!blob) fail("The requested finite MCP input is unavailable.");
  const target = resolveDataPath(launch.dataRoot, blob.relativePath);
  const metadata = fs.lstatSync(target);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== blob.sizeBytes
  ) fail("The sealed finite MCP input is invalid.");
  const canonical = fs.realpathSync.native(target);
  if (!samePath(canonical, target)) fail("The sealed finite MCP input is indirect.");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(canonical)).digest("hex");
  if (digest !== blob.sha256) fail("The sealed finite MCP input failed its integrity check.");
  return canonical;
}

/**
 * Verify a potentially large Runtime input without materializing it in the
 * worker heap. The file is revalidated after hashing so a replacement cannot
 * be mistaken for the blob that native Runtime sealed into the manifest.
 */
export async function canonicalRuntimeInputAsync(launch, index, signal) {
  const blob = launch.inputBlobs[index];
  if (!blob) fail("The requested finite MCP input is unavailable.");
  const target = resolveDataPath(launch.dataRoot, blob.relativePath);
  const before = fs.lstatSync(target);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size !== blob.sizeBytes
  ) fail("The sealed finite MCP input is invalid.");
  const canonical = fs.realpathSync.native(target);
  if (!samePath(canonical, target)) fail("The sealed finite MCP input is indirect.");
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(canonical, { highWaterMark: 1024 * 1024 });
    const abort = () => stream.destroy(
      signal?.reason ?? new DOMException("Runtime cancellation requested", "AbortError"),
    );
    signal?.addEventListener("abort", abort, { once: true });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    stream.once("end", () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    });
    if (signal?.aborted) abort();
  });
  const after = fs.lstatSync(target);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    hash.digest("hex") !== blob.sha256
  ) fail("The sealed finite MCP input failed its integrity check.");
  return canonical;
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
      onFault(new Error("The finite MCP stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      const value = JSON.parse(line.slice(0, -1));
      if (
        !line.endsWith("\n") ||
        !exactRecord(value, ["type", "force"]) ||
        value.type !== "stop" ||
        value.force !== false ||
        requested ||
        remainder
      ) fail("The finite MCP stop record is invalid.");
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

function writeResult(resultPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The finite MCP result exceeded its bound.");
  }
  const parent = path.dirname(resultPath);
  const parentMetadata = fs.lstatSync(parent);
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(parent), parent) ||
    fs.existsSync(resultPath)
  ) fail("The finite MCP result path is unavailable.");
  const pending = `${resultPath}.pending.${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(pending, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(pending, resultPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(pending, { force: true });
    throw error;
  }
}

function writeCheckpoint(checkpointPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    fail("The finite MCP checkpoint exceeded its bound.");
  }
  const parent = path.dirname(checkpointPath);
  const parentMetadata = fs.lstatSync(parent);
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(parent), parent)
  ) fail("The finite MCP checkpoint path is unavailable.");
  const pending = `${checkpointPath}.pending.${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(pending, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    // rename replaces an existing regular file atomically, so a concurrent
    // Runtime reader observes either the prior complete projection or this one.
    fs.renameSync(pending, checkpointPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(pending, { force: true });
    throw error;
  }
}

export async function runRuntimeV2FiniteMcpWorker({
  name,
  validateRequest,
  validateExecutionScope,
  expectedInputCount,
  maximumInputBytes,
  execute,
}) {
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  const launch = loadRuntimeV2FiniteMcpLaunch({
    validateRequest,
    validateExecutionScope,
    expectedInputCount,
    maximumInputBytes,
  });
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "processing",
    heartbeatIntervalMs: 5_000,
  });
  const abort = new AbortController();
  let fault = null;
  let heartbeat = null;
  let acknowledged = false;
  let acknowledgement = null;
  let checkpointPublished = false;
  const acknowledge = () => {
    if (!acknowledged) {
      acknowledged = true;
      const activeHeartbeat = heartbeat;
      acknowledgement = (async () => {
        // The heartbeat writer owns fd 1 from another thread. Join it before
        // publishing the acknowledgement so cancellation is a strict event
        // boundary even when a heartbeat was already waiting on the writer
        // lock.
        await activeHeartbeat?.stop();
        events.cancellationAcknowledged();
      })();
      // The worker awaits this promise in its finalizer. Attach a handler now
      // as well so a heartbeat-thread fault cannot become an unhandled
      // rejection while the executor is still unwinding its child process.
      void acknowledgement.catch(() => undefined);
    }
    abort.abort(new DOMException("Runtime cancellation requested", "AbortError"));
  };
  const stop = stopInput(acknowledge, (error) => { fault = error; acknowledge(); });
  try {
    events.ready();
    if (stop.requested()) return;
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    const result = await execute(launch, abort.signal, {
      checkpoint(value) {
        writeCheckpoint(launch.checkpointPath, {
          protocolVersion: PROTOCOL_VERSION,
          identity: launch.identity,
          snapshot: value,
        });
        // Finite workers already publish bounded percentage checkpoints. Mirror
        // those values into the Runtime job snapshot so read-only UI status
        // endpoints can report real progress without reading worker files.
        if (
          value !== null &&
          typeof value === "object" &&
          Number.isSafeInteger(value.percent) &&
          value.percent >= 0 &&
          value.percent <= 100
        ) {
          events.progress("processing", value.percent, 100);
        }
        if (!checkpointPublished) {
          checkpointPublished = true;
          events.checkpoint("checkpoint", launch.checkpointRelativePath);
        }
      },
    });
    await heartbeat.stop();
    heartbeat = null;
    await new Promise((resolve) => setImmediate(resolve));
    if (fault) throw fault;
    if (stop.requested()) return;
    const completionSequence = events.nextSequence();
    writeResult(launch.resultPath, {
      protocolVersion: PROTOCOL_VERSION,
      identity: launch.identity,
      completionSequence,
      result,
    });
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (!stop.requested()) {
      events.failed("FINITE_MCP_WORKER_FAILED", "Runtime MCP work failed.");
      process.exitCode = 1;
      console.error(`[${name}] execution failed:`, error);
    }
  } finally {
    try {
      await acknowledgement;
      await heartbeat?.stop();
    } catch {
      process.exitCode = 1;
    }
    stop.close();
  }
}
