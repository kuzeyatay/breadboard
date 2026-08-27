#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDashboardEnv,
  loadRootEnv,
} from "../../scripts/load-root-env.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRepoRoot = path.resolve(desktopRoot, "..");
export const leanDashboardArgument = "--breadboard-internal-lean-dashboard";

export function parseDesktopDevArguments(args = []) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("Desktop development arguments must be an array of strings.");
  }
  const leanSelections = args.filter((argument) => argument === leanDashboardArgument).length;
  if (leanSelections > 1) {
    throw new Error(`Desktop development received ${leanDashboardArgument} more than once.`);
  }
  return Object.freeze({
    dashboardMode: leanSelections === 1 ? "standalone" : "hot",
    electronArgs: Object.freeze(args.filter((argument) => argument !== leanDashboardArgument)),
  });
}

export function desktopDevEnvironment(env = process.env, dashboardMode = "hot") {
  if (dashboardMode !== "hot" && dashboardMode !== "standalone") {
    throw new Error(`Unknown desktop development dashboard mode: ${dashboardMode}`);
  }
  const electronEnv = {
    ...env,
    // This assignment intentionally happens after root/dashboard env loading.
    // Ambient configuration cannot silently turn the ordinary hot entrypoint
    // into the standalone compiler-free path; only dev-fast's private marker can.
    BREADBOARD_DESKTOP_DASHBOARD_MODE: dashboardMode,
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  return electronEnv;
}

export async function runDesktopDev({
  repoRoot = defaultRepoRoot,
  env = process.env,
  electronArgs = process.argv.slice(2),
  dashboardMode = "hot",
} = {}) {
  const require = createRequire(import.meta.url);
  const electronBinary = require("electron");
  const electronEnv = desktopDevEnvironment(env, dashboardMode);
  const electronChild = spawn(
    electronBinary,
    [".", "--breadboard-dev", ...electronArgs],
    {
      cwd: path.join(repoRoot, "desktop"),
      env: electronEnv,
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    },
  );

  const forwardSignal = (signal) => {
    if (electronChild.exitCode === null && electronChild.signalCode === null) {
      electronChild.kill(signal);
    }
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  const result = await new Promise((resolve) => {
    electronChild.once("error", (error) => {
      process.stderr.write(`[desktop] Electron could not start: ${error.message}\n`);
      resolve(1);
    });
    electronChild.once("exit", (code) => resolve(code ?? 1));
  });

  return result;
}

const invokedAsMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  loadRootEnv(defaultRepoRoot);
  loadDashboardEnv(defaultRepoRoot);
  const launch = parseDesktopDevArguments(process.argv.slice(2));
  process.exitCode = await runDesktopDev(launch);
}
