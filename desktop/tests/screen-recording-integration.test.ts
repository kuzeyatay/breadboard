import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("screen video captures real changing frames without focus and cleans up on stop, cancel and quit", { skip: process.platform !== "win32" }, async () => {
  const desktop = path.resolve(__dirname, "../..");
  const root = path.join(desktop, ".tmp-screen-recording-tests");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "capture-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/screen-recording.cjs"), dir], desktop, env, 60_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(root));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
