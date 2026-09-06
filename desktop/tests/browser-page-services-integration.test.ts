import { test } from "node:test";
import assert from "node:assert/strict";
import { runElectronFixture } from "./helpers/run-electron-fixture";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("browser notifications and in-place translation work in real sandboxed Chromium documents", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-page-services-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  // Electron owns its Node environment; the parent test runner's child marker
  // must not turn the application process into a nested Node test worker.
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-page-services.cjs"), dir], desktop, env, 60000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
