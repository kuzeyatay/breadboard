import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("Profile sign-ins use the persistent built-in browser, including agent tabs, and reset only its session", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-sign-ins-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const initialized = spawnSync(require("electron") as string,
      [path.join(desktop, "tests/fixtures/browser-session-persistence.cjs"), "initialize", dir],
      { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 15_000 });
    assert.equal(initialized.error, undefined, initialized.error?.message);
    assert.equal(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    for (const phase of ["save", "restore", "cleared"]) {
      fs.rmSync(path.join(dir, "passed.json"), { force: true });
      const result = await runElectronFixture(require("electron") as string,
        [path.join(desktop, "tests/fixtures/browser-sign-ins.cjs"), phase, dir], desktop, env, 60_000);
      assert.equal(result.error, undefined, `${phase}: ${result.error?.message}\n${result.output}`);
      assert.equal(result.status, 0, `${phase}: ${result.output}`);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
