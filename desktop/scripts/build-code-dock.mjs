import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
if (process.platform === "win32") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const windows = process.env.SystemRoot || "C:\\Windows";
  const compiler = path.join(windows, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const output = path.join(root, "dist/native/vscode-dock.exe");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const result = spawnSync(compiler, ["/nologo", "/target:exe", "/platform:anycpu", "/optimize+",
    "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll", `/out:${output}`,
    path.join(root, "src/native/vscode-dock.cs")], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not build the VS Code docking helper: ${result.stdout || result.stderr || result.error}`);
  console.log("[copy-static] VS Code docking helper built");
}
