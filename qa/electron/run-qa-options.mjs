import fs from "node:fs";
import path from "node:path";

export const PACKAGED_PARITY_PROJECT = "packaged-parity";
export const HOT_GBRAIN_PROJECT = "gbrain-hot";
export const PACKAGED_PARITY_ENVIRONMENT = Object.freeze({
  executablePath: "BREADBOARD_QA_PACKAGED_EXE",
  packageReceiptPath: "BREADBOARD_QA_PARITY_PACKAGE_RECEIPT_PATH",
  runId: "BREADBOARD_QA_PARITY_RUN_ID",
});

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const PARITY_ARGUMENTS = Object.freeze({
  "--packaged-executable": "executablePath",
  "--parity-package-receipt": "packageReceiptPath",
  "--parity-run-id": "runId",
});
const PARITY_ENVIRONMENT_KEYS = Object.freeze(Object.values(PACKAGED_PARITY_ENVIRONMENT));

/**
 * Parse the small wrapper surface separately from Playwright's CLI. Packaged
 * parity is deliberately stricter than an ordinary QA run: its three authority
 * values must arrive through this process's CLI, never through ambient state.
 */
export function parseQaRunnerOptions({ argv, baseEnv = process.env, repoRoot }) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    throw new TypeError("QA runner argv must be an array of strings");
  }
  const resolvedRepoRoot = resolveDirectory(repoRoot, "Breadboard repository root");
  const forwarded = [];
  const env = { ...baseEnv };
  const parityValues = new Map();
  let skipDesktopBuild = false;
  let hotDashboardSelected = false;
  let dashboardMode = environmentValue(baseEnv, "BREADBOARD_QA_DASHBOARD_MODE") === "hot"
    ? "hot"
    : "standalone";

  for (const argument of argv) {
    if (argument === "--headed") {
      env.BREADBOARD_QA_HEADED = "1";
    } else if (argument === "--trace") {
      env.BREADBOARD_QA_TRACE = "1";
    } else if (argument === "--no-trace") {
      env.BREADBOARD_QA_NO_TRACE = "1";
    } else if (argument === "--preserve-runtime") {
      env.BREADBOARD_QA_PRESERVE_RUNTIME = "1";
    } else if (argument === "--skip-desktop-build") {
      skipDesktopBuild = true;
    } else if (argument === "--hot-dashboard") {
      hotDashboardSelected = true;
      dashboardMode = "hot";
    } else {
      const parityArgument = parseParityArgument(argument);
      if (parityArgument) {
        if (parityValues.has(parityArgument.name)) {
          throw new Error(`Packaged parity argument ${parityArgument.flag} may be supplied only once`);
        }
        parityValues.set(parityArgument.name, parityArgument.value);
      } else {
        forwarded.push(argument);
      }
    }
  }

  const projects = selectedProjects(forwarded);
  if (projects.includes(HOT_GBRAIN_PROJECT) && !hotDashboardSelected) {
    throw new Error(
      `The ${HOT_GBRAIN_PROJECT} project requires an explicit --hot-dashboard before any build or launch`,
    );
  }
  const packagedParitySelected = projects.includes(PACKAGED_PARITY_PROJECT);
  if (packagedParitySelected || parityValues.size > 0) {
    configurePackagedParity({
      env,
      baseEnv,
      forwarded,
      projects,
      parityValues,
      repoRoot: resolvedRepoRoot,
      skipDesktopBuild,
      dashboardMode,
    });
  }

  env.BREADBOARD_QA_DASHBOARD_MODE = dashboardMode;
  return Object.freeze({
    forwarded: Object.freeze([...forwarded]),
    env: Object.freeze(env),
    skipDesktopBuild,
    dashboardMode,
    packagedParity: packagedParitySelected,
  });
}

/**
 * Consumer-side validation for the future packaged-parity fixture. Keeping it
 * here guarantees the Playwright worker rechecks the same path/run contracts
 * that the CLI used, without creating an evidence producer prematurely.
 */
export function readPackagedParityHandoff({ env = process.env, repoRoot }) {
  const resolvedRepoRoot = resolveDirectory(repoRoot, "Breadboard repository root");
  assertNoUnknownParityEnvironment(env);
  const executablePath = validateParityExecutable(
    requiredEnvironmentValue(env, PACKAGED_PARITY_ENVIRONMENT.executablePath),
  );
  const packageReceiptPath = validateReceiptPath(
    requiredEnvironmentValue(env, PACKAGED_PARITY_ENVIRONMENT.packageReceiptPath),
    resolvedRepoRoot,
  );
  const runId = validateRunId(
    requiredEnvironmentValue(env, PACKAGED_PARITY_ENVIRONMENT.runId),
  );
  return Object.freeze({ executablePath, packageReceiptPath, runId });
}

function configurePackagedParity({
  env,
  baseEnv,
  forwarded,
  projects,
  parityValues,
  repoRoot,
  skipDesktopBuild,
  dashboardMode,
}) {
  if (projects.length !== 1 || projects[0] !== PACKAGED_PARITY_PROJECT) {
    throw new Error(
      `Packaged parity authority arguments require exactly --project=${PACKAGED_PARITY_PROJECT}`,
    );
  }
  if (forwarded.length !== 1 || forwarded[0] !== `--project=${PACKAGED_PARITY_PROJECT}`) {
    throw new Error(
      "Packaged parity rejects Playwright selectors and CLI overrides; run its complete dedicated project",
    );
  }
  if (!skipDesktopBuild) {
    throw new Error("Packaged parity requires --skip-desktop-build and never rebuilds its sealed package");
  }
  if (dashboardMode !== "standalone") {
    throw new Error("Packaged parity rejects --hot-dashboard and ambient hot-dashboard mode");
  }
  assertNoUnknownParityEnvironment(baseEnv);
  for (const key of PARITY_ENVIRONMENT_KEYS) {
    if (environmentValue(baseEnv, key)?.trim()) {
      throw new Error(
        `Packaged parity rejects ambient ${key}; supply every package authority value through the dedicated CLI`,
      );
    }
  }
  for (const [flag, name] of Object.entries(PARITY_ARGUMENTS)) {
    if (!parityValues.has(name)) {
      throw new Error(`Packaged parity requires ${flag}=<value>`);
    }
  }

  const executablePath = validateParityExecutable(parityValues.get("executablePath"));
  const packageReceiptPath = validateReceiptPath(
    parityValues.get("packageReceiptPath"),
    repoRoot,
  );
  const runId = validateRunId(parityValues.get("runId"));
  for (const key of Object.keys(env)) {
    if (PARITY_ENVIRONMENT_KEYS.some((candidate) => candidate.toUpperCase() === key.toUpperCase())) {
      delete env[key];
    }
  }
  env[PACKAGED_PARITY_ENVIRONMENT.executablePath] = executablePath;
  env[PACKAGED_PARITY_ENVIRONMENT.packageReceiptPath] = packageReceiptPath;
  env[PACKAGED_PARITY_ENVIRONMENT.runId] = runId;
}

function parseParityArgument(argument) {
  for (const [flag, name] of Object.entries(PARITY_ARGUMENTS)) {
    if (argument === flag) {
      throw new Error(`${flag} requires the strict ${flag}=<value> form`);
    }
    const prefix = `${flag}=`;
    if (argument.startsWith(prefix)) {
      const value = argument.slice(prefix.length);
      if (value.length === 0) throw new Error(`${flag} cannot be empty`);
      return { flag, name, value };
    }
  }
  return null;
}

function selectedProjects(arguments_) {
  const projects = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument.startsWith("--project=")) {
      projects.push(argument.slice("--project=".length));
    } else if (argument === "--project") {
      const value = arguments_[index + 1];
      if (typeof value === "string") projects.push(value);
      index += 1;
    }
  }
  return projects;
}

function validateParityExecutable(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("--packaged-executable must be an absolute path to packaged Breadboard.exe");
  }
  const resolved = path.resolve(value);
  const realPath = resolveRegularFile(resolved, "--packaged-executable");
  if (path.basename(realPath).toLowerCase() !== "breadboard.exe") {
    throw new Error("--packaged-executable must identify Breadboard.exe");
  }
  if (path.basename(path.dirname(realPath)).toLowerCase() !== "win-unpacked") {
    throw new Error("--packaged-executable must be the direct child of win-unpacked");
  }
  if (!samePath(resolved, realPath)) {
    throw new Error("--packaged-executable may not traverse a symbolic link or junction");
  }
  return realPath;
}

function validateReceiptPath(value, repoRoot) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("--parity-package-receipt cannot be empty");
  }
  if (value.includes("\\") || value.includes("\0") || value.includes("#") || path.isAbsolute(value)) {
    throw new Error("--parity-package-receipt must be a canonical forward-slash repo-relative path");
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    path.posix.normalize(value) !== value
  ) {
    throw new Error("--parity-package-receipt must be a canonical forward-slash repo-relative path");
  }
  if (!value.startsWith(".qa-results/") && !value.startsWith("qa/runtime-v2/evidence/")) {
    throw new Error(
      "--parity-package-receipt must live under .qa-results/ or qa/runtime-v2/evidence/",
    );
  }
  const absolutePath = path.resolve(repoRoot, ...segments);
  const realPath = resolveRegularFile(absolutePath, "--parity-package-receipt");
  const realRepoRoot = fs.realpathSync.native(repoRoot);
  if (!samePath(absolutePath, realPath)) {
    throw new Error("--parity-package-receipt may not traverse a symbolic link or junction");
  }
  if (!isPathInside(realRepoRoot, realPath)) {
    throw new Error("--parity-package-receipt resolves outside the Breadboard repository");
  }
  return value;
}

function validateRunId(value) {
  if (
    typeof value !== "string" ||
    !RUN_ID_PATTERN.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(
      "--parity-run-id must contain 1-96 letters, digits, dots, dashes, or underscores",
    );
  }
  return value;
}

function resolveDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  const resolved = path.resolve(value);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    throw new Error(`${label} does not exist: ${resolved}`, { cause: error });
  }
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${resolved}`);
  return resolved;
}

function resolveRegularFile(value, label) {
  try {
    const stat = fs.statSync(value);
    if (!stat.isFile()) throw new Error("not a regular file");
    return fs.realpathSync.native(value);
  } catch (error) {
    throw new Error(`${label} must name an existing regular file: ${value}`, { cause: error });
  }
}

function environmentValue(environment, name) {
  const match = Object.entries(environment).find(
    ([key]) => key.toUpperCase() === name.toUpperCase(),
  );
  return match?.[1];
}

function requiredEnvironmentValue(environment, name) {
  const matches = Object.entries(environment).filter(
    ([key, value]) => key.toUpperCase() === name.toUpperCase() && value !== undefined,
  );
  if (matches.length !== 1) {
    throw new Error(`Packaged parity requires exactly one non-empty ${name}`);
  }
  const value = matches[0][1];
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`Packaged parity requires exactly one non-empty ${name}`);
  }
  return value;
}

function assertNoUnknownParityEnvironment(environment) {
  const allowed = new Set(PARITY_ENVIRONMENT_KEYS.map((key) => key.toUpperCase()));
  const unknown = Object.keys(environment).find((key) => {
    const normalized = key.toUpperCase();
    return normalized.startsWith("BREADBOARD_QA_PARITY_") && !allowed.has(normalized);
  });
  if (unknown) throw new Error(`Packaged parity rejects unknown authority environment key ${unknown}`);
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const normalize = (value) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}
