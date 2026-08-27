import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 8 * 1_024;
const MAX_LIST_ITEMS = 128;
const MAX_LIST_ITEM_BYTES = 2_048;
const REQUIRED_CLONE_FILES = Object.freeze([
  "doctor.mjs",
  "modes",
  ".agents/skills/career-ops/SKILL.md",
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

export function validateRuntimeV2CareerOpsProbeRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "doctor"
  ) fail("The canonical Career Ops probe request is invalid.");
  return value;
}

export function validateRuntimeV2CareerOpsProbeScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) fail("The Career Ops probe requires authenticated user-global scope.");
  return value;
}

export function validateRuntimeV2CareerOpsProbeEnvironment(environment) {
  for (const name of ["CAREER_OPS_ROOT", "PLAYWRIGHT_BROWSERS_PATH"]) {
    if (
      !boundedText(environment[name], MAX_PATH_BYTES) ||
      !environment[name].trim() ||
      !path.isAbsolute(environment[name])
    ) fail("The sealed Career Ops probe paths are unavailable.");
  }
}

function applicationLayout(dataRoot) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const developmentSourceRoot = path.join(developmentDashboardRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = fs.existsSync(
    path.join(developmentSourceRoot, "lib", "career-ops", "runtime.ts"),
  );
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  directFile(
    path.join(sourceRoot, "lib", "career-ops", "runtime.ts"),
    sourceRoot,
    "The staged Career Ops probe source is unavailable.",
  );
  directFile(
    path.join(sourceRoot, "lib", "runtime-paths.ts"),
    sourceRoot,
    "The staged Career Ops Runtime path authority is unavailable.",
  );
  const canonicalDataRoot = directDirectory(
    dataRoot,
    dataRoot,
    "The Career Ops Runtime data root is indirect.",
  );
  const configuredSource = directDirectory(
    process.env.CAREER_OPS_ROOT,
    appRoot,
    "The staged Career Ops clone is unavailable.",
  );
  const expectedSource = path.join(appRoot, "career-ops");
  if (!samePath(configuredSource, expectedSource)) {
    fail("The Career Ops source root is outside the sealed application closure.");
  }
  for (const relativePath of REQUIRED_CLONE_FILES) {
    const candidate = path.join(configuredSource, ...relativePath.split("/"));
    if (relativePath === "modes") {
      directDirectory(candidate, configuredSource, "The staged Career Ops clone is incomplete.");
    } else {
      directFile(candidate, configuredSource, "The staged Career Ops clone is incomplete.");
    }
  }
  const expectedBrowserRoot = path.join(
    canonicalDataRoot,
    "runtime-v2",
    "toolchains",
    "career-ops-browsers",
  );
  if (!samePath(process.env.PLAYWRIGHT_BROWSERS_PATH, expectedBrowserRoot)) {
    fail("The Career Ops browser probe path is outside Runtime data.");
  }
  if (fs.existsSync(expectedBrowserRoot)) {
    directDirectory(
      expectedBrowserRoot,
      canonicalDataRoot,
      "The Career Ops browser probe path is indirect.",
    );
  }
  const managedRoot = path.join(
    canonicalDataRoot,
    "runtime-v2",
    "toolchains",
    "career-ops",
  );
  if (fs.existsSync(managedRoot)) {
    const canonicalManaged = directDirectory(
      managedRoot,
      canonicalDataRoot,
      "The managed Career Ops runtime is indirect.",
    );
    for (const relativePath of REQUIRED_CLONE_FILES) {
      const candidate = path.join(canonicalManaged, ...relativePath.split("/"));
      if (relativePath === "modes") {
        directDirectory(candidate, canonicalManaged, "The managed Career Ops runtime is incomplete.");
      } else {
        directFile(candidate, canonicalManaged, "The managed Career Ops runtime is incomplete.");
      }
    }
  }

  const historicalDevelopmentData = development && samePath(canonicalDataRoot, appRoot);
  process.env.BREADBOARD_DATA_DIR = historicalDevelopmentData ? "" : canonicalDataRoot;
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = development ? dashboardRoot : "";
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.CAREER_OPS_ROOT = configuredSource;
  process.env.PLAYWRIGHT_BROWSERS_PATH = expectedBrowserRoot;
  process.env.NODE_ENV = development ? "development" : "production";
  for (const name of [
    "CHATMOCK_API_KEY",
    "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
    "BREADBOARD_HERMES_SESSION_TOKEN",
    "BREADBOARD_HERMES_TOOL_SECRET",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
  ]) delete process.env[name];
  process.chdir(dashboardRoot);
  return { sourceRoot };
}

function preparePrivateProcessEnvironment(workspacePath, dataRoot) {
  const workspace = directDirectory(
    workspacePath,
    dataRoot,
    "The private Career Ops probe workspace is indirect.",
  );
  const privateRoot = path.join(workspace, "career-ops-probe-process");
  const home = path.join(privateRoot, "home");
  const temporary = path.join(privateRoot, "tmp");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  process.env.HOME = directDirectory(
    home,
    workspace,
    "The private Career Ops probe home is indirect.",
  );
  process.env.USERPROFILE = process.env.HOME;
  process.env.TMP = directDirectory(
    temporary,
    workspace,
    "The private Career Ops probe temporary directory is indirect.",
  );
  process.env.TEMP = process.env.TMP;
  process.env.TMPDIR = process.env.TMP;
}

function boundedList(value) {
  return Array.isArray(value) &&
    value.length <= MAX_LIST_ITEMS &&
    value.every((item) => boundedText(item, MAX_LIST_ITEM_BYTES));
}

function canonicalHealth(value) {
  if (
    !exactRecord(value, [
      "available",
      "cloned",
      "root",
      "dependenciesInstalled",
      "browsersInstalled",
      "onboarding",
      "modeCount",
      "trackedApplications",
      "reason",
    ]) ||
    typeof value.available !== "boolean" ||
    typeof value.cloned !== "boolean" ||
    !(value.root === null || (
      boundedText(value.root, MAX_PATH_BYTES) && path.isAbsolute(value.root)
    )) ||
    typeof value.dependenciesInstalled !== "boolean" ||
    typeof value.browsersInstalled !== "boolean" ||
    !Number.isSafeInteger(value.modeCount) ||
    value.modeCount < 0 ||
    value.modeCount > 10_000 ||
    !(value.trackedApplications === null || (
      Number.isSafeInteger(value.trackedApplications) &&
      value.trackedApplications >= 0 &&
      value.trackedApplications <= 100_000_000
    )) ||
    !(value.reason === null || boundedText(value.reason, MAX_REASON_BYTES)) ||
    value.cloned !== (value.root !== null) ||
    (value.available && (!value.cloned || !value.dependenciesInstalled))
  ) fail("The Career Ops probe produced invalid health metadata.");
  if (value.onboarding !== null && (
    !exactRecord(value.onboarding, ["onboardingNeeded", "missing", "warnings", "autoCopied"]) ||
    typeof value.onboarding.onboardingNeeded !== "boolean" ||
    !boundedList(value.onboarding.missing) ||
    !boundedList(value.onboarding.warnings) ||
    !boundedList(value.onboarding.autoCopied)
  )) fail("The Career Ops probe produced invalid onboarding metadata.");
  if (value.available !== (value.onboarding !== null)) {
    fail("The Career Ops probe produced inconsistent doctor metadata.");
  }
  return value;
}

export async function executeRuntimeV2CareerOpsProbe(launch, signal, progress) {
  validateRuntimeV2CareerOpsProbeRequest(launch.request);
  validateRuntimeV2CareerOpsProbeScope(launch.executionScope);
  validateRuntimeV2CareerOpsProbeEnvironment(process.env);
  progress.checkpoint({ stage: "preparing", percent: 10 });
  const { sourceRoot } = applicationLayout(launch.dataRoot);
  preparePrivateProcessEnvironment(launch.workspacePath, launch.dataRoot);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const runtime = await import(pathToFileURL(
    path.join(sourceRoot, "lib", "career-ops", "runtime.ts"),
  ).href);
  if (typeof runtime.probeCareerOpsHealth !== "function") {
    fail("The staged Career Ops probe entrypoint is unavailable.");
  }
  progress.checkpoint({ stage: "probing", percent: 35 });
  const health = canonicalHealth(await runtime.probeCareerOpsHealth({ signal }));
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  progress.checkpoint({ stage: "complete", percent: 100 });
  return health;
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-career-ops-probe-worker",
    validateRequest: validateRuntimeV2CareerOpsProbeRequest,
    validateExecutionScope: validateRuntimeV2CareerOpsProbeScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2CareerOpsProbe,
  });
}
