import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test(
  "selecting a tab does not re-send the bounds every other tab already has",
  { skip: process.platform !== "win32", timeout: 120_000 },
  () => {
    const desktop = path.resolve(__dirname, "../..");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tab-bounds-"));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
      const run = spawnSync(
        path.join(desktop, "node_modules/electron/dist/electron.exe"),
        [path.join(desktop, "tests/fixtures/tab-activation-bounds.cjs"), dir],
        { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 110_000 },
      );
      const resultFile = path.join(dir, "result.json");
      const result = fs.existsSync(resultFile)
        ? JSON.parse(fs.readFileSync(resultFile, "utf8"))
        : null;
      assert.equal(run.error, undefined, run.error?.message);
      assert.equal(
        run.status,
        0,
        `${run.stdout}\n${run.stderr}\nresult: ${JSON.stringify(result)}`,
      );
      assert.ok(result, "the fixture recorded what it measured");
      assert.ok(result.tabCount >= 7, `expected a window of tabs, got ${result.tabCount}`);
      assert.ok(
        result.perSwitch < result.tabCount,
        `a switch cost ${result.perSwitch} native bounds calls across ${result.tabCount} tabs`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
