import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
export const OPENMONTAGE_SOURCE_COMMIT = "4eab34c5cfcccaa4f1970554928feccce73ee930";
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 8 * 1_024;
const MAX_TEXT_BYTES = 512;
const PROVIDER_KEYS = Object.freeze([
  "FAL_KEY",
  "FAL_AI_API_KEY",
  "REPLICATE_API_TOKEN",
  "HIGGSFIELD_API_KEY",
  "KLING_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "SUNO_API_KEY",
  "HEYGEN_API_KEY",
  "RUNWAY_API_KEY",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "AZURE_SPEECH_KEY",
]);
const REQUIRED_SOURCE_FILES = Object.freeze([
  "AGENT_GUIDE.md",
  "requirements.txt",
  "tools/tool_registry.py",
  "remotion-composer/package.json",
  "remotion-composer/package-lock.json",
]);

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

function boundedText(value, maximumBytes = MAX_TEXT_BYTES) {
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

function directExternalFile(candidate, message) {
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(message);
  return resolved;
}

export function validateRuntimeV2OpenMontageProbeRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "status"
  ) fail("The canonical OpenMontage probe request is invalid.");
  return value;
}

export function validateRuntimeV2OpenMontageProbeScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) fail("The OpenMontage probe requires authenticated user-global scope.");
  return value;
}

export function validateRuntimeV2OpenMontageProbeEnvironment(environment) {
  if (environment.OPENMONTAGE_SOURCE_COMMIT !== OPENMONTAGE_SOURCE_COMMIT) {
    fail("The pinned OpenMontage source receipt is unavailable.");
  }
  for (const name of ["CODEX_BIN", "OPENMONTAGE_FFMPEG_PATH"]) {
    const candidate = environment[name];
    if (candidate !== undefined && (
      !boundedText(candidate, MAX_PATH_BYTES) || !candidate.trim() || !path.isAbsolute(candidate)
    )) fail(`The sealed OpenMontage ${name} path is invalid.`);
  }
}

function optionalManagedSource(candidate, dataRoot) {
  if (!fs.existsSync(candidate)) return null;
  const root = directDirectory(candidate, dataRoot, "The managed OpenMontage source is indirect.");
  for (const relative of REQUIRED_SOURCE_FILES) {
    const marker = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(marker)) return null;
    directFile(
      marker,
      root,
      "The managed OpenMontage source is incomplete.",
    );
  }
  return root;
}

function optionalConfiguredFile(candidate, label) {
  if (!candidate || !fs.existsSync(candidate)) return null;
  return directExternalFile(candidate, `The configured OpenMontage ${label} is indirect.`);
}

function optionalConfiguredMedia(candidate, appRoot, dataRoot) {
  if (!candidate || !fs.existsSync(candidate)) return null;
  const resolved = path.resolve(candidate);
  if (!pathWithin(appRoot, resolved) && !pathWithin(dataRoot, resolved)) {
    fail("The configured OpenMontage media path is outside the sealed Runtime closure.");
  }
  const metadata = fs.lstatSync(resolved);
  if (metadata.isSymbolicLink() || !samePath(fs.realpathSync.native(resolved), resolved)) {
    fail("The configured OpenMontage media path is indirect.");
  }
  if (!metadata.isDirectory() && !metadata.isFile()) {
    fail("The configured OpenMontage media path is invalid.");
  }
  return resolved;
}

function applicationLayout(launch) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "openmontage", "setup.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relative of [
    "lib/openmontage/setup.ts",
    "lib/openmontage/runtime.ts",
    "lib/openmontage/prompt.ts",
    "lib/codex/run-manager.ts",
    "lib/runtime-paths.ts",
  ]) {
    directFile(
      path.join(sourceRoot, ...relative.split("/")),
      sourceRoot,
      "The staged OpenMontage probe source closure is unavailable.",
    );
  }
  const dataRoot = directDirectory(
    launch.dataRoot,
    launch.dataRoot,
    "The OpenMontage Runtime data root is indirect.",
  );
  const workspace = directDirectory(
    launch.workspacePath,
    dataRoot,
    "The private OpenMontage probe workspace is indirect.",
  );
  const managedRoot = path.join(dataRoot, "runtime-v2", "toolchains", "openmontage");
  const root = optionalManagedSource(managedRoot, dataRoot);
  const venv = path.join(dataRoot, "runtime-v2", "services", "openmontage", ".venv");
  if (fs.existsSync(venv)) {
    directDirectory(venv, dataRoot, "The managed OpenMontage Python environment is indirect.");
    for (const candidate of [
      path.join(venv, "Scripts", "python.exe"),
      path.join(venv, "bin", "python3"),
      path.join(venv, "bin", "python"),
    ]) {
      if (fs.existsSync(candidate)) {
        directFile(candidate, dataRoot, "The managed OpenMontage Python is indirect.");
      }
    }
  }
  if (fs.existsSync(path.join(managedRoot, "remotion-composer", "node_modules"))) {
    directDirectory(
      path.join(managedRoot, "remotion-composer", "node_modules"),
      managedRoot,
      "The managed OpenMontage Remotion runtime is indirect.",
    );
  }
  const configuredCodex = optionalConfiguredFile(process.env.CODEX_BIN, "Codex executable");
  const configuredMedia = optionalConfiguredMedia(
    process.env.OPENMONTAGE_FFMPEG_PATH,
    appRoot,
    dataRoot,
  );
  const privateRoot = path.join(workspace, "openmontage-probe-process");
  const home = path.join(privateRoot, "home");
  const temporary = path.join(privateRoot, "tmp");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  directDirectory(home, workspace, "The private OpenMontage probe home is indirect.");
  directDirectory(temporary, workspace, "The private OpenMontage probe temp is indirect.");

  const retained = new Map();
  for (const name of [...PROVIDER_KEYS, "SystemRoot", "WINDIR", "ComSpec", "PATHEXT"]) {
    if (process.env[name] !== undefined) retained.set(name, process.env[name]);
  }
  for (const name of Object.keys(process.env)) delete process.env[name];
  for (const [name, value] of retained) process.env[name] = value;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.BREADBOARD_QA_MODE = "1";
  process.env.OPENMONTAGE_ROOT = managedRoot;
  process.env.OPENMONTAGE_NODE = process.execPath;
  process.env.OPENMONTAGE_SOURCE_COMMIT = OPENMONTAGE_SOURCE_COMMIT;
  if (configuredCodex) process.env.CODEX_BIN = configuredCodex;
  if (configuredMedia) process.env.OPENMONTAGE_FFMPEG_PATH = configuredMedia;
  process.env.NODE_ENV = development ? "development" : "production";
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TMP = temporary;
  process.env.TEMP = temporary;
  process.env.TMPDIR = temporary;
  process.env.NO_COLOR = "1";
  process.env.PYTHONIOENCODING = "utf-8";
  process.env.PYTHONUTF8 = "1";
  process.env.PYTHONUNBUFFERED = "1";
  const systemDirectory = process.platform === "win32" && process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32")
    : null;
  const mediaDirectory = configuredMedia
    ? (fs.lstatSync(configuredMedia).isDirectory() ? configuredMedia : path.dirname(configuredMedia))
    : null;
  process.env.PATH = [path.dirname(process.execPath), mediaDirectory, systemDirectory]
    .filter(Boolean)
    .join(path.delimiter);
  process.chdir(dashboardRoot);
  return { sourceRoot, managedRoot, root, venv, home, temporary };
}

function canonicalPiece(value, label) {
  if (
    !exactRecord(value, ["found", "path", "source"]) ||
    typeof value.found !== "boolean" ||
    !boundedText(value.path, MAX_PATH_BYTES) ||
    (value.path !== "" && !path.isAbsolute(value.path)) ||
    value.found !== (value.path !== "") ||
    !boundedText(value.source) ||
    (!value.found && value.source !== "")
  ) fail(`The OpenMontage probe produced invalid ${label} metadata.`);
  return value;
}

export function canonicalOpenMontageStatus(value) {
  if (
    !exactRecord(value, [
      "ready", "reason", "clone", "python", "ffmpeg", "ffprobe", "node",
      "remotion", "codex", "tools", "providers",
    ]) ||
    typeof value.ready !== "boolean" ||
    !boundedText(value.reason, MAX_REASON_BYTES) ||
    !exactRecord(value.clone, ["found", "path"]) ||
    typeof value.clone.found !== "boolean" ||
    !boundedText(value.clone.path, MAX_PATH_BYTES) ||
    (value.clone.path !== "" && !path.isAbsolute(value.clone.path)) ||
    value.clone.found !== (value.clone.path !== "") ||
    !exactRecord(value.python, [
      "found", "path", "source", "version", "dependencies", "installable",
    ]) ||
    typeof value.python.found !== "boolean" ||
    !boundedText(value.python.path, MAX_PATH_BYTES) ||
    (value.python.path !== "" && !path.isAbsolute(value.python.path)) ||
    value.python.found !== (value.python.path !== "") ||
    !boundedText(value.python.source) ||
    !boundedText(value.python.version) ||
    typeof value.python.dependencies !== "boolean" ||
    typeof value.python.installable !== "boolean" ||
    value.python.installable !== value.clone.found ||
    (value.python.dependencies && !value.python.found) ||
    !exactRecord(value.node, ["found", "version"]) ||
    typeof value.node.found !== "boolean" ||
    !boundedText(value.node.version) ||
    !exactRecord(value.remotion, ["found", "path", "installable"]) ||
    typeof value.remotion.found !== "boolean" ||
    !boundedText(value.remotion.path, MAX_PATH_BYTES) ||
    !path.isAbsolute(value.remotion.path) ||
    typeof value.remotion.installable !== "boolean" ||
    value.remotion.installable !== (value.clone.found && value.node.found) ||
    !exactRecord(value.codex, ["found", "version"]) ||
    typeof value.codex.found !== "boolean" ||
    !boundedText(value.codex.version) ||
    !exactRecord(value.tools, ["available", "total", "reason"]) ||
    !Number.isSafeInteger(value.tools.available) || value.tools.available < 0 ||
    !Number.isSafeInteger(value.tools.total) || value.tools.total < value.tools.available ||
    value.tools.total > 10_000 ||
    !boundedText(value.tools.reason, MAX_REASON_BYTES) ||
    !Array.isArray(value.providers) || value.providers.length > PROVIDER_KEYS.length ||
    !value.providers.every((name) => PROVIDER_KEYS.includes(name)) ||
    new Set(value.providers).size !== value.providers.length ||
    [...value.providers].sort().some((name, index) => name !== value.providers[index])
  ) fail("The OpenMontage probe produced invalid setup metadata.");
  const ffmpeg = canonicalPiece(value.ffmpeg, "ffmpeg");
  canonicalPiece(value.ffprobe, "ffprobe");
  if (
    (!value.python.found && (value.python.source !== "" || value.python.version !== "")) ||
    (!value.node.found && value.node.version !== "") ||
    (!value.codex.found && value.codex.version !== "") ||
    (value.ready && (
      !value.clone.found || !value.python.found || !value.python.dependencies ||
      !ffmpeg.found || !value.codex.found
    ))
  ) fail("The OpenMontage probe produced inconsistent setup metadata.");
  return value;
}

export async function executeRuntimeV2OpenMontageProbe(
  launch,
  signal,
  progress,
  dependencies = {},
) {
  validateRuntimeV2OpenMontageProbeRequest(launch.request);
  validateRuntimeV2OpenMontageProbeScope(launch.executionScope);
  validateRuntimeV2OpenMontageProbeEnvironment(process.env);
  progress.checkpoint({ stage: "preparing", percent: 10 });
  const layout = applicationLayout(launch);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const loadStatus = dependencies.loadStatus ?? (async () => {
    const setup = await import(pathToFileURL(
      path.join(layout.sourceRoot, "lib", "openmontage", "setup.ts"),
    ).href);
    if (typeof setup.toolchainStatus !== "function") {
      fail("The staged OpenMontage probe entrypoint is unavailable.");
    }
    return setup.toolchainStatus(process.env);
  });
  progress.checkpoint({ stage: "probing", percent: 30 });
  const status = canonicalOpenMontageStatus(await loadStatus(layout, signal));
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  progress.checkpoint({ stage: "complete", percent: 100 });
  return status;
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-openmontage-probe-worker",
    validateRequest: validateRuntimeV2OpenMontageProbeRequest,
    validateExecutionScope: validateRuntimeV2OpenMontageProbeScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2OpenMontageProbe,
  });
}
