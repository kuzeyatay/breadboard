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

export async function runDesktopDev({
  repoRoot = defaultRepoRoot,
  env = process.env,
  electronArgs = process.argv.slice(2),
} = {}) {
  const require = createRequire(import.meta.url);
  const electronBinary = require("electron");
  const electronEnv = { ...env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
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
  process.exitCode = await runDesktopDev();
}
