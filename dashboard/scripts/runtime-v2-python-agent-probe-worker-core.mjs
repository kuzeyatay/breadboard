import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 32 * 1_024;
const MAX_LABEL_BYTES = 256;

const DEFINITIONS = Object.freeze({
  legal: Object.freeze({
    rootEnvironment: "HARVEY_LABS_ROOT",
    rootDirectory: "harvey-labs",
    pythonEnvironment: null,
    serviceId: "legal",
    markers: Object.freeze([
      "harness/agent_loop.py",
      "harness/tools.py",
      "harness/system_prompt.md",
      "sandbox/sandbox.py",
    ]),
  }),
  shorts: Object.freeze({
    rootEnvironment: "SHORTS_ROOT",
    rootDirectory: "AI-Youtube-Shorts-Generator",
    pythonEnvironment: "SHORTS_PYTHON",
    serviceId: "shorts",
    markers: Object.freeze([
      "shorts_generator/pipeline.py",
      "shorts_generator/local/clipper.py",
      "main.py",
    ]),
  }),
  tradingagents: Object.freeze({
    rootEnvironment: "TRADINGAGENTS_ROOT",
    rootDirectory: "tradingagents",
    pythonEnvironment: null,
    serviceId: "tradingagents",
    markers: Object.freeze([
      "tradingagents/graph/trading_graph.py",
      "tradingagents/default_config.py",
      "pyproject.toml",
    ]),
  }),
});

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
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(message);
  return resolved;
}

function directFile(candidate, root, message) {
  const resolved = path.resolve(candidate);
  if (!pathWithin(root, resolved)) fail(message);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(message);
  return resolved;
}

function definition(adapterId) {
  const value = DEFINITIONS[adapterId];
  if (!value) fail("The Python agent probe adapter is unavailable.");
  return value;
}

export function validateRuntimeV2PythonAgentProbeRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "health"
  ) fail("The canonical Python agent probe request is invalid.");
  return value;
}

export function validateRuntimeV2PythonAgentProbeScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) fail("The Python agent probe requires authenticated user-global scope.");
  return value;
}

export function validateRuntimeV2PythonAgentProbeEnvironment(adapterId, environment) {
  const adapter = definition(adapterId);
  const root = environment[adapter.rootEnvironment];
  if (!boundedText(root, MAX_PATH_BYTES) || !root.trim() || !path.isAbsolute(root)) {
    fail("The sealed Python agent source root is unavailable.");
  }
  if (adapter.pythonEnvironment) {
    const python = environment[adapter.pythonEnvironment];
    if (!boundedText(python, MAX_PATH_BYTES) || !python.trim() || !path.isAbsolute(python)) {
      fail("The sealed Python agent interpreter path is unavailable.");
    }
  }
}

function validateOptionalDirectRoot(root, appRoot, markers) {
  if (!fs.existsSync(root)) return;
  const canonical = directDirectory(root, appRoot, "The staged Python agent source is indirect.");
  for (const relative of markers) {
    const candidate = path.join(canonical, ...relative.split("/"));
    if (!fs.existsSync(candidate)) return;
    directFile(candidate, canonical, "The staged Python agent source is incomplete.");
  }
}

function applicationLayout(adapterId, launch) {
  const adapter = definition(adapterId);
  validateRuntimeV2PythonAgentProbeEnvironment(adapterId, process.env);
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(path.join(developmentSourceRoot, "lib", "db.ts"));
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  directFile(
    path.join(sourceRoot, "lib", adapterId, "runtime.ts"),
    sourceRoot,
    "The staged Python agent probe source closure is unavailable.",
  );
  const dataRoot = directDirectory(
    launch.dataRoot,
    launch.dataRoot,
    "The Python agent probe data root is indirect.",
  );
  const workspace = directDirectory(
    launch.workspacePath,
    dataRoot,
    "The private Python agent probe workspace is indirect.",
  );
  const expectedRoot = path.join(appRoot, adapter.rootDirectory);
  if (!samePath(process.env[adapter.rootEnvironment], expectedRoot)) {
    fail("The Python agent source root is outside the sealed application closure.");
  }
  validateOptionalDirectRoot(expectedRoot, appRoot, adapter.markers);
  const venv = path.join(
    dataRoot,
    "runtime-v2",
    "services",
    adapter.serviceId,
    ".venv",
  );
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  if (
    adapter.pythonEnvironment &&
    !samePath(process.env[adapter.pythonEnvironment], python)
  ) fail("The Python agent interpreter escaped its managed Runtime environment.");
  if (fs.existsSync(python)) {
    directFile(python, dataRoot, "The managed Python agent interpreter is indirect.");
  }
  const privateRoot = path.join(workspace, `${adapterId}-probe-process`);
  const home = path.join(privateRoot, "home");
  const temporary = path.join(privateRoot, "tmp");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.BREADBOARD_QA_MODE = "1";
  process.env.NODE_ENV = development ? "development" : "production";
  process.env.HOME = directDirectory(home, workspace, "The private probe home is indirect.");
  process.env.USERPROFILE = process.env.HOME;
  process.env.TMP = directDirectory(temporary, workspace, "The private probe temp is indirect.");
  process.env.TEMP = process.env.TMP;
  process.env.TMPDIR = process.env.TMP;
  for (const name of [
    "CHATMOCK_API_KEY",
    "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
    "BREADBOARD_HERMES_SESSION_TOKEN",
    "BREADBOARD_HERMES_TOOL_SECRET",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "GBRAIN_ADAPTER_SECRET",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ]) delete process.env[name];
  process.chdir(dashboardRoot);
  return { adapterId, sourceRoot, appRoot, dataRoot, workspace, home, temporary };
}

function nullablePath(value) {
  return value === null ||
    (boundedText(value, MAX_PATH_BYTES) && value.length > 0 && path.isAbsolute(value));
}

function nullableReason(value) {
  return value === null || boundedText(value, MAX_REASON_BYTES);
}

export function validateRuntimeV2PythonAgentProbeResult(adapterId, value) {
  if (adapterId === "legal") {
    if (
      !exactRecord(value, [
        "available",
        "cloned",
        "root",
        "environmentReady",
        "harnessImportable",
        "pandocAvailable",
        "shellAvailable",
        "systemPython",
        "uvAvailable",
        "bridgeFound",
        "reason",
      ]) ||
      typeof value.available !== "boolean" ||
      typeof value.cloned !== "boolean" ||
      !nullablePath(value.root) ||
      value.cloned !== (value.root !== null) ||
      typeof value.environmentReady !== "boolean" ||
      typeof value.harnessImportable !== "boolean" ||
      typeof value.pandocAvailable !== "boolean" ||
      typeof value.shellAvailable !== "boolean" ||
      !nullablePath(value.systemPython) ||
      typeof value.uvAvailable !== "boolean" ||
      typeof value.bridgeFound !== "boolean" ||
      !nullableReason(value.reason) ||
      value.available !== (value.reason === null) ||
      (value.environmentReady && value.systemPython === null) ||
      (value.available &&
        (!value.cloned || !value.environmentReady || !value.harnessImportable || !value.bridgeFound)) ||
      (!value.environmentReady && (value.harnessImportable || value.pandocAvailable))
    ) fail("The Legal Agent probe produced invalid health metadata.");
  } else if (adapterId === "shorts") {
    if (
      !exactRecord(value, [
        "available",
        "cloned",
        "root",
        "environmentReady",
        "dependenciesInstalled",
        "missing",
        "systemPython",
        "uvAvailable",
        "ffmpeg",
        "bridgeFound",
        "reason",
      ]) ||
      typeof value.available !== "boolean" ||
      typeof value.cloned !== "boolean" ||
      !nullablePath(value.root) ||
      value.cloned !== (value.root !== null) ||
      typeof value.environmentReady !== "boolean" ||
      typeof value.dependenciesInstalled !== "boolean" ||
      !Array.isArray(value.missing) ||
      value.missing.length > 16 ||
      value.missing.some((item) => !boundedText(item, MAX_LABEL_BYTES)) ||
      !nullablePath(value.systemPython) ||
      typeof value.uvAvailable !== "boolean" ||
      !nullablePath(value.ffmpeg) ||
      typeof value.bridgeFound !== "boolean" ||
      !nullableReason(value.reason) ||
      value.available !== (value.reason === null) ||
      (value.environmentReady && value.systemPython === null) ||
      (value.dependenciesInstalled && value.missing.length !== 0) ||
      (!value.environmentReady && value.dependenciesInstalled) ||
      (value.available &&
        (!value.cloned ||
          !value.environmentReady ||
          !value.dependenciesInstalled ||
          !value.bridgeFound ||
          value.ffmpeg === null))
    ) fail("The Shorts probe produced invalid health metadata.");
  } else if (adapterId === "tradingagents") {
    if (
      !exactRecord(value, [
        "available",
        "cloned",
        "root",
        "environmentReady",
        "packageInstalled",
        "systemPython",
        "uvAvailable",
        "version",
        "bridgeFound",
        "reason",
      ]) ||
      typeof value.available !== "boolean" ||
      typeof value.cloned !== "boolean" ||
      !nullablePath(value.root) ||
      value.cloned !== (value.root !== null) ||
      typeof value.environmentReady !== "boolean" ||
      typeof value.packageInstalled !== "boolean" ||
      !nullablePath(value.systemPython) ||
      typeof value.uvAvailable !== "boolean" ||
      (value.version !== null && !boundedText(value.version, MAX_LABEL_BYTES)) ||
      typeof value.bridgeFound !== "boolean" ||
      !nullableReason(value.reason) ||
      value.available !== (value.reason === null) ||
      (value.environmentReady && value.systemPython === null) ||
      (!value.environmentReady && value.packageInstalled) ||
      (value.available &&
        (!value.cloned || !value.environmentReady || !value.packageInstalled || !value.bridgeFound))
    ) fail("The Trading Agent probe produced invalid health metadata.");
  } else {
    fail("The Python agent probe adapter is unavailable.");
  }
  return value;
}

async function loadHealth(layout, signal) {
  const runtime = await import(pathToFileURL(
    path.join(layout.sourceRoot, "lib", layout.adapterId, "runtime.ts"),
  ).href);
  if (typeof runtime.health !== "function") {
    fail("The staged Python agent health probe is unavailable.");
  }
  return runtime.health({ force: true, signal });
}

export async function executeRuntimeV2PythonAgentProbe(
  adapterId,
  launch,
  signal,
  progress,
  dependencies = { loadHealth },
) {
  definition(adapterId);
  validateRuntimeV2PythonAgentProbeRequest(launch.request);
  validateRuntimeV2PythonAgentProbeScope(launch.executionScope);
  progress.checkpoint({ stage: "preparing", percent: 10 });
  const layout = applicationLayout(adapterId, launch);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  progress.checkpoint({ stage: "probing", percent: 35 });
  const result = await dependencies.loadHealth(layout, signal);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  validateRuntimeV2PythonAgentProbeResult(adapterId, result);
  progress.checkpoint({ stage: "complete", percent: 100 });
  return result;
}

export async function runRuntimeV2PythonAgentProbeWorker(adapterId) {
  definition(adapterId);
  await runRuntimeV2FiniteMcpWorker({
    name: `runtime-v2-${adapterId}-probe-worker`,
    validateRequest: validateRuntimeV2PythonAgentProbeRequest,
    validateExecutionScope: validateRuntimeV2PythonAgentProbeScope,
    expectedInputCount: () => 0,
    execute: (launch, signal, progress) =>
      executeRuntimeV2PythonAgentProbe(adapterId, launch, signal, progress),
  });
}
