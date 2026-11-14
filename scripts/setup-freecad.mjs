// Explicit setup only; CAD runs never install dependencies.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freecadHome, freecadExecutable } from "../dashboard/src/lib/cad/freecad/config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = freecadHome();
const project = path.join(root, "freecad-service", "vendor", "freecad-mcp");
const venv = path.join(home, "venv");
const python = path.join(venv, ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: false, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
try {
  fs.mkdirSync(home, { recursive: true });
  run("uv", ["sync", "--frozen", "--no-dev", "--no-editable", "--python", "3.13", "--project", project],
    { ...process.env, UV_PROJECT_ENVIRONMENT: venv });
  run(python, ["-c", "from freecad_mcp.server import main; import importlib.metadata as m; print('FreeCAD MCP', m.version('freecad-mcp'))"]);
  const executable = freecadExecutable();
  process.stdout.write(`[freecad] MCP ready: ${python}\n`);
  process.stdout.write(executable ? `[freecad] FreeCAD: ${executable}\n`
    : "[freecad] Install FreeCAD, then run again or set BREADBOARD_FREECAD_CMD to FreeCADCmd.\n");
} catch (error) {
  process.stderr.write(`[freecad] setup failed: ${error.message}\n`);
  process.exitCode = 1;
}
