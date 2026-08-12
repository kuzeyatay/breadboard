// Whether Stable Fast 3D could run right now, and if not, which single thing is
// missing.
//
// This is a pure read. It never installs, never downloads weights, and never
// starts a CUDA context — it runs the bridge's `--probe` mode, which import-
// checks by specification rather than by importing. That restraint is the whole
// point: a person opening a panel, or a turn deciding whether to offer the
// skill, must not trigger a multi-gigabyte install as a side effect. The same
// rule the ComfyUI integration follows.
//
// The states are ordered by what a person would have to do about them, and only
// one is ever reported: naming three problems at once when fixing the first
// would reveal the second is worse than naming the first.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readSf3dConfig, type Sf3dConfig } from "./config.ts";

export type Sf3dState =
  /** The Stability checkout is not where it should be. */
  | "clone_missing"
  /** `npm run setup:sf3d` has not been run. */
  | "not_installed"
  /** The virtualenv exists but does not import — a half-finished or broken install. */
  | "incomplete"
  /**
   * Everything imports, but there is no CUDA or Metal device. SF3D's texture
   * baker has kernels for those two only, so this is a blocking state and not a
   * slow one.
   */
  | "no_gpu"
  | "ready";

export interface Sf3dStatus {
  state: Sf3dState;
  /** One sentence a person can act on. */
  detail: string;
  /** Present once the probe ran, whatever it concluded. */
  device?: "cuda" | "mps" | "cpu";
  pythonVersion?: string;
  torchVersion?: string;
  /** Which of the runtime's parts imported. Useful only for `incomplete`. */
  modules?: Record<string, boolean>;
  /**
   * Whether a token for the gated model repository is configured. Not part of
   * the state: the weights may already be in the Hugging Face cache from an
   * earlier run, so a missing token is a likely cause of failure rather than a
   * proven one.
   */
  huggingFaceTokenConfigured: boolean;
  cloneRoot: string;
}

/** Long enough for a cold interpreter start on a spinning disk, short enough not to hang a panel. */
const PROBE_TIMEOUT_MS = 30_000;

interface ProbeResult {
  ok?: boolean;
  clonedPresent?: boolean;
  python?: string;
  modules?: Record<string, boolean>;
  torchVersion?: string | null;
  device?: string;
  bakingSupported?: boolean;
}

function runProbe(config: Sf3dConfig, signal?: AbortSignal): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ProbeResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const child = spawn(config.pythonExecutable, [config.bridgeScript, "--probe"], {
      cwd: path.dirname(config.bridgeScript),
      env: { ...process.env, SF3D_ROOT: config.cloneRoot, PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "ignore"],
      ...(signal ? { signal } : {}),
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, PROBE_TIMEOUT_MS);

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      // Bounded: a probe that floods stdout is malfunctioning, and reading it
      // all would be the malfunction's reward.
      if (stdout.length < 64 * 1024) stdout += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", () => {
      try {
        finish(JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as ProbeResult);
      } catch {
        finish(null);
      }
    });
  });
}

/** The parts whose absence means the install did not finish. */
const REQUIRED_MODULES = [
  "torch",
  "rembg",
  "trimesh",
  "transformers",
  "open_clip",
  "texture_baker",
  "uv_unwrapper",
] as const;

export async function sf3dStatus(signal?: AbortSignal): Promise<Sf3dStatus> {
  const config = readSf3dConfig();
  const base = {
    huggingFaceTokenConfigured: config.huggingFaceToken !== null,
    cloneRoot: config.cloneRoot,
  };

  if (!fs.existsSync(path.join(config.cloneRoot, "sf3d", "system.py"))) {
    return {
      ...base,
      state: "clone_missing",
      detail:
        `The Stable Fast 3D checkout is not at ${config.cloneRoot}. ` +
        "Clone https://github.com/Stability-AI/stable-fast-3d there.",
    };
  }
  if (!fs.existsSync(config.pythonExecutable)) {
    return {
      ...base,
      state: "not_installed",
      detail: "Stable Fast 3D is not installed yet. Run `npm run setup:sf3d` once to provision it.",
    };
  }

  const probe = await runProbe(config, signal);
  if (!probe?.ok) {
    return {
      ...base,
      state: "incomplete",
      detail:
        "The Stable Fast 3D environment exists but does not start. Re-run `npm run setup:sf3d`.",
    };
  }

  const modules = probe.modules ?? {};
  const missing = REQUIRED_MODULES.filter((name) => modules[name] !== true);
  const device =
    probe.device === "cuda" || probe.device === "mps" ? probe.device : "cpu";
  const common = {
    ...base,
    device,
    ...(probe.python ? { pythonVersion: probe.python } : {}),
    ...(probe.torchVersion ? { torchVersion: probe.torchVersion } : {}),
    modules,
  } as const;

  if (missing.length > 0) {
    return {
      ...common,
      state: "incomplete",
      detail:
        `The Stable Fast 3D environment is missing ${missing.join(", ")}. ` +
        "Re-run `npm run setup:sf3d`; the compiled extensions need a C++ toolchain.",
    };
  }
  if (!probe.bakingSupported) {
    return {
      ...common,
      state: "no_gpu",
      detail:
        "Stable Fast 3D needs a CUDA or Apple Metal device: its texture baker has no CPU kernel. " +
        "This machine has neither available to torch.",
    };
  }
  return {
    ...common,
    state: "ready",
    detail: `Ready on ${device}.`,
  };
}

/** The cheap half of the status: true when a run is worth attempting at all. */
export function sf3dInstalled(): boolean {
  const config = readSf3dConfig();
  return (
    fs.existsSync(path.join(config.cloneRoot, "sf3d", "system.py")) &&
    fs.existsSync(config.pythonExecutable)
  );
}
