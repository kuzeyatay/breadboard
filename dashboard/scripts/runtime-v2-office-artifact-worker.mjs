import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { createRuntimeV2WorkerEventWriter } from "./runtime-v2-worker-events.mjs";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_STOP_RECORD_BYTES = 1024;
const MAX_FAILURE_MESSAGE_BYTES = 8 * 1024;
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 5_000;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SANITIZED_FAILURE = "Office document processing failed.";
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
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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
    fail("The Office worker identity is invalid.");
  }
  return {
    jobId: value.jobId,
    attempt: value.attempt,
    workerInstanceId: value.workerInstanceId,
  };
}

function boundedScope(value) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 256 &&
    !/\p{Cc}/u.test(value);
}

function validateExecutionScope(value) {
  if (
    !hasExactKeys(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    (value.gardenId !== null && !boundedScope(value.gardenId)) ||
    (value.conversationId !== null && !boundedScope(value.conversationId))
  ) {
    fail("Office processing requires exact authenticated conversation scope.");
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
  if (
    typeof relativePath !== "string" ||
    relativePath.split("/").length < 2 ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail("The Office worker start manifest contains an invalid relative path.");
  }
  const resolved = path.resolve(dataRoot, ...relativePath.split("/"));
  if (!pathWithin(dataRoot, resolved)) {
    fail("The Office worker start manifest path escapes the Runtime data root.");
  }
  return resolved;
}

function boundedText(value, maximumBytes) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function validateRequest(value) {
  if (!isRecord(value) || typeof value.operation !== "string") {
    fail("The canonical Office request is invalid.");
  }
  for (const field of ["userId", "gardenId", "conversationId", "workspace", "path"]) {
    if (Object.hasOwn(value, field)) {
      fail(`The Office request must not carry caller-selected ${field} authority.`);
    }
  }
  if (value.operation === "command") {
    if (
      !hasExactKeys(value, ["operation", "runtimeSessionId", "command"]) ||
      !Number.isSafeInteger(value.runtimeSessionId) ||
      value.runtimeSessionId < 1 ||
      !boundedText(value.command, 20_000)
    ) {
      fail("The canonical Office command request is invalid.");
    }
    return value;
  }
  if (value.operation === "export") {
    if (
      !hasExactKeys(value, ["operation", "relativeFile", "title"]) ||
      !boundedText(value.relativeFile, 4 * 1024) ||
      !boundedText(value.title, 2 * 1024)
    ) fail("The canonical Office export request is invalid.");
    return value;
  }
  if (value.operation === "document-edit") {
    if (
      !hasExactKeys(value, [
        "operation",
        "action",
        "sourceRelativeFile",
        "output",
        "title",
      ]) ||
      !["inspect", "patch"].includes(value.action) ||
      !boundedText(value.sourceRelativeFile, 4 * 1024) ||
      (value.output !== null && !boundedText(value.output, 4 * 1024)) ||
      (value.title !== null && !boundedText(value.title, 2 * 1024)) ||
      (value.action === "inspect" && (value.output !== null || value.title !== null))
    ) fail("The canonical document edit request is invalid.");
    return value;
  }
  if (value.operation === "pdf-to-docx") {
    if (
      !hasExactKeys(value, [
        "operation",
        "sourceRelativeFile",
        "output",
        "title",
        "password",
      ]) ||
      !boundedText(value.sourceRelativeFile, 4 * 1024) ||
      (value.output !== null && !boundedText(value.output, 4 * 1024)) ||
      (value.title !== null && !boundedText(value.title, 2 * 1024)) ||
      (value.password !== null && !boundedText(value.password, 4 * 1024))
    ) fail("The canonical PDF conversion request is invalid.");
    return value;
  }
  if (value.operation === "spreadsheet") {
    if (
      !hasExactKeys(value, ["operation", "action", "title"]) ||
      !["inspect", "patch"].includes(value.action) ||
      (value.title !== null && !boundedText(value.title, 2 * 1024)) ||
      (value.action === "inspect" && value.title !== null)
    ) fail("The canonical spreadsheet request is invalid.");
    return value;
  }
  if (value.operation === "artifact-render") {
    if (
      !hasExactKeys(value, ["operation", "rendererId", "title", "filename", "metadata"]) ||
      !["docx", "pdf"].includes(value.rendererId) ||
      !boundedText(value.title, 2 * 1024) ||
      !boundedText(value.filename, 512) ||
      value.filename !== path.basename(value.filename) ||
      !isRecord(value.metadata) ||
      Buffer.byteLength(JSON.stringify(value.metadata), "utf8") > 64 * 1024
    ) fail("The canonical artifact render request is invalid.");
    return value;
  }
  if (value.operation === "markdown-pdf") {
    if (
      !hasExactKeys(value, ["operation", "filename", "documentCount"]) ||
      !boundedText(value.filename, 512) ||
      value.filename !== path.basename(value.filename) ||
      !value.filename.toLowerCase().endsWith(".pdf") ||
      !Number.isSafeInteger(value.documentCount) ||
      value.documentCount < 1 ||
      value.documentCount > 500
    ) fail("The canonical Markdown PDF request is invalid.");
    return value;
  }
  if (value.operation === "page-images") {
    if (
      !hasExactKeys(value, ["operation", "format", "maximumPages", "width"]) ||
      !["docx", "xlsx", "pptx"].includes(value.format) ||
      !Number.isSafeInteger(value.maximumPages) ||
      value.maximumPages < 1 ||
      value.maximumPages > 300 ||
      !Number.isSafeInteger(value.width) ||
      value.width < 320 ||
      value.width > 4096
    ) fail("The canonical Office page-image request is invalid.");
    return value;
  }
  if (value.operation === "skill-segment") {
    if (!hasExactKeys(value, ["operation"])) fail("The canonical document skill segmentation request is invalid.");
    return value;
  }
  if (value.operation === "skill-extract") {
    if (
      !hasExactKeys(value, ["operation", "extractionMode"]) ||
      !["text", "technical"].includes(value.extractionMode)
    ) fail("The canonical document skill extraction request is invalid.");
    return value;
  }
  if (value.operation === "skill-validate") {
    if (!hasExactKeys(value, ["operation"])) fail("The canonical document skill validation request is invalid.");
    return value;
  }
  fail("The canonical Office request operation is invalid.");
}

function expectedInputBlobCount(request) {
  if (request.operation === "command") return 0;
  if (
    (request.operation === "document-edit" || request.operation === "spreadsheet") &&
    request.action === "patch"
  ) return 2;
  return 1;
}

function validateInputBlob(value, identity) {
  const match = isRecord(value) && typeof value.relativePath === "string"
    ? /^runtime\/jobs\/([A-Za-z0-9_-]{1,128})\/inputs\/([A-Za-z0-9_-]{1,128})\/payload$/u.exec(value.relativePath)
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
    value.sizeBytes > MAX_INPUT_BYTES ||
    !SHA256.test(value.sha256) ||
    !boundedText(value.displayName, 512) ||
    value.displayName !== path.basename(value.displayName) ||
    /[\\/]/u.test(value.displayName) ||
    (value.mediaType !== null && !boundedText(value.mediaType, 256))
  ) {
    fail("The authoritative Office input blob is invalid.");
  }
  return value;
}

export function loadRuntimeV2OfficeLaunch(
  argv = process.argv.slice(2),
  launchDirectory = process.cwd(),
) {
  if (argv.length !== 1 || argv[0] !== START_MANIFEST_FILE) {
    fail("The Runtime V2 Office worker requires exactly the fixed start.json argument.");
  }
  const canonicalLaunchDirectory = fs.realpathSync.native(path.resolve(launchDirectory));
  const manifest = readBoundedJson(
    path.join(canonicalLaunchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The Office worker start manifest",
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
    fail("The Office worker start manifest is invalid.");
  }
  const identity = validateIdentity(manifest.identity);
  const executionScope = validateExecutionScope(manifest.executionScope);
  const expected = expectedWorkerPaths(identity);
  for (const field of ["inputManifestPath", "workspacePath", "checkpointPath", "resultPath"]) {
    if (manifest[field] !== expected[field]) {
      fail(`The Office worker ${field} is not fenced to its identity.`);
    }
  }
  let dataRoot = canonicalLaunchDirectory;
  for (let index = 0; index < expected.attemptRoot.split("/").length; index += 1) {
    dataRoot = path.dirname(dataRoot);
  }
  if (!samePath(canonicalLaunchDirectory, resolveDataPath(dataRoot, expected.attemptRoot))) {
    fail("The Office worker launch directory is not bound to its start identity.");
  }
  const workspacePath = resolveDataPath(dataRoot, manifest.workspacePath);
  const workspaceMetadata = fs.lstatSync(workspacePath);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("The Office worker private workspace is unavailable.");
  }
  const request = validateRequest(readBoundedJson(
    resolveDataPath(dataRoot, manifest.inputManifestPath),
    MAX_INPUT_MANIFEST_BYTES,
    "The canonical Office request",
  ));
  if (
    ["command", "export", "document-edit", "pdf-to-docx", "spreadsheet", "artifact-render"].includes(request.operation) &&
    executionScope.conversationId === null
  ) {
    fail("The Office artifact operation requires exact conversation authority.");
  }
  if (!Array.isArray(manifest.inputBlobs)) {
    fail("The Office worker input blob list is invalid.");
  }
  if (manifest.inputBlobs.length !== expectedInputBlobCount(request)) {
    fail("The Office worker received the wrong number of staged inputs.");
  }
  const inputBlobs = manifest.inputBlobs.map((blob) => validateInputBlob(blob, identity));
  if (new Set(inputBlobs.map((blob) => blob.blobId)).size !== inputBlobs.length) {
    fail("The Office worker received duplicate staged inputs.");
  }
  return {
    dataRoot,
    identity,
    executionScope,
    request,
    inputBlobs,
    inputBlob: inputBlobs[0] ?? null,
    workspacePath,
    resultPath: resolveDataPath(dataRoot, manifest.resultPath),
    resultRelativePath: manifest.resultPath,
  };
}

export function parseRuntimeV2OfficeStopRecord(line) {
  if (
    Buffer.byteLength(line, "utf8") < 2 ||
    Buffer.byteLength(line, "utf8") > MAX_STOP_RECORD_BYTES ||
    !line.endsWith("\n") ||
    line.slice(0, -1).includes("\n")
  ) {
    fail("The Office worker stop record is invalid.");
  }
  let value;
  try {
    value = JSON.parse(line.slice(0, -1));
  } catch {
    fail("The Office worker stop record is not valid JSON.");
  }
  if (!hasExactKeys(value, ["type", "force"]) || value.type !== "stop" || value.force !== false) {
    fail("The Office worker stop record is invalid.");
  }
  return value;
}

function startStopInput(onStop, onProtocolFault) {
  let buffered = "";
  let requested = false;
  let poisoned = false;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (poisoned) return;
    buffered += chunk;
    if (Buffer.byteLength(buffered, "utf8") > MAX_STOP_RECORD_BYTES) {
      poisoned = true;
      onProtocolFault(new Error("The Office worker stop record exceeded its bound."));
      return;
    }
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline + 1);
    const remainder = buffered.slice(newline + 1);
    buffered = "";
    try {
      parseRuntimeV2OfficeStopRecord(line);
      if (requested || remainder.length > 0) fail("The Office worker received more than one stop record.");
      requested = true;
      onStop();
    } catch (error) {
      poisoned = true;
      onProtocolFault(error);
    }
  });
  process.stdin.resume();
  return {
    requested: () => requested,
    close() {
      process.stdin.removeAllListeners("data");
      process.stdin.pause();
    },
  };
}

function sourceLayout() {
  const dashboardMarkerRoot = path.dirname(path.dirname(ENTRYPOINT_PATH));
  const appRoot = path.dirname(dashboardMarkerRoot);
  const developmentSourceRoot = path.join(dashboardMarkerRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(path.join(developmentSourceRoot, "lib", "office", "agent-query.ts"));
  const dashboardRoot = development ? dashboardMarkerRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relativePath of [
    path.join("lib", "office", "agent-query.ts"),
    path.join("lib", "office", "officecli.ts"),
  ]) {
    const source = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
      fail("The staged Office worker source closure is unavailable.");
    }
  }
  return { appRoot, dashboardRoot, development, sourceRoot };
}

function configureWorkerEnvironment(launch, layout) {
  const historicalDevelopmentData = layout.development && samePath(launch.dataRoot, layout.appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : launch.dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = layout.development ? layout.dashboardRoot : "";
  process.env.BREADBOARD_REPO_ROOT = layout.appRoot;
  // Runtime workers receive a deliberately minimal environment. Derive the
  // mutable Garden content root from the supervisor-sealed data root instead
  // of accepting a path through the request or inherited process state.
  process.env.QUARTZ_CONTENT_PATH = path.join(launch.dataRoot, "quartz", "content");
  process.env.BOOK_TO_SKILL_ROOT = path.join(layout.appRoot, "book-to-skill");
  process.env.NODE_ENV = layout.development ? "development" : "production";
  process.env.OFFICECLI_NO_AUTO_RESIDENT = "1";
  process.env.OFFICECLI_RESIDENT_FLUSH = "each";
  process.env.OFFICECLI_SKIP_UPDATE = "1";
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
  if (!target) fail("The authoritative Breadboard database is unavailable to the Office worker.");
  return fs.realpathSync.native(target);
}

function authenticatedSessionWorkspace(launch, layout) {
  const database = new DatabaseSync(databasePath(launch, layout), { readOnly: true });
  let row;
  try {
    row = database.prepare(`
      SELECT s.user_id AS userId, s.conversation_id AS conversationId,
             s.garden_id AS gardenId, s.active_directory AS activeDirectory,
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
    !Number.isSafeInteger(row.conversationId) ||
    row.conversationId < 1 ||
    !["dashboard_terminal", "garden_chat"].includes(row.surface) ||
    typeof row.activeDirectory !== "string" ||
    !path.isAbsolute(row.activeDirectory)
  ) {
    fail("The Office runtime session does not match the authenticated job scope.");
  }
  const metadata = fs.lstatSync(row.activeDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("The authenticated Office workspace is unavailable.");
  }
  return fs.realpathSync.native(row.activeDirectory);
}

function hashOpenFile(descriptor, sizeBytes) {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let offset = 0;
  while (offset < sizeBytes) {
    const count = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, sizeBytes - offset), offset);
    if (count < 1) fail("The canonical Office blob ended before its declared size.");
    hash.update(chunk.subarray(0, count));
    offset += count;
  }
  return hash.digest("hex");
}

function canonicalInputBlob(launch, index = 0) {
  const inputBlob = launch.inputBlobs[index];
  if (!inputBlob) fail("The requested canonical Office blob is unavailable.");
  const blobPath = resolveDataPath(launch.dataRoot, inputBlob.relativePath);
  const metadata = fs.lstatSync(blobPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== inputBlob.sizeBytes) {
    fail("The canonical Office blob is not a direct file of its sealed size.");
  }
  const realPath = fs.realpathSync.native(blobPath);
  if (!samePath(realPath, blobPath)) fail("The canonical Office blob contains an indirect path.");
  const descriptor = fs.openSync(realPath, "r");
  try {
    const opened = fs.fstatSync(descriptor);
    if (hashOpenFile(descriptor, opened.size) !== inputBlob.sha256) {
      fail("The canonical Office blob digest does not match its sealed metadata.");
    }
    const checked = fs.fstatSync(descriptor);
    if (checked.size !== opened.size || checked.mtimeMs !== opened.mtimeMs) {
      fail("The canonical Office blob changed while it was verified.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return realPath;
}

function fsyncFile(filePath) {
  const descriptor = fs.openSync(filePath, process.platform === "win32" ? "r+" : "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== "win32" || !isRecord(error) || !["EACCES", "EINVAL", "EPERM"].includes(String(error.code))) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeResultOnce(filePath, bytes) {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES || fs.existsSync(filePath)) {
    fail("The durable Office result path or size is invalid.");
  }
  const temporary = `${filePath}.pending.${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fsyncFile(filePath);
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function relativeDataPath(dataRoot, filePath) {
  const relative = path.relative(dataRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("The Office worker output is outside the Runtime data root.");
  }
  return relative.split(path.sep).join("/");
}

async function runCommand(launch, modules, signal) {
  const workspace = authenticatedSessionWorkspace(launch, modules.layout);
  return modules.agentQuery.runOfficeCommand(
    workspace,
    { command: launch.request.command },
    { signal },
  );
}

async function runExport(launch, modules, signal) {
  const sourcePath = canonicalInputBlob(launch);
  const pending = path.join(launch.workspacePath, `.office-stage.pending-${process.pid}`);
  const published = path.join(launch.workspacePath, "office-stage");
  if (fs.existsSync(pending) || fs.existsSync(published)) {
    fail("The fenced Office staging directory already exists.");
  }
  fs.mkdirSync(pending);
  try {
    const documentPath = path.join(pending, launch.inputBlob.displayName);
    fs.copyFileSync(sourcePath, documentPath, fs.constants.COPYFILE_EXCL);
    fsyncFile(documentPath);
    if (signal.aborted) throw signal.reason ?? new Error("Office export was canceled.");
    const staged = await modules.agentQuery.prepareOfficeExport(
      pending,
      { file: launch.inputBlob.displayName, title: launch.request.title },
      { signal },
    );
    let previewPath = null;
    if (staged.previewFilePath) {
      previewPath = path.join(pending, "preview.html");
      fs.renameSync(staged.previewFilePath, previewPath);
      fsyncFile(previewPath);
      staged.cleanup();
    }
    if (signal.aborted) throw signal.reason ?? new Error("Office export was canceled.");
    fsyncDirectory(pending);
    fs.renameSync(pending, published);
    fsyncDirectory(launch.workspacePath);
    const outputPath = path.join(published, launch.inputBlob.displayName);
    const publishedPreview = previewPath ? path.join(published, "preview.html") : null;
    return {
      operation: "export",
      relativeFile: launch.request.relativeFile,
      kind: staged.kind,
      title: staged.title,
      filename: staged.filename,
      outputRelativePath: relativeDataPath(launch.dataRoot, outputPath),
      previewRelativePath: publishedPreview
        ? relativeDataPath(launch.dataRoot, publishedPreview)
        : null,
    };
  } catch (error) {
    fs.rmSync(pending, { recursive: true, force: true });
    throw error;
  }
}

function createStage(launch) {
  const pending = path.join(launch.workspacePath, `.office-stage.pending-${process.pid}`);
  const published = path.join(launch.workspacePath, "office-stage");
  if (fs.existsSync(pending) || fs.existsSync(published)) {
    fail("The fenced Office staging directory already exists.");
  }
  fs.mkdirSync(pending);
  return { pending, published };
}

function publishStage(launch, stage) {
  fsyncDirectory(stage.pending);
  fs.renameSync(stage.pending, stage.published);
  fsyncDirectory(launch.workspacePath);
}

function directStageFile(root, filePath, label, maximumBytes = MAX_INPUT_BYTES) {
  if (!pathWithin(root, filePath)) fail(`${label} escaped the private Office stage.`);
  const metadata = fs.lstatSync(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) fail(`${label} is not a bounded direct file.`);
  const canonical = fs.realpathSync.native(filePath);
  if (!samePath(canonical, filePath)) fail(`${label} is indirect.`);
  return canonical;
}

function writeStageJson(stage, filename, value, maximumBytes = 16 * 1024 * 1024) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    fail("The staged Office operation result exceeds its bound.");
  }
  const target = path.join(stage.pending, filename);
  fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  fsyncFile(target);
  return target;
}

function readPatchInput(launch, maximumPatches) {
  const blob = launch.inputBlobs[1];
  if (!blob || blob.displayName !== "patches.json") {
    fail("The sealed Office patch set is unavailable.");
  }
  const value = readBoundedJson(canonicalInputBlob(launch, 1), 16 * 1024 * 1024, "The sealed Office patch set");
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumPatches) {
    fail("The sealed Office patch set is invalid.");
  }
  return value.map((patch) => {
    if (
      !hasExactKeys(patch, ["anchor", "text"]) ||
      !boundedText(patch.anchor, 4 * 1024) ||
      typeof patch.text !== "string" ||
      Buffer.byteLength(patch.text, "utf8") > 100 * 1024 ||
      /\u0000/u.test(patch.text)
    ) fail("The sealed Office patch set contains an invalid edit.");
    return { anchor: patch.anchor, text: patch.text };
  });
}

function copyCanonicalInput(launch, stage) {
  const sourcePath = canonicalInputBlob(launch);
  const target = path.join(stage.pending, launch.inputBlob.displayName);
  fs.copyFileSync(sourcePath, target, fs.constants.COPYFILE_EXCL);
  fsyncFile(target);
  return target;
}

async function stageOfficePreview(modules, stage, outputPath, title, signal) {
  const relativeOutput = path.relative(stage.pending, outputPath);
  if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
    fail("The generated Office file escaped its private stage.");
  }
  const staged = await modules.agentQuery.prepareOfficeExport(
    stage.pending,
    { file: relativeOutput, title },
    { signal },
  );
  if (!staged.previewFilePath) return null;
  const preview = path.join(stage.pending, "preview.html");
  fs.renameSync(staged.previewFilePath, preview);
  fsyncFile(preview);
  staged.cleanup();
  return preview;
}

function publishedPath(stage, pendingPath) {
  const relative = path.relative(stage.pending, pendingPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("The Office stage returned an invalid output path.");
  }
  return path.join(stage.published, relative);
}

async function runDocumentEdit(launch, modules, signal) {
  const stage = createStage(launch);
  try {
    const source = copyCanonicalInput(launch, stage);
    const patches = launch.request.action === "patch" ? readPatchInput(launch, 200) : [];
    const result = await modules.genofficeAgentQuery.editDocument(stage.pending, {
      file: path.basename(source),
      ...(launch.request.output === null ? {} : { output: launch.request.output }),
      ...(launch.request.title === null ? {} : { title: launch.request.title }),
      ...(patches.length > 0 ? { patches } : {}),
    });
    if (launch.request.action === "inspect") {
      if (result.operation !== "inspect") fail("The document inspector returned an invalid operation.");
      const dataPath = writeStageJson(stage, "operation.json", {
        ...result,
        file: launch.request.sourceRelativeFile,
      });
      publishStage(launch, stage);
      return {
        operation: "document-edit",
        action: "inspect",
        dataRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, dataPath)),
      };
    }
    if (result.operation !== "patch") fail("The document editor returned an invalid operation.");
    const output = directStageFile(stage.pending, result.outputPath, "The edited Office document");
    const preview = await stageOfficePreview(modules, stage, output, result.title, signal);
    if (signal.aborted) throw signal.reason ?? new Error("Document editing was canceled.");
    const outputWorkspaceRelativePath = path.relative(stage.pending, output).split(path.sep).join("/");
    publishStage(launch, stage);
    return {
      operation: "document-edit",
      action: "patch",
      file: launch.request.sourceRelativeFile,
      outputWorkspaceRelativePath,
      title: result.title,
      filename: result.filename,
      kind: result.kind,
      patched: result.patched,
      outputRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, output)),
      previewRelativePath: preview
        ? relativeDataPath(launch.dataRoot, publishedPath(stage, preview))
        : null,
    };
  } catch (error) {
    fs.rmSync(stage.pending, { recursive: true, force: true });
    throw error;
  }
}

async function runPdfToDocx(launch, modules, signal) {
  const stage = createStage(launch);
  try {
    const source = copyCanonicalInput(launch, stage);
    const result = await modules.pdfQuery.convertPdfDocument(stage.pending, {
      file: path.basename(source),
      ...(launch.request.output === null ? {} : { output: launch.request.output }),
      ...(launch.request.title === null ? {} : { title: launch.request.title }),
      ...(launch.request.password === null ? {} : { password: launch.request.password }),
    });
    const output = directStageFile(stage.pending, result.outputPath, "The converted Word document");
    const preview = await stageOfficePreview(modules, stage, output, result.title, signal);
    if (signal.aborted) throw signal.reason ?? new Error("PDF conversion was canceled.");
    const outputWorkspaceRelativePath = path.relative(stage.pending, output).split(path.sep).join("/");
    publishStage(launch, stage);
    return {
      operation: "pdf-to-docx",
      file: launch.request.sourceRelativeFile,
      outputWorkspaceRelativePath,
      title: result.title,
      filename: result.filename,
      kind: result.kind,
      pages: result.pages,
      warnings: result.warnings,
      scannedDocument: result.scannedDocument,
      pageResults: result.pageResults,
      outputRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, output)),
      previewRelativePath: preview
        ? relativeDataPath(launch.dataRoot, publishedPath(stage, preview))
        : null,
    };
  } catch (error) {
    fs.rmSync(stage.pending, { recursive: true, force: true });
    throw error;
  }
}

function parseOfficeJson(output, operation) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail(`${operation} returned invalid JSON.`);
  }
  if (!isRecord(parsed) || parsed.success !== true || !Object.hasOwn(parsed, "data")) {
    fail(isRecord(parsed?.error) && typeof parsed.error.error === "string"
      ? parsed.error.error
      : `${operation} failed.`);
  }
  return parsed.data;
}

function spreadsheetBlocks(data) {
  const blocks = [];
  let total = 0;
  for (const sheet of Array.isArray(data?.sheets) ? data.sheets : []) {
    const sheetName = typeof sheet?.name === "string" ? sheet.name : "Sheet";
    for (const row of Array.isArray(sheet?.rows) ? sheet.rows : []) {
      const cells = isRecord(row?.cells) ? row.cells : {};
      for (const [cell, value] of Object.entries(cells)) {
        total += 1;
        if (blocks.length >= 2_000) continue;
        blocks.push({
          anchor: `/${sheetName}/${cell}`,
          kind: "cell",
          text: value === null || value === undefined ? "" : String(value),
          editable: true,
          sheet: sheetName,
          cell,
        });
      }
    }
  }
  return { blocks, truncated: total > blocks.length };
}

async function inspectSpreadsheetSource(modules, source, stage, signal) {
  const result = await modules.officeCli.runOfficeCli(
    ["view", source, "text", "--max-lines", "1000", "--json"],
    {
      cwd: stage.pending,
      timeoutMs: 60_000,
      env: { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: "1" },
      signal,
    },
  );
  if (signal.aborted) throw signal.reason ?? new Error("Spreadsheet inspection was canceled.");
  if (result.code !== 0 || result.timedOut || result.truncated) {
    fail(result.stderr.trim() || "The spreadsheet could not be opened for editing.");
  }
  return spreadsheetBlocks(parseOfficeJson(result.stdout, "Spreadsheet inspection"));
}

async function runSpreadsheet(launch, modules, signal) {
  const stage = createStage(launch);
  try {
    const source = copyCanonicalInput(launch, stage);
    const inspected = await inspectSpreadsheetSource(modules, source, stage, signal);
    if (launch.request.action === "inspect") {
      const dataPath = writeStageJson(stage, "operation.json", inspected);
      publishStage(launch, stage);
      return {
        operation: "spreadsheet",
        action: "inspect",
        dataRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, dataPath)),
      };
    }
    const patches = readPatchInput(launch, 2_000);
    const allowed = new Set(inspected.blocks.map((block) => block.anchor));
    if (patches.some((patch) => !allowed.has(patch.anchor))) {
      fail("A spreadsheet cell is outside the editable range.");
    }
    const commands = patches.map((patch) => ({
      command: "set",
      path: patch.anchor,
      props: { value: patch.text },
    }));
    const result = await modules.officeCli.runOfficeCli(
      ["batch", source, "--commands", JSON.stringify(commands), "--json"],
      {
        cwd: stage.pending,
        timeoutMs: 90_000,
        env: { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: "1" },
        signal,
      },
    );
    if (signal.aborted) throw signal.reason ?? new Error("Spreadsheet editing was canceled.");
    if (result.code !== 0 || result.timedOut) {
      fail(result.stderr.trim() || result.stdout.trim() || "The spreadsheet edits could not be saved.");
    }
    parseOfficeJson(result.stdout, "Spreadsheet editing");
    directStageFile(stage.pending, source, "The edited spreadsheet");
    const preview = await stageOfficePreview(
      modules,
      stage,
      source,
      launch.request.title ?? path.basename(source, path.extname(source)),
      signal,
    );
    if (signal.aborted) throw signal.reason ?? new Error("Spreadsheet editing was canceled.");
    publishStage(launch, stage);
    return {
      operation: "spreadsheet",
      action: "patch",
      outputWorkspaceRelativePath: launch.inputBlob.displayName,
      outputRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, source)),
      previewRelativePath: preview
        ? relativeDataPath(launch.dataRoot, publishedPath(stage, preview))
        : null,
    };
  } catch (error) {
    fs.rmSync(stage.pending, { recursive: true, force: true });
    throw error;
  }
}

async function runArtifactRender(launch, modules, signal) {
  const stage = createStage(launch);
  try {
    const source = canonicalInputBlob(launch);
    const bytes = fs.readFileSync(source);
    if (bytes.includes(0)) fail("The artifact source is not UTF-8 text.");
    const content = bytes.toString("utf8");
    const renderer = modules.artifactRenderers.artifactRenderer(launch.request.rendererId);
    if (!renderer) fail("The requested artifact renderer is unavailable.");
    const validation = await renderer.validate(content);
    if (!validation.ok) fail(validation.error);
    if (signal.aborted) throw signal.reason ?? new Error("Artifact rendering was canceled.");
    const parsed = modules.frontmatter.parseMarkdownFrontmatter(content);
    const fallbackTitle = launch.request.filename
      .replace(/\.[a-z0-9]+$/iu, "")
      .replace(/[-_]+/gu, " ")
      .trim()
      .replace(/\b\w/gu, (character) => character.toUpperCase()) || "Document";
    const title = launch.request.title.trim() || parsed.title || fallbackTitle;
    const theme = modules.theme.themeFromMetadata(launch.request.metadata);
    const outputPath = path.join(stage.pending, launch.request.filename);
    let previewPath;
    let mimeType;
    if (launch.request.rendererId === "docx") {
      fs.writeFileSync(outputPath, modules.markdownDocx.renderMarkdownToDocx(parsed.body, { theme }), {
        flag: "wx",
        mode: 0o600,
      });
      previewPath = path.join(stage.pending, "preview.html");
      fs.writeFileSync(previewPath, modules.markdownDocx.markdownToDocxPreviewHtml(parsed.body, { theme }), {
        flag: "wx",
        mode: 0o600,
      });
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else {
      const pdf = await modules.markdownPdf.renderMarkdownToPdf(
        [{ content: parsed.body, title }],
        { title, theme },
      );
      fs.writeFileSync(outputPath, pdf, { flag: "wx", mode: 0o600 });
      previewPath = outputPath;
      mimeType = "application/pdf";
    }
    fsyncFile(outputPath);
    if (!samePath(previewPath, outputPath)) fsyncFile(previewPath);
    const output = directStageFile(stage.pending, outputPath, "The rendered artifact");
    const preview = directStageFile(stage.pending, previewPath, "The artifact preview", 32 * 1024 * 1024);
    if (signal.aborted) throw signal.reason ?? new Error("Artifact rendering was canceled.");
    publishStage(launch, stage);
    return {
      operation: "artifact-render",
      rendererId: launch.request.rendererId,
      mimeType,
      outputRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, output)),
      previewRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, preview)),
    };
  } catch (error) {
    fs.rmSync(stage.pending, { recursive: true, force: true });
    throw error;
  }
}

async function runMarkdownPdf(launch, modules, signal) {
  const bundle = readBoundedJson(
    canonicalInputBlob(launch),
    MAX_INPUT_BYTES,
    "The sealed Markdown PDF document bundle",
  );
  if (
    !hasExactKeys(bundle, ["protocolVersion", "title", "documents"]) ||
    bundle.protocolVersion !== PROTOCOL_VERSION ||
    typeof bundle.title !== "string" ||
    !bundle.title.trim() ||
    !Array.isArray(bundle.documents) ||
    bundle.documents.length !== launch.request.documentCount ||
    bundle.documents.some((document) =>
      !hasExactKeys(document, ["content", "title"]) ||
      typeof document.content !== "string" ||
      typeof document.title !== "string" ||
      !document.title.trim()) ||
    bundle.documents.reduce((total, document) => total + document.content.length, 0) > 10_000_000
  ) fail("The sealed Markdown PDF document bundle is invalid.");
  if (signal.aborted) throw signal.reason ?? new Error("Markdown PDF rendering was canceled.");
  const stage = createStage(launch);
  try {
    const outputPath = path.join(stage.pending, launch.request.filename);
    const pdf = await modules.markdownPdf.renderMarkdownToPdf(
      bundle.documents,
      {
        title: bundle.title,
        clusterSlug: launch.executionScope.gardenId ?? undefined,
      },
    );
    fs.writeFileSync(outputPath, pdf, { flag: "wx", mode: 0o600 });
    fsyncFile(outputPath);
    const output = directStageFile(stage.pending, outputPath, "The Markdown PDF output");
    if (signal.aborted) throw signal.reason ?? new Error("Markdown PDF rendering was canceled.");
    publishStage(launch, stage);
    return {
      operation: "markdown-pdf",
      mimeType: "application/pdf",
      outputRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, output)),
    };
  } catch (error) {
    fs.rmSync(stage.pending, { recursive: true, force: true });
    throw error;
  }
}

function pageNumberFromName(name) {
  const match = /(\d+)(?=\.[a-z]+$)/iu.exec(name);
  return match ? Number.parseInt(match[1], 10) : 1;
}

async function runPageImages(launch, modules, signal) {
  if (modules.officeCli.resolveOfficeCli() === null) {
    return {
      operation: "page-images",
      pages: [],
      unsupported: "OfficeCLI is not installed (npm run setup:officecli)",
    };
  }
  const stage = createStage(launch);
  try {
    const source = copyCanonicalInput(launch, stage);
    const target = path.join(stage.pending, "page.png");
    const rendered = await modules.officeCli.runOfficeCli(
      [
        "view",
        source,
        "screenshot",
        "--page",
        `1-${launch.request.maximumPages}`,
        "--screenshot-width",
        String(launch.request.width),
        "-o",
        target,
      ],
      {
        cwd: stage.pending,
        timeoutMs: 10 * 60_000,
        env: { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: "1" },
        signal,
      },
    );
    if (signal.aborted) throw signal.reason ?? new Error("Office page rendering was canceled.");
    const written = fs.readdirSync(stage.pending).filter((name) => /\.(png|jpe?g)$/iu.test(name));
    if (written.length === 0) {
      fs.rmSync(stage.pending, { recursive: true, force: true });
      const detail = (rendered.stderr || rendered.stdout || "").trim().slice(0, 300);
      return {
        operation: "page-images",
        pages: [],
        unsupported: `OfficeCLI rendered no pages for this ${launch.request.format}${detail ? `: ${detail}` : ""}`,
      };
    }
    const pages = written
      .map((name) => {
        const file = directStageFile(stage.pending, path.join(stage.pending, name), "An Office page image", 32 * 1024 * 1024);
        return { pageNumber: pageNumberFromName(name), file };
      })
      .sort((left, right) => left.pageNumber - right.pageNumber)
      .slice(0, launch.request.maximumPages);
    publishStage(launch, stage);
    return {
      operation: "page-images",
      pages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        relativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, page.file)),
      })),
      unsupported: "",
    };
  } catch (error) {
    fs.rmSync(stage.pending, { recursive: true, force: true });
    throw error;
  }
}

async function runSkillOperation(launch, modules, signal) {
  if (signal.aborted) throw signal.reason ?? new Error("Document skill processing was canceled.");
  let value;
  if (launch.request.operation === "skill-segment") {
    const text = fs.readFileSync(canonicalInputBlob(launch), "utf8");
    value = await modules.skillBridge.segmentDocumentInWorker(text, { signal });
  } else if (launch.request.operation === "skill-extract") {
    value = await modules.skillBridge.extractWithCloneInWorker(
      canonicalInputBlob(launch),
      launch.request.extractionMode,
      { signal },
    );
  } else {
    value = await modules.skillValidate.validateGeneratedSkillFileInWorker(
      canonicalInputBlob(launch),
      { signal },
    );
  }
  if (signal.aborted) throw signal.reason ?? new Error("Document skill processing was canceled.");
  const stage = createStage(launch);
  try {
    const dataPath = writeStageJson(stage, "operation.json", { value }, 128 * 1024 * 1024);
    publishStage(launch, stage);
    return {
      operation: launch.request.operation,
      dataRelativePath: relativeDataPath(launch.dataRoot, publishedPath(stage, dataPath)),
    };
  } catch (error) {
    fs.rmSync(stage.pending, { recursive: true, force: true });
    throw error;
  }
}

async function loadOperationModules(launch, layout) {
  const importSource = (relativePath) => import(pathToFileURL(path.join(layout.sourceRoot, ...relativePath)).href);
  const modules = { layout };
  if (["command", "export", "document-edit", "pdf-to-docx", "spreadsheet"].includes(launch.request.operation)) {
    modules.agentQuery = await importSource(["lib", "office", "agent-query.ts"]);
  }
  if (launch.request.operation === "document-edit") {
    modules.genofficeAgentQuery = await importSource(["lib", "genoffice", "agent-query.ts"]);
  } else if (launch.request.operation === "pdf-to-docx") {
    modules.pdfQuery = await importSource(["lib", "genoffice", "pdf-query.ts"]);
  } else if (["spreadsheet", "page-images"].includes(launch.request.operation)) {
    modules.officeCli = await importSource(["lib", "office", "officecli.ts"]);
  } else if (launch.request.operation === "artifact-render") {
    modules.artifactRenderers = await importSource(["lib", "hermes", "artifact-renderers.ts"]);
    modules.frontmatter = await importSource(["lib", "markdown-render", "frontmatter.ts"]);
    modules.theme = await importSource(["lib", "markdown-render", "theme.ts"]);
    modules.markdownDocx = await importSource(["lib", "markdown-render", "docx.ts"]);
    modules.markdownPdf = await importSource(["lib", "markdown-render", "pdf.ts"]);
  } else if (launch.request.operation === "markdown-pdf") {
    modules.markdownPdf = await importSource(["lib", "markdown-render", "pdf.ts"]);
  } else if (["skill-segment", "skill-extract"].includes(launch.request.operation)) {
    modules.skillBridge = await importSource(["lib", "document-skills", "bridge.ts"]);
  } else if (launch.request.operation === "skill-validate") {
    modules.skillValidate = await importSource(["lib", "document-skills", "validate-worker.ts"]);
  }
  return modules;
}

async function runOperation(launch, modules, signal) {
  switch (launch.request.operation) {
    case "command":
      return { operation: "command", ...await runCommand(launch, modules, signal) };
    case "export":
      return runExport(launch, modules, signal);
    case "document-edit":
      return runDocumentEdit(launch, modules, signal);
    case "pdf-to-docx":
      return runPdfToDocx(launch, modules, signal);
    case "spreadsheet":
      return runSpreadsheet(launch, modules, signal);
    case "artifact-render":
      return runArtifactRender(launch, modules, signal);
    case "markdown-pdf":
      return runMarkdownPdf(launch, modules, signal);
    case "page-images":
      return runPageImages(launch, modules, signal);
    case "skill-segment":
    case "skill-extract":
    case "skill-validate":
      return runSkillOperation(launch, modules, signal);
    default:
      fail("The Office worker operation is unavailable.");
  }
}

/**
 * Execute an already supervisor-validated Office launch. The exported seam is
 * used by protocol-faithful tests with sealed inputs; product requests still
 * enter only through loadRuntimeV2OfficeLaunch and the fixed worker process.
 */
export async function executeRuntimeV2OfficeOperation(
  launch,
  signal,
  dependencies = {},
) {
  const layout = (dependencies.sourceLayout ?? sourceLayout)();
  (dependencies.configureEnvironment ?? configureWorkerEnvironment)(launch, layout);
  const modules = dependencies.modules ?? await loadOperationModules(launch, layout);
  return runOperation(launch, modules, signal);
}

function serializeResult(identity, completionSequence, result) {
  return Buffer.from(`${JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    identity,
    completionSequence,
    result,
  })}\n`, "utf8");
}

function redirectApplicationStdout() {
  const diagnosticWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) => diagnosticWrite(chunk, encoding, callback);
}

function boundedFailureMessage(error) {
  const raw = isRecord(error) && typeof error.message === "string" ? error.message : String(error);
  const bytes = Buffer.from(raw || SANITIZED_FAILURE, "utf8");
  return bytes.byteLength <= MAX_FAILURE_MESSAGE_BYTES
    ? bytes.toString("utf8")
    : bytes.subarray(0, MAX_FAILURE_MESSAGE_BYTES).toString("utf8").replace(/\uFFFD+$/u, "");
}

async function runRuntimeV2OfficeWorker() {
  redirectApplicationStdout();
  const launch = loadRuntimeV2OfficeLaunch();
  const events = createRuntimeV2WorkerEventWriter(launch.identity, {
    heartbeatStage: "office-processing",
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
  const abortController = new AbortController();
  let protocolFault = null;
  let heartbeat = null;
  let completed = false;
  const stop = startStopInput(
    () => {
      events.cancellationAcknowledged();
      abortController.abort(new Error("Office processing was canceled."));
    },
    (error) => {
      protocolFault = error;
      abortController.abort(error);
      console.error("[runtime-v2-office-worker] Invalid supervisor input:", error);
    },
  );
  events.ready();
  try {
    heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    await new Promise((resolve) => setImmediate(resolve));
    if (stop.requested()) return;
    events.progress("preparing", 1, 3);
    const result = await executeRuntimeV2OfficeOperation(
      launch,
      abortController.signal,
    );
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;
    events.progress("persisting", 2, 3);
    if (typeof result.outputRelativePath === "string") {
      events.artifact("document", result.outputRelativePath);
    }
    if (result.operation === "page-images") {
      for (const page of result.pages) events.artifact("page", page.relativePath);
    }
    await heartbeat.stop();
    if (stop.requested()) return;
    if (protocolFault) throw protocolFault;
    events.progress("finalizing", 3, 3);
    const completionSequence = events.nextSequence();
    writeResultOnce(
      launch.resultPath,
      serializeResult(launch.identity, completionSequence, result),
    );
    events.complete(launch.resultRelativePath);
    completed = true;
  } catch (error) {
    if (stop.requested()) return;
    events.failed("OFFICE_PROCESSING_FAILED", SANITIZED_FAILURE);
    process.exitCode = 1;
    console.error("[runtime-v2-office-worker] Office processing failed:", error);
  } finally {
    try {
      await heartbeat?.stop();
    } catch (error) {
      process.exitCode = 1;
      console.error("[runtime-v2-office-worker] Heartbeat shutdown failed:", error);
    }
    if (!completed && launch.request.operation !== "command") {
      for (const transient of [
        path.join(launch.workspacePath, `.office-stage.pending-${process.pid}`),
        path.join(launch.workspacePath, "office-stage"),
      ]) {
        try {
          fs.rmSync(transient, {
            recursive: true,
            force: true,
            maxRetries: process.platform === "win32" ? 10 : 0,
            retryDelay: 100,
          });
        } catch (error) {
          process.exitCode = 1;
          console.error("[runtime-v2-office-worker] Transient stage cleanup failed:", error);
        }
      }
    }
    stop.close();
  }
}

const invokedAsEntrypoint = process.argv.length === 3 &&
  process.argv[2] === START_MANIFEST_FILE &&
  typeof process.argv[1] === "string" &&
  samePath(process.argv[1], ENTRYPOINT_PATH);
if (invokedAsEntrypoint) {
  void runRuntimeV2OfficeWorker().catch((error) => {
    process.exitCode = 1;
    fs.writeSync(2, `[runtime-v2-office-worker] Startup failed: ${boundedFailureMessage(error)}\n`, undefined, "utf8");
  });
}
