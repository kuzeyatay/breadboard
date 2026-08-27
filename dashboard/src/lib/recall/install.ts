// Installing the Recall capture engine.
//
// The engine is a ~130 MB prebuilt native binary published on npm. Installing
// it is a long, network-bound job that must survive the request that started
// it. The authenticated route submits one durable Runtime V2 job and returns;
// a fresh disposable worker owns npm and reports through the existing bounded
// heartbeat file so the Settings tab keeps exactly the same polling contract.

import { randomUUID } from "node:crypto";
import fs from "fs";
import path from "path";

import {
  getRecallConfig,
  recallCliRoot,
  recallInstallStatusPath,
  type RecallConfig,
} from "./config.ts";
import { RecallError } from "./errors.ts";
import {
  isRuntimeV2ServiceControlConfigured,
  submitRuntimeJob,
} from "../supervisor-control.ts";

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
  const updatedAtMs = Date.parse(parsed.updatedAt);
  const pid =
    typeof parsed.pid === "number" && Number.isFinite(parsed.pid)
      ? parsed.pid
      : null;
  // Next no longer probes or signals worker PIDs. Runtime V2 owns that process;
  // callers with authoritative liveness evidence may still supply it, while
  // ordinary Settings polls use the bounded heartbeat age.
  const writerGone =
    pid !== null && pid > 0 && options.isAlive ? !options.isAlive(pid) : false;
  const overdue =
    Number.isFinite(updatedAtMs) &&
    now - updatedAtMs > INSTALL_HEARTBEAT_GRACE_MS;

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
    return parseInstallStatus(
      fs.readFileSync(recallInstallStatusPath(config), "utf8"),
    );
  } catch {
    return null;
  }
}

function writeInstallStatus(
  config: RecallConfig,
  status: {
    phase: RecallInstallPhase;
    message: string;
    startedAt?: string;
    pid?: number;
  },
): void {
  let temporary: string | null = null;
  try {
    fs.mkdirSync(config.home, { recursive: true });
    const target = recallInstallStatusPath(config);
    temporary = `${target}.pending.${process.pid}.${randomUUID()}`;
    const bytes = `${JSON.stringify({
      ...status,
      updatedAt: new Date().toISOString(),
    })}\n`;
    fs.writeFileSync(temporary, bytes, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
    temporary = null;
  } catch {
    // A status file we cannot write only costs progress reporting; never let it
    // take down the install itself.
  } finally {
    if (temporary) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // Best-effort cleanup of a status-only temporary file.
      }
    }
  }
}

/** Absolute path of the installed native binary, or null when it is absent. */
export function resolveBinaryPath(
  config: RecallConfig = getRecallConfig(),
): string | null {
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
        path.join(
          recallCliRoot(config),
          "node_modules",
          "screenpipe",
          "package.json",
        ),
        "utf8",
      ),
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

export function installState(
  config: RecallConfig = getRecallConfig(),
): RecallInstallState {
  const binaryPath = resolveBinaryPath(config);
  return {
    installed: binaryPath !== null,
    version: installedVersion(config),
    pinnedVersion: config.cliVersion,
    binaryPath,
    supported: platformPackage() !== null,
  };
}

const installSubmissionGlobal = globalThis as typeof globalThis & {
  __breadboardRecallInstallSubmission?: Promise<void>;
};

/**
 * Submit the install and return once Runtime V2 durably accepted it. The route
 * never owns npm or waits for the download; the existing status poll observes
 * the disposable worker's heartbeat and terminal outcome.
 */
export async function startInstall(
  userId: number,
  config: RecallConfig = getRecallConfig(),
): Promise<void> {
  if (!config.enabled) throw new RecallError("feature_disabled");
  if (!platformPackage()) throw new RecallError("unsupported_platform");
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new RecallError("invalid_input", {
      detail: "invalid Recall installer owner",
    });
  }

  const current = readInstallStatus(config);
  if (
    installSubmissionGlobal.__breadboardRecallInstallSubmission ||
    (current && current.phase === "installing" && !current.stalled)
  ) {
    throw new RecallError("install_in_progress");
  }
  if (!isRuntimeV2ServiceControlConfigured()) {
    throw new RecallError("install_failed", {
      detail: "the authoritative Runtime V2 job owner is unavailable",
    });
  }

  const startedAt = new Date().toISOString();
  const submission = (async () => {
    try {
      const snapshot = await submitRuntimeJob(
        { userId, gardenId: null, conversationId: null },
        {
          jobType: "recall-install",
          idempotencyKey: `recall-install-${randomUUID()}`,
          requestPayload: { protocolVersion: 1, action: "install" },
        },
      );
      if (
        ![
          "queued",
          "admitted",
          "starting",
          "running",
          "checkpointing",
        ].includes(snapshot.state)
      ) {
        throw new Error(
          `Runtime rejected the Recall install in state ${snapshot.state}.`,
        );
      }
      writeInstallStatus(config, {
        phase: "installing",
        message: `Downloading the capture engine (${config.cliPackage}@${config.cliVersion})…`,
        startedAt,
      });
    } catch (cause) {
      writeInstallStatus(config, {
        phase: "error",
        message: "The capture engine install could not be scheduled.",
        startedAt,
      });
      throw new RecallError("install_failed", {
        detail: "Runtime V2 did not accept the Recall install",
        cause,
      });
    }
  })();
  installSubmissionGlobal.__breadboardRecallInstallSubmission = submission;
  try {
    await submission;
  } finally {
    if (
      installSubmissionGlobal.__breadboardRecallInstallSubmission === submission
    ) {
      installSubmissionGlobal.__breadboardRecallInstallSubmission = undefined;
    }
  }
}
