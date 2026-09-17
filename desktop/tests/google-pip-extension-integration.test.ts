import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("Google's actual PiP package initializes, runs from its UI and shortcut, and restores after restart", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-google-pip-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    fs.cpSync(path.join(desktop, "tests/fixtures/google-pip-extension"), path.join(dir, "extension"), {recursive:true});
    for (const phase of ["install", "restore"]) {
      const result = await runElectronFixture(require("electron") as string,
        [path.join(desktop, "tests/fixtures/google-pip-extension.cjs"), phase, dir], desktop, env, 60_000);
      assert.equal(result.error, undefined, `${phase}: ${result.error?.message}\n${result.output}`);
      assert.equal(result.status, 0, `${phase}: ${result.output}`);
      fs.unlinkSync(path.join(dir, "passed.json"));
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, {recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
