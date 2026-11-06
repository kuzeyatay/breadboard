import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("legacy defaults migrate once and independent provider choices survive restarts", (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-provider-migration-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const run = (code) => {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import db from './src/lib/db.ts';
      import {getHermesUserSettings, setHermesUserSettings} from './src/lib/hermes/runtime-store.ts';
      ${code}
      db.close();
    `], {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, BREADBOARD_DATA_DIR: dataRoot },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  };
  run(`
    for (const [id, model] of [[1, 'cliproxy/claude-opus-5'], [2, 'none']]) {
      db.prepare('INSERT INTO users(id, username, email, password_hash) VALUES (?, ?, ?, ?)')
        .run(id, 'user' + id, id + '@example.test', 'x');
      setHermesUserSettings(id, {defaultModel: model});
    }
    db.exec('ALTER TABLE hermes_user_settings DROP COLUMN fallback_model');
  `);
  run(`
    assert.equal(getHermesUserSettings(1).fallbackModel, 'cliproxy/claude-opus-5');
    assert.equal(getHermesUserSettings(2).fallbackModel, 'none');
    setHermesUserSettings(1, {defaultModel: 'gpt-6-astra'});
    assert.equal(getHermesUserSettings(1).fallbackModel, 'cliproxy/claude-opus-5');
    setHermesUserSettings(2, {fallbackModel: 'gpt-5.6-sol'});
    assert.equal(getHermesUserSettings(2).defaultModel, 'none');
  `);
  run(`
    assert.equal(getHermesUserSettings(1).defaultModel, 'gpt-6-astra');
    assert.equal(getHermesUserSettings(1).fallbackModel, 'cliproxy/claude-opus-5');
    assert.equal(getHermesUserSettings(2).defaultModel, 'none');
    assert.equal(getHermesUserSettings(2).fallbackModel, 'gpt-5.6-sol');
  `);
});
