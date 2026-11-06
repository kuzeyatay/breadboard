import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('persistent voice and dictation pages spend no sessions across nine idle hours', { timeout: 60_000 }, async t => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Runtime from './src/app/components/voice-assistant-runtime';
      import Dictation from './src/app/dictation/page';
      window.voiceConnections = 0;
      window.RTCPeerConnection = class { constructor() { window.voiceConnections++; throw Error('Unexpected idle voice connection'); } };
      window.breadboardDictation = { ready: async () => { window.dictationReady = true; return true; },
        onCommand: () => () => {}, report: () => {}, screenContext: async () => ({}) };
      createRoot(document.getElementById('root')).render(<><Runtime/><Dictation/></>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' },
  });
  const requests = [];
  const server = createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (!req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script src="/app.js"></script>'); return; }
    requests.push({ url: req.url, method: req.method });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/profile/voice-assistant') res.end(JSON.stringify({ userId: '1', preferences: {
      readAloudNotifications: false, alwaysOnVoiceAssistant: false, startVoiceOnStartup: true, voiceModel: 'default',
    } }));
    else if (req.url === '/api/speech/settings') res.end(JSON.stringify({ userId: '1', settings: { enabled: true, speechProvider: 'chatgpt', openaiVoice: 'sol' } }));
    else res.end('{"ready":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-04T20:00:00Z') });
  const prepared = page.waitForResponse(response => response.url().endsWith('/api/speech/prepare'));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.dictationReady);
  await prepared;
  // Allow the initial settings read and any speculative startup to settle.
  await page.clock.runFor(2_000);
  assert.equal(await page.evaluate(() => window.voiceConnections), 0);
  for (let hour = 0; hour < 9; hour++) {
    await page.clock.fastForward(60 * 60_000);
    await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
    await page.clock.runFor(1_000);
  }
  assert.equal(await page.evaluate(() => window.voiceConnections), 0, 'startup, timers and reconnect events cannot allocate metered voice sessions');
  assert.deepEqual(requests.filter(request => /subscription|completions|responses/.test(request.url)), []);
  assert.deepEqual(errors, []);
});
