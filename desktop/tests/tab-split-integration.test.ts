import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("native split drag, interactive panes, focus, resize, eviction, ungroup and restart", { skip: process.platform !== "win32" }, () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tab-split-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    for (const phase of ["save", "restore"]) {
      const run = spawnSync(path.join(desktop, "node_modules/electron/dist/electron.exe"),
        [path.join(desktop, "tests/fixtures/tab-split.cjs"), dir, phase],
        { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
      assert.equal(run.error, undefined, `${phase}: ${run.error?.message}`);
      assert.equal(run.status, 0, `${phase}: ${run.stdout}\n${run.stderr}`);
      assert.match(run.stdout, /TAB_SPLIT_OK/);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
