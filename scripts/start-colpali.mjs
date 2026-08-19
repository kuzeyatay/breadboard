#!/usr/bin/env node
// Focused launcher for the Breadboard ColPali service (Python sidecar).
//
// The service binds 127.0.0.1 only and refuses to serve without a shared
// secret, so the launcher reads the same file-backed secret the dashboard does
// and passes it through the environment rather than argv.
//
//   npm run setup:colpali   once, to provision the Python environment
//   npm run dev:colpali     to run it

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDashboardEnv, loadRootEnv } from "./load-root-env.mjs";
import { colpaliPythonPath } from "./setup-colpali.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
// The dashboard's .env.local is where a developer would put an override, and
// this process must agree with the dashboard about the port and the secret.
loadDashboardEnv(repoRoot);

// The same module the dashboard resolves its endpoint with, so both sides read
// the same file-backed secret and no value has to be passed between them.
const { colpaliPort, colpaliServiceSecret, colpaliHome, colpaliModel } = await import(
  pathToFileURL(path.join(repoRoot, "dashboard", "src", "lib", "colpali", "config.ts")).href
);

const python = colpaliPythonPath(repoRoot);
if (!fs.existsSync(python)) {
  process.stderr.write(
    `[colpali] no ColPali Python environment at ${python}.\n` +
      "[colpali] Run `npm run setup:colpali` first (it downloads ~3.5 GB).\n",
  );
  process.exit(1);
}

const serviceRoot = path.join(repoRoot, "colpali-service");
const port = String(colpaliPort(process.env));
const secret = colpaliServiceSecret(process.env);
if (!secret) {
  process.stderr.write(
    "[colpali] could not read or create the service secret. Check that Breadboard's data directory is writable.\n",
  );
  process.exit(1);
}
const home = colpaliHome(process.env);
const indexRoot = path.join(home, "index");
fs.mkdirSync(indexRoot, { recursive: true });

const env = {
  ...process.env,
  PYTHONUNBUFFERED: "1",
  PYTHONDONTWRITEBYTECODE: "1",
  BREADBOARD_COLPALI_HOME: home,
  BREADBOARD_COLPALI_PORT: port,
  // Passed through the environment, never argv, so it cannot leak into a
  // process listing.
  BREADBOARD_COLPALI_SECRET: secret,
  BREADBOARD_COLPALI_MODEL: colpaliModel(process.env),
};

process.stdout.write(
  `[colpali] serving on http://127.0.0.1:${port} (loopback only)\n` +
    `[colpali] model ${env.BREADBOARD_COLPALI_MODEL}, loaded on first request\n`,
);

const child = spawn(
  python,
  ["-m", "breadboard_colpali", "serve", "--host", "127.0.0.1", "--port", port],
  { cwd: serviceRoot, env, stdio: "inherit" },
);
child.on("error", (error) => {
  process.stderr.write(`[colpali] failed to start the ColPali service: ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));

function shutdown() {
  child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
