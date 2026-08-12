// The setup panel behind the gear icon: what the production toolchain is
// missing, and the two actions that fix what Breadboard can fix on its own.
//
// This is a second trust context, the same way Agent Reach's and HyperFrames'
// setup panels are: the person is standing in front of the dialog asking for an
// install, so an install runs here even though nothing the model says can ever
// trigger one. Both argv lists are fixed — a requirements file and an npm
// install in a known directory — so no request field becomes part of a command.
//
// The panel also reports how many of OpenMontage's 102 tools are actually
// available, because that number is the honest answer to "what can this make?".
// It moves with the toolchain: 14 tools with Python alone, 34 once ffmpeg is
// resolvable (which is what brings in `video_compose`, and with it any way to
// turn a plan into a video), and more with each provider key the person adds.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { planSpawn } from "../agent-reach/spawn-plan.ts";
import { resolveCodexLauncher } from "../codex/run-manager.ts";
import { configuredProviders } from "./prompt.ts";
import {
  openMontageEnv,
  resolveOpenMontageRoot,
  resolveToolchain,
  runtimeAvailability,
  venvDirectory,
} from "./runtime.ts";

const INSTALL_TIMEOUT_MS = 15 * 60_000;
const PROBE_TIMEOUT_MS = 90_000;
/** The registry probe shells out to Python; a health poll must not pay for it. */
const TOOL_CACHE_MS = 60_000;

export interface ToolAvailability {
  available: number;
  total: number;
  /** Empty when the probe could not run — the panel then says so. */
  reason: string;
}

export interface ToolchainStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  python: {
    found: boolean;
    path: string;
    source: string;
    version: string;
    dependencies: boolean;
    installable: boolean;
  };
  ffmpeg: { found: boolean; path: string; source: string };
  ffprobe: { found: boolean; path: string; source: string };
  node: { found: boolean; version: string };
  remotion: { found: boolean; path: string; installable: boolean };
  codex: { found: boolean; version: string };
  tools: ToolAvailability;
  /** Provider keys found in the clone's `.env`, which widen what can be made. */
  providers: string[];
}

const toolCacheGlobal = globalThis as typeof globalThis & {
  __breadboardOpenMontageTools?: { at: number; value: ToolAvailability };
};

/**
 * Ask the clone's own registry how many tools report themselves available.
 *
 * This runs upstream's discovery rather than reimplementing the rules, so a
 * tool that gains a provider or loses a binary is counted correctly without
 * Breadboard knowing anything about it.
 */
export function toolAvailability(env: NodeJS.ProcessEnv = process.env): ToolAvailability {
  const cached = toolCacheGlobal.__breadboardOpenMontageTools;
  if (cached && Date.now() - cached.at < TOOL_CACHE_MS) return cached.value;

  const root = resolveOpenMontageRoot(env);
  const toolchain = resolveToolchain(env);
  let value: ToolAvailability;
  if (!root || !toolchain.python.found || !toolchain.python.dependencies) {
    value = { available: 0, total: 0, reason: "Python and the dependencies are not installed yet." };
  } else {
    const result = spawnSync(
      toolchain.python.path,
      [
        "-c",
        "from tools.tool_registry import ToolRegistry\nr = ToolRegistry()\nr.discover()\nprint(len(r.get_available()), len(r.list_all()))",
      ],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: PROBE_TIMEOUT_MS,
        env: openMontageEnv(toolchain, { projectsDirectory: path.join(root, "projects") }, env),
      },
    );
    const line = (result.stdout ?? "").trim().split(/\r?\n/).pop() ?? "";
    const match = /^(\d+)\s+(\d+)$/.exec(line.trim());
    value = match
      ? { available: Number(match[1]), total: Number(match[2]), reason: "" }
      : {
          available: 0,
          total: 0,
          reason:
            (result.stderr ?? "").trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 200) ||
            "The tool registry could not be read.",
        };
  }
  toolCacheGlobal.__breadboardOpenMontageTools = { at: Date.now(), value };
  return value;
}

export function toolchainStatus(env: NodeJS.ProcessEnv = process.env): ToolchainStatus {
  const availability = runtimeAvailability(env);
  const toolchain = resolveToolchain(env);
  const codex = resolveCodexLauncher(env);
  return {
    ready: availability.available && Boolean(codex),
    reason: !availability.available
      ? (availability.reason ?? "")
      : codex
        ? ""
        : "The coding runtime that drives OpenMontage was not found. Install Codex or set CODEX_BIN.",
    clone: { found: Boolean(availability.root), path: availability.root ?? "" },
    python: {
      found: toolchain.python.found,
      path: toolchain.python.path,
      source: toolchain.python.source,
      version: toolchain.python.version,
      dependencies: toolchain.python.dependencies,
      installable: Boolean(availability.root),
    },
    ffmpeg: toolchain.ffmpeg,
    ffprobe: toolchain.ffprobe,
    node: { found: toolchain.node.found, version: toolchain.node.version },
    remotion: {
      found: toolchain.remotion.found,
      path: toolchain.remotion.path,
      installable: Boolean(availability.root) && toolchain.node.found,
    },
    codex: { found: Boolean(codex), version: codex?.version ?? "" },
    tools: availability.available
      ? toolAvailability(env)
      : { available: 0, total: 0, reason: "Install the dependencies to read the tool registry." },
    providers: configuredProviders(env),
  };
}

export interface InstallResult {
  ok: boolean;
  message: string;
  status: ToolchainStatus;
}

const installGlobal = globalThis as typeof globalThis & {
  __breadboardOpenMontageInstall?: Promise<InstallResult>;
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
 * Create the clone's virtualenv and install `requirements.txt` into it.
 *
 * `uv` is preferred when present — it is what the other Python integrations in
 * this repository use — and `UV_LINK_MODE=copy` is not optional here: the
 * repository sits in a OneDrive folder, where uv's default hardlinking fails.
 * Plain `venv` + `pip` is the fallback so a machine without uv still works.
 */
export function installDependencies(): Promise<InstallResult> {
  if (installGlobal.__breadboardOpenMontageInstall) {
    return installGlobal.__breadboardOpenMontageInstall;
  }
  const request = (async (): Promise<InstallResult> => {
    const root = resolveOpenMontageRoot();
    if (!root) {
      return {
        ok: false,
        message: "The OpenMontage clone was not found. Clone it beside the dashboard first.",
        status: toolchainStatus(),
      };
    }
    const venv = venvDirectory() ?? path.join(root, ".venv");
    const requirements = path.join(root, "requirements.txt");
    if (!fs.existsSync(requirements)) {
      return {
        ok: false,
        message: "The clone has no requirements.txt — it may be an incomplete checkout.",
        status: toolchainStatus(),
      };
    }

    const uvEnv = { UV_LINK_MODE: "copy" };
    const hasUv = !("error" in planSpawn("uv", ["--version"], process.env, () => "missing"));
    let log = "";
    if (hasUv) {
      const created = await run("uv", ["venv", venv], root, uvEnv);
      log += created.log;
      const installed = await run(
        "uv",
        ["pip", "install", "--python", venv, "-r", requirements],
        root,
        uvEnv,
      );
      log += installed.log;
    } else {
      const created = await run("python", ["-m", "venv", venv], root);
      log += created.log;
      const python = fs.existsSync(path.join(venv, "Scripts", "python.exe"))
        ? path.join(venv, "Scripts", "python.exe")
        : path.join(venv, "bin", "python");
      const installed = await run(python, ["-m", "pip", "install", "-r", requirements], root);
      log += installed.log;
    }

    // Force the next probe to re-read rather than serve a pre-install count.
    toolCacheGlobal.__breadboardOpenMontageTools = undefined;
    const status = toolchainStatus();
    if (status.python.dependencies) {
      return {
        ok: true,
        message: `Installed OpenMontage's Python dependencies (${status.tools.available} of ${status.tools.total} tools available).`,
        status,
      };
    }
    return {
      ok: false,
      message: `The Python dependencies could not be installed. ${tail(log)}`.trim(),
      status,
    };
  })().finally(() => {
    installGlobal.__breadboardOpenMontageInstall = undefined;
  });
  installGlobal.__breadboardOpenMontageInstall = request;
  return request;
}

const remotionGlobal = globalThis as typeof globalThis & {
  __breadboardOpenMontageRemotion?: Promise<InstallResult>;
};

/**
 * Install `remotion-composer/node_modules`, which is what makes the React
 * composition runtime selectable. Optional: the ffmpeg render path works
 * without it, and upstream's rule is that the agent must present whichever
 * runtimes are genuinely available rather than silently defaulting.
 */
export function installRemotion(): Promise<InstallResult> {
  if (remotionGlobal.__breadboardOpenMontageRemotion) {
    return remotionGlobal.__breadboardOpenMontageRemotion;
  }
  const request = (async (): Promise<InstallResult> => {
    const root = resolveOpenMontageRoot();
    const composer = root ? path.join(root, "remotion-composer") : "";
    if (!composer || !fs.existsSync(path.join(composer, "package.json"))) {
      return {
        ok: false,
        message: "The clone has no remotion-composer project.",
        status: toolchainStatus(),
      };
    }
    const { code, log } = await run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--loglevel", "error"],
      composer,
    );
    toolCacheGlobal.__breadboardOpenMontageTools = undefined;
    const status = toolchainStatus();
    if (status.remotion.found) {
      return { ok: true, message: "Installed the Remotion composition runtime.", status };
    }
    return {
      ok: false,
      message:
        `Remotion could not be installed${code === null ? "" : ` (npm exited with ${code})`}. ${tail(log)}`.trim(),
      status,
    };
  })().finally(() => {
    remotionGlobal.__breadboardOpenMontageRemotion = undefined;
  });
  remotionGlobal.__breadboardOpenMontageRemotion = request;
  return request;
}
