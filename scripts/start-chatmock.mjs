#!/usr/bin/env node
// Cross-platform launcher for ChatMock (local OpenAI-compatible backend, :8765).
// Preserves the existing invocation used by start.bat.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
const chatmockDir = path.join(repoRoot, "chatmock");
const python = process.platform === "win32" ? "python" : "python3";

const child = spawn(
  python,
  [
    "chatmock.py",
    "serve",
    "--port",
    "8765",
    "--reasoning-effort",
    "low",
    "--reasoning-summary",
    "detailed",
    "--reasoning-compat",
    "legacy",
  ],
  { cwd: chatmockDir, env: process.env, stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(`ChatMock failed to start: ${error.message}`);
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
