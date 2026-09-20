import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-understanding-ui-'));
process.env.BREADBOARD_DATA_DIR = root;
const { default: db } = await import('../src/lib/db.ts');
const { pageUnderstanding: store } = await import('../src/lib/page-understanding.ts');
const { syncTextHighlights } = await import('../src/lib/text-highlight-store.ts');
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES (1,'reader','reader@example.test','x')").run();

test('Quartz understanding is saved, reflected in page flags, restored after reload, and recoverable on failure', async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve(import.meta.dirname, '..'), contents: `
    import '../quartz/quartz/components/scripts/highlighter.inline.ts';
    import '../quartz/quartz/components/scripts/pageUnderstanding.inline.ts';
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const require = createRequire(new URL('../../quartz/package.json', import.meta.url));
  // Include the real theme AFTER the component to exercise the task-checkbox
  // specificity collision that caused the checkbox to hang outside the article.
  const css = ['components/styles/pageUnderstanding.scss', 'components/styles/highlighter.scss', 'styles/custom.scss']
    .map(file => require('sass').compile(path.resolve(import.meta.dirname, '../../quartz/quartz', file), { logger: { warn() {} } }).css).join('\n');
  let fail = false;
  let anonymous = false;
  let holdReads = false;
  let holdWrites = false;
  const reads = [], writes = [];
  const until = async predicate => {
    for (let i = 0; i < 400 && !predicate(); i++) await delay(10);
    assert.ok(predicate(), 'expected request reached the server');
  };
  syncTextHighlights(1, { key: 'breadboard:garden-highlights:v1:physics/one/lesson', entries: [
    { id: 'lesson-heading', color: 'blue', start: 0, end: 23, text: 'Understanding a concept', prefix: '', suffix: '', createdAt: Date.now() },
  ] });
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.url === '/api/text-highlights') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      res.end(JSON.stringify(syncTextHighlights(1, JSON.parse(Buffer.concat(chunks).toString())))); return;
    }
    if (req.url === '/api/page-understanding') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (anonymous || fail) { res.statusCode = anonymous ? 401 : 503; res.end(JSON.stringify({ error: 'Save unavailable. Try again.' })); return; }
      if (typeof body.understood === 'boolean') {
        if (holdWrites) await new Promise(resolve => writes.push(resolve));
        store.set(1, body.gardenSlug, body.pageSlug, body.understood);
        res.end(JSON.stringify({ pages: store.list(1, body.gardenSlug) })); return;
      }
      const snapshot = store.list(1, body.gardenSlug);
      if (holdReads) await new Promise(resolve => reads.push(resolve));
      res.end(JSON.stringify({ pages: snapshot })); return;
    }
    if (req.url === '/script.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head><style>:root{--lightgray:#bdccbe;--light:#e7f1e8;--gray:#6c786d;--darkgray:#243c35;--dark:#16271f;--secondary:#507568;--bodyFont:Arial,sans-serif;--headerFont:Arial,sans-serif}.explorer-flag-swatch{display:block;width:18px;height:18px}${css}body{font-size:16px;max-width:min(1070px,calc(100% - 32px));margin:40px auto}</style></head><body data-slug="physics/one/lesson">
      <nav><button data-understanding-page="physics/one/lesson" data-manual-flag-color="#fb7185"><span class="explorer-flag-swatch"></span></button>
      <button data-understanding-page="physics/two/lesson" data-manual-flag-color="#38bdf8"><span class="explorer-flag-swatch"></span></button></nav>
      <article class="popover-hint"><h1>Understanding a concept</h1><p>Read the page, then record whether the explanation makes sense.</p></article>
      <div class="bb-highlighter" hidden><div class="bb-highlight-menu">
        <button data-highlight-color="blue">Blue</button><button data-highlight-action="erase">Erase</button>
        <button data-highlight-action="ask-chat">Ask in chat</button><button data-highlight-action="ask-inline">Ask here</button>
      </div></div>
      <script>window.cleanups=[];window.addCleanup=fn=>cleanups.push(fn);window.changePage=slug=>{cleanups.splice(0).forEach(fn=>fn());document.body.dataset.slug=slug;document.querySelector('article').innerHTML='<h1>Next lesson</h1><p>Another explanation.</p>';document.dispatchEvent(new Event('nav'));};
      </script><script src="/script.js"></script>
      <script>document.dispatchEvent(new Event('nav'));</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(async () => {
    for (const release of [...reads, ...writes]) release();
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    db.close(); fs.rmSync(root, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Preserve the real browser script's host resolution while serving a bounded fixture.
  await page.route('http://127.0.0.1:3000/api/**', route => route.continue({ url: `http://127.0.0.1:${server.address().port}${new URL(route.request().url()).pathname}` }));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const checkbox = page.getByRole('checkbox', { name: 'I understand this' });
  await page.waitForFunction(() => !document.querySelector('.bb-page-understanding input')?.disabled);
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await page.locator('article > :last-child').getAttribute('class'), 'bb-page-understanding');
  const settled = () => page.waitForFunction(() => document.querySelector('.bb-page-understanding [role="status"]')?.textContent === 'Saved');
  const metrics = await checkbox.evaluate(el => {
    const article = el.closest('article').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const footer = el.closest('.bb-page-understanding').getBoundingClientRect();
    return { left: box.left - article.left, width: box.width, height: box.height, footerHeight: footer.height, after: getComputedStyle(el, '::after').content };
  });
  assert.equal(metrics.left, 0, 'checkbox aligns with the article, not outside its left edge');
  assert.equal(metrics.width, 16);
  assert.equal(metrics.height, 16);
  assert.ok(metrics.footerHeight <= 48, `compact footer: ${metrics.footerHeight}px`);
  assert.equal(metrics.after, 'none', 'native checkbox has no duplicate task-list tick');
  await page.locator('mark.bb-hl').first().waitFor();
  await page.evaluate(() => { window.originalHighlight = document.querySelector('mark.bb-hl'); });
  await checkbox.click();
  assert.equal(await checkbox.isChecked(), true);
  await settled();
  const swatch = page.locator('[data-understanding-page="physics/one/lesson"] span');
  assert.equal(await swatch.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(34, 197, 94)');
  assert.equal(store.get(1, 'physics', 'one/lesson').understood, true);
  assert.equal(await page.evaluate(() => window.originalHighlight === document.querySelector('mark.bb-hl')), true, 'saving must not repaint text highlights');
  assert.equal(await checkbox.evaluate(el => getComputedStyle(el, '::after').content), 'none');

  // Refocus starts a slow background read. A single click must still uncheck,
  // immediately, and the stale read must not restore the old checked state.
  holdReads = true;
  holdWrites = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await until(() => reads.length === 1);
  await checkbox.click();
  await until(() => writes.length === 1);
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await checkbox.isEnabled(), true);
  assert.equal(await swatch.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(251, 113, 133)');
  assert.equal(store.get(1, 'physics', 'one/lesson').understood, true, 'UI responds before persistence completes');
  holdReads = false;
  reads.shift()();
  await delay(100);
  assert.equal(await checkbox.isChecked(), false, 'stale refresh cannot undo a click');
  holdWrites = false;
  writes.shift()();
  await settled();
  assert.equal(store.get(1, 'physics', 'one/lesson').understood, false);

  // Several clicks during one slow save coalesce to the last requested state.
  holdWrites = true;
  await checkbox.click();
  await until(() => writes.length === 1);
  for (const expected of [false, true, false]) {
    await checkbox.click();
    assert.equal(await checkbox.isChecked(), expected);
    assert.equal(await checkbox.isEnabled(), true);
  }
  holdWrites = false;
  writes.shift()();
  await settled();
  assert.equal(store.get(1, 'physics', 'one/lesson').understood, false);
  await checkbox.focus();
  await checkbox.press('Space');
  assert.equal(await checkbox.isChecked(), true);
  await settled();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.bb-page-understanding input')?.checked);
  await page.evaluate(() => { document.querySelector('article').innerHTML = '<p>Fresh canonical markdown.</p>'; });
  await page.waitForFunction(() => document.querySelector('.bb-page-understanding input')?.checked);
  assert.equal(await page.locator('.bb-page-understanding').count(), 1);
  // Quartz can re-announce navigation while retaining an existing DOM node.
  await page.evaluate(() => { window.cleanups.splice(0).forEach(fn => fn()); document.dispatchEvent(new Event('nav')); });
  await page.waitForFunction(() => !document.querySelector('.bb-page-understanding input')?.disabled);
  await checkbox.click();
  assert.equal(await checkbox.isChecked(), false);
  await settled();
  assert.equal(await swatch.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(251, 113, 133)');
  fail = true;
  await checkbox.click();
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(store.get(1, 'physics', 'one/lesson').understood, false);
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await settled();
  assert.equal(await checkbox.isChecked(), true);
  await page.evaluate(() => window.changePage('physics/two/lesson'));
  await page.waitForFunction(() => !document.querySelector('.bb-page-understanding input')?.disabled);
  assert.equal(await checkbox.isChecked(), false, 'same filename in another folder is a different page');
  await page.evaluate(() => window.changePage('physics/one/lesson'));
  await page.waitForFunction(() => document.querySelector('.bb-page-understanding input')?.checked);
  // A save can finish after SPA navigation without touching the new page.
  holdWrites = true;
  await checkbox.click();
  await until(() => writes.length === 1);
  await page.evaluate(() => window.changePage('physics/two/lesson'));
  await page.waitForFunction(() => !document.querySelector('.bb-page-understanding input')?.disabled);
  holdWrites = false;
  writes.shift()();
  await until(() => store.get(1, 'physics', 'one/lesson').understood === false);
  assert.equal(await checkbox.isChecked(), false);
  await page.evaluate(() => window.changePage('physics/one/lesson'));
  await page.waitForFunction(() => !document.querySelector('.bb-page-understanding input')?.disabled);
  assert.equal(await checkbox.isChecked(), false);
  await page.locator('.bb-page-understanding label').click();
  assert.equal(await checkbox.isChecked(), true);
  await settled();
  // Keep a reviewable screenshot outside the repository.
  await page.screenshot({ path: path.join(os.tmpdir(), 'breadboard-page-understanding.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 720 });
  const mobile = await checkbox.evaluate(el => ({
    aligned: el.getBoundingClientRect().left === el.closest('article').getBoundingClientRect().left,
    footerHeight: el.closest('.bb-page-understanding').getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.equal(mobile.aligned, true);
  assert.ok(mobile.footerHeight <= 48);
  assert.equal(mobile.overflow, false);
  anonymous = true;
  await page.reload();
  await page.getByText('Sign in to save your understanding.', { exact: true }).waitFor();
  assert.equal(await checkbox.isEnabled(), false);
  assert.deepEqual(errors, []);
});
