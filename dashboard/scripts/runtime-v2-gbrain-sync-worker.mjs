import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);

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

export function validateRuntimeV2GBrainSyncRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation", "clusterId", "queueJobId"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "sync-garden" ||
    !Number.isSafeInteger(value.clusterId) ||
    value.clusterId < 1 ||
    (value.queueJobId !== null &&
      (!Number.isSafeInteger(value.queueJobId) || value.queueJobId < 1))
  ) {
    fail("The canonical GBrain sync request is invalid.");
  }
  return value;
}

export function validateRuntimeV2GBrainSyncScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    !boundedText(value.gardenId, 256) ||
    value.conversationId !== null
  ) {
    fail("The GBrain sync worker requires authenticated garden scope.");
  }
  return value;
}

export function validateRuntimeV2GBrainAdapterEnvironment(environment) {
  const rawUrl = environment.GBRAIN_ADAPTER_URL;
  const secret = environment.GBRAIN_ADAPTER_SECRET;
  if (!boundedText(rawUrl, 2048) || !boundedText(secret, 1024)) {
    fail("The sealed GBrain adapter environment is unavailable.");
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("The sealed GBrain adapter endpoint is invalid.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.port ||
    !["", "/"].includes(url.pathname)
  ) {
    fail("The GBrain sync worker requires the Runtime-minted loopback adapter endpoint.");
  }
}

function sourceLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "gbrain", "sync-executor.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relativePath of [
    path.join("lib", "db.ts"),
    path.join("lib", "knowledge.ts"),
    path.join("lib", "gbrain", "client.ts"),
    path.join("lib", "gbrain", "sync-executor.ts"),
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, relativePath))) {
      fail("The staged GBrain sync worker source closure is unavailable.");
    }
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

export async function executeRuntimeV2GBrainSync(launch, signal, progress) {
  validateRuntimeV2GBrainSyncRequest(launch.request);
  validateRuntimeV2GBrainSyncScope(launch.executionScope);
  validateRuntimeV2GBrainAdapterEnvironment(process.env);
  progress.checkpoint({ stage: "loading-garden" });
  const sourceRoot = sourceLayout(launch.dataRoot);
  await import(
    pathToFileURL(path.join(path.dirname(ENTRYPOINT), "learn-worker-import-hook.mjs")).href
  );
  const executorModule = await import(
    pathToFileURL(path.join(sourceRoot, "lib", "gbrain", "sync-executor.ts")).href
  );
  if (typeof executorModule.syncGardenInRuntimeWorker !== "function") {
    fail("The staged GBrain sync executor is unavailable.");
  }
  progress.checkpoint({ stage: "indexing" });
  const result = await executorModule.syncGardenInRuntimeWorker({
    clusterId: launch.request.clusterId,
    userId: launch.executionScope.userId,
    gardenId: launch.executionScope.gardenId,
    queueJobId: launch.request.queueJobId,
    runtimeJobId: launch.identity.jobId,
    signal,
  });
  progress.checkpoint({ stage: "complete" });
  return result;
}

if (
  typeof process.argv[1] === "string" &&
  samePath(process.argv[1], ENTRYPOINT)
) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-gbrain-sync-worker",
    validateRequest: validateRuntimeV2GBrainSyncRequest,
    validateExecutionScope: validateRuntimeV2GBrainSyncScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2GBrainSync,
  });
}
