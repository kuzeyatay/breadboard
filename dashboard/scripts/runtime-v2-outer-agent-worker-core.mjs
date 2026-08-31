import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";
import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2OuterAgentRequest,
} from "./runtime-v2-outer-agent-adapters.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 512 * 1024;
const MAX_CHECKPOINT_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024 + 32 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
const MAX_FAILURE_MESSAGE_BYTES = 8 * 1024;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_LEGAL_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_LEGAL_TOTAL_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MEETING_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MEETING_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 5_000;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
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
  ) fail("The outer-agent Runtime worker identity is invalid.");
  return value;
}

function validateExecutionScope(adapter, value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    typeof value.conversationId !== "string" ||
    !new RegExp(`^${adapter.scopePrefix}[0-9a-f]{32}$`, "u").test(value.conversationId)
  ) fail("The outer-agent Runtime worker requires exact authenticated authority.");
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
  ) fail("The outer-agent worker received an invalid Runtime-relative path.");
  const resolved = path.resolve(dataRoot, ...relativePath.split("/"));
  if (!pathWithin(dataRoot, resolved)) fail("The outer-agent worker path escaped its data root.");
  return resolved;
}

function validateInputBlob(value, identity, adapterId, request, index) {
  const match = isRecord(value) && typeof value.relativePath === "string"
    ? /^runtime\/jobs\/([A-Za-z0-9_-]{1,128})\/inputs\/([A-Za-z0-9_-]{1,128})\/payload$/u.exec(value.relativePath)
    : null;
  if (
    !exactRecord(value, [
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
    value.sizeBytes > (
      adapterId === "legal"
        ? MAX_LEGAL_INPUT_BYTES
        : adapterId === "meeting-notes"
          ? request.source.kind !== "audio"
            ? MAX_MEETING_TRANSCRIPT_BYTES
            : MAX_MEETING_INPUT_BYTES
          : MAX_INPUT_BYTES
    ) ||
    !SHA256.test(value.sha256) ||
    typeof value.displayName !== "string" ||
    value.displayName !== path.basename(value.displayName) ||
    Buffer.byteLength(value.displayName, "utf8") > 512 ||
    !(adapterId === "legal"
      ? value.mediaType === (index === 0
          ? "application/vnd.breadboard.legal-bundle"
          : "application/octet-stream")
      : adapterId === "meeting-notes"
        ? value.mediaType === (request.source.kind !== "audio"
            ? "text/plain"
            : "application/octet-stream")
        : ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(value.mediaType))
  ) fail("The outer-agent Runtime input blob is invalid.");
  return value;
}

function verifyInput(dataRoot, blob) {
  const target = resolveDataPath(dataRoot, blob.relativePath);
  const metadata = fs.lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== blob.sizeBytes) {
    fail("The sealed outer-agent Runtime input is invalid.");
  }
  const canonical = fs.realpathSync.native(target);
  if (!samePath(canonical, target)) fail("The sealed outer-agent Runtime input is indirect.");
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(canonical, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  try {
    while (position < blob.sizeBytes) {
      const requested = Math.min(chunk.byteLength, blob.sizeBytes - position);
      const read = fs.readSync(descriptor, chunk, 0, requested, position);
      if (read < 1) fail("The sealed outer-agent Runtime input changed while hashing.");
      hash.update(chunk.subarray(0, read));
      position += read;
    }
    if (fs.readSync(descriptor, chunk, 0, 1, position) !== 0) {
      fail("The sealed outer-agent Runtime input changed while hashing.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const digest = hash.digest("hex");
  if (digest !== blob.sha256) fail("The sealed outer-agent Runtime input failed integrity check.");
  return canonical;
}

export function loadRuntimeV2OuterAgentLaunch({
  adapterId,
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
}) {
  const adapter = RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS[adapterId];
  if (!adapter) fail("The Runtime worker adapter is not registered.");
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The outer-agent Runtime worker requires exactly fixed start.json.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The outer-agent start manifest",
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
  ) fail("The outer-agent start manifest has an unsupported shape.");
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(adapter, manifest.executionScope);
  const expected = expectedPaths(identity);
  for (const field of ["inputManifestPath", "workspacePath", "checkpointPath", "resultPath"]) {
    if (manifest[field] !== expected[field]) fail(`The outer-agent ${field} is not identity-bound.`);
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (!samePath(canonicalLaunchDirectory, resolveDataPath(dataRoot, expected.attemptRoot))) {
    fail("The outer-agent launch directory is not identity-bound.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("The outer-agent private worker workspace is unavailable.");
  }
  const request = validateRuntimeV2OuterAgentRequest(
    adapterId,
    readBoundedJson(
      resolveDataPath(dataRoot, manifest.inputManifestPath),
      MAX_INPUT_MANIFEST_BYTES,
      "The canonical outer-agent request",
    ),
  );
  if (
    !Array.isArray(manifest.inputBlobs) ||
    manifest.inputBlobs.length !== expectedRuntimeV2OuterAgentInputCount(adapterId, request) ||
    manifest.inputBlobs.length > adapter.maximumInputs
  ) fail("The outer-agent Runtime worker received the wrong number of inputs.");
  const inputBlobs = manifest.inputBlobs.map((blob, index) =>
    validateInputBlob(blob, identity, adapterId, request, index));
  if (
    new Set(inputBlobs.map((blob) => blob.blobId)).size !== inputBlobs.length ||
    inputBlobs.reduce((total, blob) => total + blob.sizeBytes, 0) >
      (adapterId === "legal"
        ? MAX_LEGAL_TOTAL_INPUT_BYTES
        : adapterId === "meeting-notes"
          ? MAX_MEETING_INPUT_BYTES
          : MAX_TOTAL_INPUT_BYTES)
  ) fail("The outer-agent Runtime inputs exceeded their sealed bounds.");
  const inputPaths = inputBlobs.map((blob) => verifyInput(dataRoot, blob));
  return {
    adapter,
    dataRoot,
    identity,
    executionScope,
    request,
    inputBlobs,
    inputPaths,
    workspacePath,
    checkpointPath: resolveDataPath(dataRoot, manifest.checkpointPath),
    checkpointRelativePath: manifest.checkpointPath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
  };
}

export function canonicalRuntimeV2OuterAgentInput(launch, index) {
  const inputPath = launch.inputPaths[index];
  if (!inputPath) fail("The requested outer-agent Runtime input is unavailable.");
  return inputPath;
}

export function parseRuntimeV2OuterAgentStopRecord(line) {
  if (
    typeof line !== "string" ||
    Buffer.byteLength(line, "utf8") > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) fail("The outer-agent Runtime stop record is invalid.");
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The outer-agent Runtime stop record is invalid JSON.");
  }
  if (!exactRecord(value, ["type", "force"]) || value.type !== "stop" || value.force !== false) {
    fail("The outer-agent Runtime stop record is invalid.");
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
      onFault(new Error("The outer-agent stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2OuterAgentStopRecord(line);
      if (requested || remainder) fail("The outer-agent worker received more than one stop record.");
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

function sourceLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT_PATH));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(path.join(developmentSourceRoot, "lib", "db.ts"));
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  if (!fs.existsSync(path.join(sourceRoot, "lib", "db.ts"))) {
    fail("The staged outer-agent Runtime source closure is unavailable.");
  }
  const historicalDevelopmentData = development && samePath(dataRoot, appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = dashboardRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.QUARTZ_CONTENT_PATH ||= path.join(dataRoot, "quartz", "content");
  process.env.NODE_ENV = development ? "development" : "production";
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

function writeResultOnce(resultPath, value, maximumBytes = MAX_RESULT_BYTES) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    fail("The outer-agent Runtime result exceeded its bounded envelope.");
  }
  if (fs.existsSync(resultPath)) fail("The outer-agent Runtime result already exists.");
  atomicReplace(resultPath, bytes, maximumBytes, "The outer-agent Runtime result");
}

function projectionBytes(current) {
  while (true) {
    const projection = {
      protocolVersion: PROTOCOL_VERSION,
      identity: current.identity,
      scope: current.executionScope,
      adapterId: current.adapterId,
      status: current.status,
      events: current.events,
    };
    const bytes = Buffer.from(`${JSON.stringify(projection)}\n`, "utf8");
    if (bytes.byteLength <= current.maximumProjectionBytes) return { projection, bytes };
    if (current.events.length <= 1) fail("The outer-agent checkpoint exceeded its bound.");
    current.events.shift();
  }
}

function persistProjection(current) {
  const { bytes } = projectionBytes(current);
  atomicReplace(
    current.checkpointPath,
    bytes,
    current.maximumProjectionBytes,
    "The outer-agent Runtime checkpoint",
  );
  if (!current.checkpointPublished) {
    current.checkpointPublished = true;
    current.onFirstCheckpoint();
  }
}

function validateApplicationEvent(event, prior) {
  if (
    !exactRecord(event, ["sequenceNumber", "type", "payload", "at"]) ||
    !Number.isSafeInteger(event.sequenceNumber) ||
    event.sequenceNumber <= prior ||
    !EVENT_TYPE.test(event.type) ||
    !isRecord(event.payload) ||
    typeof event.at !== "string" ||
    !Number.isFinite(Date.parse(event.at))
  ) fail("The outer-agent application event stream is invalid.");
  return event;
}

function updateProjection(current, nextEvents, status) {
  if (TERMINAL_STATUSES.has(current.status)) return;
  if (status !== undefined) {
    if (!["queued", "planning", "running", "completed", "failed", "aborted"].includes(status)) {
      fail("The outer-agent application status is invalid.");
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
  if (current.events.length > MAX_EVENTS) {
    current.events.splice(0, current.events.length - MAX_EVENTS);
  }
  persistProjection(current);
}

function terminalPayload(adapterId, status, error) {
  if (status === "aborted") {
    return {
      summary: adapterId === "ruflo"
        ? "Ruflo swarm stopped."
        : adapterId === "deep-tutor"
          ? "The tutoring turn was stopped before an answer."
        : adapterId === "deer-flow"
          ? "DeerFlow stopped before it answered."
        : adapterId === "deep-research"
          ? "The research run was stopped."
          : adapterId === "video-use"
            ? "The edit was stopped before it finished rendering."
          : adapterId === "openscience"
            ? "The OpenScience run was stopped."
          : adapterId === "opencode"
            ? "OpenCode task stopped."
            : adapterId === "trading-agent"
              ? "The market analysis was stopped."
              : adapterId === "openexecutive"
                ? "Open Executive stopped."
              : adapterId === "career-ops"
                ? "Career Ops stopped."
                : adapterId === "agent-reach"
                  ? "Agent Reach stopped."
                  : adapterId === "praxist"
                    ? "Praxist research stopped."
                  : adapterId === "shorts"
                    ? "The Shorts run was stopped before any clip was finished."
                    : adapterId === "open-gym"
                      ? "openGym stopped."
                      : adapterId === "legal"
                        ? "The assignment was stopped before anything was written."
                      : adapterId === "openplanter"
                        ? "OpenPlanter investigation stopped."
                      : adapterId === "resource2skill"
                        ? "Resource2Skill run stopped."
                      : adapterId === "matraix"
                        ? "The MatrAIx study was stopped."
                      : adapterId === "hyperframes"
                        ? "Video build stopped."
                      : adapterId === "openmontage"
                        ? "Production stopped."
                      : adapterId === "bolt-slides"
                        ? "The deck was stopped."
                      : adapterId === "hardware-blueprint"
                        ? "The hardware blueprint run was stopped."
                      : adapterId === "inbox-zero"
                        ? "Inbox Zero stopped."
                      : adapterId === "socials-manager"
                        ? "Postiz drafting stopped."
                      : adapterId === "get-doc"
                        ? "The document search was stopped."
                      : adapterId === "get-doc-download"
                        ? "The document download was stopped."
                       : adapterId === "meeting-notes"
                         ? "The meeting notes run was stopped."
                       : adapterId === "max-research"
                         ? "Max Research stopped."
                       : adapterId === "wardrobe"
                         ? "The wardrobe import was stopped."
                       : adapterId === "parametric-cad"
                         ? "The parametric CAD operation was stopped."
                       : adapterId === "stock-analyst"
                         ? "Stock Analyst stopped before it answered."
                       : adapterId === "vibe-trading"
                         ? "Vibe Trading stopped before it answered."
                       : adapterId === "money-printer"
                         ? "The video was stopped."
               : "Codex task stopped.",
    };
  }
  if (status === "completed") {
    return {
      summary: adapterId === "ruflo"
        ? "The Ruflo swarm finished."
        : adapterId === "deep-tutor"
          ? "The tutor finished without an answer."
        : adapterId === "deer-flow"
          ? "DeerFlow finished without an answer."
        : adapterId === "deep-research"
          ? "Deep Research finished without a report."
          : adapterId === "video-use"
            ? "Video Use finished without an edited video."
          : adapterId === "openscience"
            ? "OpenScience finished without an answer."
          : adapterId === "opencode"
            ? "OpenCode completed the task."
            : adapterId === "trading-agent"
              ? "The market analysis finished."
              : adapterId === "openexecutive"
                ? "Open Executive finished without a response."
              : adapterId === "career-ops"
                ? "Career Ops finished without an answer."
                : adapterId === "agent-reach"
                  ? "Agent Reach finished without an answer."
                  : adapterId === "praxist"
                    ? "Praxist finished without a research summary."
                  : adapterId === "shorts"
                    ? "The Shorts run finished without any clips."
                    : adapterId === "open-gym"
                      ? "openGym finished without an answer."
                      : adapterId === "legal"
                        ? "The Legal Agent finished without producing a response."
                      : adapterId === "openplanter"
                        ? "OpenPlanter completed."
                      : adapterId === "resource2skill"
                        ? "Resource2Skill completed the artifact."
                      : adapterId === "matraix"
                        ? "The MatrAIx study finished."
                      : adapterId === "hyperframes"
                        ? "The HyperFrames video build finished."
                      : adapterId === "openmontage"
                        ? "The OpenMontage production finished."
                      : adapterId === "bolt-slides"
                        ? "The presentation finished."
                      : adapterId === "hardware-blueprint"
                        ? "The hardware blueprint finished."
                      : adapterId === "inbox-zero"
                        ? "Inbox Zero finished without an answer."
                      : adapterId === "socials-manager"
                        ? "The Socials Manager finished without any posts."
                      : adapterId === "get-doc"
                        ? "The document search finished."
                      : adapterId === "get-doc-download"
                        ? "The document was saved to artifacts."
                       : adapterId === "meeting-notes"
                         ? "The meeting notes finished."
                       : adapterId === "max-research"
                         ? "Max Research finished without an answer."
                       : adapterId === "wardrobe"
                         ? "No clothing was found in those photos."
                       : adapterId === "parametric-cad"
                         ? "The parametric CAD operation finished."
                       : adapterId === "stock-analyst"
                         ? "Stock Analyst finished without an answer."
                       : adapterId === "vibe-trading"
                         ? "Vibe Trading finished without an answer."
                       : adapterId === "money-printer"
                         ? "MoneyPrinter finished without a video."
               : "Codex completed the task.",
    };
  }
  return { error: boundedFailureMessage(error) };
}

function finalizeProjection(current, status, error) {
  const terminal = current.events.findLast((event) => TERMINAL_EVENTS.has(event.type));
  if (terminal) {
    current.status = terminal.type === "run.completed"
      ? "completed"
      : terminal.type === "run.aborted"
        ? "aborted"
        : "failed";
    persistProjection(current);
    return;
  }
  const type = status === "completed"
    ? "run.completed"
    : status === "aborted"
      ? "run.aborted"
      : "run.failed";
  updateProjection(current, [{
    sequenceNumber: current.lastSequence + 1,
    type,
    payload: terminalPayload(current.adapterId, status, error),
    at: new Date().toISOString(),
  }], status);
}

function attachSnapshotReceipt(current, edits) {
  if (
    !isRecord(edits) ||
    !exactRecord(edits, ["before", "after"]) ||
    typeof edits.before !== "string" ||
    !/^[0-9a-f]{40}$/u.test(edits.before) ||
    typeof edits.after !== "string" ||
    !/^[0-9a-f]{40}$/u.test(edits.after)
  ) return;
  const terminal = current.events.findLast((event) => TERMINAL_EVENTS.has(event.type));
  if (!terminal) return;
  terminal.payload = { ...terminal.payload, edits };
  persistProjection(current);
}

function boundedFailureMessage(error) {
  const raw = error && typeof error === "object" && typeof error.message === "string"
    ? error.message
    : String(error || "Outer-agent Runtime execution failed.");
  const bytes = Buffer.from(raw, "utf8");
  return bytes.byteLength <= MAX_FAILURE_MESSAGE_BYTES
    ? bytes.toString("utf8")
    : bytes.subarray(0, MAX_FAILURE_MESSAGE_BYTES).toString("utf8").replace(/\uFFFD+$/u, "");
}

export async function runRuntimeV2OuterAgentWorker(adapterId) {
  const adapter = RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS[adapterId];
  if (!adapter) fail("The Runtime worker adapter is not registered.");
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  const launch = loadRuntimeV2OuterAgentLaunch({ adapterId });
  const { sourceRoot } = sourceLayout(launch.dataRoot);
  await import(pathToFileURL(path.join(path.dirname(ENTRYPOINT_PATH), "learn-worker-import-hook.mjs")).href);
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "agent-execution",
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
    adapterId,
    identity: launch.identity,
    executionScope: launch.executionScope,
    checkpointPath: launch.checkpointPath,
    checkpointPublished: false,
    onFirstCheckpoint: () => events.checkpoint("checkpoint", launch.checkpointRelativePath),
    status: "queued",
    lastSequence: 0,
    events: [],
    maximumProjectionBytes: adapter.maximumProjectionBytes ?? MAX_CHECKPOINT_BYTES,
  };
  try {
    events.ready();
    if (stop.requested()) return;
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    persistProjection(current);
    const outcome = await executeRuntimeV2OuterAgentAdapter({
      adapterId,
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
      finalizeProjection(current, "aborted");
      attachSnapshotReceipt(current, outcome.edits);
      return;
    }
    if (outcome.status === "failed") {
      finalizeProjection(current, "failed");
      attachSnapshotReceipt(current, outcome.edits);
      events.failed("OUTER_AGENT_WORKER_FAILED", "Runtime agent execution failed.");
      process.exitCode = 1;
      return;
    }
    finalizeProjection(current, "completed");
    attachSnapshotReceipt(current, outcome.edits);
    const completionSequence = events.nextSequence();
    writeResultOnce(launch.resultPath, {
      protocolVersion: PROTOCOL_VERSION,
      identity: launch.identity,
      completionSequence,
      run: projectionBytes(current).projection,
    }, current.maximumProjectionBytes + 32 * 1024);
    events.complete(launch.resultRelativePath);
  } catch (error) {
    if (stop.requested()) {
      finalizeProjection(current, "aborted");
      return;
    }
    finalizeProjection(current, "failed", error);
    events.failed("OUTER_AGENT_WORKER_FAILED", "Runtime agent execution failed.");
    process.exitCode = 1;
    console.error(`[runtime-v2-${adapterId}-worker] execution failed:`, error);
  } finally {
    try {
      await heartbeat?.stop();
    } catch {
      process.exitCode = 1;
    }
    stop.close();
  }
}
