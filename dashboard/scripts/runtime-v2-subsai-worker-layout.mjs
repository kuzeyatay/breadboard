import fs from "node:fs";
import path from "node:path";

export const SUBSAI_SOURCE_COMMIT = "5ed78a85d2b868a907c811404f7cd9179db39968";
export const SUBSAI_MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
export const SUBSAI_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_PATH_BYTES = 2_048;
const SOURCE_MARKERS = Object.freeze([
  "pyproject.toml",
  "src/subsai/cli.py",
  "src/subsai/configs.py",
  "src/subsai/models/faster_whisper_model.py",
]);
const RETAINED_ENVIRONMENT = Object.freeze([
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "SUBSAI_DEVICE",
  "SUBSAI_COMPUTE_TYPE",
  "UV_PATH",
  "BREADBOARD_RUNTIME_V2_MEDIA_BIN",
]);

export function failSubsAiWorker(message) {
  throw new Error(message);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function boundedText(value, maximumBytes) {
  return typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

export function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function directDirectory(candidate, root, message) {
  const resolved = path.resolve(candidate);
  if (!pathWithin(root, resolved)) failSubsAiWorker(message);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isDirectory() || metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) failSubsAiWorker(message);
  return resolved;
}

export function directFile(candidate, root, message) {
  const resolved = path.resolve(candidate);
  if (!pathWithin(root, resolved)) failSubsAiWorker(message);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) failSubsAiWorker(message);
  return resolved;
}

function optionalExternalFile(candidate, message) {
  if (!candidate || !fs.existsSync(candidate)) return null;
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) failSubsAiWorker(message);
  return resolved;
}

function optionalExternalDirectory(candidate, message) {
  if (!candidate || !fs.existsSync(candidate)) return null;
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isDirectory() || metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) failSubsAiWorker(message);
  return resolved;
}

function optionalSource(candidate, appRoot) {
  if (!fs.existsSync(candidate)) return null;
  const root = directDirectory(candidate, appRoot, "The staged subsai source is indirect.");
  for (const relative of SOURCE_MARKERS) {
    const marker = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(marker)) return null;
    directFile(marker, root, "The staged subsai source is incomplete.");
  }
  return root;
}

function optionalPython(venv, dataRoot) {
  if (!fs.existsSync(venv)) return null;
  directDirectory(venv, dataRoot, "The managed subsai environment is indirect.");
  const candidates = process.platform === "win32"
    ? [path.join(venv, "Scripts", "python.exe")]
    : [path.join(venv, "bin", "python"), path.join(venv, "bin", "python3")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return directFile(candidate, dataRoot, "The managed subsai Python is indirect.");
    }
  }
  return null;
}

function validOptionalPath(value) {
  return value === undefined || (
    boundedText(value, MAX_PATH_BYTES) && value.trim() && path.isAbsolute(value)
  );
}

export function validateRuntimeV2SubsAiEnvironment(environment) {
  if (environment.SUBSAI_SOURCE_COMMIT !== SUBSAI_SOURCE_COMMIT) {
    failSubsAiWorker("The pinned subsai source receipt is unavailable.");
  }
  for (const name of ["SUBSAI_ROOT", "UV_PATH", "BREADBOARD_RUNTIME_V2_MEDIA_BIN"]) {
    if (!validOptionalPath(environment[name])) {
      failSubsAiWorker(`The trusted subsai ${name} path is invalid.`);
    }
  }
  for (const name of ["SUBSAI_DEVICE", "SUBSAI_COMPUTE_TYPE"]) {
    const value = environment[name];
    if (value !== undefined && (
      !boundedText(value, 64) || !/^[a-z0-9_-]{1,32}$/u.test(value)
    )) failSubsAiWorker(`The trusted subsai ${name} setting is invalid.`);
  }
}

export function validateRuntimeV2SubsAiScope(value) {
  const validScope = (item) => item === null || (
    boundedText(item, 256) && item.trim() === item && item.length > 0
  );
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    !validScope(value.gardenId) || !validScope(value.conversationId)
  ) failSubsAiWorker("The subsai worker requires authenticated user scope.");
  return value;
}

function sourceLayout(entrypoint) {
  const developmentDashboardRoot = path.dirname(path.dirname(entrypoint));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(path.join(developmentSourceRoot, "lib", "runtime-paths.ts"));
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  return { appRoot, dashboardRoot, sourceRoot, development };
}

export function prepareRuntimeV2SubsAiLayout(entrypoint, launch, options = {}) {
  validateRuntimeV2SubsAiEnvironment(process.env);
  const sourceLayoutValue = sourceLayout(entrypoint);
  const { appRoot, dashboardRoot, sourceRoot, development } = sourceLayoutValue;
  if (options.requireDashboardRuntime) {
    for (const relative of ["lib/subsai/runtime.ts", "lib/runtime-paths.ts"]) {
      directFile(
        path.join(sourceRoot, ...relative.split("/")),
        sourceRoot,
        "The staged subsai health source closure is unavailable.",
      );
    }
  }
  const dataRoot = directDirectory(
    launch.dataRoot,
    launch.dataRoot,
    "The subsai Runtime data root is indirect.",
  );
  const workspace = directDirectory(
    launch.workspacePath,
    dataRoot,
    "The private subsai workspace is indirect.",
  );
  const expectedRoot = path.join(appRoot, "subsai");
  if (process.env.SUBSAI_ROOT && !samePath(process.env.SUBSAI_ROOT, expectedRoot)) {
    failSubsAiWorker("The subsai source root is outside the sealed application closure.");
  }
  const root = optionalSource(expectedRoot, appRoot);
  if (options.requireSource && !root) {
    failSubsAiWorker("The staged subsai source is unavailable.");
  }
  const venv = path.join(dataRoot, "runtime-v2", "services", "subsai", ".venv");
  const python = optionalPython(venv, dataRoot);
  if (options.requirePython && !python) {
    failSubsAiWorker("The managed subsai Python environment is unavailable.");
  }
  const configuredUv = optionalExternalFile(
    process.env.UV_PATH,
    "The configured uv executable is indirect.",
  );
  const mediaBin = optionalExternalDirectory(
    process.env.BREADBOARD_RUNTIME_V2_MEDIA_BIN,
    "The staged media tools directory is indirect.",
  );
  if (mediaBin) {
    for (const name of process.platform === "win32"
      ? ["ffmpeg.exe", "ffprobe.exe"]
      : ["ffmpeg", "ffprobe"]) {
      directFile(
        path.join(mediaBin, name),
        mediaBin,
        "The staged media tools directory is incomplete.",
      );
    }
  }
  const uv = configuredUv;
  const privateRoot = path.join(workspace, "subsai-process");
  const home = path.join(privateRoot, "home");
  const temporary = path.join(privateRoot, "tmp");
  const models = path.join(dataRoot, "runtime-v2", "services", "subsai", "models");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  if (options.createModelCache) fs.mkdirSync(models, { recursive: true, mode: 0o700 });
  directDirectory(home, workspace, "The private subsai home is indirect.");
  directDirectory(temporary, workspace, "The private subsai temp directory is indirect.");
  if (fs.existsSync(models)) {
    directDirectory(models, dataRoot, "The subsai model cache is indirect.");
  }

  const retained = new Map();
  for (const name of RETAINED_ENVIRONMENT) {
    if (process.env[name] !== undefined) retained.set(name, process.env[name]);
  }
  for (const name of Object.keys(process.env)) delete process.env[name];
  for (const [name, value] of retained) process.env[name] = value;
  if (!uv) delete process.env.UV_PATH;
  if (!mediaBin) delete process.env.BREADBOARD_RUNTIME_V2_MEDIA_BIN;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.BREADBOARD_QA_MODE = "1";
  process.env.SUBSAI_ROOT = expectedRoot;
  process.env.SUBSAI_SOURCE_COMMIT = SUBSAI_SOURCE_COMMIT;
  process.env.NODE_ENV = development ? "development" : "production";
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TMP = temporary;
  process.env.TEMP = temporary;
  process.env.TMPDIR = temporary;
  process.env.HF_HOME = models;
  process.env.PYTHONUTF8 = "1";
  process.env.PYTHONIOENCODING = "utf-8";
  process.env.PYTHONDONTWRITEBYTECODE = "1";
  process.env.PYTHONUNBUFFERED = "1";
  process.env.NO_COLOR = "1";
  if (uv) process.env.UV_PATH = uv;
  if (mediaBin) process.env.BREADBOARD_RUNTIME_V2_MEDIA_BIN = mediaBin;
  const systemDirectory = process.platform === "win32" && process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32")
    : null;
  const entries = [
    python ? path.dirname(python) : null,
    mediaBin,
    uv ? path.dirname(uv) : null,
    path.dirname(process.execPath),
    systemDirectory,
  ].filter(Boolean);
  process.env.PATH = [...new Set(entries)].join(path.delimiter);
  process.chdir(dashboardRoot);
  return {
    ...sourceLayoutValue,
    dataRoot,
    workspace,
    root,
    expectedRoot,
    venv,
    python,
    uv,
    mediaBin,
    home,
    temporary,
    models,
  };
}

export function runtimeV2SubsAiChildEnvironment(layout) {
  const environment = { ...process.env };
  environment.PYTHONPATH = path.join(layout.expectedRoot, "src");
  return environment;
}
