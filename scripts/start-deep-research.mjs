#!/usr/bin/env node
// Focused launcher for the Deep Research agent service (open-deep-research clone).
//
// Honors DEEP_RESEARCH_MODE: `disabled` exits immediately (no process); `optional`
// and `required` launch the loopback service. The service binds only to 127.0.0.1
// and requires DEEP_RESEARCH_SECRET, which the dashboard shares with it so the
// browser never sees a credential. Its LLM is ChatMock (CHATMOCK_BASE_URL) — the
// same local gateway the chat surfaces use — so no provider key is needed.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, loadDashboardEnv } from "./load-root-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
// dashboard/.env.local holds the dev loopback credentials, so the service and the
// dashboard share one DEEP_RESEARCH_SECRET instead of drifting apart.
loadDashboardEnv(repoRoot);

const mode = process.env.DEEP_RESEARCH_MODE?.trim().toLowerCase() || "optional";
if (mode === "disabled") {
  process.stdout.write("[deep-research] DEEP_RESEARCH_MODE=disabled; service not started.\n");
  process.exit(0);
}

const engineDir = path.join(repoRoot, "deep-research");
const entry = path.join(engineDir, "src", "api.ts");
const tsx = path.join(engineDir, "node_modules", "tsx", "dist", "cli.mjs");

if (!fs.existsSync(entry)) {
  process.stderr.write(
    `[deep-research] engine checkout not found at ${engineDir}. Clone dzhng/deep-research there (see docs/DEEP_RESEARCH.md).\n`,
  );
  process.exit(mode === "required" ? 1 : 0);
}
if (!fs.existsSync(tsx)) {
  process.stderr.write(
    `[deep-research] dependencies are not installed. Run: npm install --prefix "${engineDir}"\n`,
  );
  process.exit(mode === "required" ? 1 : 0);
}

const port = process.env.DEEP_RESEARCH_PORT?.trim() || "7722";
const secret = process.env.DEEP_RESEARCH_SECRET?.trim() || crypto.randomBytes(24).toString("hex");

const env = {
  ...process.env,
  DEEP_RESEARCH_HOST: "127.0.0.1",
  DEEP_RESEARCH_PORT: port,
  DEEP_RESEARCH_SECRET: secret,
  // ChatMock is the backend LLM. The engine reads these directly.
  CHATMOCK_BASE_URL: process.env.CHATMOCK_BASE_URL || "http://127.0.0.1:8765/v1",
  CHATMOCK_API_KEY: process.env.CHATMOCK_API_KEY || "local",
  CHATMOCK_MODEL: process.env.CHATMOCK_MODEL || "default",
  CONTEXT_SIZE: process.env.CONTEXT_SIZE || "128000",
  // Reasoning models behind the local gateway are slower than the engine's
  // upstream default assumes; a per-step budget that is too small turns into
  // silently dropped search results.
  DEEP_RESEARCH_STEP_TIMEOUT_MS: process.env.DEEP_RESEARCH_STEP_TIMEOUT_MS || "180000",
  DEEP_RESEARCH_MAX_CONCURRENT_RUNS: process.env.DEEP_RESEARCH_MAX_CONCURRENT_RUNS || "2",
  // Search: ChatMock's built-in web_search by default (no third-party key), or
  // Firecrawl when one is configured. One search is a full upstream model call,
  // hence the minutes-scale budget.
  DEEP_RESEARCH_SEARCH_PROVIDER: process.env.DEEP_RESEARCH_SEARCH_PROVIDER || "auto",
  DEEP_RESEARCH_SEARCH_TIMEOUT_MS: process.env.DEEP_RESEARCH_SEARCH_TIMEOUT_MS || "300000",
  DEEP_RESEARCH_CONCURRENCY: process.env.DEEP_RESEARCH_CONCURRENCY || "2",
};

const child = spawn(process.execPath, [tsx, entry], {
  cwd: engineDir,
  env,
  stdio: "inherit",
});
child.on("error", (error) => {
  process.stderr.write(`[deep-research] failed to spawn service: ${error.message}\n`);
  process.exit(mode === "required" ? 1 : 0);
});
child.on("exit", (code) => process.exit(code ?? 0));

function shutdown() {
  child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
