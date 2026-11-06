import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { runElectronFixture } from "./helpers/run-electron-fixture";

for (const shell of ["legacy", "persistent"]) test(`websites reconnect after an app restart without opening a tab (${shell})`, async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-notification-restart-"));
  const env: NodeJS.ProcessEnv = { ...process.env, BB_NOTIFICATION_TEST_SHELL: shell };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    for (const phase of ["seed", "restore", "paused", "existing", "reset"]) {
      fs.rmSync(path.join(dir, "passed.json"), { force: true });
      const result = await runElectronFixture(require("electron") as string,
        [path.join(desktop, "tests/fixtures/notification-restart.cjs"), phase, dir], desktop, env, 60000);
      assert.equal(result.error, undefined, `${phase}: ${result.error?.message}\n${result.output}`);
      assert.equal(result.status, 0, `${phase}: ${result.output}`);
      if (phase === "seed" && shell === "legacy") {
        // Exercise an upgrade from the old profile that only saved grants/history.
        fs.unlinkSync(path.join(dir, "preferences/browser-notification-pages.json"));
      }
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("bb-notification-restart-"));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
