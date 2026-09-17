import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("browser session cookies survive process restarts with encryption, scope, logout and expiry intact", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cookie-restart-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    for (const phase of ["save", "restore", "signed-out", "cleared", "corrupt"]) {
      fs.rmSync(path.join(dir, "passed.json"), { force: true });
      if (phase === "save") {
        const run = spawnSync(require("electron") as string,
          [path.join(desktop, "tests/fixtures/browser-session-persistence.cjs"), phase, dir],
          { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
        assert.equal(run.error, undefined, run.error?.message);
        assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "passed.json"), "utf8")).passed, true);
        continue;
      }
      const run = await runElectronFixture(require("electron") as string,
        [path.join(desktop, "tests/fixtures/browser-session-persistence.cjs"), phase, dir], desktop, env, 30_000);
      assert.equal(run.error, undefined, `${phase}: ${run.error?.message}\n${run.output}`);
      assert.equal(run.status, 0, `${phase}: ${run.output}`);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
