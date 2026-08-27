// Where the MatrAIx clone, its Python environment and its persona pools are,
// and whether the pieces add up to something that can run a study.
//
// Two venv locations are accepted, in this order: the one Breadboard provisions
// under `.runtime/`, and the clone's own `.venv`, which is what upstream's
// README tells you to create. Someone who followed the upstream install is
// therefore already set up, and someone who has not gets a setup button.

import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  dashboardDataDir,
  repositoryRoot,
  runtimeV2ServiceVenv,
} from "../runtime-paths.ts";
import { externalRuntimePathExists } from "../external-runtime-filesystem.ts";

/** The pool the clone ships: 200 personas, enough for a real study. */
export const MATRAIX_DEV_POOL = "persona/datasets/matraix-persona-dev-sample";
/** The million-persona release, present only once someone imports it. */
export const MATRAIX_PRODUCTION_POOL = "persona/datasets/matraix-persona-1m";

export interface MatraixPool {
  pool: string;
  label: string;
  count: number;
  kind: string;
}

export interface MatraixAvailability {
  available: boolean;
  cloned: boolean;
  root: string | null;
  python: string | null;
  pythonVersion: string;
  bridge: string;
  reason?: string;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function isCheckout(candidate: string | null): boolean {
  return Boolean(
    candidate &&
      externalRuntimePathExists(path.join(candidate, "environment", "runtime", "harbor")) &&
      externalRuntimePathExists(path.join(candidate, "src", "matraix", "cli.py")),
  );
}

export function resolveMatraixRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.MATRAIX_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") return isCheckout(explicit) ? explicit : null;
  const candidates = [
    explicit,
    path.join(repositoryRoot(), "MatrAIx-Persona-8B"),
  ];
  return candidates.find(isCheckout) ?? null;
}

export function matraixVenv(): string {
  return runtimeV2ServiceVenv("matraix");
}

function pythonIn(venv: string): string {
  return process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
}

/**
 * The interpreter to run the bridge with, or null when neither environment
 * exists yet. The clone's own `.venv` is accepted second so an upstream install
 * counts as an install.
 */
export function matraixPython(): string | null {
  const candidate = pythonIn(matraixVenv());
  return externalRuntimePathExists(candidate) ? candidate : null;
}

export function matraixBridge(): string {
  return path.join(repositoryRoot(), "scripts", "matraix-bridge.py");
}

export function matraixWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return configured(env.MATRAIX_WORKSPACE_ROOT) ?? path.join(dashboardDataDir(), "matraix-runs");
}

/** True once someone has downloaded the Persona 1M release into the clone. */
export function productionPoolPresent(root: string): boolean {
  return externalRuntimePathExists(path.join(root, MATRAIX_PRODUCTION_POOL, "release"));
}

/**
 * The environment the bridge runs in. The clone's launchers set `PYTHONPATH`
 * themselves, but a study's model calls go through Breadboard's own ChatMock,
 * so the OpenAI-compatible variables are set here — the clone's persona client
 * builds a stock `OpenAI()` and reads exactly these.
 */
export function matraixEnv(
  input: { baseUrl: string; apiKey: string },
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    OPENAI_BASE_URL: input.baseUrl,
    OPENAI_API_BASE: input.baseUrl,
    OPENAI_API_KEY: input.apiKey,
    NO_COLOR: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

const PROBE_TIMEOUT_MS = 120_000;

export function matraixAvailability(env: NodeJS.ProcessEnv = process.env): MatraixAvailability {
  const root = resolveMatraixRoot(env);
  const bridge = matraixBridge();
  if (!root) {
    return {
      available: false,
      cloned: false,
      root: null,
      python: null,
      pythonVersion: "",
      bridge,
      reason:
        "The MatrAIx clone was not found. Set MATRAIX_ROOT if it is not at ./MatrAIx-Persona-8B.",
    };
  }
  if (!externalRuntimePathExists(bridge)) {
    return {
      available: false,
      cloned: true,
      root,
      python: null,
      pythonVersion: "",
      bridge,
      reason: "Breadboard's MatrAIx bridge is missing.",
    };
  }
  const python = matraixPython();
  if (!python) {
    return {
      available: false,
      cloned: true,
      root,
      python: null,
      pythonVersion: "",
      bridge,
      reason:
        "MatrAIx is cloned but its Python environment is not installed. Open setup, or run npm run setup:matraix.",
    };
  }
  const probe = spawnSync(python, [bridge, "--root", root, "--check"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: PROBE_TIMEOUT_MS,
    env: { ...env, NO_COLOR: "1", PYTHONIOENCODING: "utf-8" },
  });
  const line = (probe.stdout ?? "").trim().split(/\r?\n/).at(-1) ?? "";
  let parsed: { event?: string; python?: string } = {};
  try {
    parsed = JSON.parse(line) as { event?: string; python?: string };
  } catch {
    parsed = {};
  }
  if (parsed.event !== "check.ok") {
    const detail = (probe.stderr ?? "").trim().split(/\r?\n/).at(-1) ?? "";
    return {
      available: false,
      cloned: true,
      root,
      python,
      pythonVersion: "",
      bridge,
      reason: `The MatrAIx environment is incomplete. ${detail}`.trim(),
    };
  }
  return {
    available: true,
    cloned: true,
    root,
    python,
    pythonVersion: String(parsed.python ?? ""),
    bridge,
  };
}
