import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { voiceRequestUrl } from '../src/main/voice-transport';
import { runElectronFixture } from './helpers/run-electron-fixture';

test('voice transport accepts only allowed routes on the current loopback app', () => {
  const origin = 'http://127.0.0.1:32123';
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(voiceRequestUrl(origin + '/api/speech/livekit?id=fixture&sequence=1', origin, method)?.pathname, '/api/speech/livekit');
  }
  for (const url of [origin + '/api/auth/session', origin + '/api/speech/%2fsettings', origin + '/api/speech/../auth/session',
    origin.replace('32123', '32124') + '/api/speech/settings', 'https://example.com/api/speech/settings',
    origin.replace('http://', 'http://user:pass@') + '/api/speech/settings']) {
    assert.equal(voiceRequestUrl(url, origin, 'POST'), null);
  }
  assert.equal(voiceRequestUrl(origin + '/api/speech/settings', origin, 'CONNECT'), null);
  assert.equal(voiceRequestUrl(origin + '/api/speech/settings', null, 'GET'), null);
});


test('voice preference transport permits only two exact authenticated GET routes', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const origin = 'http://' + host + ':32123';
    for (const route of ['/api/profile/voice-assistant', '/api/assistant-preferences']) {
      assert.equal(voiceRequestUrl(origin + route, origin, 'GET')?.href, origin + route);
      assert.equal(voiceRequestUrl(origin + route + '?fresh=1', origin, 'GET')?.search, '?fresh=1');
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT']) {
        assert.equal(voiceRequestUrl(origin + route, origin, method), null);
      }
      for (const url of [origin + route + '/', origin + route + '/extra',
        origin.replace('32123', '32124') + route,
        'https://example.com' + route,
        origin.replace('http://', 'http://user:pass@') + route]) {
        assert.equal(voiceRequestUrl(url, origin, 'GET'), null);
      }
    }
    for (const route of ['/api/profile', '/api/profile/voice-assistant-settings',
      '/api/profile/%76oice-assistant', '/api/assistant-preferences-backup',
      '/api/auth/session', '/api/keys']) {
      assert.equal(voiceRequestUrl(origin + route, origin, 'GET'), null);
    }
  }
});

test('Electron voice and preference reads stay responsive with six occupied sockets, preserving uploads, streaming, auth and cancellation', { timeout: 35_000 }, async t => {
  const desktop = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-voice-transport-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require('electron') as string,
      [path.join(desktop, 'tests/fixtures/voice-transport.cjs'), directory], desktop, env, 30_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
    const timing = result.output.split(/\r?\n/).find(line => line.startsWith('{"voiceReadyMs":'));
    if (timing) t.diagnostic(timing);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
