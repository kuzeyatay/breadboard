#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStatusWriter } from "./voicebox-status.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const voiceboxRoot = path.join(repoRoot, "voicebox");
const backendRoot = path.join(voiceboxRoot, "backend");
const environment =
  process.env.VOICEBOX_ENV_DIR?.trim() || path.join(repoRoot, ".runtime", "voicebox-venv");
const windows = process.platform === "win32";
const python = path.join(environment, windows ? "Scripts/python.exe" : "bin/python");
const readyMarker = path.join(environment, ".breadboard-voicebox-ready");
const uv = process.env.UV_BIN?.trim() || "uv";
const statusPath =
  process.env.VOICEBOX_STATUS_PATH?.trim() ||
  path.join(repoRoot, ".runtime", "voicebox", "startup-status.json");
const setupLockPath = path.join(path.dirname(statusPath), "setup.lock");

/**
 * Beyond the shared heartbeat, this writer also reports the current step and
 * byte-level download progress, so the panel can show which of the six steps
 * is running and how far into a 2.75 GB wheel it is.
 */
const PROGRESS_WRITE_MS = 1_000;

const status = createStatusWriter(statusPath, {
  message: "Preparing the local speech service.",
  step: 0,
  totalSteps: 0,
  detail: null,
  progress: null,
});
const state = status.state;
const persistStatus = status.persist;

function writeStatus(phase, message, extra = {}) {
  status.write(phase, message, { detail: null, progress: null, ...extra });
}

function log(line) {
  process.stdout.write(`[voicebox setup] ${line}\n`);
}

/** `torch-2.11.0%2Bcu128-cp312-cp312-win_amd64.whl` -> `torch 2.11.0+cu128`. */
function describeArtifact(filename) {
  const decoded = decodeURIComponent(filename).replace(/\.(whl|tar\.gz|zip)$/i, "");
  const match = /^([A-Za-z0-9._]+?)-(\d[^-]*)/.exec(decoded);
  return match ? `${match[1]} ${match[2]}` : decoded;
}

const DOWNLOADING = /^\s*Downloading\s+(\S+?)(?:\s+\(([\d.]+)\s*([kKMG]?B)\))?\s*$/;
const PROGRESS = /^\s*Progress\s+(\d+)\s+of\s+(\d+)\s*$/;
const COLLECTING = /^\s*Installing collected packages:/;

let lastProgressWrite = 0;
let lastProgressLog = 0;
let lastErrorLine = null;

/**
 * Interpret pip's output as progress. Returns true when the line is pure
 * progress noise that should stay out of the service log.
 */
function observeLine(line) {
  const progress = PROGRESS.exec(line);
  if (progress) {
    const received = Number(progress[1]);
    const total = Number(progress[2]);
    state.progress = { receivedBytes: received, totalBytes: total };
    const now = Date.now();
    if (now - lastProgressWrite >= PROGRESS_WRITE_MS) {
      lastProgressWrite = now;
      persistStatus();
    }
    const percent = total > 0 ? Math.floor((received / total) * 100) : 0;
    if (percent >= lastProgressLog + 10) {
      lastProgressLog = percent - (percent % 10);
      log(`${state.detail || "download"}: ${lastProgressLog}%`);
    }
    return true;
  }

  const downloading = DOWNLOADING.exec(line);
  if (downloading) {
    state.detail = describeArtifact(downloading[1]);
    state.progress = null;
    lastProgressLog = 0;
    persistStatus();
    return false;
  }

  if (COLLECTING.test(line)) {
    state.detail = "Unpacking the downloaded packages";
    state.progress = null;
    persistStatus();
  }
  // "python.exe exited with code 1" tells nobody anything; pip's own ERROR
  // line is what belongs in Settings.
  const failure = /^\s*ERROR:\s*(.+)$/.exec(line);
  if (failure) lastErrorLine = failure[1].trim();
  return false;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: voiceboxRoot,
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

function acquireSetupLock() {
  fs.mkdirSync(path.dirname(setupLockPath), { recursive: true });
  const deadline = Date.now() + 2 * 60 * 60_000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    try {
      const descriptor = fs.openSync(setupLockPath, "wx");
      fs.writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      );
      return descriptor;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
      // A killed setup leaves its lock behind, so trust the recorded pid over
      // the clock: waiting hours for a process that no longer exists would
      // leave speech permanently "installing".
      if (!lockHolderAlive()) {
        fs.rmSync(setupLockPath, { force: true });
        continue;
      }
      try {
        const age = Date.now() - fs.statSync(setupLockPath).mtimeMs;
        if (age > 6 * 60 * 60_000) {
          fs.rmSync(setupLockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      writeStatus("waiting", "Another Breadboard process is preparing the local speech service.");
      Atomics.wait(sleeper, 0, 0, 2_000);
    }
  }
  throw new Error("Timed out waiting for another Voicebox setup to finish.");
}

function lockHolderAlive() {
  let holder;
  try {
    holder = JSON.parse(fs.readFileSync(setupLockPath, "utf8"));
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

function wheelAvailable(requirement) {
  const probe = spawnSync(
    python,
    ["-m", "pip", "install", "--dry-run", "--no-deps", "--only-binary", ":all:", requirement],
    { cwd: voiceboxRoot, stdio: "ignore", windowsHide: true, timeout: 120_000 },
  );
  return probe.status === 0;
}

function importable(moduleName) {
  const probe = spawnSync(python, ["-c", `import ${moduleName}`], {
    cwd: voiceboxRoot,
    stdio: "ignore",
    windowsHide: true,
    timeout: 60_000,
  });
  return probe.status === 0;
}

/** Drop one extra from a `package[a,b,c]` requirement line, keeping the rest. */
function withoutExtra(requirementsText, packageName, extra) {
  const pattern = new RegExp(`^(\\s*${packageName}\\[)([^\\]]*)(\\].*)$`, "m");
  return requirementsText.replace(pattern, (line, head, extras, tail) => {
    const kept = extras
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== extra);
    return kept.length ? `${head}${kept.join(",")}${tail}` : `${head.slice(0, -1)}${tail.slice(1)}`;
  });
}

/**
 * Install the backend requirements, working around misaki's `ja` extra.
 *
 * That extra pulls `pyopenjtalk`, which publishes no Windows wheel and whose
 * sdist needs a C++ toolchain a normal machine does not have — it is what
 * turned a finished 2.7 GB download into a failed install. The clone stays
 * pristine, so the substitution happens here: prefer the prebuilt fork, which
 * imports under the same name, and only give up Japanese G2P if even that is
 * unavailable. Everything else installs either way.
 */
async function installRequirements(pip) {
  const requirements = path.join(backendRoot, "requirements.txt");
  if (wheelAvailable("pyopenjtalk")) {
    await pip(["install", "-r", requirements]);
    return;
  }

  log("pyopenjtalk has no wheel for this machine; using the prebuilt Japanese G2P instead.");
  let japanese = false;
  try {
    await pip([
      "install",
      "--only-binary",
      ":all:",
      "fugashi",
      "jaconv",
      "mojimoji",
      "pyopenjtalk-plus",
    ]);
    japanese = importable("pyopenjtalk");
  } catch {
    japanese = false;
  }

  const derived = path.join(environment, "breadboard-requirements.txt");
  fs.writeFileSync(
    derived,
    withoutExtra(fs.readFileSync(requirements, "utf8"), "misaki", "ja"),
    "utf8",
  );
  await pip(["install", "-r", derived]);
  if (!japanese) {
    log("Japanese speech is unavailable: pyopenjtalk needs a C++ build toolchain on this machine.");
  }
}

function verifyPythonVersion() {
  const version = spawnSync(
    python,
    ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
    { encoding: "utf8", windowsHide: true },
  );
  if (version.status !== 0 || version.stdout.trim() !== "3.12") {
    throw new Error(
      `Expected Python 3.12 in ${environment}; found ${version.stdout.trim() || "unknown"}.`,
    );
  }
}

if (!fs.existsSync(path.join(backendRoot, "requirements.txt"))) {
  writeStatus("error", "The cloned Voicebox checkout was not found.");
  process.stderr.write("[voicebox setup] Expected the cloned Voicebox checkout at ./voicebox.\n");
  process.exit(1);
}

let setupLock = null;
let released = false;

function releaseLock() {
  if (setupLock === null || released) return;
  released = true;
  try {
    fs.closeSync(setupLock);
  } finally {
    fs.rmSync(setupLockPath, { force: true });
  }
}

// A graceful stop still leaves the user staring at this status, so say the
// setup was interrupted instead of leaving a phase that reads like progress.
for (const signal of windows ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    writeStatus("interrupted", "Speech setup was stopped before it finished.");
    releaseLock();
    process.exit(1);
  });
}

try {
  setupLock = acquireSetupLock();
  const readyProbe =
    fs.existsSync(python) && fs.existsSync(readyMarker)
      ? spawnSync(python, ["-c", "import backend.main"], {
          cwd: voiceboxRoot,
          stdio: "ignore",
          windowsHide: true,
          timeout: 30_000,
        })
      : null;
  if (readyProbe?.status === 0) {
    writeStatus(
      "installed",
      "Voicebox dependencies are installed. Starting the local speech service.",
    );
    log("Existing Voicebox runtime is ready.");
  } else {
    const uvProbe = spawnSync(uv, ["--version"], { stdio: "ignore", windowsHide: true });
    if (uvProbe.status !== 0) {
      throw new Error("uv is required to prepare the local speech environment.");
    }

    let progressArgs = null;
    const pip = (args) => {
      // Resolved lazily: the interpreter does not exist until the first step
      // has created the environment.
      if (progressArgs === null) progressArgs = rawProgressArgs();
      return run(python, ["-m", "pip", ...args, ...progressArgs]);
    };

    const gpuName = detectGpuName();
    const steps = [
      {
        phase: "environment",
        message: "Preparing an isolated Python 3.12 speech environment.",
        action: async () => {
          if (!fs.existsSync(python)) {
            await run(uv, ["venv", "--seed", "--python", "3.12", environment]);
          }
          verifyPythonVersion();
        },
      },
      {
        phase: "tooling",
        message: "Updating the Python package installer.",
        action: () => pip(["install", "--upgrade", "pip"]),
      },
    ];
    if (gpuName) {
      steps.push({
        phase: "acceleration",
        message: `Installing GPU acceleration for ${gpuName}.`,
        action: () =>
          pip([
            "install",
            "torch",
            "torchvision",
            "torchaudio",
            "--index-url",
            "https://download.pytorch.org/whl/cu128",
          ]),
      });
    }
    steps.push(
      {
        phase: "dependencies",
        message: "Installing Voicebox speech and audio dependencies.",
        action: () => installRequirements(pip),
      },
      {
        phase: "engines",
        message: "Installing the Chatterbox and TADA speech engines.",
        action: async () => {
          await pip(["install", "--no-deps", "chatterbox-tts"]);
          await pip(["install", "--no-deps", "hume-tada"]);
        },
      },
      {
        phase: "engines",
        message: "Installing the Qwen3 speech engine.",
        action: () => pip(["install", "git+https://github.com/QwenLM/Qwen3-TTS.git"]),
      },
    );

    log("Installing the local speech runtime. The first setup is a large download.");
    for (const [index, step] of steps.entries()) {
      writeStatus(step.phase, step.message, { step: index + 1, totalSteps: steps.length });
      log(`Step ${index + 1} of ${steps.length}: ${step.message}`);
      await step.action();
    }

    fs.writeFileSync(readyMarker, new Date().toISOString(), "utf8");
    writeStatus(
      "installed",
      "Voicebox dependencies are installed. Starting the local speech service.",
      { step: steps.length, totalSteps: steps.length },
    );
    log("Voicebox runtime is ready.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeStatus("error", lastErrorLine || message);
  process.stderr.write(`[voicebox setup] ${message}\n`);
  if (lastErrorLine) process.stderr.write(`[voicebox setup] ${lastErrorLine}\n`);
  process.exitCode = 1;
} finally {
  status.stopHeartbeat();
  releaseLock();
}
