#!/usr/bin/env node
// Provision the Stable Fast 3D environment.
//
// Run once:  npm run setup:sf3d
//
// SF3D is not a pip package. Its `requirements.txt` ends with two local source
// directories — `texture_baker/` and `uv_unwrapper/` — which are C++ torch
// extensions compiled at install time. That single fact shapes this script:
//
//   * torch has to be installed *first*, on its own, because the two setup.py
//     files import it at build time. Installing everything in one resolution
//     step fails with "No module named torch" rather than anything about SF3D.
//   * torch's build must match the machine. A CUDA wheel is chosen when an
//     NVIDIA GPU is present, because SF3D's texture baker has only a CUDA and a
//     Metal kernel — on a CPU-only torch the run fails inside the extension
//     instead of merely being slow.
//   * a C++ toolchain must already exist. On Windows that means MSVC, which is
//     multi-gigabyte and cannot be installed from here, so it is checked up
//     front and reported as a precise prerequisite rather than discovered
//     halfway through a compile.
//
// The environment is its own pinned Python 3.12 under .runtime/, exactly as the
// CAD service's is: SF3D pins numpy 1.26 and transformers 4.42, neither of which
// has wheels for this repository's default interpreter.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloneRoot = process.env.SF3D_ROOT?.trim() || path.join(repoRoot, "stable-fast-3d");
const venvDir = process.env.SF3D_VENV?.trim() || path.join(repoRoot, ".runtime", "sf3d-venv");

/** The CUDA wheel index torch is taken from when an NVIDIA GPU is present. */
const TORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu124";
const TORCH_SPEC = ["torch==2.4.1", "torchvision==0.19.1"];

export function sf3dPythonPath(root = repoRoot) {
  const dir = process.env.SF3D_VENV?.trim() || path.join(root, ".runtime", "sf3d-venv");
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

function have(command, args = ["--version"]) {
  const probe = spawnSync(command, args, { stdio: "ignore", shell: false });
  return probe.status === 0;
}

function haveNvidiaGpu() {
  const probe = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
    encoding: "utf8",
    shell: false,
  });
  return probe.status === 0 && probe.stdout.trim().length > 0;
}

/**
 * Whether the two torch extensions can be compiled at all.
 *
 * Deliberately checked before anything is downloaded. The alternative is a user
 * watching several gigabytes of torch install and then failing on a missing
 * compiler, with an error from distutils that names neither SF3D nor Visual
 * Studio.
 */
function compilerReport() {
  if (process.platform === "win32") {
    // torch's cpp_extension shells out to `cl.exe` on Windows; MinGW is not a
    // substitute, so nothing else counts here.
    if (have("cl.exe", [])) return { ok: true };
    const vswhere = path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Microsoft Visual Studio",
      "Installer",
      "vswhere.exe",
    );
    const found =
      fs.existsSync(vswhere) &&
      spawnSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"], {
        encoding: "utf8",
      }).stdout?.trim();
    return {
      ok: false,
      message: found
        ? [
            `[sf3d] Visual Studio is installed at ${found}, but cl.exe is not on PATH.`,
            "[sf3d] Run this from a \"x64 Native Tools Command Prompt for VS\", or run",
            "[sf3d]   \"<VS>\\VC\\Auxiliary\\Build\\vcvars64.bat\" first.",
          ].join("\n")
        : [
            "[sf3d] Stable Fast 3D compiles two C++ torch extensions, which needs MSVC.",
            "[sf3d] Install the free Visual Studio 2022 Build Tools with the",
            "[sf3d] \"Desktop development with C++\" workload:",
            "[sf3d]   https://visualstudio.microsoft.com/downloads/",
            "[sf3d] Then re-run this from a \"x64 Native Tools Command Prompt for VS\".",
          ].join("\n"),
    };
  }
  if (have("c++", ["--version"]) || have("g++", ["--version"]) || have("clang++", ["--version"])) {
    return { ok: true };
  }
  return {
    ok: false,
    message: [
      "[sf3d] Stable Fast 3D compiles two C++ torch extensions, and no C++ compiler was found.",
      "[sf3d] Install one (build-essential on Debian/Ubuntu, Xcode command line tools on macOS)",
      "[sf3d] and run `npm run setup:sf3d` again.",
    ].join("\n"),
  };
}

function main() {
  const requirements = path.join(cloneRoot, "requirements.txt");
  if (!fs.existsSync(requirements)) {
    throw new Error(
      `Missing ${requirements}. Clone https://github.com/Stability-AI/stable-fast-3d into ${cloneRoot}.`,
    );
  }

  const compiler = compilerReport();
  if (!compiler.ok) {
    process.stderr.write(`${compiler.message}\n`);
    process.exit(1);
  }

  if (!have("uv")) {
    process.stderr.write(
      [
        "[sf3d] `uv` is required to provision this environment on a pinned Python 3.12.",
        "[sf3d] Install it from https://docs.astral.sh/uv/ and run `npm run setup:sf3d` again.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const python = sf3dPythonPath();
  if (!fs.existsSync(python)) {
    process.stdout.write("[sf3d] creating the Stable Fast 3D virtualenv on Python 3.12…\n");
    run("uv", ["venv", "--python", "3.12", venvDir]);
  }

  // SF3D's own instructions pin these two: setuptools 70+ removed the distutils
  // shim its extension builds still rely on.
  process.stdout.write("[sf3d] pinning build tooling…\n");
  run("uv", ["pip", "install", "--python", python, "setuptools==69.5.1", "wheel"]);

  const cuda = haveNvidiaGpu();
  process.stdout.write(
    cuda
      ? "[sf3d] NVIDIA GPU detected — installing the CUDA build of torch…\n"
      : "[sf3d] no NVIDIA GPU detected — installing the CPU build of torch (texture baking will not run)…\n",
  );
  run("uv", [
    "pip", "install", "--python", python,
    ...(cuda ? ["--index-url", TORCH_CUDA_INDEX] : []),
    ...TORCH_SPEC,
  ]);

  process.stdout.write("[sf3d] installing Stable Fast 3D and compiling its extensions…\n");
  // `--no-build-isolation` is required, not a speed-up: the two extension
  // setup.py files import torch, and an isolated build environment would not
  // have the torch that was just installed.
  run("uv", [
    "pip", "install", "--python", python, "--no-build-isolation",
    "-r", requirements,
  ], { cwd: cloneRoot });

  const probe = spawnSync(
    python,
    [path.join(repoRoot, "dashboard", "scripts", "sf3d-bridge.py"), "--probe"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  process.stdout.write(probe.stdout ?? "");
  if (probe.status !== 0) {
    process.stderr.write(probe.stderr ?? "");
    throw new Error("The Stable Fast 3D environment was installed but does not import cleanly.");
  }

  process.stdout.write(
    [
      "",
      "[sf3d] Environment ready.",
      "[sf3d] The model weights are gated on Hugging Face and are downloaded on first use:",
      "[sf3d]   1. Request access at https://huggingface.co/stabilityai/stable-fast-3d",
      "[sf3d]   2. Create a read token at https://huggingface.co/settings/tokens",
      "[sf3d]   3. Put it in the repository .env as HUGGINGFACE_TOKEN=hf_…",
      "",
    ].join("\n"),
  );
}

// Importable for its path helper without running the installer.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
