import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runElectronFixture } from './helpers/run-electron-fixture';

test('dictation private bridge records, transcribes, submits once and rejects cancelled or forged results', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
  const desktop = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-system-dictation-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require('electron') as string, [path.join(desktop, 'tests/fixtures/system-dictation.cjs'), directory], desktop, env, 40000);
    assert.equal(result.error, undefined, result.output + String(result.error ?? ''));
    assert.equal(result.status, 0, result.output);
  } finally { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
