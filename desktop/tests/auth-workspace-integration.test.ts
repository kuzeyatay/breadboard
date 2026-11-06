import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("real Electron replaces the workspace with one login screen and restores only the signed-in account", {
  skip: process.platform !== "win32",
}, () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-auth-workspace-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const mode of ["signed-out", "signed-in"]) {
      const modeDir = path.join(dir, mode);
      fs.mkdirSync(modeDir);
      const run = spawnSync(path.join(desktop, "node_modules/electron/dist/electron.exe"), [
        path.join(desktop, "tests/fixtures/auth-workspace.cjs"), modeDir, mode,
      ], { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
      assert.equal(run.error, undefined, run.error?.message);
      assert.equal(run.status, 0, `${mode}: ${run.stdout}\n${run.stderr}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
