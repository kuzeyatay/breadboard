import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const UPSTREAM_COMMIT = "7b8fac1857eba19d25665825793dfbaf0414c6bf";
const WORKSPACE_KEY = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/u;
const MAX_ARGUMENTS = 12;
const MAX_ARGUMENT_LENGTH = 4_096;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const REQUIRED_CLONE_FILES = Object.freeze([
  "skills/ingestion/fetch-content/scripts/fetch.py",
  "skills/ingestion/coverage-check/scripts/coverage.py",
  "skills/analysis/bullshit-detector/scripts/tally.py",
  "skills/analysis/bullshit-detector/scripts/retractions.py",
  "skills/analysis/bullshit-detector/RUBRIC.md",
  "skills/analysis/bullshit-detector/CLAIMS.md",
  "skills/analysis/bullshit-detector/RUN-RECORD.md",
]);

function fail(message) {
  throw new Error(message);
}

function domainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
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
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
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

function basicArguments(value) {
  return Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= MAX_ARGUMENTS &&
    value.every((entry) =>
      typeof entry === "string" &&
      entry.trim().length > 0 &&
      entry.length <= MAX_ARGUMENT_LENGTH &&
      !/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(entry)
    ) &&
    Buffer.byteLength(value.join("\u0000"), "utf8") <= MAX_ARGUMENT_BYTES;
}

export function validateRuntimeV2FactcheckRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation", "workspaceKey", "arguments"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "command" ||
    typeof value.workspaceKey !== "string" ||
    Buffer.byteLength(value.workspaceKey, "utf8") > 512 ||
    !WORKSPACE_KEY.test(value.workspaceKey) ||
    !basicArguments(value.arguments)
  ) fail("The canonical Factcheck Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2FactcheckScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    (value.gardenId !== null && !boundedText(value.gardenId, 256)) ||
    !boundedText(value.conversationId, 256)
  ) fail("The Factcheck worker requires authenticated conversation scope.");
  return value;
}

export function validateRuntimeV2FactcheckEnvironment(environment) {
  for (const name of [
    "BREADBOARD_BULLSHIT_DETECTOR_ROOT",
    "BREADBOARD_FACTCHECK_UV",
    "BREADBOARD_FACTCHECK_PYTHON",
    "HERMES_ROOT",
  ]) {
    if (!boundedText(environment[name], 2_048) || !path.isAbsolute(environment[name])) {
      fail("The sealed Factcheck runtime paths are unavailable.");
    }
  }
  const cache = environment.UV_CACHE_DIR;
  if (
    cache !== undefined &&
    cache !== "" &&
    (!boundedText(cache, 2_048) || !path.isAbsolute(cache))
  ) fail("The sealed Factcheck cache path is invalid.");
}

function directDirectory(candidate, message, create = false) {
  const resolved = path.resolve(candidate);
  if (create) fs.mkdirSync(resolved, { recursive: true });
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

function sourceLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "hermes", "factcheck-service.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relativePath of [
    path.join("lib", "runtime-paths.ts"),
    path.join("lib", "hermes", "factcheck-service.ts"),
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, relativePath))) {
      throw domainError(
        "factcheck_runtime_unavailable",
        "The fact-check runtime is not prepared. Clone bullshit-detector/ and install uv (https://docs.astral.sh/uv/).",
      );
    }
  }
  const historicalDevelopmentData = development && samePath(dataRoot, appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.NODE_ENV = development ? "development" : "production";
  process.chdir(dashboardRoot);
  return { development, sourceRoot };
}

function workspaceDirectory(workspaceKey) {
  let root;
  try {
    root = directDirectory(
      process.env.HERMES_ROOT,
      "The sealed Factcheck Hermes root is indirect.",
      true,
    );
  } catch {
    throw domainError(
      "factcheck_workspace_unavailable",
      "The fact-check tool could not prepare this conversation's workspace.",
    );
  }
  const candidate = path.resolve(root, ...workspaceKey.split("/"));
  if (!pathWithin(root, candidate) || samePath(root, candidate)) {
    throw domainError(
      "factcheck_path_denied",
      "Fact-check files must live inside this conversation's workspace.",
    );
  }
  try {
    return directDirectory(
      candidate,
      "The Factcheck workspace is indirect or outside the sealed Hermes root.",
      true,
    );
  } catch {
    throw domainError(
      "factcheck_workspace_unavailable",
      "The fact-check tool could not prepare this conversation's workspace.",
    );
  }
}

function sealedRuntime(development) {
  let cloneRoot;
  let executable;
  let python;
  try {
    cloneRoot = directDirectory(
      process.env.BREADBOARD_BULLSHIT_DETECTOR_ROOT,
      "The staged Factcheck clone is unavailable.",
    );
    executable = directFile(
      process.env.BREADBOARD_FACTCHECK_UV,
      path.dirname(process.env.BREADBOARD_FACTCHECK_UV),
      "The staged Factcheck uv executable is unavailable.",
    );
    python = directFile(
      process.env.BREADBOARD_FACTCHECK_PYTHON,
      path.dirname(process.env.BREADBOARD_FACTCHECK_PYTHON),
      "The staged Factcheck Python executable is unavailable.",
    );
    for (const relativePath of REQUIRED_CLONE_FILES) {
      directFile(
        path.join(cloneRoot, ...relativePath.split("/")),
        cloneRoot,
        "The staged Factcheck source closure is unavailable.",
      );
    }
    if (!development) {
      const receipt = directFile(
        path.join(cloneRoot, "BREADBOARD_UPSTREAM_COMMIT"),
        cloneRoot,
        "The staged Factcheck source receipt is unavailable.",
      );
      if (fs.readFileSync(receipt, "utf8").trim() !== UPSTREAM_COMMIT) {
        fail("The staged Factcheck source receipt does not match the reviewed commit.");
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && typeof error.code === "string") throw error;
    throw domainError(
      "factcheck_runtime_unavailable",
      "The fact-check runtime is not prepared. Clone bullshit-detector/ and install uv (https://docs.astral.sh/uv/).",
    );
  }
  return { executable, python, usesUv: true, cloneRoot };
}

function prepareChildEnvironment(launch, runtime) {
  const privateRoot = directDirectory(
    path.join(launch.workspacePath, "factcheck-process"),
    "The private Factcheck process workspace is unavailable.",
    true,
  );
  const home = directDirectory(
    path.join(privateRoot, "home"),
    "The private Factcheck home is unavailable.",
    true,
  );
  const temporary = directDirectory(
    path.join(privateRoot, "tmp"),
    "The private Factcheck temporary directory is unavailable.",
    true,
  );
  const appData = directDirectory(
    path.join(privateRoot, "appdata"),
    "The private Factcheck application data directory is unavailable.",
    true,
  );
  const localAppData = directDirectory(
    path.join(privateRoot, "localappdata"),
    "The private Factcheck local data directory is unavailable.",
    true,
  );
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = appData;
  process.env.LOCALAPPDATA = localAppData;
  process.env.XDG_CACHE_HOME = path.join(home, ".cache");
  process.env.TMP = temporary;
  process.env.TEMP = temporary;
  process.env.TMPDIR = temporary;
  process.env.UV_PYTHON = runtime.python;
  process.env.UV_PYTHON_DOWNLOADS = "never";
  const systemDirectory = process.platform === "win32" && process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32")
    : null;
  process.env.PATH = [
    path.dirname(runtime.executable),
    path.dirname(runtime.python),
    path.dirname(process.execPath),
    systemDirectory,
  ].filter(Boolean).join(path.delimiter);
  if (process.env.UV_CACHE_DIR) {
    directDirectory(
      process.env.UV_CACHE_DIR,
      "The sealed Factcheck cache is indirect.",
      true,
    );
  }
}

function validateLocalInput(validated, workspace) {
  const local = validated.command === "tally" ||
    validated.command === "retractions" ||
    (validated.command === "fetch" && !/^https?:/iu.test(validated.scriptArguments[0]));
  if (!local) return;
  const relativePath = validated.scriptArguments[0];
  const candidate = path.resolve(workspace, ...relativePath.split("/"));
  if (!pathWithin(workspace, candidate) || samePath(workspace, candidate)) {
    throw domainError(
      "factcheck_path_denied",
      "Fact-check files must live inside this conversation's workspace.",
    );
  }
  if (!fs.existsSync(candidate)) return;
  const metadata = fs.lstatSync(candidate);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(candidate), candidate)
  ) {
    throw domainError(
      "factcheck_path_denied",
      "Fact-check files must live inside this conversation's workspace.",
    );
  }
}

function validateOutput(result, workspace) {
  if (
    !isRecord(result) ||
    typeof result.outputPath !== "string" ||
    result.outputPath.includes("\\") ||
    result.outputPath.includes(":") ||
    result.outputPath.split("/").length !== 2 ||
    result.outputPath.split("/")[0] !== "factcheck" ||
    result.outputPath.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !Number.isSafeInteger(result.outputBytes) ||
    result.outputBytes < 0 ||
    result.outputBytes > MAX_OUTPUT_BYTES
  ) {
    throw domainError(
      "factcheck_workspace_unavailable",
      "The fact-check tool could not write its output into this conversation's workspace.",
    );
  }
  const output = path.resolve(workspace, ...result.outputPath.split("/"));
  if (!pathWithin(workspace, output) || samePath(workspace, output)) {
    throw domainError(
      "factcheck_workspace_unavailable",
      "The fact-check tool could not write its output into this conversation's workspace.",
    );
  }
  const metadata = fs.lstatSync(output);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== result.outputBytes ||
    !samePath(fs.realpathSync.native(output), output)
  ) {
    throw domainError(
      "factcheck_workspace_unavailable",
      "The fact-check tool could not write its output into this conversation's workspace.",
    );
  }
}

function boundedFailure(error) {
  const raw = error instanceof Error ? error.message : "Fact-checking failed.";
  const clean = raw.replace(/\p{Cc}+/gu, " ").trim() || "Fact-checking failed.";
  const bytes = Buffer.from(clean, "utf8");
  return (bytes.byteLength <= 32 * 1024 ? bytes : bytes.subarray(0, 32 * 1024))
    .toString("utf8")
    .replace(/\uFFFD+$/u, "") || "Fact-checking failed.";
}

export async function executeRuntimeV2Factcheck(launch, signal, progress) {
  validateRuntimeV2FactcheckRequest(launch.request);
  validateRuntimeV2FactcheckScope(launch.executionScope);
  try {
    validateRuntimeV2FactcheckEnvironment(process.env);
    const { development, sourceRoot } = sourceLayout(launch.dataRoot);
    const runtime = sealedRuntime(development);
    prepareChildEnvironment(launch, runtime);
    await import(
      pathToFileURL(path.join(path.dirname(ENTRYPOINT), "learn-worker-import-hook.mjs")).href
    );
    const service = await import(
      pathToFileURL(path.join(sourceRoot, "lib", "hermes", "factcheck-service.ts")).href
    );
    if (
      typeof service.runFactcheck !== "function" ||
      typeof service.validateFactcheckArguments !== "function"
    ) throw domainError(
      "factcheck_runtime_unavailable",
      "The fact-check runtime is not prepared. Clone bullshit-detector/ and install uv (https://docs.astral.sh/uv/).",
    );
    const workspace = workspaceDirectory(launch.request.workspaceKey);
    const validated = service.validateFactcheckArguments({
      arguments: launch.request.arguments,
      workspaceDirectory: workspace,
      cloneRoot: runtime.cloneRoot,
    });
    validateLocalInput(validated, workspace);
    progress.checkpoint({ stage: "running", percent: 10 });
    const result = await service.runFactcheck({
      arguments: launch.request.arguments,
      workspaceDirectory: workspace,
      signal,
      runtime: {
        executable: runtime.executable,
        usesUv: true,
        cloneRoot: runtime.cloneRoot,
      },
    });
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    validateOutput(result, workspace);
    progress.checkpoint({ stage: "complete", percent: 100 });
    return { ok: true, operation: "command", ...result };
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    const candidate = error && typeof error === "object" && typeof error.code === "string"
      ? error.code.slice(0, 128)
      : "factcheck_failed";
    return {
      ok: false,
      operation: "command",
      errorCode: /^[a-z][a-z0-9_]{0,127}$/u.test(candidate) ? candidate : "factcheck_failed",
      message: boundedFailure(error),
    };
  }
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-factcheck-worker",
    validateRequest: validateRuntimeV2FactcheckRequest,
    validateExecutionScope: validateRuntimeV2FactcheckScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2Factcheck,
  });
}
