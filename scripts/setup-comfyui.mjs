#!/usr/bin/env node

// Builds the Python environment the vendored ComfyUI runs in.
//
// This is the one part of the Advanced image tab that cannot be quick: PyTorch
// alone is a multi-gigabyte download, and on a first run this process is doing
// nothing else for several minutes. So it is never run inline with a request —
// the dashboard starts it detached and watches the status file it heartbeats,
// which is what lets Settings say "still downloading torch" instead of leaving
// a spinner that might mean anything.
//
// What it does NOT do is fetch a model. A checkpoint is a taste decision (and
// often a licence decision) worth several gigabytes, so ComfyUI is left with an
// empty models directory and the UI says so plainly.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The shared setup-status protocol: a heartbeat plus the writer's pid, so a
// reader can tell a slow install from a dead one. It lives under the Voicebox
// name because that is the engine it was written for; the contract is general.
import { createStatusWriter } from "./voicebox-status.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloneRoot = process.env.COMFYUI_ROOT?.trim() || path.join(repoRoot, "comfyui");
const environment =
  process.env.COMFYUI_ENV_DIR?.trim() || path.join(repoRoot, ".runtime", "comfyui-venv");
const windows = process.platform === "win32";
const python = path.join(environment, windows ? "Scripts/python.exe" : "bin/python");
const readyMarker = path.join(environment, ".breadboard-comfyui-ready");
const uv = process.env.UV_BIN?.trim() || "uv";
const statusPath =
  process.env.COMFYUI_STATUS_PATH?.trim() ||
  path.join(repoRoot, ".runtime", "comfyui", "startup-status.json");
const lockPath = path.join(path.dirname(statusPath), "setup.lock");

const status = createStatusWriter(statusPath, {
  message: "Preparing the local image generator.",
  step: 0,
  totalSteps: 0,
  detail: null,
  progress: null,
});

function writeStatus(phase, message, extra = {}) {
  status.write(phase, message, { detail: null, progress: null, ...extra });
}

function log(line) {
  process.stdout.write(`[comfyui setup] ${line}\n`);
}

const DOWNLOADING = /^\s*Downloading\s+(\S+?)(?:\s+\(([\d.]+)\s*([kKMG]?B)\))?\s*$/;
const PROGRESS = /^\s*Progress\s+(\d+)\s+of\s+(\d+)\s*$/;
const COLLECTING = /^\s*Installing collected packages:/;
const PROGRESS_WRITE_MS = 1_000;

let lastProgressWrite = 0;
let lastErrorLine = null;

/** `torch-2.6.0%2Bcu128-cp312-...whl` -> `torch 2.6.0+cu128`. */
function describeArtifact(filename) {
  const decoded = decodeURIComponent(filename).replace(/\.(whl|tar\.gz|zip)$/i, "");
  const match = /^([A-Za-z0-9._]+?)-(\d[^-]*)/.exec(decoded);
  return match ? `${match[1]} ${match[2]}` : decoded;
}

/** Turn pip's chatter into progress. True means "keep it out of the log". */
function observeLine(line) {
  const progress = PROGRESS.exec(line);
  if (progress) {
    status.state.progress = { receivedBytes: Number(progress[1]), totalBytes: Number(progress[2]) };
    const now = Date.now();
    if (now - lastProgressWrite >= PROGRESS_WRITE_MS) {
      lastProgressWrite = now;
      status.persist();
    }
    return true;
  }
  const downloading = DOWNLOADING.exec(line);
  if (downloading) {
    status.state.detail = describeArtifact(downloading[1]);
    status.state.progress = null;
    status.persist();
    return false;
  }
  if (COLLECTING.test(line)) {
    status.state.detail = "Unpacking the downloaded packages";
    status.state.progress = null;
    status.persist();
  }
  const failure = /^\s*ERROR:\s*(.+)$/.exec(line);
  if (failure) lastErrorLine = failure[1].trim();
  return false;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cloneRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const forward = (stream, sink) => {
      let buffer = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (!observeLine(line)) sink.write(`${line}\n`);
          newline = buffer.indexOf("\n");
        }
      });
      stream.on("end", () => {
        if (buffer.trim() && !observeLine(buffer)) sink.write(`${buffer}\n`);
      });
    };
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code ?? "unknown"}`));
    });
  });
}

function holderAlive() {
  let holder;
  try {
    holder = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return false;
  }
  const pid = Number(holder?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && error.code === "EPERM");
  }
}

/** One install at a time, and never blocked forever by a lock nobody holds. */
function acquireLock() {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 2 * 60 * 60_000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    try {
      const descriptor = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      );
      return descriptor;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
      if (!holderAlive()) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      writeStatus("waiting", "Another Breadboard process is preparing the image generator.");
      Atomics.wait(sleeper, 0, 0, 2_000);
    }
  }
  throw new Error("Timed out waiting for another ComfyUI setup to finish.");
}

function detectGpuName() {
  const nvidia = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (nvidia.status !== 0 || !nvidia.stdout.trim()) return null;
  return nvidia.stdout.trim().split(/\r?\n/)[0];
}

/** pip only reports machine-readable download progress when asked for it. */
function rawProgressArgs() {
  const help = spawnSync(python, ["-m", "pip", "install", "--help"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return help.status === 0 && /--progress-bar/.test(help.stdout || "") && /raw/.test(help.stdout || "")
    ? ["--progress-bar", "raw"]
    : [];
}

function importable(moduleName) {
  const probe = spawnSync(python, ["-c", `import ${moduleName}`], {
    cwd: cloneRoot,
    stdio: "ignore",
    windowsHide: true,
    timeout: 120_000,
  });
  return probe.status === 0;
}

let lock = null;
let released = false;

function releaseLock() {
  if (lock === null || released) return;
  released = true;
  try {
    fs.closeSync(lock);
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

for (const signal of windows ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    writeStatus("interrupted", "Image generator setup was stopped before it finished.");
    releaseLock();
    process.exit(1);
  });
}

if (!fs.existsSync(path.join(cloneRoot, "requirements.txt"))) {
  writeStatus("error", "The cloned ComfyUI checkout was not found.");
  process.stderr.write(`[comfyui setup] Expected a ComfyUI checkout at ${cloneRoot}.\n`);
  process.exit(1);
}

try {
  lock = acquireLock();

  if (fs.existsSync(python) && fs.existsSync(readyMarker) && importable("torch")) {
    writeStatus("installed", "ComfyUI is already installed.");
    log("Existing ComfyUI environment is ready.");
  } else {
    const uvProbe = spawnSync(uv, ["--version"], { stdio: "ignore", windowsHide: true });
    if (uvProbe.status !== 0) {
      throw new Error(
        "uv is required to prepare the ComfyUI environment. Install it from https://docs.astral.sh/uv/.",
      );
    }

    let progressArgs = null;
    const pip = (args) => {
      if (progressArgs === null) progressArgs = rawProgressArgs();
      return run(python, ["-m", "pip", ...args, ...progressArgs]);
    };

    const gpuName = detectGpuName();
    const steps = [
      {
        phase: "environment",
        message: "Preparing an isolated Python 3.12 environment for ComfyUI.",
        action: async () => {
          if (!fs.existsSync(python)) {
            await run(uv, ["venv", "--seed", "--python", "3.12", environment]);
          }
        },
      },
      {
        phase: "tooling",
        message: "Updating the Python package installer.",
        action: () => pip(["install", "--upgrade", "pip"]),
      },
      {
        phase: "acceleration",
        message: gpuName
          ? `Installing GPU acceleration for ${gpuName}.`
          : "Installing PyTorch for the CPU. Rendering will be slow without a GPU.",
        action: () =>
          gpuName
            ? pip([
                "install",
                "torch",
                "torchvision",
                "--index-url",
                "https://download.pytorch.org/whl/cu128",
              ])
            : pip(["install", "torch", "torchvision"]),
      },
      {
        phase: "dependencies",
        message: "Installing the ComfyUI dependencies.",
        action: () => pip(["install", "-r", path.join(cloneRoot, "requirements.txt")]),
      },
    ];

    log("Installing the ComfyUI runtime. The first setup is a large download.");
    for (const [index, step] of steps.entries()) {
      writeStatus(step.phase, step.message, { step: index + 1, totalSteps: steps.length });
      log(`Step ${index + 1} of ${steps.length}: ${step.message}`);
      await step.action();
    }

    fs.writeFileSync(readyMarker, new Date().toISOString(), "utf8");
    writeStatus("installed", "ComfyUI is installed and ready to start.");
    log("ComfyUI environment is ready.");
  }
} catch (error) {
  const detail = lastErrorLine || (error instanceof Error ? error.message : String(error));
  writeStatus("error", `ComfyUI setup failed: ${detail}`);
  process.stderr.write(`[comfyui setup] ${detail}\n`);
  releaseLock();
  process.exit(1);
}

releaseLock();
process.exit(0);
