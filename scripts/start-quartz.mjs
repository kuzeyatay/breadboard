#!/usr/bin/env node
// Cross-platform launcher for the Quartz site (:8081).
//
// On Windows it delegates to the existing PowerShell script (which handles port
// checks and the websocket port); elsewhere it runs the Quartz build --serve.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";
import { exitIfAlreadyRunning, WARMING_BUDGET_MS } from "./service-probe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);

let cmd;
let args;
let cwd = repoRoot;
if (process.platform === "win32") {
  cmd = "powershell.exe";
  args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "start-quartz.ps1")];
} else {
  cmd = "npx";
  args = ["quartz", "build", "--serve", "--port", "8081"];
  cwd = path.join(repoRoot, "quartz");
}

// A Quartz already serving the garden is the one to keep: a second build would
// spend minutes re-rendering every note only to lose the port. (The Windows
// PowerShell path checks this too; this covers the other platforms and gives
// the full-stack launcher the same answer everywhere.)
await exitIfAlreadyRunning("quartz", { url: "http://127.0.0.1:8081/" }, WARMING_BUDGET_MS.quartz);

const child = spawn(cmd, args, { cwd, env: process.env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Quartz failed to start: ${error.message}`);
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
