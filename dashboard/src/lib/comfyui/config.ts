// Where ComfyUI is, and what Breadboard is allowed to do about it.
//
// ComfyUI is the "Advanced" way to make a picture: a local diffusion server the
// user drives with a checkpoint, a sampler and a step count, instead of asking
// a hosted model for something nice. It is deliberately not treated like the
// other vendored clones, because it is the only one whose install is measured
// in gigabytes and whose usefulness depends on model files Breadboard has no
// business downloading on someone's behalf.
//
// Managed local mode is exclusively Runtime V2-owned. External mode is the
// only path that adopts an independently managed HTTP endpoint.

import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface ComfyUiConfig {
  /** Off entirely: the Advanced tab does not appear. */
  enabled: boolean;
  /** Root of the HTTP API, no trailing slash. */
  baseUrl: string;
  /** Runtime V2 may start the local service; false means explicit external mode. */
  managed: boolean;
  /** The vendored ComfyUI checkout. */
  cloneRoot: string;
  /** Python environment Breadboard builds for the clone. */
  envDir: string;
  /** Heartbeated status file the setup process writes; see ./setup-status.ts. */
  statusFile: string;
  /** Where the launch and setup output is kept, for when it goes wrong. */
  logFile: string;
  /** Runtime-reserved managed port, or the development/external default. */
  port: number;
  /** Retained configuration contract; native readiness owns managed cold-start timing. */
  startTimeoutMs: number;
  /**
   * How long one picture may take. Generous on purpose: the first render after
   * a start also pays for loading several gigabytes of checkpoint off disk.
   */
  generateTimeoutMs: number;
}

const DEFAULT_PORT = 8188;

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

function count(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredRuntimeValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Runtime V2 omitted required managed ComfyUI field ${name}.`);
  return value;
}

export function resolveComfyUiConfig(env: NodeJS.ProcessEnv = process.env): ComfyUiConfig {
  const runtimeV2Active = env.BREADBOARD_RUNTIME_V2_ACTIVE === "true";
  const managed = flag(env.COMFYUI_MANAGED, true);
  const runtimeManaged = runtimeV2Active && managed;
  const port = runtimeManaged
    ? count(requiredRuntimeValue(env, "COMFYUI_PORT"), 0)
    : DEFAULT_PORT;
  const baseUrl = (
    runtimeManaged
      ? requiredRuntimeValue(env, "COMFYUI_URL")
      : managed
        ? `http://127.0.0.1:${port}`
        : requiredRuntimeValue(env, "COMFYUI_URL")
  ).replace(/\/+$/, "");
  const root = repositoryRoot();
  const cloneRoot = runtimeManaged
    ? requiredRuntimeValue(env, "COMFYUI_ROOT")
    : path.join(root, "comfyui");
  const envDir = runtimeManaged
    ? requiredRuntimeValue(env, "COMFYUI_ENV_DIR")
    : path.join(root, ".runtime", "comfyui-venv");
  const runtimeDir = runtimeManaged
    ? requiredRuntimeValue(env, "COMFYUI_RUNTIME_DIR")
    : path.join(root, ".runtime", "comfyui");

  const parsed = new URL(baseUrl);
  if (runtimeManaged) {
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password ||
      Number(parsed.port) !== port ||
      !path.isAbsolute(cloneRoot) ||
      !path.isAbsolute(envDir) ||
      !path.isAbsolute(runtimeDir)
    ) {
      throw new Error("Runtime V2 supplied invalid managed ComfyUI launch authority.");
    }
  } else if (
    !managed &&
    (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
  ) {
    throw new Error("External ComfyUI requires a credential-free HTTP(S) base URL.");
  }

  return {
    enabled: flag(env.COMFYUI_ENABLED, true),
    baseUrl,
    managed,
    cloneRoot,
    envDir,
    statusFile: path.join(runtimeDir, "startup-status.json"),
    logFile: path.join(runtimeDir, "comfyui.log"),
    port,
    startTimeoutMs: count(env.COMFYUI_START_TIMEOUT_MS, 180_000),
    generateTimeoutMs: count(env.COMFYUI_GENERATE_TIMEOUT_MS, 600_000),
  };
}

/** The interpreter inside the environment Breadboard builds for the clone. */
export function comfyUiPython(config: ComfyUiConfig): string {
  return process.platform === "win32"
    ? path.join(config.envDir, "Scripts", "python.exe")
    : path.join(config.envDir, "bin", "python");
}
