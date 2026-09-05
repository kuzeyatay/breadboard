import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("retiring the base clears native drag regions and warm tab switches stay responsive", {
  skip: process.platform !== "win32",
}, () => {
  const desktop = path.resolve(__dirname, "../..");
  const fixture = path.join(desktop, "tests/fixtures/tab-switching.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tab-switching-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const run = spawnSync(path.join(desktop, "node_modules/electron/dist/electron.exe"), [fixture, dir], {
      cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 30_000,
    });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
