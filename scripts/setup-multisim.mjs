#!/usr/bin/env node
// Provision the native circuit worker and synchronize its first-party skill.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venv = path.join(root, ".runtime", "multisim-venv");
const python = path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
}
if (!existsSync(python)) run("uv", ["venv", "--python", "3.12", venv]);
const references = path.join(root, "multisim-service/src/breadboard_multisim/references");
mkdirSync(references, { recursive: true });
for (const folder of ["workflows", "examples"]) {
  const source = path.join(root, "skills/multisim-agent", folder);
  for (const name of readdirSync(source).filter(name => /\.(md|json)$/.test(name))) {
    cpSync(path.join(source, name), path.join(references, name));
  }
}
run("uv", ["pip", "install", "--python", python, "-e", "./multisim-service[test]"]);
run(process.execPath, [path.join(root, "scripts/setup-multisim-exports.mjs")]);
const probe = spawnSync(python, ["-m", "breadboard_multisim", "doctor"], { cwd: root, encoding: "utf8", windowsHide: true });
if (probe.status !== 0) throw new Error(probe.stdout || probe.stderr);
const status = JSON.parse(probe.stdout);
mkdirSync(path.join(root, ".runtime"), { recursive: true });
writeFileSync(path.join(root, ".runtime", "multisim.json"), JSON.stringify({ python, ngspice: status.backend.executable ?? null }, null, 2) + "\n");
cpSync(path.join(root, "skills", "multisim-agent"), path.join(root, "hermes-skills", "prebuilt", "multisim-agent"), { recursive: true });
process.stdout.write(`Multisim Agent installed. ngspice available: ${status.backend.available}.\n`);
if (!status.backend.available) process.stdout.write("Install ngspice and put it on PATH, or set BREADBOARD_NGSPICE to its executable and rerun setup.\n");
process.stdout.write("Start a new Breadboard conversation to discover the native multisim tool and skill.\n");
