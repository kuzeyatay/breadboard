import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("notification native input stays within the cards at every page zoom", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-notification-layout-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const run = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/notification-overlay-layout.cjs"), dir], desktop, env, 30_000);
    assert.equal(run.error, undefined, `${run.error?.message}\n${run.output}`);
    assert.equal(run.status, 0, run.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
