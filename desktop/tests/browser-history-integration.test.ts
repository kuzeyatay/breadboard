import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("real browser navigation and history UI survive Electron restarts with fresh renderer storage", () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-history-restart-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const phase of ["save", "restore", "cleared"]) {
      const run = spawnSync(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-history.cjs"), dir, phase], {
        cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 45_000,
      });
      assert.equal(run.error, undefined, `${phase}: ${run.error?.message}\n${run.stdout}\n${run.stderr}`);
      assert.equal(run.status, 0, `${phase}: ${run.stdout}\n${run.stderr}`);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
