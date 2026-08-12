// Installing the Recall capture engine.
//
// The engine is a ~130 MB prebuilt native binary published on npm. Installing
// it is a long, network-bound job that must survive the request that started
// it, so the installer runs detached and reports through a heartbeat file:
// phase, message, and a pid, so the settings tab can tell "still downloading"
// from "died twenty minutes ago" instead of showing a spinner forever.

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import {
  getRecallConfig,
  recallCliRoot,
  recallInstallStatusPath,
  type RecallConfig,
} from "./config.ts";
import { RecallError } from "./errors.ts";

/** Native binary package per platform, mirroring the CLI's own map. */
const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@screenpipe/cli-darwin-arm64",
  "darwin-x64": "@screenpipe/cli-darwin-x64",
  "linux-x64": "@screenpipe/cli-linux-x64",
  "win32-x64": "@screenpipe/cli-win32-x64",
};

export function platformPackage(
  platform: string = process.platform,
  arch: string = process.arch,
): string | null {
  return PLATFORM_PACKAGES[`${platform}-${arch}`] ?? null;
}

export interface RecallInstallState {
  installed: boolean;
  /** Version actually on disk, which may lag the pinned one after a bump. */
  version: string | null;
  /** The version this build of Breadboard installs. */
  pinnedVersion: string;
  /** Absolute path of the native binary, when it is present. */
  binaryPath: string | null;
  /** False on a platform screenpipe publishes no binary for. */
  supported: boolean;
}

export type RecallInstallPhase =
  | "idle"
  | "installing"
  | "installed"
  | "error"
  | "interrupted";

export interface RecallInstallStatus {
  phase: RecallInstallPhase;
  message: string;
  updatedAt: string;
  startedAt: string | null;
  /** An in-progress phase whose writer stopped reporting: the install died. */
  stalled: boolean;
}

/** Phases that are an outcome, where a still `updatedAt` is expected. */
const SETTLED_PHASES: ReadonlySet<string> = new Set([
  "idle",
  "installed",
  "error",
  "interrupted",
]);

/** Generous next to the installer's 5s heartbeat, so a slow disk never lies. */
export const INSTALL_HEARTBEAT_GRACE_MS = 60_000;

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}

/**
 * Turn the raw heartbeat file into an honest status. A phase that claims to be
 * running while its writer is gone, or has not been touched within the grace
 * window, is reported as stalled rather than in progress.
 */
export function parseInstallStatus(
  raw: string,
  options: { now?: number; isAlive?: (pid: number) => boolean } = {},
): RecallInstallStatus | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed.phase !== "string" ||
    typeof parsed.message !== "string" ||
    typeof parsed.updatedAt !== "string"
  ) {
    return null;
  }
  const now = options.now ?? Date.now();
  const isAlive = options.isAlive ?? processAlive;
  const updatedAtMs = Date.parse(parsed.updatedAt);
  const pid =
    typeof parsed.pid === "number" && Number.isFinite(parsed.pid) ? parsed.pid : null;
  const writerGone = pid !== null && pid > 0 ? !isAlive(pid) : false;
  const overdue =
    Number.isFinite(updatedAtMs) && now - updatedAtMs > INSTALL_HEARTBEAT_GRACE_MS;

  return {
    phase: parsed.phase as RecallInstallPhase,
    message: parsed.message,
    updatedAt: parsed.updatedAt,
    startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
    stalled: !SETTLED_PHASES.has(parsed.phase) && (writerGone || overdue),
  };
}

export function readInstallStatus(
  config: RecallConfig = getRecallConfig(),
): RecallInstallStatus | null {
  try {
    return parseInstallStatus(fs.readFileSync(recallInstallStatusPath(config), "utf8"));
  } catch {
    return null;
  }
}

function writeInstallStatus(
  config: RecallConfig,
  status: { phase: RecallInstallPhase; message: string; startedAt?: string; pid?: number },
): void {
  try {
    fs.mkdirSync(config.home, { recursive: true });
    fs.writeFileSync(
      recallInstallStatusPath(config),
      `${JSON.stringify({
        ...status,
        updatedAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
  } catch {
    // A status file we cannot write only costs progress reporting; never let it
    // take down the install itself.
  }
}

/** Absolute path of the installed native binary, or null when it is absent. */
export function resolveBinaryPath(config: RecallConfig = getRecallConfig()): string | null {
  const pkg = platformPackage();
  if (!pkg) return null;
  const ext = process.platform === "win32" ? ".exe" : "";
  const binary = path.join(
    recallCliRoot(config),
    "node_modules",
    ...pkg.split("/"),
    "bin",
    `screenpipe${ext}`,
  );
  return fs.existsSync(binary) ? binary : null;
}

function installedVersion(config: RecallConfig): string | null {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(recallCliRoot(config), "node_modules", "screenpipe", "package.json"),
        "utf8",
      ),
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

export function installState(config: RecallConfig = getRecallConfig()): RecallInstallState {
  const binaryPath = resolveBinaryPath(config);
  return {
    installed: binaryPath !== null,
    version: installedVersion(config),
    pinnedVersion: config.cliVersion,
    binaryPath,
    supported: platformPackage() !== null,
  };
}

/**
 * Kick off the install and return immediately. Progress is the heartbeat file;
 * the caller polls status rather than holding a request open for minutes.
 */
export function startInstall(config: RecallConfig = getRecallConfig()): void {
  if (!config.enabled) throw new RecallError("feature_disabled");
  if (!platformPackage()) throw new RecallError("unsupported_platform");

  const current = readInstallStatus(config);
  if (current && current.phase === "installing" && !current.stalled) {
    throw new RecallError("install_in_progress");
  }

  const root = recallCliRoot(config);
  try {
    fs.mkdirSync(root, { recursive: true });
    // npm refuses to install into a directory with no manifest of its own.
    const manifest = path.join(root, "package.json");
    if (!fs.existsSync(manifest)) {
      fs.writeFileSync(
        manifest,
        `${JSON.stringify({ name: "breadboard-recall-cli", private: true, version: "0.0.0" }, null, 2)}\n`,
        "utf8",
      );
    }
  } catch (error) {
    throw new RecallError("install_failed", {
      detail: "could not create the Recall home",
      cause: error,
    });
  }

  const startedAt = new Date().toISOString();
  writeInstallStatus(config, {
    phase: "installing",
    message: `Downloading the capture engine (${config.cliPackage}@${config.cliVersion})…`,
    startedAt,
  });

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(
    npm,
    [
      "install",
      `${config.cliPackage}@${config.cliVersion}`,
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ],
    {
      cwd: root,
      detached: true,
      windowsHide: true,
      // npm on Windows is a .cmd shim, which cannot be spawned without a shell.
      shell: process.platform === "win32",
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, npm_config_yes: "true" },
    },
  );

  // Heartbeat while npm works, so a long download is visibly alive.
  const heartbeat = setInterval(() => {
    writeInstallStatus(config, {
      phase: "installing",
      message: `Downloading the capture engine (${config.cliPackage}@${config.cliVersion})…`,
      startedAt,
      pid: child.pid,
    });
  }, 5_000);
  heartbeat.unref?.();

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    // Bounded: npm's failure reason is at the end, and the whole thing is only
    // ever summarized into a phase message.
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
  });

  const timeout = setTimeout(() => {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }, config.installTimeoutMs);
  timeout.unref?.();

  child.on("error", (error) => {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    writeInstallStatus(config, {
      phase: "error",
      message: `Could not start npm: ${error.message}`,
      startedAt,
    });
  });

  child.on("exit", (code) => {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    if (code === 0 && resolveBinaryPath(config)) {
      writeInstallStatus(config, {
        phase: "installed",
        message: `Capture engine ${config.cliVersion} installed.`,
        startedAt,
      });
      return;
    }
    const reason = stderr.trim().split("\n").filter(Boolean).slice(-1)[0] ?? `npm exited ${code}`;
    writeInstallStatus(config, {
      phase: "error",
      message: `Install failed: ${reason.slice(0, 300)}`,
      startedAt,
    });
  });

  child.unref();
}
