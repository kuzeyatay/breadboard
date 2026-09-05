import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("browser Terminal reads and captures its own live tab through the preload and loopback bridge", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-terminal-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const dashboard = path.join(desktop, "..", "dashboard");
    const esbuild = require(require.resolve("esbuild", { paths: [dashboard] }));
    await esbuild.build({
      entryPoints: [path.join(dashboard, "src/lib/hermes/browser-terminal-context.ts")],
      bundle: true, platform: "node", format: "cjs", outfile: path.join(dir, "transport.cjs"),
    });
    await esbuild.stop();
    const result = spawnSync(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-terminal.cjs"), dir], {
      cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 60_000,
    });
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
