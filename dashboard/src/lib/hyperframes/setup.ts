// The setup panel behind the gear icon: what the video toolchain is missing,
// and the one action that fixes the piece Breadboard can fix on its own.
//
// This is a second trust context, the same way Agent Reach's setup panel is:
// the person is standing in front of the dialog asking for an install, so an
// install runs here even though nothing the model says can ever trigger one.
// The argv is fixed — a package name pinned to the clone's own CLI version — so
// there is no request field that becomes part of a command.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { planSpawn } from "../agent-reach/spawn-plan.ts";
import { resolveCodexLauncher } from "../codex/run-manager.ts";
import {
  managedCliRoot,
  resolveHyperframesRoot,
  resolveToolchain,
  runtimeAvailability,
  skillsRoot,
} from "./runtime.ts";
import { installedSkills } from "./prompt.ts";

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const FALLBACK_VERSION = "latest";

export interface ToolchainStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string; skills: number };
  cli: { found: boolean; version: string; source: string; installable: boolean };
  ffmpeg: { found: boolean; path: string; source: string };
  browser: { found: boolean; path: string; source: string };
  codex: { found: boolean; version: string };
  /** The version an install would pin to, read from the clone. */
  targetVersion: string;
}

/** The CLI version this clone ships, so an install matches the skills. */
export function targetCliVersion(env: NodeJS.ProcessEnv = process.env): string {
  const root = resolveHyperframesRoot(env);
  if (!root) return FALLBACK_VERSION;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "packages", "cli", "package.json"), "utf8"),
    ) as { version?: unknown };
    const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
    return /^\d+\.\d+\.\d+/.test(version) ? version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export function toolchainStatus(env: NodeJS.ProcessEnv = process.env): ToolchainStatus {
  const availability = runtimeAvailability(env);
  const toolchain = resolveToolchain(env);
  const codex = resolveCodexLauncher(env);
  const skills = skillsRoot(env);
  return {
    ready: availability.available && Boolean(codex),
    reason: !availability.available
      ? (availability.reason ?? "")
      : codex
        ? ""
        : "The coding runtime that drives HyperFrames was not found. Install Codex or set CODEX_BIN.",
    clone: {
      found: Boolean(availability.root),
      path: availability.root ?? "",
      skills: skills ? installedSkills(env).length : 0,
    },
    cli: {
      found: toolchain.cli.found,
      version: toolchain.cli.found ? toolchain.cli.version : "",
      source: toolchain.cli.found ? toolchain.cli.source : "",
      installable: true,
    },
    ffmpeg: {
      found: toolchain.ffmpeg.found,
      path: toolchain.ffmpeg.path,
      source: toolchain.ffmpeg.source,
    },
    browser: {
      found: toolchain.browser.found,
      path: toolchain.browser.path,
      source: toolchain.browser.source,
    },
    codex: { found: Boolean(codex), version: codex?.version ?? "" },
    targetVersion: targetCliVersion(env),
  };
}

export interface InstallResult {
  ok: boolean;
  message: string;
  status: ToolchainStatus;
}

const installGlobal = globalThis as typeof globalThis & {
  __breadboardHyperframesInstall?: Promise<InstallResult>;
};

function runNpmInstall(prefix: string, version: string): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const plan = planSpawn(
      "npm",
      [
        "install",
        `hyperframes@${version}`,
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
 * Install the HyperFrames CLI into Breadboard's own prefix, pinned to the
 * version this clone ships. Concurrent requests share one install: npm in the
 * same prefix twice over is how a half-extracted `node_modules` happens.
 */
export function installCli(): Promise<InstallResult> {
  if (installGlobal.__breadboardHyperframesInstall) {
    return installGlobal.__breadboardHyperframesInstall;
  }
  const request = (async (): Promise<InstallResult> => {
    const prefix = managedCliRoot();
    const version = targetCliVersion();
    await fs.promises.mkdir(prefix, { recursive: true });
    const { code, log } = await runNpmInstall(prefix, version);
    const status = toolchainStatus();
    if (status.cli.found) {
      return {
        ok: true,
        message: `Installed the HyperFrames CLI (${status.cli.version}).`,
        status,
      };
    }
    const tail = log.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
    return {
      ok: false,
      message: `The HyperFrames CLI could not be installed${code === null ? "" : ` (npm exited with ${code})`}. ${tail}`.trim(),
      status,
    };
  })().finally(() => {
    installGlobal.__breadboardHyperframesInstall = undefined;
  });
  installGlobal.__breadboardHyperframesInstall = request;
  return request;
}
