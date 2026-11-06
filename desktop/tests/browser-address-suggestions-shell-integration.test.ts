import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("address focus keeps single and split websites visible below the persistent toolbar", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-address-shell-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const run = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/browser-address-suggestions-shell.cjs"), dir], desktop, env, 45_000);
    assert.equal(run.error, undefined, `${run.error?.message}\n${run.output}`);
    assert.equal(run.status, 0, run.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
