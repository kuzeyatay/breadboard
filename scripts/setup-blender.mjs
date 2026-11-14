#!/usr/bin/env node
// Install only Breadboard's pinned MCP environment. Blender is user-installed.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BLENDER_MCP_VERSION, blenderRuntimePaths } from "../dashboard/scripts/blender-runtime.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = process.argv.slice(2);
const dataIndex = flags.indexOf("--data-dir");
if (dataIndex >= 0 && (!flags[dataIndex + 1] || flags[dataIndex + 1].startsWith("--"))) {
  throw new Error("--data-dir needs the Breadboard data directory.");
}
const dataRoot = path.resolve(dataIndex >= 0 ? flags[dataIndex + 1]
  : process.env.BREADBOARD_DATA_DIR?.trim() || path.join(repoRoot, "dashboard"));
const paths = blenderRuntimePaths(repoRoot, dataRoot);
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot, stdio: "inherit", windowsHide: true, shell: false,
    env: { ...process.env, DISABLE_TELEMETRY: "true", PYTHONUTF8: "1" }, timeout: 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with ${result.status}`);
}

try {
  mkdirSync(paths.directory, { recursive: true });
  if (!existsSync(paths.python)) run("uv", ["venv", "--python", "3.12", paths.venv]);
  run("uv", ["pip", "sync", "--python", paths.python, "--require-hashes",
    path.join(repoRoot, "scripts", "blender-requirements.txt")]);
  run(paths.python, ["-c", [
    "import importlib.metadata, pathlib, shutil, sys",
    "from blender_mcp.addon_manager import get_bundled_addon_path",
    `assert importlib.metadata.version('mcp-for-blender') == '${BLENDER_MCP_VERSION}'`,
    "shutil.copyfile(get_bundled_addon_path(), pathlib.Path(sys.argv[1]))",
  ].join("; "), paths.addon]);
  writeFileSync(paths.receipt, JSON.stringify({ package: "mcp-for-blender", version: BLENDER_MCP_VERSION }, null, 2) + "\n");
  if (flags.includes("--install-addon")) run(paths.python, [paths.launcher, "install-addon"]);
  process.stdout.write(`Blender MCP ${BLENDER_MCP_VERSION} installed.\nAddon: ${paths.addon}\n`);
  process.stdout.write("In Blender: Preferences > Add-ons > Install from Disk, choose that addon.py, enable MCP for Blender, then start its server from the viewport sidebar (N).\n");
  process.stdout.write("In Breadboard: Settings > Connections > Blender > Connect. Use /blender in chat.\n");
} catch (error) {
  process.stderr.write(`[blender] Setup failed: ${error.message}\nInstall uv if it is missing: https://docs.astral.sh/uv/getting-started/installation/\n`);
  process.exitCode = 1;
}
