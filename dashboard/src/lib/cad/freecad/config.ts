import { externalRuntimeFilesystem as fs } from "../../external-runtime-filesystem.ts";
import os from "node:os";
import { externalRuntimePath as path } from "../../external-runtime-path.ts";

export const FREECAD_MCP_COMMIT = "5014bd9d538b8d09e11201e219cfe291ebca7b4e";

function file(candidate: string | undefined): string | null {
  if (!candidate || !path.isAbsolute(candidate)) return null;
  try {
    return fs.statSync(/* turbopackIgnore: true */ candidate).isFile() ? candidate : null;
  } catch { return null; }
}

export function freecadRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.BREADBOARD_REPO_ROOT?.trim() ||
    (path.basename(process.cwd()).toLowerCase() === "dashboard" ? ".." : "."));
}

export function freecadHome(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.BREADBOARD_FREECAD_HOME?.trim() ||
    path.join(env.LOCALAPPDATA || path.join(os.homedir(), ...(process.platform === "win32" ? ["AppData", "Local"] : [".local", "share"])), "Breadboard", "freecad"));
}

export function freecadPython(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BREADBOARD_FREECAD_PYTHON?.trim()) return file(env.BREADBOARD_FREECAD_PYTHON.trim());
  return file(path.join(freecadHome(env), "venv", ...(process.platform === "win32"
    ? ["Scripts", "python.exe"] : ["bin", "python"])));
}

/** Passive discovery: inspecting Settings must never start FreeCAD or install packages. */
export function freecadExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BREADBOARD_FREECAD_CMD?.trim()) return file(env.BREADBOARD_FREECAD_CMD.trim());
  const names = process.platform === "win32" ? ["FreeCADCmd.exe"] : ["FreeCADCmd", "freecadcmd"];
  for (const directory of (env.PATH || env.Path || "").split(path.delimiter)) {
    for (const name of names) {
      const found = file(path.join(directory, name));
      if (found) return found;
    }
  }
  const roots = process.platform === "win32" ? [
    env.ProgramFiles || "C:\\Program Files",
    path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs"),
  ] : ["/Applications", path.join(os.homedir(), "Applications"), "/opt"];
  for (const root of roots) {
    let entries: string[];
    try { entries = fs.readdirSync(/* turbopackIgnore: true */ root); } catch { continue; }
    for (const name of entries.filter((entry) => /^freecad/i.test(entry)).sort().reverse()) {
      for (const suffix of process.platform === "win32" ? ["bin/FreeCADCmd.exe"]
        : ["Contents/Resources/bin/FreeCADCmd", "bin/freecadcmd", "bin/FreeCADCmd"]) {
        const found = file(path.join(root, name, suffix));
        if (found) return found;
      }
    }
  }
  return null;
}

export function freecadAvailability(env: NodeJS.ProcessEnv = process.env) {
  const executable = freecadExecutable(env);
  const python = freecadPython(env);
  const runner = file(path.join(freecadRoot(env), "freecad-service", "runner.py"));
  const code = !executable ? "freecad_not_installed" : !python ? "freecad_mcp_not_installed"
    : !runner ? "freecad_runner_missing" : "ready";
  return {
    available: code === "ready", code, executable, python, runner,
    message: !executable
      ? "Install FreeCAD, or set BREADBOARD_FREECAD_CMD to its FreeCADCmd executable."
      : !python ? "Set up the FreeCAD MCP bridge with npm run setup:freecad."
      : !runner ? "The Breadboard FreeCAD runner is missing from this installation."
      : "FreeCAD is ready to build native documents through FreeCAD MCP.",
  };
}
