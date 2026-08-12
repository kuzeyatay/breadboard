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
const port = /^\d+$/.test(process.env.CHATMOCK_PORT ?? "")
  ? process.env.CHATMOCK_PORT
  : "8765";

const child = spawn(
  python,
  [
    "chatmock.py",
    "serve",
    "--port",
    port,
    "--reasoning-effort",
    "low",
    "--reasoning-summary",
    "detailed",
    "--reasoning-compat",
    "legacy",
    // Native Responses web search uses the existing ChatGPT login handled by
    // ChatMock. It does not require a Serper, Firecrawl, or OpenAI API key and
    // keeps current-fact questions on a grounded path by default.
    "--enable-web-search",
  ],
  { cwd: chatmockDir, env: process.env, stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(`ChatMock failed to start: ${error.message}`);
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
