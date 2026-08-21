#!/usr/bin/env node
// Provision the humanizer service's Python environment.
//
// Two separate opt-ins, and the second one does not happen unless you ask:
//
//   npm run setup:humanizer                    the environment (~2.5 GB)
//   npm run setup:humanizer -- --download-model  the checkpoint (~1.6 GB)
//
// The split is not tidiness. The model card for
// cive202/humanize-ai-text-bart-large carries an MIT designation and says the
// designation is a placeholder, so Breadboard treats the weights as an optional
// third-party download of unresolved licence status: never vendored, never
// bundled, never fetched because somebody launched the application. See
// humanizer-service/THIRD_PARTY_NOTICES.md.
//
// The environment gets its own pinned interpreter rather than sharing one. This
// repository's default Python is 3.14, for which PyTorch publishes no Windows
// wheels; `uv` fetches 3.13 instead. The virtualenv lands under .runtime/,
// which is already gitignored, and the checkpoint lands under Breadboard's data
// directory — never in the checkout, never in the installer.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvDir =
  process.env.HUMANIZER_VENV?.trim() || path.join(repoRoot, ".runtime", "humanizer-venv");
const requirements = path.join(repoRoot, "humanizer-service", "requirements.txt");

/** Matches DEFAULT_MODEL_ID / DEFAULT_MODEL_REVISION in the service package. */
const MODEL_ID = process.env.BREADBOARD_HUMANIZER_MODEL?.trim() || "cive202/humanize-ai-text-bart-large";
const MODEL_REVISION =
  process.env.BREADBOARD_HUMANIZER_REVISION?.trim() ||
  "c74c28e03d3e306c8717d9f85cc18edb7d493299";

/** CUDA 12.4 wheels. A machine without an NVIDIA card falls back below. */
const TORCH_INDEX = "https://download.pytorch.org/whl/cu124";

export function humanizerPythonPath(root = repoRoot) {
  const dir = process.env.HUMANIZER_VENV?.trim() || path.join(root, ".runtime", "humanizer-venv");
  return process.platform === "win32"
    ? path.join(dir, "Scripts", "python.exe")
    : path.join(dir, "bin", "python");
}

/**
 * Where the checkpoint is cached.
 *
 * The same location the dashboard and the desktop supervisor resolve, so a
 * model downloaded by this script is the model the service finds. Under
 * Breadboard's mutable data directory: an application update replaces the
 * program, not this.
 */
export function humanizerModelCache(env = process.env) {
  const home =
    env.BREADBOARD_HUMANIZER_HOME?.trim() ||
    path.join(
      env.BREADBOARD_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard"),
      "humanizer",
    );
  return path.join(home, "models");
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

function downloadModel(python) {
  const cache = humanizerModelCache();
  fs.mkdirSync(cache, { recursive: true });
  process.stdout.write(
    [
      `[humanizer] downloading ${MODEL_ID} at revision ${MODEL_REVISION} (~1.6 GB)`,
      `[humanizer]   into ${cache}`,
      "[humanizer]   This is a third-party model. Breadboard does not redistribute it,",
      "[humanizer]   and its upstream licence designation is an unresolved placeholder —",
      "[humanizer]   see humanizer-service/THIRD_PARTY_NOTICES.md.",
      "",
    ].join("\n"),
  );
  const fetched = spawnSync(
    python,
    [
      "-c",
      "from transformers import AutoModelForSeq2SeqLM, AutoTokenizer;" +
        `kw = dict(revision=${JSON.stringify(MODEL_REVISION)}, trust_remote_code=False);` +
        `AutoTokenizer.from_pretrained(${JSON.stringify(MODEL_ID)}, **kw);` +
        `AutoModelForSeq2SeqLM.from_pretrained(${JSON.stringify(MODEL_ID)}, **kw);` +
        "print('model ready')",
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        HF_HOME: cache,
        HF_HUB_DISABLE_TELEMETRY: "1",
        DISABLE_TELEMETRY: "1",
        // Explicitly online: this is the one command allowed to reach the hub.
        HF_HUB_OFFLINE: "0",
      },
    },
  );
  if (fetched.status !== 0) {
    process.stderr.write(
      "[humanizer] the model could not be downloaded. Check network access to huggingface.co.\n",
    );
    process.exit(1);
  }
}

function main(argv) {
  const wantsModel = argv.includes("--download-model");
  const modelOnly = argv.includes("--model-only");

  if (!fs.existsSync(requirements)) {
    throw new Error(`Missing ${requirements}. Is the humanizer-service directory present?`);
  }
  const python = humanizerPythonPath();

  if (!modelOnly) {
    if (!fs.existsSync(python)) {
      if (!haveUv()) {
        process.stderr.write(
          [
            "[humanizer] `uv` is required to provision the environment on a pinned Python 3.13.",
            "[humanizer] Install it from https://docs.astral.sh/uv/ and run `npm run setup:humanizer` again.",
            "[humanizer] Alternatively, create the environment yourself:",
            `[humanizer]   python3.13 -m venv "${venvDir}"`,
            `[humanizer]   "${python}" -m pip install -r "${requirements}"`,
            "",
          ].join("\n"),
        );
        process.exit(1);
      }
      process.stdout.write("[humanizer] creating the humanizer virtualenv on Python 3.13…\n");
      run("uv", ["venv", "--python", "3.13", venvDir]);
    }

    // Torch first and from its own index, so pip resolves the CUDA build rather
    // than the CPU wheel transformers would otherwise be satisfied by.
    const cuda = haveNvidia();
    process.stdout.write(
      cuda
        ? "[humanizer] installing PyTorch with CUDA 12.4 (~2.5 GB)…\n"
        : "[humanizer] no NVIDIA GPU found; installing CPU PyTorch (rewriting will be slower)…\n",
    );
    if (haveUv()) {
      run("uv", [
        "pip",
        "install",
        "--python",
        python,
        ...(cuda ? ["--index-url", TORCH_INDEX] : []),
        "torch",
      ]);
      process.stdout.write("[humanizer] installing transformers and its dependencies…\n");
      run("uv", ["pip", "install", "--python", python, "-r", requirements]);
    } else {
      run(python, [
        "-m",
        "pip",
        "install",
        ...(cuda ? ["--index-url", TORCH_INDEX] : []),
        "torch",
      ]);
      process.stdout.write("[humanizer] installing transformers and its dependencies…\n");
      run(python, ["-m", "pip", "install", "-r", requirements]);
    }
  }

  if (!fs.existsSync(python)) {
    process.stderr.write(`[humanizer] no environment at ${python}. Run without --model-only first.\n`);
    process.exit(1);
  }

  // Verify the imports before claiming anything. A half-installed environment
  // that only fails on the first rewrite is worse than a failed setup.
  const probe = spawnSync(
    python,
    [
      "-c",
      "import sys, torch, transformers, pydantic;" +
        "print('python', sys.version.split()[0]);" +
        "print('torch', torch.__version__);" +
        "print('cuda', torch.version.cuda or 'cpu-only');" +
        "print('device', 'cuda:0' if torch.cuda.is_available() else 'cpu');" +
        "print('transformers', transformers.__version__);" +
        "print('pydantic', pydantic.VERSION)",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (probe.status !== 0) {
    process.stderr.write(
      `[humanizer] the environment did not import its dependencies:\n${probe.stderr}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(probe.stdout.replace(/^/gm, "[humanizer] "));

  if (wantsModel || modelOnly) {
    downloadModel(python);
    process.stdout.write("[humanizer] model ready.\n");
  } else {
    process.stdout.write(
      [
        "[humanizer] environment ready. The model has NOT been downloaded.",
        "[humanizer] Fetch it explicitly with:",
        "[humanizer]   npm run setup:humanizer -- --download-model",
        `[humanizer] It will be cached under ${humanizerModelCache()}`,
        "",
      ].join("\n"),
    );
  }
  process.stdout.write(`[humanizer] ready: ${python}\n`);
  process.stdout.write(
    "[humanizer] start Breadboard again and the service runs on its own — every\n" +
      "[humanizer] launcher checks for this environment at startup.\n",
  );
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("setup-humanizer.mjs")
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[humanizer] setup failed: ${error.message}\n`);
    process.exit(1);
  }
}
