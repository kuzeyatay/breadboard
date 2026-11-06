import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { livekitRuntimePackagePaths, livekitRuntimeTraceIncludes } from '../scripts/livekit-runtime-packages.mjs';
import { verifyLiveKitRuntime } from '../../desktop/scripts/verify-livekit-runtime.mjs';

test('LiveKit tracing preserves nested versions, both module formats, and installed optional bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-livekit-packages-'));
  const writePackage = (relative, manifest) => {
    const directory = path.join(root, 'node_modules', relative);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest));
  };
  try {
    writePackage('@livekit/agents', { dependencies: { sdk: '1' }, devDependencies: { 'dev-only': '1' }, peerDependencies: { typescript: '5' } });
    writePackage('@livekit/agents/node_modules/typescript', {});
    writePackage('@livekit/agents/node_modules/dev-only', {});
    writePackage('@livekit/rtc-node', { dependencies: { sdk: '2' } });
    writePackage('@livekit/local-inference', { optionalDependencies: { 'native-present': '1', 'native-absent': '1' } });
    writePackage('@livekit/rtc-node/node_modules/sdk', { version: '2', exports: { import: './esm.js', require: './cjs.cjs' } });
    writePackage('sdk', { version: '1', dependencies: { jose: '1' } });
    writePackage('sdk/node_modules/jose', {});
    writePackage('native-present', {});
    writePackage('dev-only', {});
    writePackage('typescript', {});
    fs.mkdirSync(path.join(root, 'node_modules/sdk/dist'));
    fs.writeFileSync(path.join(root, 'node_modules/sdk/dist/index.js'), '');
    assert.deepEqual(livekitRuntimeTraceIncludes(root), [
      'node_modules/@livekit/agents/package.json',
      'node_modules/@livekit/local-inference/package.json',
      'node_modules/@livekit/rtc-node/node_modules/sdk/package.json',
      'node_modules/@livekit/rtc-node/package.json',
      'node_modules/native-present/package.json',
      'node_modules/sdk/dist/**/*',
      'node_modules/sdk/node_modules/jose/package.json',
      'node_modules/sdk/package.json',
    ]);
    fs.rmSync(path.join(root, 'node_modules/sdk/node_modules/jose'), { recursive: true });
    assert.throws(() => livekitRuntimePackagePaths(root), /Missing LiveKit runtime dependency: jose/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('packaged voice verification rejects silent fallback to checkout dependencies', () => {
  const dashboard = fileURLToPath(new URL('../', import.meta.url));
  const artifact = fs.mkdtempSync(path.join(dashboard, '.tmp-livekit-packaging-'));
  try {
    assert.throws(() => verifyLiveKitRuntime(artifact), /resolved outside the standalone artifact/);
  } finally { fs.rmSync(artifact, { recursive: true, force: true }); }
});
