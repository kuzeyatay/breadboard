import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('combined home restores past searches without visited pages and opens real native web pages', {skip:process.platform !== 'win32'}, () => {
  const desktop = path.resolve('../desktop');
  const requireDesktop = createRequire(path.join(desktop, 'package.json'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-combined-home-'));
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const run = spawnSync(requireDesktop('electron'), [path.join(desktop, 'tests/fixtures/combined-home-navigation.cjs'), dir], {
      cwd:desktop, env, encoding:'utf8', windowsHide:true, timeout:60000,
    });
    assert.equal(run.error, undefined, `${run.error?.message}\n${run.stdout}\n${run.stderr}`);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    process.stdout.write(run.stdout);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, {recursive:true, force:true});
  }
});
