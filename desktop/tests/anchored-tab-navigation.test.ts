import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("anchored tabs enforce their screen for native navigation and replacement", { skip: process.platform !== "win32" }, () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-anchor-navigation-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const run = spawnSync(require("electron") as string, [
      path.join(desktop, "tests/fixtures/anchored-tab-navigation.cjs"), dir,
    ], { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
