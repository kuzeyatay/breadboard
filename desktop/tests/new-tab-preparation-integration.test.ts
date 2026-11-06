import { test } from "node:test";
import assert from "node:assert/strict";
import { runElectronFixture } from "./helpers/run-electron-fixture";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("prepared new tabs open without a request and are bounded and invalidated", {
  skip: process.platform !== "win32",
  timeout: 50_000,
}, async () => {
  const desktop = path.resolve(__dirname, "../..");
  fs.cpSync(path.join(desktop, "dist/window-shell"), path.join(desktop, "dist-tests/src/window-shell"), { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-new-tab-preparation-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const run = await runElectronFixture(path.join(desktop, "node_modules/electron/dist/electron.exe"), [
      path.join(desktop, "tests/fixtures/new-tab-preparation.cjs"), dir,
    ], desktop, env, 45_000);
    assert.equal(run.error, undefined, `${run.error?.message}\n${run.output}`);
    assert.equal(run.status, 0, run.output);
    process.stdout.write(run.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
