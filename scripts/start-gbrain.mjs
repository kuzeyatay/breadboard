#!/usr/bin/env node
// Focused launcher for the Breadboard GBrain adapter (Bun sidecar).
//
// Honors GBRAIN_MODE: `disabled` exits immediately (no process), `preferred` and
// `required` launch the loopback adapter. The adapter binds only to 127.0.0.1 and
// requires GBRAIN_ADAPTER_SECRET. Mutable data lives under GBRAIN_DATA_DIR, never
// inside the checkout.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadRootEnv, loadDashboardEnv } from "./load-root-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
// dev-all.mjs reads the dashboard's git-ignored .env.local too, so the focused
// launcher must as well: without this, `npm run dev:gbrain` exits on
// GBRAIN_MODE=disabled even when .env.local enables GBrain for the full stack.
loadDashboardEnv(repoRoot);

const mode = (process.env.GBRAIN_MODE?.trim().toLowerCase() || "disabled");
if (mode === "disabled") {
  process.stdout.write("[gbrain] GBRAIN_MODE=disabled; adapter not started.\n");
  process.exit(0);
}

const bun = process.platform === "win32" ? "bun.exe" : "bun";
const adapterEntry = path.join(repoRoot, "gbrain-adapter", "src", "server.ts");

const secret = process.env.GBRAIN_ADAPTER_SECRET?.trim() || crypto.randomBytes(24).toString("hex");
const dataDir =
  process.env.GBRAIN_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard", "gbrain");
const port = process.env.GBRAIN_ADAPTER_PORT?.trim() || "7717";

const env = {
  ...process.env,
  GBRAIN_ADAPTER_HOST: "127.0.0.1",
  GBRAIN_ADAPTER_PORT: port,
  GBRAIN_ADAPTER_SECRET: secret,
  GBRAIN_DATA_DIR: dataDir,
  // Backend: `gbrain` (production, vendored engine) is the default; `fake` is
  // test-only and refused in packaged production.
  GBRAIN_BACKEND: process.env.GBRAIN_BACKEND || "gbrain",
  // Embedding provider + credentials (openai-compatible). Missing credentials =>
  // truthful lexical_degraded. Keys never reach the browser.
  GBRAIN_EMBEDDING_PROVIDER: process.env.GBRAIN_EMBEDDING_PROVIDER || "none",
  GBRAIN_EMBEDDING_BASE_URL: process.env.GBRAIN_EMBEDDING_BASE_URL || "",
  GBRAIN_EMBEDDING_API_KEY: process.env.GBRAIN_EMBEDDING_API_KEY || "",
  GBRAIN_EMBEDDING_MODEL: process.env.GBRAIN_EMBEDDING_MODEL || "",
  GBRAIN_EMBEDDING_DIMENSIONS: process.env.GBRAIN_EMBEDDING_DIMENSIONS || "",
  GBRAIN_QUERY_TIMEOUT_MS: process.env.GBRAIN_QUERY_TIMEOUT_MS || "15000",
};

const child = spawn(bun, ["run", adapterEntry], { cwd: repoRoot, env, stdio: "inherit" });
child.on("error", (error) => {
  process.stderr.write(`[gbrain] failed to spawn adapter: ${error.message}\n`);
  process.exit(mode === "required" ? 1 : 0);
});
child.on("exit", (code) => process.exit(code ?? 0));

function shutdown() {
  child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
