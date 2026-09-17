import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("browser navigation retains submitted text and the outgoing page while the top bar runs", {
  skip: process.platform !== "win32",
}, () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-navigation-loading-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const run = spawnSync(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-navigation-loading.cjs"), dir], {
      cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 45_000,
    });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
