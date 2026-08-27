import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_REASON_BYTES = 512;
const MAX_REASONS = 32;
const MAX_OUTPUT_TAIL_BYTES = 8 * 1024;
const MIN_BUILD_TIMEOUT_MS = 10_000;
const MAX_BUILD_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_BUILD_CONCURRENCY = 16;
const MAX_BUILD_ENVIRONMENT_BYTES = 16 * 1024;
const CHILD_TERMINATION_GRACE_MS = 10_000;
const DEFAULT_LOCK_POLL_MS = 100;
const DEFAULT_LOCK_STALE_MS = 30_000;
const LOCK_DIRECTORY_NAME = ".breadboard-quartz-publish.lock";
const LOCK_OWNER_FILE_NAME = "owner.json";
const TRANSACTION_FILE_NAME = ".breadboard-quartz-publish.transaction.json";
const COMPLETE_MARKER_FILE_NAME = ".breadboard-quartz-build-complete.json";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const TRANSACTION_NAME = /^\.breadboard-quartz-publish\.(?:stage|previous)-[A-Za-z0-9_-]{1,128}-\d+-[A-Za-z0-9_-]{1,128}$/u;
const BUILD_ENVIRONMENT_NAMES = new Set([
  "BREADBOARD_DASHBOARD_URL",
  "CI",
  "DASHBOARD_URL",
  "NEXT_PUBLIC_DASHBOARD_URL",
  "NEXT_PUBLIC_PENECHO_URL",
  "NEXT_PUBLIC_QUARTZ_URL",
  "PENECHO_URL",
  "QUARTZ_BASE_URL",
  "QUARTZ_CUSTOM_OG_IMAGES",
  "SECOND_BRAIN_ASSET_VERSION",
  "SHOW_LEGACY_SUBTOPIC_PAGES",
  "TERM",
]);

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
    fail("The Runtime V2 Quartz worker identity is invalid.");
  }
  return {
    jobId: value.jobId,
    attempt: value.attempt,
    workerInstanceId: value.workerInstanceId,
  };
}

function validateCurrentRuntimeWorker(options) {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== START_MANIFEST_FILE ||
    !isRecord(options) ||
    !hasExactKeys(options, [
      "identity",
      "dataRoot",
      "contentPath",
      "sourceRoot",
      "workspacePath",
      "signal",
    ])
  ) {
    fail("Quartz direct execution requires a sealed Runtime V2 worker launch.");
  }
  const identity = validateIdentity(options.identity);
  const launchDirectory = fs.realpathSync.native(path.resolve(process.cwd()));
  const startPath = path.join(launchDirectory, START_MANIFEST_FILE);
  const manifest = readBoundedJson(
    startPath,
    MAX_START_MANIFEST_BYTES,
    "The Runtime V2 worker start manifest",
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
    fail("Quartz direct execution received an invalid worker start manifest.");
  }
  const manifestIdentity = validateIdentity(manifest.identity);
  if (
    manifestIdentity.jobId !== identity.jobId ||
    manifestIdentity.attempt !== identity.attempt ||
    manifestIdentity.workerInstanceId !== identity.workerInstanceId
  ) {
    fail("Quartz direct execution is fenced to another worker attempt.");
  }
  const dataRoot = fs.realpathSync.native(path.resolve(options.dataRoot));
  const expectedAttempt = path.join(
    dataRoot,
    "runtime",
    "jobs",
    identity.jobId,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  const expectedWorkspace = path.join(expectedAttempt, "workspace");
  if (
    !samePath(launchDirectory, expectedAttempt) ||
    manifest.workspacePath !==
      `runtime/jobs/${identity.jobId}/attempts/${identity.attempt}/${identity.workerInstanceId}/workspace` ||
    !samePath(options.workspacePath, expectedWorkspace)
  ) {
    fail("Quartz direct execution is outside its fenced worker workspace.");
  }
  const workspaceMetadata = fs.lstatSync(expectedWorkspace);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("Quartz direct execution requires a direct private worker workspace.");
  }
  const contentPath = fs.realpathSync.native(path.resolve(options.contentPath));
  const expectedContentPath = path.join(dataRoot, "quartz", "content");
  if (!samePath(contentPath, expectedContentPath)) {
    fail("Quartz direct execution received a non-authoritative content root.");
  }
  const sourceRoot = fs.realpathSync.native(path.resolve(options.sourceRoot));
  const sourceMetadata = fs.lstatSync(sourceRoot);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
    fail("The sealed Quartz source root is unavailable or indirect.");
  }
  for (const sourceFile of [
    path.join(sourceRoot, "quartz", "bootstrap-cli.mjs"),
    path.join(sourceRoot, "package.json"),
  ]) {
    const metadata = fs.lstatSync(sourceFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail("The sealed Quartz compiler closure is unavailable.");
    }
  }
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    fail("Quartz direct execution received an invalid cancellation signal.");
  }
  return {
    identity,
    dataRoot,
    contentPath,
    sourceRoot,
    workspacePath: expectedWorkspace,
    signal: options.signal,
  };
}

function fsyncFile(filePath) {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail("Quartz publication durability requires a direct regular file.");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, process.platform === "win32" ? "r+" : "r");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directoryPath) {
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

function atomicWriteJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 2 || bytes.byteLength > 32 * 1024) {
    fail("The Quartz publication journal exceeded its bound.");
  }
  const temporaryPath = `${filePath}.pending.${process.pid}.${randomUUID()}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncFile(filePath);
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function directDirectory(root, name, label) {
  if (!TRANSACTION_NAME.test(name)) fail(`${label} name is invalid.`);
  const target = path.join(root, name);
  if (!pathWithin(root, target) || path.dirname(target) !== path.resolve(root)) {
    fail(`${label} escapes the Quartz root.`);
  }
  return target;
}

function readTransaction(quartzRoot) {
  const journalPath = path.join(quartzRoot, TRANSACTION_FILE_NAME);
  if (!fs.existsSync(journalPath)) return null;
  const value = readBoundedJson(
    journalPath,
    32 * 1024,
    "The Quartz publication transaction",
  );
  if (
    !hasExactKeys(value, [
      "version",
      "jobId",
      "attempt",
      "workerInstanceId",
      "stageName",
      "previousName",
      "state",
    ]) ||
    value.version !== 1 ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId) ||
    !TRANSACTION_NAME.test(value.stageName) ||
    !TRANSACTION_NAME.test(value.previousName) ||
    !["building", "prepared", "previous-moved", "published"].includes(
      value.state,
    )
  ) {
    fail("The Quartz publication transaction is invalid.");
  }
  return value;
}

function validCompleteStage(stagePath, transaction) {
  if (!fs.existsSync(stagePath)) return false;
  const stageMetadata = fs.lstatSync(stagePath);
  if (!stageMetadata.isDirectory() || stageMetadata.isSymbolicLink()) return false;
  const markerPath = path.join(stagePath, COMPLETE_MARKER_FILE_NAME);
  if (!fs.existsSync(markerPath)) return false;
  const marker = readBoundedJson(
    markerPath,
    8 * 1024,
    "The Quartz build-complete marker",
  );
  return (
    hasExactKeys(marker, [
      "version",
      "jobId",
      "attempt",
      "workerInstanceId",
    ]) &&
    marker.version === 1 &&
    marker.jobId === transaction.jobId &&
    marker.attempt === transaction.attempt &&
    marker.workerInstanceId === transaction.workerInstanceId
  );
}

function removeDirectDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) return;
  const metadata = fs.lstatSync(directoryPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("Quartz publication cleanup encountered a non-directory transaction path.");
  }
  fs.rmSync(directoryPath, { recursive: true, force: true });
}

function assertDirectDirectory(directoryPath, label) {
  const metadata = fs.lstatSync(directoryPath);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(directoryPath), directoryPath)
  ) {
    fail(`${label} is not a direct directory.`);
  }
}

export function recoverQuartzPublicationTransaction(quartzRootInput) {
  const quartzRoot = fs.realpathSync.native(path.resolve(quartzRootInput));
  const transaction = readTransaction(quartzRoot);
  if (!transaction) return { recovered: false, outcome: "none" };
  const journalPath = path.join(quartzRoot, TRANSACTION_FILE_NAME);
  const publicPath = path.join(quartzRoot, "public");
  const stagePath = directDirectory(
    quartzRoot,
    transaction.stageName,
    "Quartz publication stage",
  );
  const previousPath = directDirectory(
    quartzRoot,
    transaction.previousName,
    "Quartz previous publication",
  );
  const publicExists = fs.existsSync(publicPath);
  const stageComplete = validCompleteStage(stagePath, transaction);

  if (publicExists) {
    assertDirectDirectory(publicPath, "The Quartz public tree");
  }

  if (!publicExists) {
    if (stageComplete) {
      fs.renameSync(stagePath, publicPath);
      fsyncDirectory(quartzRoot);
    } else if (fs.existsSync(previousPath)) {
      assertDirectDirectory(previousPath, "The previous Quartz public tree");
      fs.renameSync(previousPath, publicPath);
      fsyncDirectory(quartzRoot);
    } else if (transaction.state === "building") {
      removeDirectDirectory(stagePath);
      fs.rmSync(journalPath, { force: true });
      fsyncDirectory(quartzRoot);
      return { recovered: true, outcome: "discarded-incomplete-stage" };
    } else {
      fail("Quartz publication recovery cannot restore a complete public tree.");
    }
  }

  const publicMarkerPath = path.join(publicPath, COMPLETE_MARKER_FILE_NAME);
  if (fs.existsSync(publicMarkerPath)) {
    const publicMarker = readBoundedJson(
      publicMarkerPath,
      8 * 1024,
      "The promoted Quartz build marker",
    );
    if (
      hasExactKeys(publicMarker, [
        "version",
        "jobId",
        "attempt",
        "workerInstanceId",
      ]) &&
      publicMarker.version === 1 &&
      publicMarker.jobId === transaction.jobId &&
      publicMarker.attempt === transaction.attempt &&
      publicMarker.workerInstanceId === transaction.workerInstanceId
    ) {
      fs.rmSync(publicMarkerPath);
      fsyncDirectory(publicPath);
    }
  }

  removeDirectDirectory(stagePath);
  removeDirectDirectory(previousPath);
  fs.rmSync(journalPath, { force: true });
  fsyncDirectory(quartzRoot);
  return {
    recovered: true,
    outcome: stageComplete ? "published-prepared-stage" : "restored-previous",
  };
}

function readLockOwner(lockDirectory) {
  try {
    const value = readBoundedJson(
      path.join(lockDirectory, LOCK_OWNER_FILE_NAME),
      8 * 1024,
      "The Quartz publication lock owner",
    );
    if (
      !hasExactKeys(value, [
        "version",
        "token",
        "pid",
        "hostname",
        "acquiredAt",
        "heartbeatAt",
      ]) ||
      value.version !== 1 ||
      !IDENTIFIER.test(value.token) ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      typeof value.hostname !== "string" ||
      typeof value.acquiredAt !== "string" ||
      typeof value.heartbeatAt !== "string"
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === "EPERM";
  }
}

function lockAgeMs(lockDirectory) {
  try {
    return Date.now() - fs.statSync(
      path.join(lockDirectory, LOCK_OWNER_FILE_NAME),
    ).mtimeMs;
  } catch {
    try {
      return Date.now() - fs.statSync(lockDirectory).mtimeMs;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
}

function retireStaleLock(lockDirectory, staleAfterMs) {
  const owner = readLockOwner(lockDirectory);
  if (owner?.hostname === os.hostname() && processIsAlive(owner.pid)) return false;
  if (lockAgeMs(lockDirectory) <= staleAfterMs) return false;
  const retiredPath = `${lockDirectory}.stale-${owner?.token ?? randomUUID()}`;
  try {
    fs.renameSync(lockDirectory, retiredPath);
    fs.rmSync(retiredPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (
      isRecord(error) &&
      ["ENOENT", "EEXIST", "ENOTEMPTY"].includes(String(error.code))
    ) {
      return false;
    }
    throw error;
  }
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Quartz publication was canceled."));
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Quartz publication was canceled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function acquireLock(quartzRoot, timeoutMs, signal) {
  const lockDirectory = path.join(quartzRoot, LOCK_DIRECTORY_NAME);
  const staleAfterMs = Math.max(DEFAULT_LOCK_STALE_MS, Math.min(timeoutMs, 5 * 60_000));
  const deadline = Date.now() + timeoutMs + staleAfterMs + 60_000;
  while (true) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Quartz publication was canceled.");
    }
    const token = randomUUID();
    const timestamp = new Date().toISOString();
    const owner = {
      version: 1,
      token,
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
    };
    try {
      fs.mkdirSync(lockDirectory);
      atomicWriteJson(path.join(lockDirectory, LOCK_OWNER_FILE_NAME), owner);
      let released = false;
      const ownerPath = path.join(lockDirectory, LOCK_OWNER_FILE_NAME);
      const heartbeat = setInterval(() => {
        if (released || readLockOwner(lockDirectory)?.token !== token) return;
        try {
          const now = new Date();
          fs.utimesSync(ownerPath, now, now);
        } catch {
          // The fenced release/recovery path remains authoritative.
        }
      }, Math.max(1_000, Math.min(5_000, Math.floor(staleAfterMs / 3))));
      heartbeat.unref();
      return {
        release() {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          if (readLockOwner(lockDirectory)?.token !== token) return;
          const releasedPath = `${lockDirectory}.released-${token}`;
          try {
            fs.renameSync(lockDirectory, releasedPath);
            fs.rmSync(releasedPath, { recursive: true, force: true });
          } catch (error) {
            if (!isRecord(error) || error.code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if (!isRecord(error) || error.code !== "EEXIST") throw error;
    }
    if (retireStaleLock(lockDirectory, staleAfterMs)) continue;
    if (Date.now() >= deadline) {
      fail("Timed out waiting for the Quartz publication lock.");
    }
    await delay(DEFAULT_LOCK_POLL_MS, signal);
  }
}

function normalizeReasons(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REASONS) {
    fail("The Quartz publication reasons are outside their bound.");
  }
  const reasons = [];
  const seen = new Set();
  for (const rawReason of value) {
    if (typeof rawReason !== "string") fail("A Quartz publication reason is invalid.");
    const reason = rawReason.trim() || "Breadboard content update";
    if (
      Buffer.byteLength(reason, "utf8") > MAX_REASON_BYTES ||
      /\p{Cc}/u.test(reason)
    ) {
      fail("A Quartz publication reason is invalid.");
    }
    if (!seen.has(reason)) {
      seen.add(reason);
      reasons.push(reason);
    }
  }
  return reasons;
}

function normalizeBuildOptions(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "reasons",
      "concurrency",
      "timeoutMs",
      "buildEnvironment",
    ]) ||
    !Number.isSafeInteger(value.concurrency) ||
    value.concurrency < 1 ||
    value.concurrency > MAX_BUILD_CONCURRENCY ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < MIN_BUILD_TIMEOUT_MS ||
    value.timeoutMs > MAX_BUILD_TIMEOUT_MS
  ) {
    fail("The Quartz publication options are invalid.");
  }
  if (!isRecord(value.buildEnvironment)) {
    fail("The Quartz build environment is invalid.");
  }
  const buildEnvironment = {};
  let environmentBytes = 0;
  for (const [name, raw] of Object.entries(value.buildEnvironment)) {
    if (
      !BUILD_ENVIRONMENT_NAMES.has(name) ||
      typeof raw !== "string" ||
      raw.length === 0 ||
      raw.includes("\0") ||
      Buffer.byteLength(raw, "utf8") > 2 * 1024
    ) {
      fail("The Quartz build environment is invalid.");
    }
    environmentBytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(raw, "utf8");
    if (environmentBytes > MAX_BUILD_ENVIRONMENT_BYTES) {
      fail("The Quartz build environment exceeded its bound.");
    }
    buildEnvironment[name] = raw;
  }
  return {
    reasons: normalizeReasons(value.reasons),
    concurrency: value.concurrency,
    timeoutMs: value.timeoutMs,
    buildEnvironment,
  };
}

function appendTail(current, chunk) {
  return Buffer.from(`${current}${String(chunk)}`, "utf8")
    .subarray(-MAX_OUTPUT_TAIL_BYTES)
    .toString("utf8")
    .replace(/^\uFFFD+/u, "");
}

function runBuildChild({
  quartzRoot,
  sourceRoot,
  cliPath,
  stagePath,
  concurrency,
  timeoutMs,
  buildEnvironment,
  signal,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Quartz publication was canceled."));
      return;
    }
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "build",
        `--concurrency=${concurrency}`,
        `--directory=${path.join(quartzRoot, "content")}`,
        `--output=${stagePath}`,
      ],
      {
        cwd: sourceRoot,
        env: {
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          ...buildEnvironment,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let terminationTimer = null;
    let stopping = false;
    const stopChild = () => {
      if (stopping) return;
      stopping = true;
      child.kill("SIGTERM");
      terminationTimer = setTimeout(
        () => child.kill("SIGKILL"),
        CHILD_TERMINATION_GRACE_MS,
      );
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (terminationTimer !== null) clearTimeout(terminationTimer);
      signal?.removeEventListener("abort", stopChild);
      if (error) reject(error);
      else resolve();
    };
    signal?.addEventListener("abort", stopChild, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout = appendTail(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendTail(stderr, chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (signal?.aborted) {
        finish(signal.reason ?? new Error("Quartz publication was canceled."));
      } else if (timedOut) {
        finish(new Error(`Quartz build timed out after ${timeoutMs} ms.`));
      } else if (code === 0) {
        finish();
      } else {
        const details = (stderr || stdout).trim();
        finish(
          new Error(
            details
              ? `Quartz build exited with code ${code}: ${details}`
              : `Quartz build exited with code ${code}.`,
          ),
        );
      }
    });
  });
}

function transactionFor(identity) {
  const suffix = `${identity.jobId}-${identity.attempt}-${identity.workerInstanceId}`;
  return {
    version: 1,
    jobId: identity.jobId,
    attempt: identity.attempt,
    workerInstanceId: identity.workerInstanceId,
    stageName: `.breadboard-quartz-publish.stage-${suffix}`,
    previousName: `.breadboard-quartz-publish.previous-${suffix}`,
    state: "building",
  };
}

async function runSealedQuartzPublication(attestation, rawOptions) {
  const options = normalizeBuildOptions(rawOptions);
  const quartzRoot = path.dirname(attestation.contentPath);
  const cliPath = path.join(attestation.sourceRoot, "quartz", "bootstrap-cli.mjs");
  const lease = await acquireLock(quartzRoot, options.timeoutMs, attestation.signal);
  const startedAt = Date.now();
  try {
    recoverQuartzPublicationTransaction(quartzRoot);
    const transaction = transactionFor(attestation.identity);
    const journalPath = path.join(quartzRoot, TRANSACTION_FILE_NAME);
    const publicPath = path.join(quartzRoot, "public");
    const stagePath = directDirectory(
      quartzRoot,
      transaction.stageName,
      "Quartz publication stage",
    );
    const previousPath = directDirectory(
      quartzRoot,
      transaction.previousName,
      "Quartz previous publication",
    );
    if (fs.existsSync(stagePath) || fs.existsSync(previousPath)) {
      fail("The fenced Quartz publication paths already exist.");
    }
    atomicWriteJson(journalPath, transaction);
    try {
      await runBuildChild({
        quartzRoot,
        sourceRoot: attestation.sourceRoot,
        cliPath,
        stagePath,
        concurrency: options.concurrency,
        timeoutMs: options.timeoutMs,
        buildEnvironment: options.buildEnvironment,
        signal: attestation.signal,
      });
      assertDirectDirectory(stagePath, "The staged Quartz public tree");
      if (attestation.signal?.aborted) {
        throw attestation.signal.reason ?? new Error("Quartz publication was canceled.");
      }
      atomicWriteJson(path.join(stagePath, COMPLETE_MARKER_FILE_NAME), {
        version: 1,
        jobId: transaction.jobId,
        attempt: transaction.attempt,
        workerInstanceId: transaction.workerInstanceId,
      });
      transaction.state = "prepared";
      atomicWriteJson(journalPath, transaction);
      if (fs.existsSync(publicPath)) {
        assertDirectDirectory(publicPath, "The Quartz public tree");
        fs.renameSync(publicPath, previousPath);
      }
      transaction.state = "previous-moved";
      atomicWriteJson(journalPath, transaction);
      fs.renameSync(stagePath, publicPath);
      fs.rmSync(path.join(publicPath, COMPLETE_MARKER_FILE_NAME));
      fsyncDirectory(publicPath);
      fsyncDirectory(quartzRoot);
      transaction.state = "published";
      atomicWriteJson(journalPath, transaction);
      removeDirectDirectory(previousPath);
      fs.rmSync(journalPath, { force: true });
      fsyncDirectory(quartzRoot);
    } catch (error) {
      // Before promotion, failure leaves the prior public tree untouched. If
      // promotion began, retain the journal so the next owned worker can
      // deterministically finish or restore it.
      const current = readTransaction(quartzRoot);
      if (current?.state === "building") {
        removeDirectDirectory(stagePath);
        fs.rmSync(journalPath, { force: true });
      }
      throw error;
    }
    return {
      published: true,
      durationMs: Date.now() - startedAt,
      reasonCount: options.reasons.length,
    };
  } finally {
    lease.release();
  }
}

/**
 * Mint the only direct Quartz compiler capability. The attestation is bound to
 * the current fixed `start.json`, exact attempt directory, private workspace,
 * and authoritative Runtime data root. A Next process cannot satisfy it.
 */
export function createSealedRuntimeV2QuartzPublishExecutor(options) {
  const attestation = validateCurrentRuntimeWorker(options);
  let active = false;
  return async (buildOptions) => {
    if (active) fail("A sealed Runtime worker cannot start concurrent Quartz builds.");
    active = true;
    try {
      return await runSealedQuartzPublication(attestation, buildOptions);
    } finally {
      active = false;
    }
  };
}
