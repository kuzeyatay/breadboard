#!/usr/bin/env node
// Provision the CAD service's Python environment.
//
// CadQuery's kernel binding (cadquery-ocp) publishes wheels for CPython 3.10–
// 3.12 only, and this repository's default interpreter is newer than that. The
// environment therefore gets its own pinned interpreter rather than sharing
// ChatMock's: `uv` downloads 3.12 if the machine does not have it, and the
// virtualenv lands under .runtime/, which is already gitignored.
//
// Run once:  npm run setup:cad

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvDir = process.env.CAD_VENV?.trim() || path.join(repoRoot, ".runtime", "cad-venv");
const requirements = path.join(repoRoot, "cad-service", "requirements.txt");

export function cadPythonPath(root = repoRoot) {
  const dir = process.env.CAD_VENV?.trim() || path.join(root, ".runtime", "cad-venv");
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

function main() {
  if (!fs.existsSync(requirements)) {
    throw new Error(`Missing ${requirements}. Is the cad-service directory present?`);
  }
  const python = cadPythonPath();

  if (!fs.existsSync(python)) {
    if (!haveUv()) {
      process.stderr.write(
        [
          "[cad] `uv` is required to provision the CAD environment on a pinned Python 3.12.",
          "[cad] Install it from https://docs.astral.sh/uv/ and run `npm run setup:cad` again.",
          "[cad] Alternatively, create the environment yourself:",
          `[cad]   python3.12 -m venv "${venvDir}"`,
          `[cad]   "${python}" -m pip install -r "${requirements}"`,
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
    process.stdout.write("[cad] creating the CAD virtualenv on Python 3.12…\n");
    run("uv", ["venv", "--python", "3.12", venvDir]);
  }

  process.stdout.write("[cad] installing pinned CAD dependencies…\n");
  if (haveUv()) {
    run("uv", ["pip", "install", "--python", python, "-r", requirements]);
  } else {
    run(python, ["-m", "pip", "install", "-r", requirements]);
  }

  const probe = spawnSync(
    python,
    [
      "-c",
      "import cadquery, importlib.metadata as m, sys;" +
        "print('cadquery', cadquery.__version__);" +
        "print('cadquery-ocp', m.version('cadquery-ocp'));" +
        "print('python', sys.version.split()[0])",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (probe.status !== 0) {
    process.stderr.write(`[cad] the environment did not import CadQuery:\n${probe.stderr}\n`);
    process.exit(1);
  }
  process.stdout.write(probe.stdout.replace(/^/gm, "[cad] "));
  process.stdout.write(`[cad] ready: ${python}\n`);
  process.stdout.write("[cad] start it with `npm run dev:cad`.\n");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("setup-cad.mjs")) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[cad] setup failed: ${error.message}\n`);
    process.exit(1);
  }
}
