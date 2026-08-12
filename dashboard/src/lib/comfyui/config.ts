// Where ComfyUI is, and what Breadboard is allowed to do about it.
//
// ComfyUI is the "Advanced" way to make a picture: a local diffusion server the
// user drives with a checkpoint, a sampler and a step count, instead of asking
// a hosted model for something nice. It is deliberately not treated like the
// other vendored clones, because it is the only one whose install is measured
// in gigabytes and whose usefulness depends on model files Breadboard has no
// business downloading on someone's behalf.
//
// So there are two separate questions here, and they are kept separate:
//   1. *Is a ComfyUI answering?* — anything at `baseUrl` will do, including an
//      install the user already runs by hand. Breadboard never insists on the
//      vendored copy.
//   2. *May Breadboard start the vendored one?* — only when `managed` is on and
//      the clone has a Python environment already built for it.

import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface ComfyUiConfig {
  /** Off entirely: the Advanced tab does not appear. */
  enabled: boolean;
  /** Root of the HTTP API, no trailing slash. */
  baseUrl: string;
  /** Breadboard may start (and set up) the vendored clone itself. */
  managed: boolean;
  /**
   * Bring the server up with the app rather than on the first render.
   *
   * Only ever acts when there is a built environment and nothing else is
   * answering — see ./autostart.ts. It never installs anything.
   */
  autostart: boolean;
  /** The vendored ComfyUI checkout. */
  cloneRoot: string;
  /** Python environment Breadboard builds for the clone. */
  envDir: string;
  /** Heartbeated status file the setup process writes; see ./setup-status.ts. */
  statusFile: string;
  /** Where the launch and setup output is kept, for when it goes wrong. */
  logFile: string;
  /** Port used when Breadboard starts the server itself. */
  port: number;
  /** How long to wait for a server Breadboard just started. */
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

export function resolveComfyUiConfig(env: NodeJS.ProcessEnv = process.env): ComfyUiConfig {
  const port = count(env.COMFYUI_PORT, DEFAULT_PORT);
  const baseUrl = (env.COMFYUI_URL?.trim() || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  const root = repositoryRoot();

  return {
    enabled: flag(env.COMFYUI_ENABLED, true),
    baseUrl,
    managed: flag(env.COMFYUI_MANAGED, true),
    autostart: flag(env.COMFYUI_AUTOSTART, true),
    cloneRoot: env.COMFYUI_ROOT?.trim() || path.join(root, "comfyui"),
    envDir: env.COMFYUI_ENV_DIR?.trim() || path.join(root, ".runtime", "comfyui-venv"),
    statusFile: path.join(root, ".runtime", "comfyui", "startup-status.json"),
    logFile: path.join(root, ".runtime", "comfyui", "comfyui.log"),
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
