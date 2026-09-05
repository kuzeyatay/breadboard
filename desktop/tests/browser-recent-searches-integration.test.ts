import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("recent-search history survives real Electron restarts with fresh renderer storage", () => {
  const desktop = path.resolve(__dirname, "../..");
  const fixture = path.join(desktop, "tests/fixtures/browser-recent-searches.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-search-history-restart-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const phase of ["save", "restore", "cleared"]) {
      const run = spawnSync(require("electron") as string, [fixture, dir, phase], {
        cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 45_000,
      });
      assert.equal(run.error, undefined, `${phase}: ${run.error?.message}`);
      assert.equal(run.status, 0, `${phase}: ${run.stdout}\n${run.stderr}`);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
