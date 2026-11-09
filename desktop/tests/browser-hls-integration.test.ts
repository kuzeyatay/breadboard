import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runElectronFixture } from './helpers/run-electron-fixture';

test('native HLS discovery, authenticated saving, progress, cancellation and navigation isolation', { timeout: 90_000 }, async () => {
  const desktop = path.resolve(__dirname, '../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-hls-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const run = await runElectronFixture(require('electron') as string,
      [path.join(desktop, 'tests/fixtures/browser-hls.cjs'), dir], desktop, env, 80_000);
    assert.equal(run.error, undefined, `${run.error?.message}\n${run.output}`);
    assert.equal(run.status, 0, run.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
