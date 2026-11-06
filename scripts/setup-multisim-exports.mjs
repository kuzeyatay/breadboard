#!/usr/bin/env node
// Install pinned exporter dependencies. NI template provisioning is explicit and local.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, "multisim-service/src/breadboard_multisim/export_runtime");
const configPath = path.join(root, ".runtime/multisim-exports.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
function run(command, args, env = process.env) {
  const child = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true, env });
  if (child.error || child.status !== 0) throw child.error ?? new Error(`${command} exited ${child.status}`);
}
// Invoke npm's JS entrypoint directly: never interpolate paths into a shell command.
const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
if (!existsSync(npm)) throw new Error("Run this setup using npm, or install Node.js with npm.");
run(process.execPath, [npm, "ci", "--prefix", runtime, "--ignore-scripts", "--no-audit", "--no-fund"]);
config.node = process.execPath;
const args = process.argv.slice(2);
const sampleShell = args.length === 1 && args[0] === "--multisim-sample-shell";
if (args.length && !sampleShell && (args[0] !== "--multisim-python" || args.length !== 2)) {
  throw new Error("Usage: node scripts/setup-multisim-exports.mjs [--multisim-python <32-bit-python> | --multisim-sample-shell]");
}
if (args.length) {
  if (process.platform !== "win32") throw new Error("NI template provisioning requires Windows and licensed Multisim.");
  const python = sampleShell ? path.join(root, ".runtime/multisim-venv/Scripts/python.exe") : path.resolve(args[1]);
  if (!existsSync(python)) throw new Error(sampleShell ? "Run npm run setup:multisim first to install the circuit worker." : "The supplied 32-bit Python does not exist.");
  // Upstream creates a blank circuit. Do not interfere with an already-open user's circuit.
  const running = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq Multisim.exe", "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true });
  if (running.error || running.status !== 0) throw new Error("Could not check whether Multisim is open.");
  if (!sampleShell && /"multisim\.exe"/i.test(running.stdout)) throw new Error("Save and close Multisim before provisioning its local component pack.");
  const pack = path.join(root, ".runtime", `multisim-component-pack-${Date.now()}`);
  const tools = path.join(root, "multisim-service/vendor/multisim_tools");
  const env = { ...process.env,
    PYTHONPATH: [path.join(root, "multisim-service/vendor"), tools, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    MULTISIM_MCP_EWD: path.join(runtime, "node_modules/electronics-workbench-decoder/dist/ewd.js"),
    MULTISIM_MCP_EWE: path.join(runtime, "node_modules/electronics-workbench-decoder/dist/ewe.js"),
  };
  run(python, [path.join(tools, "bootstrap_local_component_pack.py"), "--output", pack, ...(sampleShell ? ["--sample-shell"] : [])], env);
  config.multisim_template_dir = pack;
  if (!sampleShell) config.multisim_worker_python = python;
  config.multisim_template_source = sampleShell ? "installed_sample" : "automation_blank";
}
mkdirSync(path.dirname(configPath), { recursive: true });
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log("LTspice export dependencies installed.");
console.log(config.multisim_template_dir ? "Multisim native export component pack configured." :
  "For .ms14 export, provision licensed local templates with --multisim-python <32-bit-python-with-pywin32>.");
