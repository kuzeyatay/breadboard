import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("real browser, workspace and main-window crashes recover after native teardown", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-renderer-crash-recovery-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/renderer-crash-recovery.cjs"), dir], desktop, env, 45_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
