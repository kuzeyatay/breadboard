// The setup panel behind the gear icon: what OpenScience is missing, and the
// one action that fixes it.
//
// This is a second trust context, the same way Agent Reach's and HyperFrames'
// setup panels are: the person is standing in front of the dialog asking for an
// install, so an install runs here even though nothing the model says can ever
// trigger one. The argv is fixed — a package name pinned to the clone's own
// version — so no request field becomes part of a command.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { planSpawn } from "../agent-reach/spawn-plan.ts";
import {
  managedCliRoot,
  resolveOpenscienceRoot,
  runtimeAvailability,
  targetCliVersion,
  workspaceRoot,
} from "./runtime.ts";

const INSTALL_TIMEOUT_MS = 15 * 60_000;

export interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  cli: { found: boolean; version: string; source: string };
  workspace: { path: string; isolated: boolean };
  /** The version an install would pin to, read from the clone. */
  targetVersion: string;
}

/**
 * Whether the workspace is its own version-control root.
 *
 * This matters more than it looks. OpenScience resolves a project by walking up
 * from its working directory to the nearest VCS root, and in development the
 * workspace lives inside the Breadboard repository — so without its own `.git`
 * the project root becomes the whole of Breadboard, and the agent's write roots
 * and trust decision come to cover this repository rather than its own
 * directory. `git init` in the workspace is what keeps the run inside it.
 */
export function workspaceIsolated(env: NodeJS.ProcessEnv = process.env): boolean {
  return fs.existsSync(path.join(workspaceRoot(env), ".git"));
}

/**
 * A package manifest the workspace owns, so a package manager the agent runs
 * stops here.
 *
 * `.git` is not enough. npm and bun locate their project by walking up for a
 * `package.json`, not a VCS root — so `bun install` inside a workspace without
 * one climbs out, finds `dashboard/package.json`, and installs Breadboard's own
 * dependencies over the top of themselves. That is not hypothetical: it
 * happened during this integration's own verification, and it replaced the
 * dashboard's compiled `better-sqlite3` binding with nothing, which broke every
 * database-backed test until it was rebuilt.
 */
function ensureManifest(root: string): void {
  const manifest = path.join(root, "package.json");
  if (fs.existsSync(manifest)) return;
  fs.writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        name: "openscience-workspace",
        private: true,
        description:
          "Breadboard's OpenScience research workspace. This file marks the directory as its own package root so a package manager run inside it never reaches the surrounding repository.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/** Create the workspace and make it its own project root. */
export function ensureWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  const root = workspaceRoot(env);
  fs.mkdirSync(root, { recursive: true });
  ensureManifest(root);
  if (workspaceIsolated(env)) return root;
  const plan = planSpawn("git", ["init"], process.env, () => "git was not found on PATH.");
  if ("error" in plan) return root;
  spawnSync(plan.command, plan.argv, {
    cwd: root,
    windowsHide: true,
    windowsVerbatimArguments: plan.verbatim,
    timeout: 60_000,
    stdio: "ignore",
  });
  return root;
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): SetupStatus {
  const availability = runtimeAvailability(env);
  const root = resolveOpenscienceRoot(env);
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: Boolean(root), path: root ?? "" },
    cli: {
      found: availability.cli.found,
      version: availability.cli.found ? availability.cli.version : "",
      source: availability.cli.found ? availability.cli.source : "",
    },
    workspace: { path: workspaceRoot(env), isolated: workspaceIsolated(env) },
    targetVersion: availability.targetVersion,
  };
}

export interface InstallResult {
  ok: boolean;
  message: string;
  status: SetupStatus;
}

const installGlobal = globalThis as typeof globalThis & {
  __breadboardOpenscienceInstall?: Promise<InstallResult>;
};

function runNpmInstall(
  prefix: string,
  version: string,
): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const plan = planSpawn(
      "npm",
      [
        "install",
        `@synsci/openscience@${version}`,
        "--prefix",
        prefix,
        "--no-audit",
        "--no-fund",
        "--loglevel",
        "error",
      ],
      process.env,
      () => "npm was not found on PATH.",
    );
    if ("error" in plan) {
      resolve({ code: null, log: plan.error });
      return;
    }
    const child = spawn(plan.command, plan.argv, {
      cwd: prefix,
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", npm_config_yes: "true" },
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

/**
 * Install the CLI into Breadboard's own prefix, pinned to the version the clone
 * ships, and prepare the workspace. Concurrent requests share one install: npm
 * in the same prefix twice over is how a half-extracted `node_modules` happens.
 */
export function install(): Promise<InstallResult> {
  if (installGlobal.__breadboardOpenscienceInstall) {
    return installGlobal.__breadboardOpenscienceInstall;
  }
  const request = (async (): Promise<InstallResult> => {
    const prefix = managedCliRoot();
    const version = targetCliVersion();
    await fs.promises.mkdir(prefix, { recursive: true });
    const { code, log } = await runNpmInstall(prefix, version);
    ensureWorkspace();
    const status = setupStatus();
    if (status.cli.found) {
      return { ok: true, message: `Installed OpenScience ${status.cli.version}.`, status };
    }
    const tail = log.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
    return {
      ok: false,
      message:
        `OpenScience could not be installed${code === null ? "" : ` (npm exited with ${code})`}. ${tail}`.trim(),
      status,
    };
  })().finally(() => {
    installGlobal.__breadboardOpenscienceInstall = undefined;
  });
  installGlobal.__breadboardOpenscienceInstall = request;
  return request;
}
