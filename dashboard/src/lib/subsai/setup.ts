// Building the subtitle environment, only when someone asks for it.
//
// This is the one part of the subtitle path that is genuinely expensive: torch
// is unavoidable (every backend adapter imports `subsai.utils`, which imports
// it), torch pins the interpreter to 3.12 or older, and the CPU wheel is still
// hundreds of megabytes. So `uv` fetches its own Python and builds a venv
// inside the clone, and nothing here ever runs behind a chat turn.
//
// Only one backend is installed. `configs.py` registers whichever imported, so
// a checkout with faster-whisper alone is a working checkout — and faster-whisper
// is the one that gives word-level timings on a CPU, which is what the video
// editor needs. The rest of the zoo (whisperX, stable-ts, whisper.cpp, Hugging
// Face) is left out on purpose: each is another gigabyte for a capability
// nothing here asks for.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { invalidateHealth, recordModels, resolveSubsAiRoot, resolveUv, subsAiEnv } from "./runtime.ts";

/** Torch's ceiling, and comfortably inside faster-whisper's support. */
const PYTHON_VERSION = "3.11";

const STEP_TIMEOUT_MS = 45 * 60_000;

export interface SetupResult {
  ok: boolean;
  message: string;
  detail?: string;
}

function run(
  binary: string,
  args: string[],
  options: { cwd: string; onLine?: (line: string) => void },
): Promise<{ code: number | null; tail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: subsAiEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    let buffer = "";
    const consume = (chunk: string) => {
      tail = `${tail}${chunk}`.slice(-8_000);
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) options.onLine?.(line);
        newline = buffer.indexOf("\n");
      }
      if (buffer.length > 100_000) buffer = "";
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, STEP_TIMEOUT_MS);
    timer.unref?.();

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, tail });
    });
  });
}

function lastLines(tail: string, count = 4): string {
  return tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\s*\d+%/.test(line) && !line.startsWith("█"))
    .slice(-count)
    .join("\n");
}

/**
 * Create the venv and install one backend into it.
 *
 * Deliberately not `pip install -e .`: the clone's `requirements.txt` pins the
 * union of every backend, including two git checkouts, and installing it would
 * take an hour to deliver capabilities nothing here uses. The package itself is
 * installed without dependencies and the ones it actually imports are named
 * explicitly.
 */
export async function buildEnvironment(
  onLine?: (line: string) => void,
): Promise<SetupResult> {
  const runtime = resolveSubsAiRoot();
  if (!runtime) {
    return { ok: false, message: "The subsai clone was not found next to the dashboard." };
  }
  const uv = resolveUv();
  if (!uv) {
    return {
      ok: false,
      message: "uv was not found, and it is what builds this environment. Install uv and try again.",
    };
  }

  const venv = await run(uv, ["venv", "--python", PYTHON_VERSION, ".venv"], {
    cwd: runtime.root,
    onLine,
  });
  if (venv.code !== 0) {
    return {
      ok: false,
      message: `The environment could not be created (Python ${PYTHON_VERSION}).`,
      detail: lastLines(venv.tail),
    };
  }

  // CPU torch: the GPU wheels are several gigabytes and nothing here needs one.
  const install = await run(
    uv,
    [
      "pip", "install",
      "--python", ".venv",
      "--index-strategy", "unsafe-best-match",
      "--extra-index-url", "https://download.pytorch.org/whl/cpu",
      "torch==2.2.0",
      "numpy<2",
      "faster-whisper",
      "pysubs2~=1.6.0",
      "ffsubsync~=0.4.24",
      "dl_translate==0.3.0",
      "ffmpeg-python>=0.2.0",
      "tqdm",
    ],
    { cwd: runtime.root, onLine },
  );
  if (install.code !== 0) {
    return {
      ok: false,
      message: "The subtitle engine could not be installed.",
      detail: lastLines(install.tail),
    };
  }

  // The package itself, without its dependency union — the imports it needs are
  // already above, and the rest of the zoo is what we are avoiding.
  const self = await run(
    uv,
    ["pip", "install", "--python", ".venv", "--no-deps", "-e", "."],
    { cwd: runtime.root, onLine },
  );
  if (self.code !== 0) {
    return {
      ok: false,
      message: "subsai itself could not be installed into the environment.",
      detail: lastLines(self.tail),
    };
  }

  recordModels(runtime.root, ["guillaumekln/faster-whisper"]);
  invalidateHealth();
  return {
    ok: true,
    message: "Subtitles are ready. The first run also downloads the speech model.",
  };
}

/** Delete the environment. Nothing else in the clone is touched. */
export function removeEnvironment(): SetupResult {
  const runtime = resolveSubsAiRoot();
  if (!runtime) {
    return { ok: false, message: "The subsai clone was not found next to the dashboard." };
  }
  try {
    fs.rmSync(path.join(runtime.root, ".venv"), { recursive: true, force: true });
    invalidateHealth();
    return { ok: true, message: "The subtitle environment was removed." };
  } catch (error) {
    return {
      ok: false,
      message: "The environment could not be removed.",
      detail: error instanceof Error ? error.message : undefined,
    };
  }
}
