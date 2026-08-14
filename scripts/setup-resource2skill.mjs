#!/usr/bin/env node
// Explicitly provision Resource2Skill's isolated Python 3.11 environment.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloneRoot = path.resolve(process.env.RESOURCE2SKILL_ROOT?.trim() || path.join(repoRoot, "Resource2Skill"));
const venvRoot = path.resolve(
  process.env.RESOURCE2SKILL_VENV?.trim() || path.join(repoRoot, ".runtime", "resource2skill-venv"),
);
const python = process.platform === "win32"
  ? path.join(venvRoot, "Scripts", "python.exe")
  : path.join(venvRoot, "bin", "python");
const requirements = path.join(cloneRoot, "requirements.txt");
const bridge = path.join(repoRoot, "scripts", "resource2skill-bridge.py");
const flags = new Set(process.argv.slice(2));

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `${result.stderr || result.stdout || ""}`.trim() : "";
    throw new Error(`${command} exited with ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function have(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore", windowsHide: true, shell: false });
  return result.status === 0;
}

function createVenv() {
  if (have(process.platform === "win32" ? "uv.exe" : "uv")) {
    run(process.platform === "win32" ? "uv.exe" : "uv", ["venv", "--python", "3.11", venvRoot]);
    return;
  }
  if (process.platform === "win32" && have("py.exe", ["-3.11", "--version"])) {
    run("py.exe", ["-3.11", "-m", "venv", venvRoot]);
    return;
  }
  const candidate = process.platform === "win32" ? "python.exe" : "python3.11";
  const probe = spawnSync(candidate, ["-c", "import sys; raise SystemExit(sys.version_info[:2] != (3, 11))"], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (probe.status === 0) {
    run(candidate, ["-m", "venv", venvRoot]);
    return;
  }
  throw new Error("Python 3.11 is required. Install it or install uv, then retry.");
}

function check() {
  if (!fs.existsSync(requirements)) throw new Error(`Resource2Skill was not found at ${cloneRoot}.`);
  if (!fs.existsSync(python)) throw new Error(`The Resource2Skill environment is not installed at ${venvRoot}.`);
  const workspace = path.join(venvRoot, ".check");
  const result = run(
    python,
    [bridge, "--check", "--root", cloneRoot, "--workspace", workspace, "--domain", "web", "--task", "check"],
    { capture: true },
  );
  const line = `${result.stdout || ""}`.trim().split(/\r?\n/).at(-1) || "{}";
  const info = JSON.parse(line);
  return { ok: true, python, root: cloneRoot, version: info.python || "3.11" };
}

function main() {
  if (flags.has("--check")) {
    const status = check();
    process.stdout.write(flags.has("--json") ? `${JSON.stringify(status)}\n` : `[resource2skill] ready: ${status.python}\n`);
    return;
  }
  if (!fs.existsSync(requirements)) throw new Error(`Missing ${requirements}. Clone Resource2Skill first.`);
  if (!fs.existsSync(python)) {
    process.stdout.write("[resource2skill] creating a Python 3.11 virtual environment…\n");
    createVenv();
  }
  const uv = process.platform === "win32" ? "uv.exe" : "uv";
  if (have(uv)) run(uv, ["pip", "install", "--python", python, "-r", requirements]);
  else run(python, ["-m", "pip", "install", "--upgrade", "pip"]), run(python, ["-m", "pip", "install", "-r", requirements]);

  if (flags.has("--with-web")) run(python, ["-m", "playwright", "install", "chromium"]);
  if (flags.has("--with-blender")) run(python, ["-m", "pip", "install", "bpy"]);
  const status = check();
  process.stdout.write(flags.has("--json") ? `${JSON.stringify(status)}\n` : `[resource2skill] ready: ${status.python}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (flags.has("--json")) process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  else process.stderr.write(`[resource2skill] setup failed: ${message}\n`);
  process.exitCode = 1;
}
