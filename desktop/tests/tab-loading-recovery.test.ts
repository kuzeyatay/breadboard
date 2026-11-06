import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runElectronFixture } from "./helpers/run-electron-fixture";

for (const kind of ["document", "browser"]) test(`a ${kind} tab recovers a late hidden surface without switching tabs`, {
  skip: process.platform !== "win32",
}, async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tab-loading-recovery-"));
  const env: NodeJS.ProcessEnv = { ...process.env, BB_TEST_SURFACE_KIND: kind };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/tab-loading-recovery.cjs"), dir], desktop, env, 30_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
