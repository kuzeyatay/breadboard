import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("the standalone dashboard receives readable native data paths", { skip: process.platform !== "win32" }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-dashboard-paths-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "dashboard", "scripts");
  const standalone = path.join(root, "dashboard", ".next-desktop", "standalone");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(standalone, { recursive: true });
  const entry = path.join(scripts, "runtime-v2-dashboard.mjs");
  fs.copyFileSync(new URL("../scripts/runtime-v2-dashboard.mjs", import.meta.url), entry);
  fs.writeFileSync(path.join(standalone, "server.js"), 'console.log(JSON.stringify({data:process.env.BREADBOARD_DATA_DIR,app:process.env.BREADBOARD_REPO_ROOT}));');
  const result = spawnSync(process.execPath, [entry], {
    encoding: "utf8", windowsHide: true, timeout: 10_000,
    env: { ...process.env, BREADBOARD_DATA_DIR: path.toNamespacedPath(root), BREADBOARD_REPO_ROOT: path.toNamespacedPath(root) },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { data: fs.realpathSync.native(root), app: fs.realpathSync.native(root) });
});
