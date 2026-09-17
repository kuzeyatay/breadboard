import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("runtime port changes reconnect both live and already-retrying chat tabs", {
  skip: process.platform !== "win32",
}, () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-runtime-tab-reconnect-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const run = spawnSync(path.join(desktop, "node_modules/electron/dist/electron.exe"), [
      path.join(desktop, "tests/fixtures/runtime-tab-reconnect.cjs"), dir,
    ], { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 45_000 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
