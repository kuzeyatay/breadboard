import fs from "node:fs";
import path from "node:path";

const PROTOCOL_VERSION = 1;
const STARTUP_FILE_FLAG = "--breadboard-learn-start-file";
const OPERATIONS = new Set([
  "plan",
  "generate",
  "confirm",
  "confirm_generate",
  "repair",
  "rebuild",
  "humanizer",
]);

let started = false;
let readySent = false;
let envelope = null;

function response(message) {
  if (!envelope) throw new Error("The Learn worker startup envelope is missing.");
  return { ...envelope, ...message };
}

function serializeError(error) {
  return {
    name:
      error && typeof error === "object" && typeof error.name === "string"
        ? error.name
        : "Error",
    message:
      error && typeof error === "object" && typeof error.message === "string"
        ? error.message
        : String(error),
    ...(error &&
    typeof error === "object" &&
    error.requiresReplan === true
      ? { requiresReplan: true }
      : {}),
  };
}

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected || typeof process.send !== "function") {
      reject(new Error("The Learn worker lost its startup IPC channel."));
      return;
    }
    process.send(message, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function assertRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Learn worker request must be an object.");
  }
  if (!OPERATIONS.has(value.operation)) {
    throw new Error(`Unsupported Learn worker operation: ${String(value.operation)}`);
  }
  if (
    typeof value.gardenId !== "string" ||
    !value.gardenId.trim() ||
    !Number.isSafeInteger(value.userId) ||
    value.userId <= 0 ||
    typeof value.contentPath !== "string" ||
    !value.contentPath.trim()
  ) {
    throw new Error("The Learn worker request is missing its garden, user, or content path.");
  }
  const authoritativeContentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (
    !authoritativeContentPath ||
    path.resolve(value.contentPath) !== path.resolve(authoritativeContentPath)
  ) {
    throw new Error("The Learn worker content path does not match its server environment.");
  }
  if (
    value.operation !== "humanizer" &&
    value.operation !== "confirm" &&
    (typeof value.baseURL !== "string" ||
      !value.baseURL.trim() ||
      typeof value.model !== "string" ||
      !value.model.trim())
  ) {
    throw new Error("The Learn worker model request is incomplete.");
  }
  const optionalStringArray = (candidate) =>
    candidate === undefined ||
    (Array.isArray(candidate) &&
      candidate.every((entry) => typeof entry === "string" && entry.trim()));
  const nonEmptyUniqueStringArray = (candidate) =>
    Array.isArray(candidate) &&
    candidate.length > 0 &&
    candidate.every((entry) => typeof entry === "string" && entry.trim()) &&
    new Set(candidate.map((entry) => entry.trim())).size === candidate.length;
  const optionalString = (candidate) =>
    candidate === undefined ||
    (typeof candidate === "string" && candidate.trim());
  const optionalLearnUserInstruction = (candidate) =>
    candidate === undefined ||
    (typeof candidate === "string" &&
      Boolean(candidate.trim()) &&
      candidate.trim().length <= 4_000);
  const nullableNonEmptyString = (candidate) =>
    candidate === null || (typeof candidate === "string" && candidate.trim());
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
        throw new Error("The Learn planning request is invalid.");
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
        throw new Error("The Learn generation request is invalid.");
      }
      break;
    case "confirm":
      if (
        typeof value.expectedModel !== "string" ||
        !value.expectedModel.trim() ||
        typeof value.proposedLearningMapId !== "string" ||
        !value.proposedLearningMapId.trim()
      ) {
        throw new Error("The Learn confirmation request is invalid.");
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
        throw new Error("The Learn confirmation-and-generation request is invalid.");
      }
      break;
    case "repair":
      if (
        !value.request ||
        typeof value.request !== "object" ||
        value.request.gardenId !== value.gardenId ||
        value.request.mode !== "repair"
      ) {
        throw new Error("The Learn repair request is invalid.");
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
        throw new Error("The Learn rebuild request is invalid.");
      }
      break;
    case "humanizer":
      if (
        typeof value.enabled !== "boolean" ||
        !optionalString(value.expectedVersionId)
      ) {
        throw new Error("The Learn humanizer request is invalid.");
      }
      break;
  }
  return value;
}

function markerMatchesLaunch(marker, message) {
  return (
    marker?.protocolVersion === PROTOCOL_VERSION &&
    marker?.requestId === message.requestId &&
    marker?.nonce === message.concurrencyNonce &&
    marker?.state === "launching"
  );
}

function promoteConcurrencyMarker(concurrencyPath, message) {
  const transitionPath = `${concurrencyPath}.promoting-${process.pid}-${message.concurrencyNonce}`;
  fs.renameSync(concurrencyPath, transitionPath);
  let markerCreated = false;
  let markerFd;
  try {
    const current = JSON.parse(fs.readFileSync(transitionPath, "utf8"));
    if (!markerMatchesLaunch(current, message)) {
      throw new Error("The Learn worker concurrency marker changed before PID fencing.");
    }
    markerFd = fs.openSync(concurrencyPath, "wx");
    markerCreated = true;
    fs.writeFileSync(
      markerFd,
      `${JSON.stringify({
        ...current,
        pid: process.pid,
        state: "running",
      })}\n`,
      "utf8",
    );
    fs.closeSync(markerFd);
    markerFd = undefined;
    // Cleanup cannot invalidate an already-published running owner.
    try {
      fs.rmSync(transitionPath, { force: true });
    } catch (cleanupError) {
      console.error("[learn-worker] Could not prune its promotion receipt:", cleanupError);
    }
  } catch (error) {
    if (markerFd !== undefined) fs.closeSync(markerFd);
    if (markerCreated) fs.rmSync(concurrencyPath, { force: true });
    try {
      fs.linkSync(transitionPath, concurrencyPath);
      fs.rmSync(transitionPath, { force: true });
    } catch {
      // Another exclusive claimant won the empty-path arbitration. Never
      // overwrite its marker; this worker must exit instead.
      try {
        fs.rmSync(transitionPath, { force: true });
      } catch {
        // An orphaned nonce path is safe and pruned after its bounded lease.
      }
    }
    throw error;
  }
}

function learnWorkerRuntimeRoot() {
  const configured = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "..", ".runtime", "learn-workers");
}

function assertTrustedStartEnvelope(message) {
  if (
    !message ||
    typeof message !== "object" ||
    message.type !== "start" ||
    message.protocolVersion !== PROTOCOL_VERSION ||
    typeof message.requestId !== "string" ||
    !message.requestId.trim() ||
    typeof message.receiptPath !== "string" ||
    !message.receiptPath.trim() ||
    typeof message.concurrencyPath !== "string" ||
    !message.concurrencyPath.trim() ||
    typeof message.concurrencyNonce !== "string" ||
    !message.concurrencyNonce.trim()
  ) {
    throw new Error("The Learn worker startup envelope is invalid.");
  }
  const runtimeRoot = learnWorkerRuntimeRoot();
  const receiptPath = path.resolve(message.receiptPath);
  const concurrencyPath = path.resolve(message.concurrencyPath);
  const relativeReceipt = path.relative(runtimeRoot, receiptPath);
  if (
    !relativeReceipt ||
    relativeReceipt.startsWith("..") ||
    path.isAbsolute(relativeReceipt) ||
    path.extname(receiptPath) !== ".json"
  ) {
    throw new Error("The Learn worker startup receipt path is outside its runtime root.");
  }
  if (
    path.dirname(concurrencyPath) !== runtimeRoot ||
    path.basename(concurrencyPath) !== "learn-worker.active.json"
  ) {
    throw new Error("The Learn worker concurrency marker is outside its runtime root.");
  }
  const concurrency = JSON.parse(fs.readFileSync(concurrencyPath, "utf8"));
  if (
    concurrency?.protocolVersion !== PROTOCOL_VERSION ||
    concurrency?.requestId !== message.requestId ||
    concurrency?.nonce !== message.concurrencyNonce
  ) {
    throw new Error("The Learn worker concurrency marker does not own this process.");
  }
  if (concurrency.state === "launching") {
    promoteConcurrencyMarker(concurrencyPath, message);
  } else if (concurrency.state !== "running" || concurrency.pid !== process.pid) {
    throw new Error("The Learn worker concurrency marker does not own this process.");
  }
  return {
    request: message.request,
    receiptPath,
    concurrencyPath,
    concurrencyNonce: message.concurrencyNonce,
  };
}

function writeStartupReceipt(receiptPath, message) {
  const temporary = `${receiptPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(message)}\n`, "utf8");
  fs.renameSync(temporary, receiptPath);
}

function writeReadyReceipt(receiptPath, message) {
  writeStartupReceipt(receiptPath, message);
}

async function execute(rawRequest) {
  const request = assertRequest(rawRequest);
  const yieldToResponse = async (jobId) => {
    if (typeof jobId !== "string" || !jobId.trim()) {
      throw new Error("The Learn worker reached handoff without a durable job ID.");
    }
    const ready = response({
      type: "ready",
      jobId,
    });
    writeReadyReceipt(rawRequest.receiptPath, ready);
    readySent = true;
    if (process.connected) {
      try {
        await send(ready);
      } catch (error) {
        console.error(
          "[learn-worker] Parent disappeared after the durable checkpoint; continuing independently:",
          error,
        );
      }
    }
    if (process.connected) process.disconnect();
  };

  // Admission must precede the heavyweight Learn import graph. Acquiring from
  // inside learn-operation-executor.ts is too late: its top-level imports have
  // already committed db, source-processing, and pipeline state by then.
  const { acquireCapabilityLease, releaseSupervisorLease } = await import(
    "../src/lib/supervisor-control.ts"
  );
  const lease = await acquireCapabilityLease(
    "learn-worker",
    `learn-${request.operation}`,
  );
  try {
    const { executeAdmittedLearnOperation } = await import(
      "../src/lib/learn-operation-executor.ts"
    );
    // The await is intentional: the finally below must retain the capability
    // through work that continues after the durable response handoff.
    return await executeAdmittedLearnOperation(request, yieldToResponse);
  } finally {
    // JS completion precedes OS process teardown. Ask Electron to acknowledge
    // now but, within the bounded lease lifetime, retain the hold until it
    // observes this recorded PID exit. Reclaimed services cannot return while
    // ordinary native/runtime teardown still owns commit.
    await releaseSupervisorLease(lease, process.env, {
      afterOwnerPidExit: process.pid,
    });
  }
}

function startWorker(message, durableStartup) {
  if (started) return;
  started = true;
  let start;
  try {
    start = assertTrustedStartEnvelope(message);
    envelope = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      operation: start.request?.operation,
      gardenId: start.request?.gardenId,
    };
  } catch (error) {
    console.error("[learn-worker] Invalid startup request:", error);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
    return;
  }
  try {
    start.request = assertRequest(start.request);
  } catch (error) {
    const failed = response({
      type: "failed",
      error: serializeError(error),
    });
    const finish = () => {
      if (process.connected) process.disconnect();
      console.error("[learn-worker] Invalid startup request:", error);
      process.exitCode = 1;
    };
    if (durableStartup) {
      try {
        writeStartupReceipt(start.receiptPath, failed);
      } catch (receiptError) {
        console.error(
          "[learn-worker] Could not write its startup failure receipt:",
          receiptError,
        );
      }
      finish();
    } else {
      void send(failed)
        .catch((sendError) => {
          console.error(
            "[learn-worker] Could not send its startup failure receipt:",
            sendError,
          );
        })
        .finally(finish);
    }
    return;
  }
  const keepalive = setInterval(() => {}, 60_000);
  void execute({ ...start.request, receiptPath: start.receiptPath }).then(
    async (value) => {
      if (!readySent) {
        const completed = response({ type: "completed", value });
        if (durableStartup) writeStartupReceipt(start.receiptPath, completed);
        else await send(completed);
        if (process.connected) process.disconnect();
      }
    },
    async (error) => {
      if (!readySent) {
        try {
          const failed = response({
            type: "failed",
            error: serializeError(error),
          });
          if (durableStartup) writeStartupReceipt(start.receiptPath, failed);
          else await send(failed);
        } catch {
          // The parent also observes the non-zero exit and reads this log.
        }
        if (process.connected) process.disconnect();
      }
      console.error("[learn-worker] Learn task failed:", error);
      process.exitCode = 1;
    },
  ).finally(() => {
    clearInterval(keepalive);
    // Leave the marker fenced through OS-level process exit. The next launch
    // reclaims it only after the recorded PID is no longer alive.
  });
}

function startupFilePath() {
  const indexes = process.argv
    .map((argument, index) => (argument === STARTUP_FILE_FLAG ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return null;
  if (indexes.length !== 1 || !process.argv[indexes[0] + 1]) {
    throw new Error("The Learn worker startup-file argument is invalid.");
  }
  const startupPath = path.resolve(process.argv[indexes[0] + 1]);
  const runtimeRoot = learnWorkerRuntimeRoot();
  const relative = path.relative(runtimeRoot, startupPath);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !/^learn-worker-[\w-]+\.start\.json$/u.test(path.basename(startupPath))
  ) {
    throw new Error("The Learn worker startup file is outside its runtime root.");
  }
  return startupPath;
}

let durableStartupPath;
try {
  durableStartupPath = startupFilePath();
} catch (error) {
  console.error("[learn-worker] Invalid startup file:", error);
  process.exitCode = 1;
}

if (durableStartupPath) {
  let message;
  try {
    message = JSON.parse(fs.readFileSync(durableStartupPath, "utf8"));
  } catch (error) {
    console.error("[learn-worker] Could not read its startup file:", error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(durableStartupPath, { force: true });
  }
  if (message) startWorker(message, true);
} else if (process.exitCode !== 1) {
  process.on("message", (message) => startWorker(message, false));
}
