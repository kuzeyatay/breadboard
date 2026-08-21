#!/usr/bin/env node
// Provision MatrAIx's Python 3.12 environment, the same one the setup dialog
// builds. `--check` reports whether the bridge can already run.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloneRoot = path.resolve(
  process.env.MATRAIX_ROOT?.trim() || path.join(repoRoot, "MatrAIx-Persona-8B"),
);
const venvRoot = path.resolve(
  process.env.MATRAIX_VENV?.trim() || path.join(repoRoot, ".runtime", "matraix-venv"),
);
const bridge = path.join(repoRoot, "scripts", "matraix-bridge.py");
const uv = process.platform === "win32" ? "uv.exe" : "uv";
const flags = new Set(process.argv.slice(2));

function pythonIn(root) {
  return process.platform === "win32"
    ? path.join(root, "Scripts", "python.exe")
    : path.join(root, "bin", "python");
}

// The clone's own README tells you to create `.venv` inside it, so an upstream
// install counts as an install here too.
function resolvePython() {
  return [pythonIn(venvRoot), pythonIn(path.join(cloneRoot, ".venv"))].find((candidate) =>
    fs.existsSync(candidate),
  );
}

function run(command, args, { capture = false, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
    shell: false,
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `${result.stderr || result.stdout || ""}`.trim() : "";
    throw new Error(`${command} exited with ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function have(command, args = ["--version"]) {
  return spawnSync(command, args, { stdio: "ignore", windowsHide: true, shell: false }).status === 0;
}

function check() {
  if (!fs.existsSync(path.join(cloneRoot, "pyproject.toml"))) {
    throw new Error(`MatrAIx was not found at ${cloneRoot}.`);
  }
  const python = resolvePython();
  if (!python) throw new Error(`MatrAIx's environment is not installed at ${venvRoot}.`);
  const result = run(python, [bridge, "--root", cloneRoot, "--check"], { capture: true });
  const line = `${result.stdout || ""}`.trim().split(/\r?\n/).at(-1) || "{}";
  const info = JSON.parse(line);
  if (info.event !== "check.ok") throw new Error("The MatrAIx bridge could not import the clone.");
  return { ok: true, python, root: cloneRoot, version: info.python, pools: info.pools ?? [] };
}

function main() {
  if (flags.has("--check")) {
    const status = check();
    process.stdout.write(
      flags.has("--json")
        ? `${JSON.stringify(status)}\n`
        : `[matraix] ready: Python ${status.version} · ${status.pools.length} persona pools\n`,
    );
    return;
  }
  if (!fs.existsSync(path.join(cloneRoot, "pyproject.toml"))) {
    throw new Error(`MatrAIx was not found at ${cloneRoot}. Clone it beside the dashboard first.`);
  }
  if (!have(uv)) {
    throw new Error("uv is required (MatrAIx pins Python 3.12). Install uv, then retry.");
  }
  // UV_LINK_MODE=copy: the repository sits in a OneDrive folder, where uv's
  // default hardlinking fails.
  const env = { UV_LINK_MODE: "copy" };
  run(uv, ["venv", "--python", "3.12", venvRoot], { env });
  run(uv, ["pip", "install", "--python", venvRoot, "-e", cloneRoot, "-e", path.join(cloneRoot, "packages", "playground")], { env });
  const status = check();
  process.stdout.write(`[matraix] ready: Python ${status.version}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[matraix] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
