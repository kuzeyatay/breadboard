import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const RECALL_CLI_PACKAGE = "screenpipe";
export const RECALL_CLI_VERSION = "0.4.37";
export const RECALL_INSTALL_TIMEOUT_MS = 30 * 60_000;
export const RECALL_STATUS_HEARTBEAT_MS = 5_000;

const MAX_STATUS_BYTES = 8 * 1024;
const MAX_INSTALL_LOG_BYTES = 8 * 1024;
const PLATFORM_PACKAGES = new Map([
  ["darwin-arm64", "@screenpipe/cli-darwin-arm64"],
  ["darwin-x64", "@screenpipe/cli-darwin-x64"],
  ["linux-x64", "@screenpipe/cli-linux-x64"],
  ["win32-x64", "@screenpipe/cli-win32-x64"],
]);

function fail(message) {
  throw new Error(message);
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function requireDirectDirectory(directory, label) {
  if (!fs.existsSync(directory)) return;
  const metadata = fs.lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${label} must be a direct directory.`);
  }
}

function inheritedInstallEnvironment(env) {
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "ComSpec",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "ProgramW6432",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  const result = {};
  for (const name of allowed) {
    if (typeof env[name] === "string" && env[name]) result[name] = env[name];
  }
  result.NO_COLOR = "1";
  result.npm_config_yes = "true";
  return result;
}

export function recallPlatformPackage(
  platform = process.platform,
  arch = process.arch,
) {
  return PLATFORM_PACKAGES.get(`${platform}-${arch}`) ?? null;
}

export function buildRecallInstallPlan({
  dataRoot,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
}) {
  if (typeof dataRoot !== "string" || !path.isAbsolute(dataRoot)) {
    fail("The Recall install data root is invalid.");
  }
  const platformPackage = recallPlatformPackage(platform, arch);
  if (!platformPackage) fail("Recall is not supported on this platform.");
  const home = path.resolve(dataRoot, "recall");
  const cliRoot = path.join(home, "cli");
  const statusPath = path.join(home, "install-status.json");
  const binaryPath = path.join(
    cliRoot,
    "node_modules",
    ...platformPackage.split("/"),
    "bin",
    `screenpipe${platform === "win32" ? ".exe" : ""}`,
  );
  const versionPath = path.join(
    cliRoot,
    "node_modules",
    RECALL_CLI_PACKAGE,
    "package.json",
  );
  for (const candidate of [
    home,
    cliRoot,
    statusPath,
    binaryPath,
    versionPath,
  ]) {
    if (!pathWithin(dataRoot, candidate))
      fail("The Recall install path escaped the data root.");
  }
  return {
    home,
    cliRoot,
    statusPath,
    binaryPath,
    versionPath,
    command: platform === "win32" ? "npm.cmd" : "npm",
    args: [
      "install",
      `${RECALL_CLI_PACKAGE}@${RECALL_CLI_VERSION}`,
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ],
    shell: platform === "win32",
    env: inheritedInstallEnvironment(env),
  };
}

export function writeRecallInstallStatus(statusPath, value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !new Set(["installing", "installed", "error", "interrupted"]).has(
      value.phase,
    ) ||
    typeof value.message !== "string" ||
    !value.message ||
    Buffer.byteLength(value.message, "utf8") > 1_024 ||
    typeof value.startedAt !== "string"
  ) {
    fail("The Recall install status is invalid.");
  }
  const bytes = Buffer.from(
    `${JSON.stringify({
      phase: value.phase,
      message: value.message,
      startedAt: value.startedAt,
      updatedAt: new Date().toISOString(),
      pid: process.pid,
    })}\n`,
    "utf8",
  );
  if (bytes.byteLength > MAX_STATUS_BYTES)
    fail("The Recall install status exceeded its bound.");
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const temporary = `${statusPath}.worker-${process.pid}.pending`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: "w", mode: 0o600 });
    fs.renameSync(temporary, statusPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function installedVersion(plan) {
  try {
    const metadata = fs.lstatSync(plan.binaryPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const manifestMetadata = fs.lstatSync(plan.versionPath);
    if (
      !manifestMetadata.isFile() ||
      manifestMetadata.isSymbolicLink() ||
      manifestMetadata.size < 2 ||
      manifestMetadata.size > 128 * 1024
    )
      return null;
    const value = JSON.parse(fs.readFileSync(plan.versionPath, "utf8"));
    return typeof value?.version === "string" ? value.version : null;
  } catch {
    return null;
  }
}

function ensureInstallRoot(plan) {
  requireDirectDirectory(plan.home, "The Recall home");
  fs.mkdirSync(plan.home, { recursive: true });
  requireDirectDirectory(plan.cliRoot, "The Recall CLI root");
  fs.mkdirSync(plan.cliRoot, { recursive: true });
  const manifestPath = path.join(plan.cliRoot, "package.json");
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          name: "breadboard-recall-cli",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } else {
    const metadata = fs.lstatSync(manifestPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > 128 * 1024
    ) {
      fail("The Recall CLI manifest is invalid.");
    }
  }
}

function runNpm(plan, signal, timeoutMs, spawnImpl) {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let logTail = "";
    const child = spawnImpl(plan.command, plan.args, {
      cwd: plan.cliRoot,
      detached: false,
      windowsHide: true,
      windowsVerbatimArguments: false,
      shell: plan.shell,
      stdio: ["ignore", "pipe", "pipe"],
      env: plan.env,
    });
    const collect = (chunk) => {
      logTail = `${logTail}${String(chunk)}`.slice(-MAX_INSTALL_LOG_BYTES);
    };
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", collect);
    child.stderr?.on?.("data", collect);
    const terminate = () => {
      try {
        child.kill();
      } catch {
        /* Runtime owns the complete tree. */
      }
    };
    const abort = () => terminate();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref?.();
    const done = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      } else if (timedOut) {
        reject(new DOMException("Recall install timed out", "TimeoutError"));
      } else if (error) {
        reject(error);
      } else {
        resolve({ code, logTail });
      }
    };
    child.once("error", (error) => done(error, null));
    child.once("close", (code) => done(null, code));
  });
}

export async function executeRecallInstall({
  dataRoot,
  signal,
  onStatus = () => undefined,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  timeoutMs = RECALL_INSTALL_TIMEOUT_MS,
  spawnImpl = spawn,
}) {
  const plan = buildRecallInstallPlan({ dataRoot, platform, arch, env });
  ensureInstallRoot(plan);
  const startedAt = new Date().toISOString();
  const publish = (phase, message) => {
    const status = { phase, message, startedAt };
    writeRecallInstallStatus(plan.statusPath, status);
    onStatus(status);
  };
  if (installedVersion(plan) === RECALL_CLI_VERSION) {
    publish("installed", `Capture engine ${RECALL_CLI_VERSION} installed.`);
    return { installed: true, version: RECALL_CLI_VERSION, changed: false };
  }
  const progressMessage = `Downloading the capture engine (${RECALL_CLI_PACKAGE}@${RECALL_CLI_VERSION})…`;
  publish("installing", progressMessage);
  const heartbeat = setInterval(
    () => publish("installing", progressMessage),
    RECALL_STATUS_HEARTBEAT_MS,
  );
  heartbeat.unref?.();
  try {
    const result = await runNpm(plan, signal, timeoutMs, spawnImpl);
    if (result.logTail)
      process.stderr.write(result.logTail.slice(-MAX_INSTALL_LOG_BYTES));
    if (result.code !== 0 || installedVersion(plan) !== RECALL_CLI_VERSION) {
      fail("The pinned Recall package did not install successfully.");
    }
    publish("installed", `Capture engine ${RECALL_CLI_VERSION} installed.`);
    return { installed: true, version: RECALL_CLI_VERSION, changed: true };
  } catch (error) {
    if (signal.aborted) {
      publish("interrupted", "The capture engine install was interrupted.");
      throw error;
    }
    publish(
      "error",
      "Install failed. Check your network connection and try again.",
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
