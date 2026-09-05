import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("browser notifications and in-place translation work in real sandboxed Chromium documents", () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-page-services-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = spawnSync(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-page-services.cjs"), dir], {
      cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 90000,
    });
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
