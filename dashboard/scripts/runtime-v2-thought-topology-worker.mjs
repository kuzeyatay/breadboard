import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);

function fail(message) { throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value, keys) { return isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
function samePath(left, right) {
  const a = path.resolve(left); const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function validateRuntimeV2ThoughtTopologyRequest(value) {
  if (!exact(value, ["protocolVersion", "operation", "clusterId", "revision", "queueJobId"]) ||
      value.protocolVersion !== 1 || value.operation !== "build-thought-topology" ||
      ![value.clusterId, value.revision, value.queueJobId].every((number) => Number.isSafeInteger(number) && number > 0)) {
    fail("The canonical Thought Topology request is invalid.");
  }
  return value;
}

export function validateRuntimeV2ThoughtTopologyScope(value) {
  if (!exact(value, ["userId", "gardenId", "conversationId"]) ||
      !Number.isSafeInteger(value.userId) || value.userId < 1 ||
      typeof value.gardenId !== "string" || !value.gardenId.trim() || value.gardenId.length > 256 ||
      value.conversationId !== null) fail("Thought Topology requires authenticated Garden scope.");
  return value;
}

export function validateThoughtTopologyWorkerEnvironment(environment) {
  for (const name of ["GBRAIN_ADAPTER_URL", "GBRAIN_ADAPTER_SECRET", "OPENAI_BASE_URL", "OPENAI_API_KEY"]) {
    if (typeof environment[name] !== "string" || !environment[name].trim()) fail("The sealed topology service environment is unavailable.");
  }
  for (const name of ["GBRAIN_ADAPTER_URL", "OPENAI_BASE_URL"]) {
    const url = new URL(environment[name]);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || !url.port) {
      fail("Thought Topology requires Runtime-minted loopback services.");
    }
  }
}

function sourceLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(path.join(developmentSourceRoot, "lib", "thought-topology", "executor.ts"));
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relative of [path.join("lib", "db.ts"), path.join("lib", "knowledge.ts"), path.join("lib", "thought-topology", "executor.ts")]) {
    if (!fs.existsSync(path.join(sourceRoot, relative))) fail("The staged Thought Topology source closure is unavailable.");
  }
  const historicalDevelopmentData = development && samePath(dataRoot, appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : dataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.QUARTZ_CONTENT_PATH = path.join(dataRoot, "quartz", "content");
  process.env.NODE_ENV = development ? "development" : "production";
  process.chdir(dashboardRoot);
  return sourceRoot;
}

export async function executeRuntimeV2ThoughtTopology(launch, signal, progress) {
  validateRuntimeV2ThoughtTopologyRequest(launch.request);
  validateRuntimeV2ThoughtTopologyScope(launch.executionScope);
  validateThoughtTopologyWorkerEnvironment(process.env);
  progress.checkpoint({ stage: "loading-garden", percent: 5 });
  const sourceRoot = sourceLayout(launch.dataRoot);
  await import(pathToFileURL(path.join(path.dirname(ENTRYPOINT), "learn-worker-import-hook.mjs")).href);
  const executor = await import(pathToFileURL(path.join(sourceRoot, "lib", "thought-topology", "executor.ts")).href);
  progress.checkpoint({ stage: "building-topology", percent: 12 });
  const result = await executor.executeThoughtTopologyRuntimeBuild({
    clusterId: launch.request.clusterId,
    userId: launch.executionScope.userId,
    gardenId: launch.executionScope.gardenId,
    revision: launch.request.revision,
    queueJobId: launch.request.queueJobId,
    runtimeJobId: launch.identity.jobId,
    signal,
    onProgress(percent) {
      progress.checkpoint({ stage: "building-topology", percent });
    },
  });
  progress.checkpoint({ stage: "complete", percent: 100 });
  return result;
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-thought-topology-worker",
    validateRequest: validateRuntimeV2ThoughtTopologyRequest,
    validateExecutionScope: validateRuntimeV2ThoughtTopologyScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2ThoughtTopology,
  });
}
