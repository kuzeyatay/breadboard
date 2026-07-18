#!/usr/bin/env node
// Cross-platform launcher for the Quartz site (:8081).
//
// On Windows it delegates to the existing PowerShell script (which handles port
// checks and the websocket port); elsewhere it runs the Quartz build --serve.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";

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

const child = spawn(cmd, args, { cwd, env: process.env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Quartz failed to start: ${error.message}`);
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
