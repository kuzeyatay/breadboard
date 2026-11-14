import fs from "node:fs";
import path from "node:path";

/** Stage the trusted runner and the pinned upstream source, without mutable state. */
export function stageFreeCADAssets(repoRoot, stagingRoot) {
  const source = path.join(repoRoot, "freecad-service");
  const target = path.join(stagingRoot, "freecad-service");
  for (const name of ["runner.py", "upstream.json", "vendor"]) {
    fs.cpSync(path.join(source, name), path.join(target, name), {
      recursive: true, dereference: true,
      filter: (entry) => !/(?:^|[\\/])(?:__pycache__|\.venv|dist)(?:[\\/]|$)/u.test(path.relative(source, entry)),
    });
  }
  fs.mkdirSync(path.join(stagingRoot, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "scripts", "setup-freecad.mjs"), path.join(stagingRoot, "scripts", "setup-freecad.mjs"));
  // setup-freecad imports this pure discovery module; standalone Next output
  // does not retain the original source path.
  const config = "dashboard/src/lib/cad/freecad/config.ts";
  fs.mkdirSync(path.dirname(path.join(stagingRoot, config)), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, config), path.join(stagingRoot, config));
  for (const required of ["runner.py", "upstream.json", "vendor/freecad-mcp/uv.lock",
    "vendor/freecad-mcp/pyproject.toml", "vendor/freecad-mcp/src/freecad_mcp/server.py",
    "vendor/freecad-mcp/addon/FreeCADMCP/package.xml", "vendor/freecad-mcp/LICENSE"]) {
    if (!fs.statSync(path.join(target, required)).isFile()) throw new Error(`Missing FreeCAD asset: ${required}`);
  }
}
