import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';

test('chat images enlarge outside virtualized rows, zoom, and restore keyboard focus on dismissal', { timeout: 60000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const styles = postcss.parse(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'));
  const css = styles.nodes.filter(node => node.type === 'rule' &&
    /\.chat-(?:markdown|image-viewer)/.test(node.selector)).map(node => node.toString()).join('\n');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import ChatMarkdown from './src/app/components/chat-markdown';
      createRoot(document.getElementById('root')).render(<ChatMarkdown content={
        '![Circuit diagram](/diagram.svg)\\n\\n[![Linked diagram](/landscape.svg)](/source)'
      } />);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') },
  });
  const server = http.createServer((request, response) => {
    if (request.url === '/app.js') {
      response.setHeader('content-type', 'text/javascript');
      response.end(bundle.outputFiles[0].text);
    } else if (request.url.endsWith('.svg')) {
      response.setHeader('content-type', 'image/svg+xml');
      const [width, height] = request.url === '/diagram.svg' ? [300, 400] : [1200, 400];
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#659b82"/></svg>`);
    } else {
      response.setHeader('content-type', 'text/html');
      response.end(`<style>body{margin:0;padding:16px}#root{width:260px;transform:translateY(20px);overflow:hidden}${css}</style><button id="outside">Outside</button><div id="root"></div><script src="/app.js"></script>`);
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => [...document.querySelectorAll('.chat-markdown img')]
        .every(image => image.complete && image.naturalWidth > 0));
      const trigger = page.getByRole('button', { name: 'Enlarge image: Circuit diagram', exact: true });
      const inline = await trigger.boundingBox();
      await trigger.click();
      const viewer = page.getByRole('dialog', { name: 'Circuit diagram', exact: true });
      await viewer.waitFor({ state: 'visible' });
      assert.equal(await viewer.evaluate(element => element.matches(':modal') && element.parentElement === document.body), true);
      const image = viewer.getByRole('img', { name: 'Circuit diagram', exact: true });
      await page.waitForFunction(() => document.querySelector('.chat-image-viewer img')?.naturalWidth > 0);
      const enlarged = await image.boundingBox();
      assert.ok(enlarged.width > inline.width, JSON.stringify({ inline, enlarged }));
      assert.ok(enlarged.x >= 0 && enlarged.x + enlarged.width <= width);
      assert.ok(enlarged.y >= 0 && enlarged.y + enlarged.height <= 800);
      assert.ok(Math.abs(enlarged.width / enlarged.height - 0.75) < 0.01);
      assert.equal(await page.locator('body').evaluate(element => element.style.overflow), 'hidden');
      // Modal keyboard navigation cannot enter the underlying transcript.
      for (let index = 0; index < 4; index++) {
        await page.keyboard.press('Tab');
        assert.equal(await viewer.evaluate(element => element.contains(document.activeElement)), true);
      }
      await viewer.getByRole('button', { name: 'Zoom in' }).click();
      const zoomed = await image.boundingBox();
      assert.ok(Math.abs(zoomed.width - enlarged.width * 2) < 1);
      assert.equal(await viewer.locator('.chat-image-viewer-stage').evaluate(element =>
        element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight), true);
      await viewer.getByRole('button', { name: 'Fit to screen' }).click();
      await page.keyboard.press('Escape');
      await viewer.waitFor({ state: 'detached' });
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
      assert.equal(await page.locator('body').evaluate(element => element.style.overflow), '');

      for (const key of ['Enter', 'Space']) {
        await trigger.press(key);
        await viewer.waitFor({ state: 'visible' });
        if (key === 'Enter') await viewer.getByRole('button', { name: 'Close image viewer' }).click();
        else await viewer.click({ position: { x: 4, y: 4 } });
        await viewer.waitFor({ state: 'detached' });
        assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
      }

      const url = page.url();
      await page.getByRole('button', { name: 'Enlarge image: Linked diagram' }).click();
      const linked = page.getByRole('dialog', { name: 'Linked diagram', exact: true });
      await linked.waitFor({ state: 'visible' });
      assert.equal(page.url(), url);
      assert.equal(page.context().pages().length, 1, 'linked image does not open a new tab');
      await page.waitForFunction(() => document.querySelector('.chat-image-viewer img')?.naturalWidth === 1200);
      const landscape = await linked.getByRole('img').boundingBox();
      assert.ok(Math.abs(landscape.width / landscape.height - 3) < 0.01);
      // The empty area around the fitted image also dismisses the viewer.
      await linked.locator('.chat-image-viewer-stage').click({ position: { x: 4, y: 4 } });
      await linked.waitFor({ state: 'detached' });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
