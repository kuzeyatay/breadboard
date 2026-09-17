import { test } from "node:test";
import assert from "node:assert/strict";
import { runElectronFixture } from "./helpers/run-electron-fixture";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("translation prioritizes the viewport and avoids rescanning its own edits in Chromium", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-translation-dom-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/browser-translation-dom.cjs"), dir], desktop, env, 30000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
