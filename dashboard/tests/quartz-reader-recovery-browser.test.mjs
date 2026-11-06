import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { withCanonicalQuartzReader } from '../../quartz/quartz/components/scripts/canonicalReader.mjs';

const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const settings = await build({ entryPoints: [path.resolve(import.meta.dirname, '../../quartz/quartz/components/scripts/readerSettings.inline.ts')], bundle: true, write: false, platform: 'browser', format: 'iife' });

async function fixture(run, { published = true, status, folder = false } = {}) {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Exercise the real timeout/retry path without waiting 20 seconds per test.
    await page.addInitScript(() => {
      const timeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 15_000 ? 300 : ms === 5_000 ? 500 : ms, ...args);
    });
    await page.route('https://reader.test/**', route => route.fulfill({ contentType: 'text/html', body: withCanonicalQuartzReader(`<html><head></head><body data-slug="demo/${folder ? 'folder/index' : 'note'}">
      <div class="sidebar left"><div class="flex-component"><div class="search">Search</div><button class="readermode">Book</button></div></div>
      <h1 class="article-title">Published title</h1>
      ${folder ? '<div><ul class="page-listing"><li>Published folder</li></ul></div>' : `<div class="markdown-actions" data-note-slug="demo/note"><button>Edit</button></div><article class="popover-hint">${published ? '<p>Published note</p>' : ''}</article>`}
      <script>${settings.outputFiles[0].text}</script></body></html>`) }));
    await page.route('https://host.test/**', route => route.fulfill({ contentType: 'text/html', body: `<script>
      window.requests=[]; window.ready=false;
      addEventListener('message', event => {
        const request=event.data;
        if(request.type!=='second-brain:document-editor')return;
        requests.push(request);
        if(!window.ready && ${status ?? 'undefined'}===undefined)return;
        event.source.postMessage({type:'second-brain:document-editor-result',sessionId:request.sessionId,requestId:request.requestId,slug:request.slug,
          ok:${status ? 'false' : 'true'},status:${status ?? 200},reader:{slug:request.slug,title:'Saved title',html:'<p>Latest saved content</p>',${folder ? "kind:'folder'," : ''}toc:[]}},event.origin);
      });
      </script><iframe src="https://reader.test/demo/${folder ? 'folder/index' : 'note'}"></iframe>` }));
    await page.goto('https://host.test/');
    const frame = page.frames().find(frame => frame.url().startsWith('https://reader.test/'));
    await run({ page, frame });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

test('a delayed host leaves the published page readable and automatically replaces it with the saved note', async () => {
  await fixture(async ({ page, frame }) => {
    await frame.getByRole('alert').waitFor();
    assert.match(await frame.getByRole('alert').textContent(), /Showing the published version/);
    assert.equal(await frame.getByText('Published note', { exact: true }).isVisible(), true);
    assert.equal(await frame.locator('.quartz-settings-button').count(), 0, 'No duplicate gear while the host has not started');
    await page.evaluate(() => { window.ready = true; });
    await frame.getByText('Latest saved content', { exact: true }).waitFor();
    assert.equal(await frame.getByRole('alert').count(), 0);
    assert.equal(await frame.locator('.article-title').textContent(), 'Saved title');
    const requests = await page.evaluate(() => window.requests.length);
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.requests.length), requests, 'Recovery stops retrying after success');
  });
});

test('folder pages recover when the host starts after the first request timeout', async () => {
  await fixture(async ({ page, frame }) => {
    await frame.getByRole('alert').waitFor();
    assert.equal(await frame.getByText('Published folder', { exact: true }).isVisible(), true);
    await page.evaluate(() => { window.ready = true; });
    await frame.getByText('Latest saved content', { exact: true }).waitFor();
    assert.equal(await frame.getByRole('alert').count(), 0);
    assert.equal(await frame.locator('html').getAttribute('data-canonical-pending'), null);
  }, { folder: true });
});

test('unpublished shells stay empty until their own saved document arrives', async () => {
  await fixture(async ({ page, frame }) => {
    await frame.getByRole('alert').waitFor();
    assert.doesNotMatch(await frame.getByRole('alert').textContent(), /published version/);
    assert.equal(await frame.locator('article').isVisible(), false);
    await page.evaluate(() => { window.ready = true; });
    await frame.getByText('Latest saved content', { exact: true }).waitFor();
  }, { published: false });
});

for (const status of [403, 404]) test(`a ${status} response never reveals the obsolete published note`, async () => {
  await fixture(async ({ page, frame }) => {
    await frame.getByRole('alert').waitFor();
    assert.doesNotMatch(await frame.getByRole('alert').textContent(), /published version/);
    assert.equal(await frame.locator('article').isVisible(), false);
    const requests = await page.evaluate(() => window.requests.length);
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => window.requests.length), requests);
  }, { status });
});

test('navigation cancels startup recovery so it cannot overwrite the destination', async () => {
  await fixture(async ({ page, frame }) => {
    await frame.getByRole('alert').waitFor();
    await frame.evaluate(() => document.dispatchEvent(new Event('prenav')));
    const requests = await page.evaluate(() => window.requests.length);
    await page.evaluate(() => { window.ready = true; });
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => window.requests.length), requests);
    assert.equal(await frame.getByText('Latest saved content').count(), 0);
  });
});
