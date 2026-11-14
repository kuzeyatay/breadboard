import path from "node:path";

export const BLENDER_MCP_VERSION = "2.2.9";

/** Keep optional Python tools in writable data, including installed builds. */
export function blenderRuntimePaths(repoRoot, dataRoot, platform = process.platform) {
  const directory = path.join(dataRoot, "runtime-v2", "services", "blender");
  const venv = path.join(directory, "venv");
  return {
    directory,
    venv,
    python: path.join(venv, ...(platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"])),
    launcher: path.join(repoRoot, "scripts", "blender-mcp-server.py"),
    addon: path.join(directory, "addon.py"),
    receipt: path.join(directory, "installation.json"),
  };
}
