import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 8 * 1_024;
const MAX_VERSION_BYTES = 120;

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

function boundedText(value, maximumBytes) {
  return typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
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

function directDirectory(candidate, root, message) {
  const resolved = path.resolve(candidate);
  if (!pathWithin(root, resolved)) fail(message);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isDirectory() || metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(message);
  return resolved;
}

function directFile(candidate, root, message) {
  const resolved = path.resolve(candidate);
  if (!pathWithin(root, resolved)) fail(message);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(message);
  return resolved;
}

export function validateRuntimeV2CodexProbeRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "status"
  ) fail("The canonical Codex probe request is invalid.");
  return value;
}

export function validateRuntimeV2CodexProbeScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) fail("The Codex probe requires authenticated user-global scope.");
  return value;
}

export function validateRuntimeV2CodexProbeEnvironment(environment) {
  if (
    !boundedText(environment.CODEX_BIN, MAX_PATH_BYTES) ||
    !environment.CODEX_BIN.trim() ||
    !path.isAbsolute(environment.CODEX_BIN)
  ) fail("The sealed Codex executable path is unavailable.");
}

export function codexProbeApplicationLayout(launch) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "codex", "run-manager.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  directFile(
    path.join(sourceRoot, "lib", "codex", "run-manager.ts"),
    sourceRoot,
    "The staged Codex probe source is unavailable.",
  );
  directFile(
    path.join(sourceRoot, "lib", "runtime-paths.ts"),
    sourceRoot,
    "The staged Codex Runtime path authority is unavailable.",
  );
  const dataRoot = directDirectory(
    launch.dataRoot,
    launch.dataRoot,
    "The Codex Runtime data root is indirect.",
  );
  const workspace = directDirectory(
    launch.workspacePath,
    dataRoot,
    "The private Codex probe workspace is indirect.",
  );
  const privateRoot = path.join(workspace, "codex-probe-process");
  const home = path.join(privateRoot, "home");
  const temporary = path.join(privateRoot, "tmp");
  const codexHome = path.join(privateRoot, "codex-home");
  for (const directory of [home, temporary, codexHome]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    directDirectory(directory, workspace, "The private Codex probe directory is indirect.");
  }
  const historicalDevelopmentData = development && samePath(dataRoot, appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.NODE_ENV = development ? "development" : "production";
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CODEX_HOME = codexHome;
  process.env.TMP = temporary;
  process.env.TEMP = temporary;
  process.env.TMPDIR = temporary;
  for (const name of [
    "CHATMOCK_API_KEY",
    "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
    "BREADBOARD_HERMES_SESSION_TOKEN",
    "BREADBOARD_HERMES_TOOL_SECRET",
    "BREADBOARD_GRAFT_CLI",
    "BREADBOARD_GRAFT_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
  ]) delete process.env[name];
  process.chdir(dashboardRoot);
  return { sourceRoot };
}

function canonicalStatus(value) {
  if (!isRecord(value) || typeof value.available !== "boolean" || typeof value.installed !== "boolean") {
    fail("The Codex probe produced invalid availability metadata.");
  }
  const version = value.version === undefined ? null : value.version;
  const reason = value.reason === undefined ? null : value.reason;
  if (
    !(version === null || boundedText(version, MAX_VERSION_BYTES)) ||
    !(reason === null || boundedText(reason, MAX_REASON_BYTES)) ||
    (value.available && (!value.installed || !version || reason !== null)) ||
    (!value.available && (version !== null || !reason))
  ) fail("The Codex probe produced inconsistent availability metadata.");
  return { available: value.available, installed: value.installed, version, reason };
}

export async function executeRuntimeV2CodexProbe(
  launch,
  signal,
  progress,
  dependencies = {},
) {
  validateRuntimeV2CodexProbeRequest(launch.request);
  validateRuntimeV2CodexProbeScope(launch.executionScope);
  validateRuntimeV2CodexProbeEnvironment(process.env);
  progress.checkpoint({ stage: "preparing", percent: 10 });
  const layout = (dependencies.applicationLayout ?? codexProbeApplicationLayout)(launch);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const loadAvailability = dependencies.loadAvailability ?? (async () => {
    const manager = await import(pathToFileURL(
      path.join(layout.sourceRoot, "lib", "codex", "run-manager.ts"),
    ).href);
    if (typeof manager.runtimeAvailability !== "function") {
      fail("The staged Codex probe entrypoint is unavailable.");
    }
    return manager.runtimeAvailability(process.env);
  });
  progress.checkpoint({ stage: "probing", percent: 35 });
  const status = canonicalStatus(await loadAvailability(layout, signal));
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  progress.checkpoint({ stage: "complete", percent: 100 });
  return status;
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-codex-probe-worker",
    validateRequest: validateRuntimeV2CodexProbeRequest,
    validateExecutionScope: validateRuntimeV2CodexProbeScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2CodexProbe,
  });
}
