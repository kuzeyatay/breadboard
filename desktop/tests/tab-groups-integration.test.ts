import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("Electron groups survive window moves, save/close and restart", { skip: process.platform !== "win32" }, () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tab-groups-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const phase of ["save", "restore"]) {
      const run = spawnSync(path.join(desktop, "node_modules/electron/dist/electron.exe"),
        [path.join(desktop, "tests/fixtures/tab-groups.cjs"), dir, phase],
        { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 35_000 });
      assert.equal(run.error, undefined, `${phase}: ${run.error?.message}`);
      assert.equal(run.status, 0, `${phase}: ${run.stdout}\n${run.stderr}`);
    }
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()), "bb-tab-groups-")));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
