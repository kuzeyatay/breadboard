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
import { exitIfAlreadyRunning } from "./service-probe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
// dev-all.mjs reads the dashboard's git-ignored .env.local too, so the focused
// launcher must as well: without this, `npm run dev:gbrain` exits on
// GBRAIN_MODE=disabled even when .env.local enables GBrain for the full stack.
loadDashboardEnv(repoRoot);

const mode = (process.env.GBRAIN_MODE?.trim().toLowerCase() || "preferred");
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
  // Embedding provider + credentials (openai-compatible). Defaults point at
  // ChatMock's local ONNX `/v1/embeddings`, so real vectors need no paid API.
  // All five must be set or the adapter truthfully degrades to lexical; the key
  // is ignored by ChatMock. Keys never reach the browser.
  GBRAIN_EMBEDDING_PROVIDER: process.env.GBRAIN_EMBEDDING_PROVIDER || "openai-compatible",
  GBRAIN_EMBEDDING_BASE_URL:
    process.env.GBRAIN_EMBEDDING_BASE_URL ||
    process.env.CHATMOCK_BASE_URL ||
    "http://127.0.0.1:8765/v1",
  GBRAIN_EMBEDDING_API_KEY: process.env.GBRAIN_EMBEDDING_API_KEY || "local",
  GBRAIN_EMBEDDING_MODEL: process.env.GBRAIN_EMBEDDING_MODEL || "local/bge-small-en-v1.5",
  GBRAIN_EMBEDDING_DIMENSIONS: process.env.GBRAIN_EMBEDDING_DIMENSIONS || "384",
  GBRAIN_QUERY_TIMEOUT_MS: process.env.GBRAIN_QUERY_TIMEOUT_MS || "15000",
};

// /health is unauthenticated and cannot tell our adapter from one holding a
// different secret. Every other route is a POST behind the bearer: an empty
// body reaches the handler (400) only once the secret matched, where a
// stranger's adapter answers 401.
await exitIfAlreadyRunning("gbrain", {
  url: `http://127.0.0.1:${port}/search`,
  method: "POST",
  body: "{}",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  acceptStatuses: [200, 204, 400, 404, 405],
});

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
