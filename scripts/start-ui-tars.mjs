#!/usr/bin/env node
// Focused launcher for the Breadboard UI-TARS adapter (Node sidecar).
//
// Honors UI_TARS_MODE: `disabled` exits immediately (no process); `optional` and
// `required` launch the loopback adapter. The adapter binds only to 127.0.0.1 and
// requires UI_TARS_ADAPTER_SECRET. Mutable data (screenshots, isolated browser
// profiles, session registry) lives under UI_TARS_DATA_DIR, never in the checkout.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadRootEnv, loadDashboardEnv } from "./load-root-env.mjs";
import { exitIfAlreadyRunning } from "./service-probe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
// The dashboard keeps its loopback credentials in dashboard/.env.local. Load it
// here too (as start-hermes.mjs does) so the adapter and the dashboard share one
// UI_TARS_ADAPTER_SECRET instead of drifting onto a random per-launch token that
// the dashboard cannot authenticate with.
loadDashboardEnv(repoRoot);

const mode = process.env.UI_TARS_MODE?.trim().toLowerCase() || "optional";
if (mode === "disabled") {
  process.stdout.write("[ui-tars] UI_TARS_MODE=disabled; adapter not started.\n");
  process.exit(0);
}

const node = process.execPath;
const adapterEntry = path.join(repoRoot, "ui-tars-adapter", "src", "server.ts");

const secret = process.env.UI_TARS_ADAPTER_SECRET?.trim() || crypto.randomBytes(24).toString("hex");
const dataDir =
  process.env.UI_TARS_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard", "ui-tars");
const port = process.env.UI_TARS_ADAPTER_PORT?.trim() || "7719";

const env = {
  ...process.env,
  UI_TARS_ADAPTER_HOST: "127.0.0.1",
  UI_TARS_ADAPTER_PORT: port,
  UI_TARS_ADAPTER_SECRET: secret,
  UI_TARS_DATA_DIR: dataDir,
  // `agent-tars` (real browser runtime) is the default; `fake` is test-only.
  UI_TARS_RUNTIME: process.env.UI_TARS_RUNTIME || "agent-tars",
  UI_TARS_MAX_CONCURRENT_RUNS: process.env.UI_TARS_MAX_CONCURRENT_RUNS || "3",
  UI_TARS_SCREENSHOT_RETENTION_MS: process.env.UI_TARS_SCREENSHOT_RETENTION_MS || "0",
};

await exitIfAlreadyRunning("ui-tars", {
  url: `http://127.0.0.1:${port}/health`,
  headers: { Authorization: `Bearer ${secret}` },
});

const child = spawn(node, ["--experimental-strip-types", adapterEntry], {
  cwd: path.join(repoRoot, "ui-tars-adapter"),
  env,
  stdio: "inherit",
});
child.on("error", (error) => {
  process.stderr.write(`[ui-tars] failed to spawn adapter: ${error.message}\n`);
  process.exit(mode === "required" ? 1 : 0);
});
child.on("exit", (code) => process.exit(code ?? 0));

function shutdown() {
  child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
