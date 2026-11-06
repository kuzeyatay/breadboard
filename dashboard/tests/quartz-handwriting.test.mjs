import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import opentype from 'opentype.js';
import sharp from 'sharp';

const dashboard = path.resolve(import.meta.dirname, '..'), quartz = path.resolve(dashboard, '../quartz');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quartz-handwriting-test-'));
test.after(() => {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(scratch));
  assert.ok(relative.startsWith('quartz-handwriting-test-') && !relative.includes(path.sep));
  fs.rmSync(scratch, { recursive: true, force: true });
});
const output = path.join(scratch, 'public'), content = path.join(scratch, 'content');
fs.mkdirSync(path.join(content, 'demo'), { recursive: true });
fs.writeFileSync(path.join(content, 'index.md'), '---\ntitle: Gardens\n---\n[Demo](demo/index)\n');
fs.writeFileSync(path.join(content, 'demo/index.md'), '---\ntitle: Demo garden\n---\n[Read note](note)\n');
fs.writeFileSync(path.join(content, 'demo/note.md'), '---\ntitle: A page in your handwriting\n---\nThe quick brown fox jumps over the lazy dog.\n\nNumbers 0123456789, punctuation and readable paragraphs.\n\n```js\nconst unchanged = true\n```\n\nInline math $E = mc^2$.\n');
const originalMarkdown = fs.readFileSync(path.join(content, 'demo/note.md'), 'utf8');
const compiled = spawnSync(process.execPath, ['quartz/bootstrap-cli.mjs', 'build', '-d', content, '-o', output, '--concurrency', '1'], {
  cwd: quartz, encoding: 'utf8', timeout: 60_000,
  env: { ...process.env, QUARTZ_CUSTOM_OG_IMAGES: 'false', DASHBOARD_URL: 'https://dashboard.test', QUARTZ_BASE_URL: 'quartz-reader.test' },
});
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const host = await build({ stdin: { resolveDir: dashboard, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import Settings from './src/app/garden/garden-settings-button';
createRoot(document.getElementById('root')).render(<><header><Settings quartzOrigin="https://quartz-reader.test"/></header><iframe data-quartz-reader src="https://quartz-reader.test/demo/note"/></>);` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const emptySheet = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1800"><rect width="1280" height="1800" fill="white"/>${Array.from({length:80}, (_,i) => `<rect x="${40 + i % 8 * 150}" y="${70 + Math.floor(i/8) * 165}" width="130" height="130" fill="none" stroke="black" stroke-width="3"/>`).join('')}</svg>`)).png().toBuffer();

async function fixture(run, embedded = false) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], workerRequests = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15_000);
  page.on('request', r => { if (r.url().includes('handwrite')) workerRequests.push(r.url()); });
  await page.route('**/*', r => r.abort());
  await page.route('**/katex.min.css', r => r.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(dashboard,'node_modules/katex/dist/katex.min.css'))}));
  await page.route('**/fonts/KaTeX*', r => {
    const file = path.join(dashboard, 'node_modules/katex/dist/fonts', new URL(r.request().url()).pathname.split('/').pop());
    return fs.existsSync(file) ? r.fulfill({body:fs.readFileSync(file)}) : r.abort();
  });
  await page.route('https://dashboard.test/**', r => r.fulfill({ contentType: 'text/html', body: `<style>body{margin:0}header{height:50px;padding:10px;box-sizing:border-box}iframe{border:0;width:100%;height:calc(100vh - 50px)}</style><div id="root"></div><script>${host.outputFiles[0].text}</script>` }));
  await page.route('https://quartz-reader.test/**', r => {
    const url = new URL(r.request().url()), relative = decodeURIComponent(url.pathname).replace(/^\//, '');
    const file = [relative, `${relative}.html`, `${relative}/index.html`].map(p => path.join(output, p)).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!file) return r.fulfill({ status: 404, body: 'Not found' });
    return r.fulfill({ contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.pdf': 'application/pdf' })[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  try {
    await page.goto(embedded ? 'https://dashboard.test/' : 'https://quartz-reader.test/demo/note');
    const frame = embedded ? page.frameLocator('iframe') : page;
    if (embedded) await page.getByRole('button', { name: 'Page settings', exact: true }).click();
    else await frame.getByRole('button', { name: 'Page settings', exact: true }).click();
    await frame.getByRole('dialog').waitFor();
    await run({ page, frame, errors });
    assert.deepEqual(errors, []);
    assert.equal(fs.readFileSync(path.join(content, 'demo/note.md'), 'utf8'), originalMarkdown);
  } catch (error) {
    console.error({ errors, workerRequests, frames: await Promise.all(page.frames().map(async f => ({ url: f.url(), status: await f.locator('[data-settings-status]').textContent({timeout:1000}).catch(() => null) }))) });
    throw error;
  } finally { await browser.close(); }
}

test('real Quartz bundle generates, previews and persists handwriting without changing math, code or Markdown', async () => {
  await fixture(async ({ page, frame }) => {
    const template = await frame.locator('[data-template]').getAttribute('href');
    assert.equal(new URL(template).pathname, '/static/handwrite/template.pdf');
    const codeFont = await frame.locator('article code').first().evaluate(el => getComputedStyle(el).fontFamily);
    const mathFont = await frame.locator('.katex').first().evaluate(el => getComputedStyle(el).fontFamily);
    await frame.locator('[data-scan]').setInputFiles(path.join(dashboard, 'tests/fixtures/handwrite/filled-sheet.jpg'));
    await frame.locator('[data-font-preview]').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('html').getAttribute('data-quartz-handwriting'), null);
    await page.screenshot({ path: path.resolve(dashboard, '../qa/quartz-handwriting-preview.png') });
    await frame.getByRole('button', { name: 'Use this handwriting' }).click();
    await frame.locator('[data-settings-status]').filter({ hasText: 'Your handwriting is now' }).waitFor();
    assert.match(await frame.locator('article p').first().evaluate(el => getComputedStyle(el).fontFamily), /QuartzHandwriting/);
    assert.equal(await frame.locator('article code').first().evaluate(el => getComputedStyle(el).fontFamily), codeFont);
    assert.equal(await frame.locator('.katex').first().evaluate(el => getComputedStyle(el).fontFamily), mathFont);
    const downloadPromise = page.waitForEvent('download'); await frame.getByRole('button', { name: 'Export font' }).click();
    const downloaded = await downloadPromise, fontBytes = fs.readFileSync(await downloaded.path());
    const font = opentype.parse(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength));
    assert.equal(font.numGlyphs, 82);
    assert.ok(font.charToGlyph('A').path.commands.length > 4);
    assert.notDeepEqual(font.charToGlyph('A').path.commands, font.charToGlyph('B').path.commands);
    await frame.getByRole('switch', { name: 'Use my handwriting' }).uncheck();
    await frame.locator('html:not([data-quartz-handwriting])').waitFor();
    await frame.getByRole('switch', { name: 'Use my handwriting' }).check();
    await frame.locator('html[data-quartz-handwriting]').waitFor();
    await page.reload();
    await frame.locator('html[data-quartz-handwriting]').waitFor();
    await frame.getByRole('button', { name: 'Page settings', exact: true }).click();
    // Invalid input must retain the acknowledged font and the enabled setting.
    await frame.locator('[data-scan]').setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a photograph') });
    await frame.locator('[data-settings-status][role=alert]').waitFor();
    assert.equal(await frame.locator('html').getAttribute('data-quartz-handwriting'), '');
    await frame.getByRole('button', { name: 'Remove font' }).click();
    await frame.locator('[data-font-name]').filter({ hasText: 'No handwriting font yet' }).waitFor();
    await frame.locator('[data-font-import]').setInputFiles({ name: 'my-handwriting.otf', mimeType: 'font/otf', buffer: fontBytes });
    await frame.locator('[data-font-preview]').waitFor({ state: 'visible' });
    // Closing during the async IndexedDB save must not dereference a cleared preview.
    await frame.getByRole('button', { name: 'Use this handwriting' }).evaluate(button => {
      button.click(); document.querySelector('dialog').close();
    });
    await frame.locator('html[data-quartz-handwriting]').waitFor();
    await frame.getByRole('dialog').waitFor({ state: 'hidden' });
  });
});

test('top-navbar settings bridge and reading controls work across navigation with keyboard dismissal', async () => {
  await fixture(async ({ page, frame }) => {
    assert.equal(await frame.locator('.quartz-settings-button').isVisible(), false);
    await frame.getByLabel('Text size', { exact: true }).fill('22');
    await frame.getByLabel('Line spacing', { exact: true }).fill('2');
    await frame.getByRole('switch', { name: 'Show knowledge graphs' }).uncheck();
    await frame.locator('[data-settings-status]').filter({ hasText: 'Saved on this device' }).waitFor();
    assert.equal(await frame.locator('article p').first().evaluate(el => getComputedStyle(el).fontSize), '22px');
    assert.equal(await frame.locator('article p').first().evaluate(el => getComputedStyle(el).lineHeight), '44px');
    await page.keyboard.press('Escape'); await frame.getByRole('dialog').waitFor({ state: 'hidden' });
    await frame.locator('body').evaluate(() => location.assign('/demo/'));
    await frame.locator('html[data-quartz-hide-graph]').waitFor();
    await page.getByRole('button', { name: 'Page settings', exact: true }).click();
    await frame.getByRole('dialog').waitFor();
    assert.equal(await frame.getByLabel('Text size', { exact: true }).inputValue(), '22');
    await frame.getByRole('button', { name: 'Reset reading settings' }).click();
    await frame.locator('html:not([data-quartz-hide-graph]):not([data-quartz-reader-size])').waitFor();
  }, true);
});

test('incomplete sheets and fonts are rejected, processing can be cancelled, and unrelated windows cannot open settings', async () => {
  await fixture(async ({ page, frame }) => {
    await frame.locator('[data-font-import]').setInputFiles({ name: 'bad.otf', mimeType: 'font/otf', buffer: Buffer.alloc(200) });
    await frame.locator('[data-settings-status][role=alert]').waitFor();
    assert.equal(await frame.getByRole('switch', { name: 'Use my handwriting' }).isDisabled(), true);
    await frame.locator('[data-scan]').setInputFiles({ name: 'empty-template.png', mimeType: 'image/png', buffer: emptySheet });
    await frame.locator('[data-settings-status][role=alert]').filter({ hasText: 'empty or too faint' }).waitFor();
    assert.equal(await frame.getByRole('switch', { name: 'Use my handwriting' }).isDisabled(), true);
    let releaseWorker;
    await page.route('**/static/handwrite/worker.js', async route => {
      await new Promise(resolve => { releaseWorker = resolve; });
      await route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(output, 'static/handwrite/worker.js')) }).catch(() => {});
    });
    await frame.locator('[data-scan]').setInputFiles(path.join(dashboard, 'tests/fixtures/handwrite/filled-sheet.jpg'));
    await frame.getByRole('button', { name: 'Cancel processing' }).click();
    releaseWorker?.();
    await frame.locator('[data-settings-status]').filter({ hasText: 'cancelled' }).waitFor();
    assert.equal(await frame.locator('[data-font-preview]').isVisible(), false);
    await frame.getByRole('button', { name: 'Close settings' }).click();
    await frame.locator('body').evaluate(() => window.postMessage({ type: 'breadboard:quartz-settings-open' }, '*'));
    assert.equal(await frame.getByRole('dialog').isVisible(), false);
  });
});

test('settings remain usable in dark mode on a narrow screen and rejected origins do not control the panel', async () => {
  await fixture(async ({ page, frame }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await frame.locator('html').evaluate(el => el.setAttribute('saved-theme', 'dark'));
    const bounds = await frame.getByRole('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y >= 50 && bounds.y + bounds.height <= 844);
    await frame.getByRole('button', { name: 'Close settings' }).click();
    await frame.locator('body').evaluate(() => window.dispatchEvent(new MessageEvent('message', {
      source: parent, origin: 'https://unrelated.test', data: { type: 'breadboard:quartz-settings-open' },
    })));
    assert.equal(await frame.getByRole('dialog').isVisible(), false);
    await page.getByRole('button', { name: 'Page settings', exact: true }).click();
    await frame.getByRole('dialog').waitFor();
    await frame.getByRole('dialog').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({path:path.resolve(dashboard,'../qa/quartz-handwriting-mobile-dark.png')});
    await frame.getByLabel('Text size', { exact: true }).focus();
    await page.keyboard.press('Tab');
    const focused = await frame.locator('body').evaluate(() => document.querySelector('dialog')?.contains(document.activeElement));
    assert.equal(focused, true);
  }, true);
});
