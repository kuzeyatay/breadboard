#!/usr/bin/env node
// Focused launcher for the Breadboard CAD service (Python sidecar).
//
// The service binds 127.0.0.1 only and refuses to serve without a shared
// secret, so the launcher mints one when the environment has not supplied it
// and prints the two variables the dashboard needs. Mutable per-execution
// workspaces live under .runtime/, never inside the checkout's source tree.
//
//   npm run setup:cad   once, to provision the Python environment
//   npm run dev:cad     to run it

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDashboardEnv, loadRootEnv } from "./load-root-env.mjs";
import { exitIfAlreadyRunning } from "./service-probe.mjs";
import { cadPythonPath } from "./setup-cad.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
// The dashboard's .env.local is where a developer would put an override, and
// this process must agree with the dashboard about the port and the secret.
loadDashboardEnv(repoRoot);

// The same module the dashboard resolves its endpoint with, so both sides read
// the same file-backed secret and no value has to be passed between them.
const { cadPort, cadServiceSecret, cadWorkspaceRoot } = await import(
  pathToFileURL(path.join(repoRoot, "dashboard", "src", "lib", "cad", "config.ts")).href
);

const python = cadPythonPath(repoRoot);
if (!fs.existsSync(python)) {
  process.stderr.write(
    `[cad] no CAD Python environment at ${python}.\n[cad] Run \`npm run setup:cad\` first.\n`,
  );
  process.exit(1);
}

const serviceRoot = path.join(repoRoot, "cad-service");
const port = String(cadPort(process.env));
const secret = cadServiceSecret(process.env);
if (!secret) {
  process.stderr.write(
    "[cad] could not read or create the CAD service secret. Check that Breadboard's data directory is writable.\n",
  );
  process.exit(1);
}
const workspace = cadWorkspaceRoot(process.env);
fs.mkdirSync(workspace, { recursive: true });

const env = {
  ...process.env,
  PYTHONUNBUFFERED: "1",
  PYTHONDONTWRITEBYTECODE: "1",
  BREADBOARD_CAD_HOST: "127.0.0.1",
  BREADBOARD_CAD_PORT: port,
  // Passed through the environment, never argv, so it cannot leak into a
  // process listing.
  BREADBOARD_CAD_SECRET: secret,
  BREADBOARD_CAD_WORKSPACE: workspace,
};

// Nothing to copy anywhere: the dashboard resolves the same port and reads the
// same secret file through dashboard/src/lib/cad/config.ts.
process.stdout.write(`[cad] serving on http://127.0.0.1:${port} (loopback only)\n`);

// The secret is file-backed and shared with the dashboard, so an instance
// that answers it is one this checkout can use — reuse it rather than racing
// it for the port.
await exitIfAlreadyRunning("cad", {
  url: `http://127.0.0.1:${port}/health`,
  headers: { Authorization: `Bearer ${secret}` },
});

const child = spawn(python, ["-m", "breadboard_cad", "serve", "--host", "127.0.0.1", "--port", port], {
  cwd: serviceRoot,
  env,
  stdio: "inherit",
});
child.on("error", (error) => {
  process.stderr.write(`[cad] failed to start the CAD service: ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));

function shutdown() {
  child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
