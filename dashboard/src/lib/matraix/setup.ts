// The setup panel behind the gear icon: what the study runtime is missing, and
// the one action that fixes what Breadboard can fix on its own.
//
// This is a second trust context, the same way Agent Reach's and OpenMontage's
// setup panels are: the person is standing in front of the dialog asking for an
// install, so an install runs here even though nothing a model says can ever
// trigger one. The argv is fixed — an editable install of the clone and its
// Playground package into a venv at a known path — so no request field ever
// becomes part of a command.
//
// The panel also reports which persona pools exist, because that is the honest
// answer to "how big a population can this study?". The clone ships a
// 200-persona sample, which is enough for a real study of a dozen respondents;
// the million-persona release is a separate download, and the panel says how to
// get it rather than starting a multi-gigabyte transfer nobody asked for.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { planSpawn } from "../agent-reach/spawn-plan.ts";
import { forgetMatraixCatalog, matraixCatalog } from "./catalog.ts";
import {
  MATRAIX_DEV_POOL,
  MATRAIX_PRODUCTION_POOL,
  matraixAvailability,
  matraixVenv,
  productionPoolPresent,
  resolveMatraixRoot,
} from "./runtime.ts";

const INSTALL_TIMEOUT_MS = 30 * 60_000;

export interface MatraixPoolStatus {
  pool: string;
  label: string;
  personas: number;
  present: boolean;
}

export interface MatraixSetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  python: { found: boolean; path: string; version: string; venv: string };
  pools: MatraixPoolStatus[];
  /** The command that imports the million-persona release, if someone wants it. */
  productionPoolCommand: string;
}

const PRODUCTION_POOL_COMMAND = [
  "huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release",
  "--repo-type dataset",
  `--local-dir ${MATRAIX_PRODUCTION_POOL}/release`,
].join(" ");

export function setupStatus(env: NodeJS.ProcessEnv = process.env): MatraixSetupStatus {
  const availability = matraixAvailability(env);
  const root = availability.root ?? resolveMatraixRoot(env);
  const catalog = availability.available ? matraixCatalog(MATRAIX_DEV_POOL) : null;
  const pools: MatraixPoolStatus[] = [
    {
      pool: MATRAIX_DEV_POOL,
      label: "Development sample",
      personas: catalog?.count ?? 0,
      present: Boolean(root) && fs.existsSync(path.join(root ?? "", MATRAIX_DEV_POOL)),
    },
    {
      pool: MATRAIX_PRODUCTION_POOL,
      label: "Persona 1M release",
      personas: 0,
      present: Boolean(root) && productionPoolPresent(root ?? ""),
    },
  ];
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: Boolean(root), path: root ?? "" },
    python: {
      found: Boolean(availability.python),
      path: availability.python ?? "",
      version: availability.pythonVersion,
      venv: matraixVenv(env),
    },
    pools,
    productionPoolCommand: PRODUCTION_POOL_COMMAND,
  };
}

export interface MatraixInstallResult {
  ok: boolean;
  message: string;
  status: MatraixSetupStatus;
}

const installGlobal = globalThis as typeof globalThis & {
  __breadboardMatraixInstall?: Promise<MatraixInstallResult>;
};

function run(
  command: string,
  argv: readonly string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const plan = planSpawn(command, [...argv], process.env, () => `${command} was not found on PATH.`);
    if ("error" in plan) {
      resolve({ code: null, log: plan.error });
      return;
    }
    const child = spawn(plan.command, plan.argv, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", PYTHONIOENCODING: "utf-8", ...extraEnv },
    });
    let log = "";
    const collect = (chunk: string) => {
      log = `${log}${chunk}`.slice(-8_000);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, INSTALL_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, log: `${log}${error.message}` });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });
}

function tail(log: string): string {
  return log.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
}

/**
 * Build the clone's Python environment.
 *
 * `uv` is required rather than merely preferred: the clone pins Python 3.12 and
 * resolves a large dependency set, and `uv venv --python 3.12` is what upstream
 * documents. `UV_LINK_MODE=copy` is not optional here — the repository sits in a
 * OneDrive folder, where uv's default hardlinking fails.
 */
export function installEnvironment(): Promise<MatraixInstallResult> {
  if (installGlobal.__breadboardMatraixInstall) return installGlobal.__breadboardMatraixInstall;
  const request = (async (): Promise<MatraixInstallResult> => {
    const root = resolveMatraixRoot();
    if (!root) {
      return {
        ok: false,
        message: "The MatrAIx clone was not found. Clone it beside the dashboard first.",
        status: setupStatus(),
      };
    }
    const hasUv = !("error" in planSpawn("uv", ["--version"], process.env, () => "missing"));
    if (!hasUv) {
      return {
        ok: false,
        message:
          "uv is required to build MatrAIx's environment (it pins Python 3.12). Install uv, then try again.",
        status: setupStatus(),
      };
    }
    const venv = matraixVenv();
    const uvEnv = { UV_LINK_MODE: "copy" };
    let log = "";
    const created = await run("uv", ["venv", "--python", "3.12", venv], root, uvEnv);
    log += created.log;
    const installed = await run(
      "uv",
      ["pip", "install", "--python", venv, "-e", ".", "-e", "packages/playground"],
      root,
      uvEnv,
    );
    log += installed.log;

    forgetMatraixCatalog();
    const status = setupStatus();
    if (status.ready) {
      const personas = status.pools.find((pool) => pool.pool === MATRAIX_DEV_POOL)?.personas ?? 0;
      return {
        ok: true,
        message: `MatrAIx is ready. ${personas} personas are available for sampling.`,
        status,
      };
    }
    return {
      ok: false,
      message: `MatrAIx's environment could not be installed. ${tail(log)}`.trim(),
      status,
    };
  })().finally(() => {
    installGlobal.__breadboardMatraixInstall = undefined;
  });
  installGlobal.__breadboardMatraixInstall = request;
  return request;
}

/** The setup script's `--check`, so `npm run setup:matraix --check` reports the same thing. */
export function checkEnvironment(): { ok: boolean; detail: string } {
  const availability = matraixAvailability();
  if (!availability.available) return { ok: false, detail: availability.reason ?? "" };
  const probe = spawnSync(availability.python!, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  return { ok: true, detail: (probe.stdout || probe.stderr || "").trim() };
}
