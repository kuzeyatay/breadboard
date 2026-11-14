import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { stageFreeCADAssets } from "./freecad-assets.mjs";

test("packaged FreeCAD closure retains runner, MCP lock, setup dependencies and license", async () => {
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "freecad-assets-"));
  try {
    stageFreeCADAssets(repo, staging);
    const files = fs.readdirSync(staging, { recursive: true }).map(String);
    assert.ok(files.some((name) => name.endsWith("runner.py")));
    assert.ok(files.some((name) => name.endsWith("package.xml")));
    assert.ok(files.some((name) => name.endsWith("setup-freecad.mjs")));
    assert.ok(!files.some((name) => /__pycache__|\.venv/.test(name)));
    const config = await import(pathToFileURL(path.join(staging, "dashboard/src/lib/cad/freecad/config.ts")).href);
    assert.equal(config.freecadRoot({ BREADBOARD_REPO_ROOT: staging }), staging);
    for (const file of files.filter((name) => fs.statSync(path.join(staging, name)).isFile())) {
      assert.deepEqual(fs.readFileSync(path.join(staging, file)), fs.readFileSync(path.join(repo, file)), file);
    }
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});
