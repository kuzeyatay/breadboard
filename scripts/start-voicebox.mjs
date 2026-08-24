#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDashboardEnv, loadRootEnv } from "./load-root-env.mjs";
import { createStatusWriter } from "./voicebox-status.mjs";
import { exitIfAlreadyRunning } from "./service-probe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
loadDashboardEnv(repoRoot);

const voiceboxRoot = path.join(repoRoot, "voicebox");
if (!fs.existsSync(path.join(voiceboxRoot, "backend", "main.py"))) {
  process.stderr.write("[voicebox] Expected the cloned Voicebox checkout at ./voicebox.\n");
  process.exit(1);
}

const windows = process.platform === "win32";
const port = /^\d+$/.test(process.env.VOICEBOX_PORT || "")
  ? process.env.VOICEBOX_PORT
  : "17493";
const dataDir =
  process.env.VOICEBOX_DATA_DIR?.trim() || path.join(repoRoot, ".runtime", "voicebox");
const modelsDir = process.env.VOICEBOX_MODELS_DIR?.trim() || path.join(dataDir, "models");
const environment =
  process.env.VOICEBOX_ENV_DIR?.trim() || path.join(repoRoot, ".runtime", "voicebox-venv");
const statusPath =
  process.env.VOICEBOX_STATUS_PATH?.trim() || path.join(dataDir, "startup-status.json");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(modelsDir, { recursive: true });

// Speech models are the most expensive thing in the stack to warm, so an
// instance that is already serving is always the one to keep.
await exitIfAlreadyRunning("voicebox", { url: `http://127.0.0.1:${port}/health` });

// Settings distinguishes "still working" from "died" by how fresh this file
// is, so every phase this launcher owns keeps a heartbeat and records the pid
// behind it. Loading a speech model can outlast any fixed grace period.
const status = createStatusWriter(statusPath);
const writeStatus = status.write;
const stopHeartbeat = status.stopHeartbeat;

const candidates = [
  process.env.VOICEBOX_PYTHON?.trim(),
  path.join(environment, windows ? "Scripts/python.exe" : "bin/python"),
  path.join(voiceboxRoot, "backend", "venv", windows ? "Scripts/python.exe" : "bin/python"),
  path.join(voiceboxRoot, "backend", ".venv", windows ? "Scripts/python.exe" : "bin/python"),
  path.join(voiceboxRoot, ".venv", windows ? "Scripts/python.exe" : "bin/python"),
  windows ? "python" : "python3",
].filter(Boolean);

function usablePython(command) {
  if (path.isAbsolute(command) && !fs.existsSync(command)) return false;
  const managedPython = path.join(environment, windows ? "Scripts/python.exe" : "bin/python");
  if (
    path.isAbsolute(command) &&
    path.resolve(command) === path.resolve(managedPython) &&
    !fs.existsSync(path.join(environment, ".breadboard-voicebox-ready"))
  ) {
    return false;
  }
  const probe = spawnSync(
    command,
    [
      "-c",
      "import backend.main",
    ],
    { cwd: voiceboxRoot, stdio: "ignore", timeout: 30_000 },
  );
  return probe.status === 0;
}

let python = candidates.find(usablePython);
if (!python) {
  const autoInstall = !/^(0|false|no|off)$/i.test(
    process.env.VOICEBOX_AUTOINSTALL?.trim() ?? "",
  );
  if (!autoInstall) {
    writeStatus("error", "Automatic Voicebox setup is disabled.");
    process.stderr.write("[voicebox] Automatic Voicebox setup is disabled.\n");
    process.exit(1);
  }

  writeStatus(
    "installing",
    "Preparing the local speech service in the background. The first setup is a large download.",
  );
  process.stdout.write("[voicebox] Preparing Voicebox for first use...\n");
  // Setup reports its own steps and download progress into the same file, so
  // stop writing over it until it hands back.
  stopHeartbeat();
  const setup = spawn(process.execPath, [path.join(repoRoot, "scripts", "setup-voicebox.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VOICEBOX_ENV_DIR: environment,
      VOICEBOX_STATUS_PATH: statusPath,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  const setupCode = await new Promise((resolve) => {
    setup.once("error", () => resolve(1));
    setup.once("exit", (code) => resolve(code ?? 1));
  });
  if (setupCode !== 0) process.exit(setupCode);
  python = candidates.find(usablePython);
  if (!python) {
    writeStatus(
      "error",
      "Voicebox setup completed, but its Python environment is still unavailable.",
    );
    process.exit(1);
  }
}

writeStatus("starting", "Voicebox is installed and starting on this machine.");
const child = spawn(
  python,
  ["-m", "backend.main", "--host", "127.0.0.1", "--port", port, "--data-dir", dataDir],
  {
    cwd: voiceboxRoot,
    env: { ...process.env, VOICEBOX_MODELS_DIR: modelsDir },
    stdio: "inherit",
    windowsHide: true,
  },
);

const readinessTimer = setInterval(async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return;
    clearInterval(readinessTimer);
    writeStatus("ready", "Voicebox is ready.");
  } catch {
    // Imports may still be warming up.
  }
}, 1_000);

child.on("error", (error) => {
  clearInterval(readinessTimer);
  writeStatus("error", `Voicebox failed to start: ${error.message}`);
  process.stderr.write(`[voicebox] Failed to start: ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  clearInterval(readinessTimer);
  if (code && code !== 0) writeStatus("error", `Voicebox stopped with exit code ${code}.`);
  else writeStatus("stopped", "The local speech service is stopped.");
  if (signal) process.stderr.write(`[voicebox] Stopped by ${signal}.\n`);
  process.exit(code ?? 0);
});

function shutdown() {
  clearInterval(readinessTimer);
  if (!child.killed) child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
