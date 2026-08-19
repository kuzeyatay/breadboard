#!/usr/bin/env node
// Provision the ColPali service's Python environment.
//
// This is the one step in the whole integration that must stay explicit. It
// downloads roughly 3.5 GB — about 2.5 GB of PyTorch with CUDA 12.4 kernels,
// and about 1 GB of model weights — so it is never chained onto `npm install`
// and never triggered by an upload. A machine that has not run it behaves
// exactly as Breadboard did before ColPali existed: documents are inlined
// whole.
//
// The environment gets its own pinned interpreter rather than sharing one.
// This repository's default Python is 3.14, for which PyTorch publishes no
// Windows wheels; `uv` fetches 3.13 instead. The virtualenv lands under
// .runtime/, which is already gitignored.
//
// Run once:  npm run setup:colpali

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvDir =
  process.env.COLPALI_VENV?.trim() || path.join(repoRoot, ".runtime", "colpali-venv");
const requirements = path.join(repoRoot, "colpali-service", "requirements.txt");

/** Matches DEFAULT_MODEL_ID in breadboard_colpali/__init__.py. */
const MODEL_ID = process.env.BREADBOARD_COLPALI_MODEL?.trim() || "vidore/colSmol-500M";

/** CUDA 12.4 wheels. A machine without an NVIDIA card falls back below. */
const TORCH_INDEX = "https://download.pytorch.org/whl/cu124";

export function colpaliPythonPath(root = repoRoot) {
  const dir = process.env.COLPALI_VENV?.trim() || path.join(root, ".runtime", "colpali-venv");
  return process.platform === "win32"
    ? path.join(dir, "Scripts", "python.exe")
    : path.join(dir, "bin", "python");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function haveUv() {
  const probe = spawnSync(process.platform === "win32" ? "uv.exe" : "uv", ["--version"], {
    stdio: "ignore",
    shell: false,
  });
  return probe.status === 0;
}

function haveNvidia() {
  const probe = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
    stdio: "ignore",
    shell: false,
  });
  return probe.status === 0;
}

function main() {
  if (!fs.existsSync(requirements)) {
    throw new Error(`Missing ${requirements}. Is the colpali-service directory present?`);
  }
  const python = colpaliPythonPath();

  if (!fs.existsSync(python)) {
    if (!haveUv()) {
      process.stderr.write(
        [
          "[colpali] `uv` is required to provision the environment on a pinned Python 3.13.",
          "[colpali] Install it from https://docs.astral.sh/uv/ and run `npm run setup:colpali` again.",
          "[colpali] Alternatively, create the environment yourself:",
          `[colpali]   python3.13 -m venv "${venvDir}"`,
          `[colpali]   "${python}" -m pip install -r "${requirements}"`,
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
    process.stdout.write("[colpali] creating the ColPali virtualenv on Python 3.13…\n");
    run("uv", ["venv", "--python", "3.13", venvDir]);
  }

  // Torch first and from its own index, so pip resolves the CUDA build rather
  // than the CPU wheel colpali-engine would otherwise pull in as a dependency.
  const cuda = haveNvidia();
  process.stdout.write(
    cuda
      ? "[colpali] installing PyTorch with CUDA 12.4 (~2.5 GB)…\n"
      : "[colpali] no NVIDIA GPU found; installing CPU PyTorch (embedding will be slow)…\n",
  );
  const torchArgs = ["torch", "torchvision"];
  if (haveUv()) {
    run("uv", [
      "pip",
      "install",
      "--python",
      python,
      ...(cuda ? ["--index-url", TORCH_INDEX] : []),
      ...torchArgs,
    ]);
  } else {
    run(python, [
      "-m",
      "pip",
      "install",
      ...(cuda ? ["--index-url", TORCH_INDEX] : []),
      ...torchArgs,
    ]);
  }

  process.stdout.write("[colpali] installing colpali-engine and its dependencies…\n");
  if (haveUv()) {
    run("uv", ["pip", "install", "--python", python, "-r", requirements]);
  } else {
    run(python, ["-m", "pip", "install", "-r", requirements]);
  }

  process.stdout.write(`[colpali] fetching ${MODEL_ID} (~1 GB)…\n`);
  const fetch = spawnSync(
    python,
    [
      "-c",
      "import sys;" +
        "from colpali_engine.models import ColIdefics3, ColIdefics3Processor;" +
        `ColIdefics3Processor.from_pretrained(${JSON.stringify(MODEL_ID)});` +
        `ColIdefics3.from_pretrained(${JSON.stringify(MODEL_ID)});` +
        "print('model ready')",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (fetch.status !== 0) {
    process.stderr.write(
      "[colpali] the model could not be downloaded. Check network access to huggingface.co.\n",
    );
    process.exit(1);
  }

  const probe = spawnSync(
    python,
    [
      "-c",
      "import torch, sys, importlib.metadata as m;" +
        "print('python', sys.version.split()[0]);" +
        "print('torch', torch.__version__);" +
        "print('cuda', torch.version.cuda or 'cpu-only');" +
        "print('device', 'cuda:0' if torch.cuda.is_available() else 'cpu');" +
        "print('colpali-engine', m.version('colpali-engine'))",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (probe.status !== 0) {
    process.stderr.write(`[colpali] the environment did not import torch:\n${probe.stderr}\n`);
    process.exit(1);
  }
  process.stdout.write(probe.stdout.replace(/^/gm, "[colpali] "));
  process.stdout.write(`[colpali] ready: ${python}\n`);
  process.stdout.write("[colpali] start it with `npm run dev:colpali`.\n");
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("setup-colpali.mjs")
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[colpali] setup failed: ${error.message}\n`);
    process.exit(1);
  }
}
