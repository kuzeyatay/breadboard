// Read-only ComfyUI setup inspection plus the tiny durable handoff record used
// while Runtime accepts the authenticated installer job.
//
// Managed server launch and setup execution do not live here: Runtime V2 is
// their sole process owner. Explicit external endpoints are HTTP-only and are
// never spawned by the dashboard.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { isRuntimeV2ServiceControlConfigured } from "../supervisor-control.ts";
import {
  parseStartupStatus,
  SETTLED_STARTUP_PHASES,
  type VoiceboxStartupStatus,
} from "../speech/startup-status.ts";
import { comfyUiPython, type ComfyUiConfig } from "./config.ts";

export type ComfyUiSetupStatus = VoiceboxStartupStatus;

/** A managed ComfyUI source is installed only when Runtime's copied entry exists. */
export function cloneInstalled(config: ComfyUiConfig): boolean {
  return fs.existsSync(path.join(config.cloneRoot, "main.py"));
}

/** The interpreter exists and the authenticated installer completed verification. */
export function environmentReady(config: ComfyUiConfig): boolean {
  return (
    fs.existsSync(comfyUiPython(config)) &&
    fs.existsSync(path.join(config.envDir, ".breadboard-comfyui-ready"))
  );
}

export function readSetupStatus(config: ComfyUiConfig): ComfyUiSetupStatus | null {
  try {
    return parseStartupStatus(fs.readFileSync(config.statusFile, "utf8"));
  } catch {
    return null;
  }
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The native profile seals one coherent Runtime V2 layout. Checking it here
 * prevents a malformed environment from turning a setup click into an
 * arbitrary dashboard filesystem write.
 */
function setupStatusAuthority(config: ComfyUiConfig): string {
  const serviceRoot = path.dirname(config.envDir);
  const runtimeRoot = path.dirname(path.dirname(serviceRoot));
  const expectedServiceRoot = path.join(runtimeRoot, "services", "comfyui");
  const expectedCloneRoot = path.join(runtimeRoot, "toolchains", "comfyui");
  if (
    path.basename(config.envDir) !== ".venv" ||
    path.basename(config.statusFile) !== "startup-status.json" ||
    !samePath(serviceRoot, expectedServiceRoot) ||
    !samePath(path.dirname(config.statusFile), expectedServiceRoot) ||
    !samePath(config.cloneRoot, expectedCloneRoot)
  ) {
    throw new Error("Runtime V2 supplied inconsistent managed ComfyUI setup paths.");
  }
  fs.mkdirSync(serviceRoot, { recursive: true });
  const metadata = fs.lstatSync(serviceRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The managed ComfyUI setup status directory is indirect.");
  }
  return serviceRoot;
}

function setupSourceAvailable(): boolean {
  const root = path.join(repositoryRoot(), "comfyui");
  try {
    const rootMetadata = fs.lstatSync(root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) return false;
    return ["main.py", "requirements.txt", "folder_paths.py", "server.py"].every((name) => {
      const metadata = fs.lstatSync(path.join(root, name));
      return metadata.isFile() && !metadata.isSymbolicLink();
    });
  } catch {
    return false;
  }
}

function writeSetupStatus(config: ComfyUiConfig, phase: string, message: string): void {
  const serviceRoot = setupStatusAuthority(config);
  const existing = fs.lstatSync(config.statusFile, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error("The managed ComfyUI setup status path is indirect.");
  }
  const now = new Date().toISOString();
  const payload = `${JSON.stringify({
    phase,
    message: message.slice(0, 8_000),
    startedAt: now,
    updatedAt: now,
    pid: process.pid,
    step: 0,
    totalSteps: 4,
    detail: null,
    progress: null,
  })}\n`;
  const temporary = path.join(
    serviceRoot,
    `.startup-status-${process.pid}-${randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporary, payload, { flag: "wx", mode: 0o600 });
  try {
    try {
      fs.renameSync(temporary, config.statusFile);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!existing || !["EACCES", "EBUSY", "EEXIST", "EPERM"].includes(code)) {
        throw error;
      }
      fs.rmSync(config.statusFile, { force: true });
      fs.renameSync(temporary, config.statusFile);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/**
 * Reserve the existing status channel immediately before the route submits the
 * authenticated Runtime job. This never launches work itself.
 */
export function beginSetup(config: ComfyUiConfig): { started: boolean; reason?: string } {
  if (!config.managed) {
    return { started: false, reason: "Breadboard is not allowed to manage this ComfyUI." };
  }
  if (!isRuntimeV2ServiceControlConfigured()) {
    return {
      started: false,
      reason: "ComfyUI setup requires the Breadboard Runtime service owner.",
    };
  }
  if (!setupSourceAvailable()) {
    return { started: false, reason: "The ComfyUI source is missing from this install." };
  }
  const status = readSetupStatus(config);
  if (status && !status.stalled && !SETTLED_STARTUP_PHASES.has(status.phase)) {
    return { started: false, reason: "Setup is already running." };
  }
  try {
    writeSetupStatus(config, "queued", "Waiting for Runtime to start ComfyUI setup.");
    return { started: true };
  } catch (error) {
    return {
      started: false,
      reason: error instanceof Error ? error.message : "Setup could not be queued.",
    };
  }
}

/** Keep the polling UI truthful when Runtime rejects the submitted job. */
export function recordSetupSubmissionFailure(config: ComfyUiConfig, error: unknown): void {
  const detail = error instanceof Error ? error.message : "Runtime rejected ComfyUI setup.";
  try {
    writeSetupStatus(config, "error", `ComfyUI setup could not start: ${detail}`);
  } catch {
    // The route still returns the authoritative Runtime error.
  }
}
