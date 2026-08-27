import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const WORKSPACE_KEY = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/u;

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
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes && !/\p{Cc}/u.test(value);
}

function samePath(left, right) {
  const first = path.resolve(left);
  const second = path.resolve(right);
  return process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function basicArguments(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 24 &&
    value.every((entry) =>
      typeof entry === "string" && entry.trim().length > 0 && entry.length <= 8_192 &&
      !/[\r\n\u0000-\u001f\u007f]/u.test(entry)
    ) && Buffer.byteLength(value.join("\u0000"), "utf8") <= 32 * 1024;
}

export function validateRuntimeV2OmhRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation", "workspaceKey", "arguments"]) ||
    value.protocolVersion !== 1 || value.operation !== "command" ||
    typeof value.workspaceKey !== "string" ||
    Buffer.byteLength(value.workspaceKey, "utf8") > 512 ||
    !WORKSPACE_KEY.test(value.workspaceKey) || !basicArguments(value.arguments)
  ) fail("The canonical OMH Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2OmhScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    (value.gardenId !== null && !boundedText(value.gardenId, 256)) ||
    !boundedText(value.conversationId, 256)
  ) fail("The OMH worker requires authenticated conversation scope.");
  return value;
}

export function validateRuntimeV2OmhEnvironment(environment) {
  for (const name of ["BREADBOARD_OMH_ROOT", "BREADBOARD_OMH_PYTHON", "HERMES_ROOT"]) {
    if (!boundedText(environment[name], 2_048) || !path.isAbsolute(environment[name])) {
      fail("The sealed OMH runtime paths are unavailable.");
    }
  }
}

function sourceLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "hermes", "omh-service.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relativePath of [
    path.join("lib", "runtime-paths.ts"),
    path.join("lib", "hermes", "omh-request.ts"),
    path.join("lib", "hermes", "omh-service.ts"),
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, relativePath))) {
      fail("The staged OMH worker source closure is unavailable.");
    }
  }
  const historicalDevelopmentData = development && samePath(dataRoot, appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.NODE_ENV = development ? "development" : "production";
  process.chdir(dashboardRoot);
  return sourceRoot;
}

function workspaceDirectory(workspaceKey) {
  const configuredRoot = path.resolve(process.env.HERMES_ROOT);
  fs.mkdirSync(configuredRoot, { recursive: true });
  const root = fs.realpathSync.native(configuredRoot);
  const candidate = path.resolve(root, ...workspaceKey.split("/"));
  if (!pathWithin(root, candidate) || samePath(root, candidate)) {
    fail("The OMH workspace escaped the sealed Hermes root.");
  }
  fs.mkdirSync(candidate, { recursive: true });
  const canonical = fs.realpathSync.native(candidate);
  if (!samePath(candidate, canonical) || !pathWithin(root, canonical)) {
    fail("The OMH workspace is indirect or outside the sealed Hermes root.");
  }
  return canonical;
}

function boundedFailure(error) {
  const raw = error instanceof Error ? error.message : "OMH failed.";
  const clean = raw.replace(/\p{Cc}+/gu, " ").trim() || "OMH failed.";
  const bytes = Buffer.from(clean, "utf8");
  return (bytes.byteLength <= 32 * 1024 ? bytes : bytes.subarray(0, 32 * 1024))
    .toString("utf8").replace(/\uFFFD+$/u, "") || "OMH failed.";
}

export async function executeRuntimeV2Omh(launch, signal, progress) {
  validateRuntimeV2OmhRequest(launch.request);
  validateRuntimeV2OmhScope(launch.executionScope);
  validateRuntimeV2OmhEnvironment(process.env);
  const sourceRoot = sourceLayout(launch.dataRoot);
  process.env.TMP = launch.workspacePath;
  process.env.TEMP = launch.workspacePath;
  await import(
    pathToFileURL(path.join(path.dirname(ENTRYPOINT), "learn-worker-import-hook.mjs")).href
  );
  const service = await import(
    pathToFileURL(path.join(sourceRoot, "lib", "hermes", "omh-service.ts")).href
  );
  if (typeof service.runOmh !== "function" || typeof service.validateOmhArguments !== "function") {
    fail("The staged OMH executor is unavailable.");
  }

  try {
    const args = service.validateOmhArguments(launch.request.arguments);
    if (JSON.stringify(args) !== JSON.stringify(launch.request.arguments)) {
      fail("The canonical OMH arguments changed during worker validation.");
    }
    progress.checkpoint({ stage: "running", percent: 10 });
    const result = await service.runOmh({
      arguments: args,
      workspaceDirectory: workspaceDirectory(launch.request.workspaceKey),
      signal,
      timeoutMs: 30_000,
    });
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    progress.checkpoint({ stage: "complete", percent: 100 });
    return {
      ok: true,
      operation: "command",
      arguments: result.arguments,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output: result.output,
      payload: result.payload,
    };
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    const candidate = error && typeof error === "object" && typeof error.code === "string"
      ? error.code.slice(0, 128)
      : "omh_failed";
    return {
      ok: false,
      operation: "command",
      errorCode: /^[a-z][a-z0-9_]{0,127}$/u.test(candidate) ? candidate : "omh_failed",
      message: boundedFailure(error),
    };
  }
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-omh-worker",
    validateRequest: validateRuntimeV2OmhRequest,
    validateExecutionScope: validateRuntimeV2OmhScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2Omh,
  });
}
