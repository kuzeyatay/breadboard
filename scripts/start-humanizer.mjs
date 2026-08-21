#!/usr/bin/env node
// Focused launcher for the Breadboard humanizer service (Python sidecar).
//
// The service binds 127.0.0.1 only and refuses to serve without a shared
// secret, so the launcher reads the same file-backed secret the dashboard does
// and passes it through the environment rather than argv.
//
//   npm run setup:humanizer   once, to provision the Python environment
//   npm run dev:humanizer     to run it

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDashboardEnv, loadRootEnv } from "./load-root-env.mjs";
import { humanizerPythonPath } from "./setup-humanizer.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
// The dashboard's .env.local is where a developer would put an override, and
// this process must agree with the dashboard about the port and the secret.
loadDashboardEnv(repoRoot);

// The same module the dashboard resolves its endpoint with, so both sides read
// the same file-backed secret and no value has to be passed between them.
const {
  humanizerPort,
  humanizerServiceSecret,
  humanizerHome,
  humanizerModelCache,
  humanizerModel,
  humanizerRevision,
  humanizerDevice,
} = await import(
  pathToFileURL(path.join(repoRoot, "dashboard", "src", "lib", "humanizer", "config.ts")).href
);

const python = humanizerPythonPath(repoRoot);
if (!fs.existsSync(python)) {
  process.stderr.write(
    `[humanizer] no humanizer Python environment at ${python}.\n` +
      "[humanizer] Run `npm run setup:humanizer` first (it downloads ~2.5 GB).\n",
  );
  process.exit(1);
}

const serviceRoot = path.join(repoRoot, "humanizer-service");
const port = String(humanizerPort(process.env));
const secret = humanizerServiceSecret(process.env);
if (!secret) {
  process.stderr.write(
    "[humanizer] could not read or create the service secret. Check that Breadboard's data directory is writable.\n",
  );
  process.exit(1);
}
const home = humanizerHome(process.env);
const cache = humanizerModelCache(process.env);
fs.mkdirSync(cache, { recursive: true });

const env = {
  ...process.env,
  PYTHONUNBUFFERED: "1",
  PYTHONDONTWRITEBYTECODE: "1",
  BREADBOARD_HUMANIZER_HOME: home,
  BREADBOARD_HUMANIZER_PORT: port,
  // Passed through the environment, never argv, so it cannot leak into a
  // process listing.
  BREADBOARD_HUMANIZER_SECRET: secret,
  BREADBOARD_HUMANIZER_MODEL: humanizerModel(process.env),
  BREADBOARD_HUMANIZER_REVISION: humanizerRevision(process.env),
  BREADBOARD_HUMANIZER_DEVICE: humanizerDevice(process.env),
  HF_HOME: cache,
  HF_HUB_DISABLE_TELEMETRY: "1",
  DISABLE_TELEMETRY: "1",
};

process.stdout.write(
  `[humanizer] serving on http://127.0.0.1:${port} (loopback only)\n` +
    `[humanizer] model ${env.BREADBOARD_HUMANIZER_MODEL}@${env.BREADBOARD_HUMANIZER_REVISION}, preloading during startup\n` +
    `[humanizer] device ${env.BREADBOARD_HUMANIZER_DEVICE}, cache ${cache}\n`,
);

const child = spawn(
  python,
  [
    "-m",
    "breadboard_humanizer",
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--preload",
  ],
  { cwd: serviceRoot, env, stdio: "inherit" },
);
child.on("error", (error) => {
  process.stderr.write(`[humanizer] failed to start the humanizer service: ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));

function shutdown() {
  child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
