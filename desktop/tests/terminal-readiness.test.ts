import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("Terminal keeps the outgoing page until widgets and images are ready, and respects cancelled selection", { timeout: 30_000 }, async () => {
  const desktop = path.resolve(__dirname, "../..");
  // Use the existing shell bundle with the freshly compiled test main process.
  fs.cpSync(path.join(desktop, "dist/window-shell"), path.join(desktop, "dist-tests/src/window-shell"), { recursive: true });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bb-terminal-ready-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/terminal-readiness.cjs"), directory], desktop, env, 25_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
