import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { runElectronFixture } from "./helpers/run-electron-fixture";

for (const kind of ["root", "outside", "custom", "module"]) test(`encrypted server pushes reach the worker and global UI after closing a website (${kind} worker)`, async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-web-push-"));
  const env = { ...process.env };
  env.BB_WEB_PUSH_WORKER_KIND = kind;
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/web-push-notifications.cjs"), dir], desktop, env, 90000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("bb-web-push-"));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
