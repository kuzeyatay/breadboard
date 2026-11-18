import { runtimePathWithin as pathWithin } from "./runtime-v2-paths.mjs";
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
  execPath = process.execPath,
}) {
  if (typeof dataRoot !== "string" || !path.isAbsolute(dataRoot)) {
    fail("The Recall install data root is invalid.");
  }
  const platformPackage = recallPlatformPackage(platform, arch);
  if (!platformPackage) fail("Recall is not supported on this platform.");
  const npmCli = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const bundledNpmCli = fs.existsSync(npmCli) ? npmCli : null;
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
    // Node ships npm beside its executable, both on development hosts and in
    // the installed app's bundled runtime. Running npm-cli.js through the
    // current Node needs no PATH lookup, which the runtime scrubs for workers.
    command: bundledNpmCli ? execPath : platform === "win32" ? "npm.cmd" : "npm",
    args: [
      ...(bundledNpmCli ? [bundledNpmCli] : []),
      "install",
      `${RECALL_CLI_PACKAGE}@${RECALL_CLI_VERSION}`,
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ],
    shell: !bundledNpmCli && platform === "win32",
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

const RECOVERY_HEADROOM_BYTES = 2 * 1024 ** 3;
const IO_FAULT_CODES = new Set([10, 13]);

function quarantineCode(marker) {
  try {
    const code = JSON.parse(fs.readFileSync(marker, "utf8")).sqlite_code;
    return Number.isInteger(code) ? code & 0xff : null;
  } catch {
    return null;
  }
}

/** Read-only PRAGMA quick_check; any failure (or a missing driver) is "not proven intact". */
export async function databaseIntact(file) {
  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("PRAGMA quick_check").all();
    return rows.length === 1 && Object.values(rows[0])[0] === "ok";
  } catch {
    return false;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

export function recallQuarantineMarker(home) {
  return path.join(home, "data", "db.sqlite.quarantine.json");
}

/**
 * After a hard SQLite fault (a full disk is the usual one) the engine marks its
 * database quarantined and exits on every start until `db recover` has run.
 * That command repairs and verifies a working copy, then swaps it in; the
 * faulted original stays beside it. Returns the sentence Settings shows.
 */
async function recoverQuarantinedDatabase(plan, signal, timeoutMs, spawnImpl) {
  const marker = recallQuarantineMarker(plan.home);
  const dataDir = path.dirname(marker);
  const size =
    fs.statSync(path.join(dataDir, "db.sqlite"), { throwIfNoEntry: false })
      ?.size ?? 0;
  const volume = fs.statfsSync(dataDir);
  // The repair holds the original and a rebuilt copy at once. Starting it on a
  // nearly full disk would repeat the fault that caused the quarantine.
  const free = volume.bavail * volume.bsize;
  if (free < RECOVERY_HEADROOM_BYTES) {
    return "Recall's history needs a repair, and the disk is too full to do it safely.";
  }
  // A full disk (SQLITE_FULL 13) or failed write (SQLITE_IOERR 10) is not
  // corruption: SQLite rolled the write back. Upstream stopped quarantining
  // these (screenpipe #6967); the pinned engine still does, and its
  // `db recover` fails on Windows (sync of a read-only handle). So a database
  // that passes quick_check is released by archiving the marker.
  if (IO_FAULT_CODES.has(quarantineCode(marker)) && (await databaseIntact(path.join(dataDir, "db.sqlite")))) {
    fs.renameSync(marker, path.join(dataDir, `db.sqlite.quarantine.resolved-${Date.now()}.json`));
    return "Recall's history was checked and is intact.";
  }
  if (free < 2 * size + RECOVERY_HEADROOM_BYTES) {
    return "Recall's history needs a repair, and the disk is too full to do it safely.";
  }
  const result = await runNpm(
    {
      ...plan,
      command: plan.binaryPath,
      args: ["db", "recover"],
      shell: false,
      env: {
        ...plan.env,
        SCREENPIPE_DATA_DIR: dataDir,
        SCREENPIPE_DISABLE_TELEMETRY: "1",
      },
    },
    signal,
    timeoutMs,
    spawnImpl,
  );
  if (result.logTail)
    process.stderr.write(result.logTail.slice(-MAX_INSTALL_LOG_BYTES));
  if (result.code === 0 && !fs.existsSync(marker))
    return "Recall's history was repaired.";
  // A failed repair leaves its working copy, as large as the database, and
  // the next attempt makes another. Only that scratch folder is removed.
  for (const name of fs.readdirSync(dataDir)) {
    if (/^db-recovery-\d{8}-\d{6}-\d+$/u.test(name))
      fs.rmSync(path.join(dataDir, name), { recursive: true, force: true });
  }
  return "Recall's history could not be repaired. Breadboard will try again later.";
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
  // The status file is a heartbeat: Settings reads a quiet one as a dead job.
  let heartbeat;
  const working = (message) => {
    clearInterval(heartbeat);
    publish("installing", message);
    heartbeat = setInterval(
      () => publish("installing", message),
      RECALL_STATUS_HEARTBEAT_MS,
    );
    heartbeat.unref?.();
  };
  try {
    const changed = installedVersion(plan) !== RECALL_CLI_VERSION;
    if (changed) {
      working(
        `Downloading the capture engine (${RECALL_CLI_PACKAGE}@${RECALL_CLI_VERSION})…`,
      );
      const result = await runNpm(plan, signal, timeoutMs, spawnImpl);
      if (result.logTail)
        process.stderr.write(result.logTail.slice(-MAX_INSTALL_LOG_BYTES));
      if (result.code !== 0 || installedVersion(plan) !== RECALL_CLI_VERSION) {
        fail("The pinned Recall package did not install successfully.");
      }
    }
    let repair = null;
    if (fs.existsSync(recallQuarantineMarker(plan.home))) {
      working("Repairing Recall's history…");
      repair = await recoverQuarantinedDatabase(
        plan,
        signal,
        timeoutMs,
        spawnImpl,
      );
    }
    clearInterval(heartbeat);
    publish(
      "installed",
      repair ?? `Capture engine ${RECALL_CLI_VERSION} installed.`,
    );
    return { installed: true, version: RECALL_CLI_VERSION, changed };
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
