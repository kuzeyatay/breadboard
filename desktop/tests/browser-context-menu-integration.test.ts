import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("right-click in the sandboxed browser controls links, editing, bookmarks, downloads and private tabs", () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-context-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = spawnSync(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-context-menu.cjs"), dir], {
      cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 90_000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
