import { test } from "node:test";
import assert from "node:assert/strict";
import { runElectronFixture } from "./helpers/run-electron-fixture";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("Breadboard use controls real Electron tabs through the dashboard transport", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-use-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const dashboard = path.join(desktop, "..", "dashboard");
    const esbuild = require(require.resolve("esbuild", { paths: [dashboard] }));
    await esbuild.build({ entryPoints: [path.join(dashboard, "src/lib/hermes/breadboard-use.ts")],
      bundle: true, platform: "node", format: "cjs", outfile: path.join(dir, "transport.cjs"),
      external: ["server-only", "better-sqlite3"],
    });
    await esbuild.stop();
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/breadboard-use.cjs"), dir], desktop, env, 45_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
