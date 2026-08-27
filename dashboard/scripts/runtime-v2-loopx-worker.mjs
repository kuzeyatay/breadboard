import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const OUTCOMES = new Set(["completed", "error", "cancelled"]);

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

export function validateRuntimeV2LoopxRequest(value) {
  if (
    !exactRecord(value, [
      "protocolVersion",
      "operation",
      "conversationPublicId",
      "turnSequence",
      "objective",
      "outcome",
      "toolCalls",
      "producedArtifact",
    ]) ||
    value.protocolVersion !== 1 || value.operation !== "tick" ||
    !boundedText(value.conversationPublicId, 256) ||
    !Number.isSafeInteger(value.turnSequence) || value.turnSequence < 1 ||
    value.turnSequence > 10_000_000 || typeof value.objective !== "string" ||
    value.objective.length > 4_096 || /\p{Cc}/u.test(value.objective) ||
    value.objective.trim() !== value.objective || !OUTCOMES.has(value.outcome) ||
    !Number.isSafeInteger(value.toolCalls) || value.toolCalls < 0 || value.toolCalls > 10_000 ||
    typeof value.producedArtifact !== "boolean"
  ) fail("The canonical LoopX Runtime request is invalid.");
  return value;
}

export function validateRuntimeV2LoopxScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    (value.gardenId !== null && !boundedText(value.gardenId, 256)) ||
    !boundedText(value.conversationId, 256)
  ) fail("The LoopX worker requires authenticated conversation scope.");
  return value;
}

export function validateRuntimeV2LoopxEnvironment(environment) {
  for (const name of [
    "BREADBOARD_LOOPX_ROOT",
    "BREADBOARD_LOOPX_PYTHON",
    "BREADBOARD_LOOPX_HOME",
  ]) {
    if (!boundedText(environment[name], 2_048) || !path.isAbsolute(environment[name])) {
      fail("The sealed LoopX runtime paths are unavailable.");
    }
  }
  if (environment.ENABLE_LOOPX !== undefined && environment.ENABLE_LOOPX !== "1") {
    fail("The sealed LoopX enablement is invalid.");
  }
}

function sourceLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "loopx", "runtime.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  for (const relativePath of [
    path.join("lib", "runtime-paths.ts"),
    path.join("lib", "loopx", "request.ts"),
    path.join("lib", "loopx", "state.ts"),
    path.join("lib", "loopx", "runtime.ts"),
    path.join("lib", "loopx", "governance.ts"),
    path.join("lib", "loopx", "snapshot.ts"),
  ]) {
    if (!fs.existsSync(path.join(sourceRoot, relativePath))) {
      fail("The staged LoopX worker source closure is unavailable.");
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

function boundedFailure(error) {
  const raw = error instanceof Error ? error.message : "LoopX failed.";
  const clean = raw.replace(/\p{Cc}+/gu, " ").trim() || "LoopX failed.";
  const bytes = Buffer.from(clean, "utf8");
  return (bytes.byteLength <= 32 * 1024 ? bytes : bytes.subarray(0, 32 * 1024))
    .toString("utf8").replace(/\uFFFD+$/u, "") || "LoopX failed.";
}

export async function executeRuntimeV2Loopx(launch, signal, progress) {
  validateRuntimeV2LoopxRequest(launch.request);
  validateRuntimeV2LoopxScope(launch.executionScope);
  validateRuntimeV2LoopxEnvironment(process.env);
  if (launch.request.conversationPublicId !== launch.executionScope.conversationId) {
    fail("The LoopX request escaped its authenticated conversation.");
  }
  const dataRoot = fs.realpathSync.native(path.resolve(launch.dataRoot));
  const loopxHome = path.resolve(process.env.BREADBOARD_LOOPX_HOME);
  fs.mkdirSync(loopxHome, { recursive: true });
  const canonicalHome = fs.realpathSync.native(loopxHome);
  if (!samePath(loopxHome, canonicalHome) || !pathWithin(dataRoot, canonicalHome)) {
    fail("The LoopX durable root escaped Breadboard's data root.");
  }
  const sourceRoot = sourceLayout(dataRoot);
  process.env.TMP = launch.workspacePath;
  process.env.TEMP = launch.workspacePath;
  await import(
    pathToFileURL(path.join(path.dirname(ENTRYPOINT), "learn-worker-import-hook.mjs")).href
  );
  const runtime = await import(
    pathToFileURL(path.join(sourceRoot, "lib", "loopx", "runtime.ts")).href
  );
  const governance = await import(
    pathToFileURL(path.join(sourceRoot, "lib", "loopx", "governance.ts")).href
  );
  const snapshot = await import(
    pathToFileURL(path.join(sourceRoot, "lib", "loopx", "snapshot.ts")).href
  );
  const requestModule = await import(
    pathToFileURL(path.join(sourceRoot, "lib", "loopx", "request.ts")).href
  );
  if (
    typeof runtime.runLoopx !== "function" || typeof runtime.loopxPaths !== "function" ||
    typeof runtime.loopxGoalExists !== "function" || typeof governance.deliveryFor !== "function" ||
    typeof snapshot.buildSnapshot !== "function" || typeof snapshot.writeSnapshot !== "function" ||
    typeof snapshot.readObjective !== "function" ||
    typeof requestModule.validateLoopxTickRuntimeRequest !== "function"
  ) fail("The staged LoopX executor is unavailable.");

  try {
    const request = requestModule.validateLoopxTickRuntimeRequest(launch.request);
    const started = Date.now();
    const hasGoal = runtime.loopxGoalExists(request.conversationPublicId);
    const paths = runtime.loopxPaths(request.conversationPublicId);
    progress.checkpoint({ stage: "preparing", percent: 5 });
    if (!hasGoal) {
      await runtime.runLoopx({
        conversationPublicId: request.conversationPublicId,
        command: [
          "bootstrap",
          "--project",
          paths.project,
          "--goal-id",
          paths.goalId,
          "--objective",
          request.objective || "Continue this work",
          "--no-onboarding-scan",
          "--no-global-sync",
        ],
        signal,
      });
    }
    progress.checkpoint({ stage: "recording", percent: 45 });
    const delivery = governance.deliveryFor(request);
    await runtime.runLoopx({
      conversationPublicId: request.conversationPublicId,
      command: [
        "refresh-state",
        "--goal-id",
        paths.goalId,
        "--project",
        paths.project,
        "--classification",
        delivery.classification,
        "--delivery-batch-scale",
        delivery.scale,
        "--delivery-outcome",
        delivery.outcome,
        "--no-global-sync",
        "--suppress-external-sinks",
      ],
      signal,
    });
    progress.checkpoint({ stage: "projecting", percent: 75 });
    const quota = await runtime.runLoopx({
      conversationPublicId: request.conversationPublicId,
      command: ["quota", "should-run", "--goal-id", paths.goalId],
      signal,
    });
    snapshot.writeSnapshot(
      request.conversationPublicId,
      snapshot.buildSnapshot({
        goalId: paths.goalId,
        objective: snapshot.readObjective(paths.stateFile),
        quota: quota.payload,
        capturedAt: new Date().toISOString(),
      }),
    );
    progress.checkpoint({ stage: "complete", percent: 100 });
    return {
      ok: true,
      operation: "tick",
      conversationPublicId: request.conversationPublicId,
      turnSequence: request.turnSequence,
      created: !hasGoal,
      goalId: paths.goalId,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    const candidate = error && typeof error === "object" && typeof error.code === "string"
      ? error.code.slice(0, 128)
      : "loopx_failed";
    return {
      ok: false,
      operation: "tick",
      errorCode: /^[a-z][a-z0-9_]{0,127}$/u.test(candidate) ? candidate : "loopx_failed",
      message: boundedFailure(error),
    };
  }
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-loopx-worker",
    validateRequest: validateRuntimeV2LoopxRequest,
    validateExecutionScope: validateRuntimeV2LoopxScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2Loopx,
  });
}
