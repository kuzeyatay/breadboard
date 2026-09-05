import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("real Electron restarts restore only anchors beside one fresh New tab", {
  skip: process.platform !== "win32",
}, () => {
  const desktop = path.resolve(__dirname, "../..");
  const fixture = path.join(desktop, "tests/fixtures/tab-session.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-session-restart-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const phase of ["save", "restore", "verify-unanchored"]) {
      const run = spawnSync(path.join(desktop, "node_modules/electron/dist/electron.exe"), [fixture, dir, phase], {
        cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 45_000,
      });
      assert.equal(run.error, undefined, `${phase}: ${run.error?.message}`);
      assert.equal(run.status, 0, `${phase}: ${run.stdout}\n${run.stderr}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
