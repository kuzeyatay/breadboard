import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('read-aloud and MP3 controls send spoken formulas to every provider', { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const outdir = path.join(root, '.tmp-math-speech-bundle');
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Actions from './src/app/components/assistant-message-actions';
      window.readings = []; window.saved = [];
      window.provider = new URLSearchParams(location.search).get('provider');
      HTMLAnchorElement.prototype.click = function() { window.saved.push(this.download); };
      createRoot(document.getElementById('root')).render(<Actions content={'Energy: $E=mc^2$. Then $x_1 ≥ 0$.'} />);
    ` },
    bundle: true, splitting: true, write: false, format: 'esm', platform: 'browser', outdir,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'speech-transport', setup(build) {
      const stubs = {
        '@/app/components/use-humanizer-mode': 'export const useHumanizerMode = () => [false];',
        '@/lib/speech/playback': `
          export async function playSubscriptionText(text) {
            if (window.provider !== 'chatgpt') return false;
            window.readings.push({kind:'play', text}); return true;
          }
          export async function playSpeechBlob(blob) { window.readings.push({kind:'play', text:await blob.text()}); }
          export function stopSpeechPlayback() {}`,
        '@/lib/speech/request-client': `export async function speechRequest(url, init) {
          const {text} = JSON.parse(init.body);
          if (url.endsWith('/mp3')) window.readings.push({kind:'download', text});
          return new Response(text);
        }`,
      };
      build.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'stub' } : null);
      build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const assets = new Map(bundle.outputFiles.map(file => ['/' + path.relative(outdir, file.path).replaceAll('\\', '/'), file.text]));
  let releaseChunk;
  let delayChunk = true;
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const asset = assets.get(pathname);
    if (asset && pathname.startsWith('/math-speech-') && delayChunk) {
      await new Promise(resolve => { releaseChunk = resolve; });
    }
    response.setHeader('Content-Type', asset ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    response.end(asset ?? '<html><body><div id="root"></div><script type="module" src="/stdin.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const provider of ['local', 'chatgpt', 'elevenlabs']) {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      const errors = [];
      const external = [];
      page.on('pageerror', error => errors.push(error.stack));
      await page.route('https://**/*', route => { external.push(route.request().url()); return route.abort(); });
      await page.goto(`http://127.0.0.1:${server.address().port}/?provider=${provider}`);
      await page.getByRole('button', { name: 'Read response aloud', exact: true }).click();
      if (provider === 'local') {
        await page.getByRole('button', { name: 'Cancel speech generation', exact: true }).click();
        // Allow a genuinely pending lazy import to finish after cancellation.
        for (let attempt = 0; !releaseChunk && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(releaseChunk, `The math chunk was not requested. ${errors.join('; ')}`);
        delayChunk = false;
        releaseChunk();
        await page.getByRole('button', { name: 'Read response aloud', exact: true }).click();
      }
      await page.waitForFunction(() => window.readings.length === 1).catch(async error => {
        throw new Error(`${provider}: ${await page.locator('body').innerText()} ${errors.join('; ')}`, { cause: error });
      });
      assert.deepEqual(await page.evaluate(() => window.readings), [{ kind: 'play', text: 'Energy: E equals m c squared. Then x sub 1 is greater than or equal to 0.' }]);
      await page.getByRole('button', { name: 'Stop reading response', exact: true }).click();
      await page.getByRole('button', { name: 'More response actions', exact: true }).click();
      await page.getByRole('button', { name: 'Download dictation', exact: true }).click();
      await page.waitForFunction(() => window.saved.length === 1);
      const readings = await page.evaluate(() => window.readings);
      assert.equal(readings[1].kind, 'download');
      assert.equal(readings[1].text, readings[0].text);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await page.close();
    }
  } finally {
    releaseChunk?.();
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
