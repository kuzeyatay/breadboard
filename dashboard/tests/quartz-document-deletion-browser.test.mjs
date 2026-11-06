import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installQuartzDocumentEditor } from '../../quartz/quartz/components/scripts/documentEditorLoader.mjs';
import { installCanonicalQuartzReader } from '../../quartz/quartz/components/scripts/canonicalReader.mjs';

const root = path.resolve(import.meta.dirname, '..');
const hostOrigin = 'http://localhost:53285', readerOrigin = 'http://localhost:53286';
const cluster = 'electromagnetism-1';
const title = 'From abstract vector spaces to electromagnetism';
const relPath = 'notes/from-abstract-vector-spaces.md';
const slug = `${cluster}/${relPath.slice(0, -3)}`;
const documents = [{ relPath, title }, { relPath: 'learning/from-abstract-vector-spaces.md', title: 'Another lesson' }];
const explorer = await build({ entryPoints: [path.join(root, '../quartz/quartz/components/scripts/explorer.inline.ts')], bundle: true, write: false, platform: 'browser', format: 'iife' });
const host = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';
import Bridge from './src/app/garden/garden-document-editor-bridge';
import {useCanonicalGardenFolders} from './src/app/garden/use-canonical-garden-folders';
import {useCanonicalQuartzDocument} from './src/app/garden/use-canonical-quartz-document';
function Host(){const ref=useRef(null);const [active,setActive]=useState({cluster:'${cluster}',slug:'${relPath.slice(0, -3)}'});
useCanonicalGardenFolders(ref,'${readerOrigin}','${cluster}');
const reader=useCanonicalQuartzDocument(ref,'${readerOrigin}',active,setActive);
return <><output>{active?.slug || 'No active note'}</output><p role="alert">{reader.error}</p><iframe ref={ref} src="${readerOrigin}/${slug}"/><Bridge iframeRef={ref} quartzOrigin="${readerOrigin}"/></>}
createRoot(document.getElementById('root')).render(<Host/>);` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));

async function fixture(run, options = {}) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(8_000);
  const errors = [], deletes = [], heldSnapshots = [];
  const deleteWaiters = new Map();
  const waitForDelete = index => deletes[index] ? Promise.resolve(deletes[index]) : new Promise(resolve => deleteWaiters.set(index, resolve));
  let disk = options.alreadyDeleted ? documents.slice(1) : [...documents], holdSnapshots = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${hostOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/folders') return route.fulfill({ json: { folders: [{ folder: 'notes', name: 'Notes' }, { folder: 'learning', name: 'Learning' }] } });
    if (url.pathname === '/api/documents') {
      const snapshot = [...disk];
      if (holdSnapshots) {
        holdSnapshots = false;
        heldSnapshots.push(() => route.fulfill({ json: { documents: snapshot } }).catch(() => {}));
        return;
      }
      return route.fulfill({ json: { documents: snapshot } });
    }
    if (url.pathname.startsWith('/api/documents/')) {
      if (route.request().method() === 'DELETE') {
        deletes.push(async (ok = true) => {
          if (ok) disk = disk.filter(entry => entry.relPath !== relPath);
          await route.fulfill({ status: ok ? 200 : 503, json: ok
            ? { success: true, deletedSlugs: ['from-abstract-vector-spaces'], deletedPaths: [relPath] }
            : { error: 'Deletion failed. Try again.' } });
        });
        deleteWaiters.get(deletes.length - 1)?.(deletes.at(-1));
        return;
      }
      const current = decodeURIComponent(url.pathname.slice('/api/documents/'.length));
      const home = current === 'index';
      return route.fulfill({ json: { success: true, canEdit: true, content: home ? 'Garden home' : 'A vector-space explanation.', title: home ? 'EM1' : title,
        revision: 'r1', reader: { slug: home ? `${cluster}/index` : slug, title: home ? 'EM1' : title, html: home ? '<p>Garden home</p>' : '<p>A vector-space explanation.</p>', toc: [] } } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<style>iframe{width:100%;height:760px;border:0}</style><div id="root"></div><script>${host.outputFiles[0].text}</script>` });
  });
  await page.route(`${readerOrigin}/**`, route => {
    const home = new URL(route.request().url()).pathname === `/${cluster}/`;
    const current = home ? `${cluster}/index` : slug;
    const index = Object.fromEntries([[`${cluster}/index`, { filePath: `${cluster}/_index.md`, title: 'EM1' }],
      ...documents.map(entry => [`${cluster}/${entry.relPath.slice(0, -3)}`, { filePath: `${cluster}/${entry.relPath}`, title: entry.title }])]
      .map(([slug, entry]) => [slug, { slug, ...entry, links: [], tags: [], content: '' }]));
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
      :root{--light:#f0f5f0;--dark:#20352c;--lightgray:#bacac0;--gray:#52645a;--secondary:#3e715d}body{font:16px system-ui}button{padding:8px}.folder-outer{display:block}.explorer{max-width:600px}
      </style><script>(${installCanonicalQuartzReader.toString()})();(${installQuartzDocumentEditor.toString()})();</script></head><body data-slug="${current}">
      <h1 class="article-title">${home ? 'EM1' : title}</h1><div class="markdown-actions" data-note-slug="${current}"><button class="markdown-edit-button">Edit</button><button class="markdown-delete-button">Delete</button><span class="markdown-action-status"></span></div>
      <article class="popover-hint"><p>Published stale explanation</p></article>
      <ul class="section-ul"><li class="section-li" id="listed-note"><div class="desc"><a href="/${slug}">Listed EM1 page</a></div><ul class="tags"><li><a href="/tags/physics">Physics</a></li></ul></li></ul>
      <div class="explorer" data-behavior="link" data-collapsed="open" data-savestate="false"><ul class="explorer-ul"></ul></div>
      <template id="template-folder"><li><div class="folder-container"><svg class="folder-icon"></svg><div><button class="folder-button"><span class="folder-title"></span></button></div></div><div class="folder-outer"><ul></ul></div></li></template>
      <template id="template-file"><li><a></a></li></template>
      <script>window.fetchData=Promise.resolve(${JSON.stringify(index)});</script><script>${explorer.outputFiles[0].text}</script>
      <script>document.dispatchEvent(new CustomEvent('nav',{detail:{url:'${current}'}}));</script></body></html>` });
  });
  try {
    await page.goto(hostOrigin);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('heading', { name: title, exact: true }).waitFor();
    await frame.getByRole('link', { name: 'Another lesson', exact: true }).waitFor();
    await run({ page, frame, deletes, waitForDelete, heldSnapshots, holdSnapshot: () => { holdSnapshots = true; } });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

async function confirm(frame) {
  await frame.locator('.markdown-delete-button').click();
  await frame.getByRole('alertdialog').getByRole('button', { name: 'Delete page', exact: true }).click();
}

test('deletion hides the page and explorer immediately, survives slow saves, stale replies, and old publications', { timeout: 30_000 }, async () => fixture(async ({ page, frame, deletes, waitForDelete, holdSnapshot, heldSnapshots }) => {
  await frame.locator('article').evaluate(() => {
    window.__quartzDocumentEditor = { flush: () => new Promise(resolve => { window.finishSave = resolve; }) };
  });
  holdSnapshot();
  const snapshotRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/documents');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await snapshotRequest;
  await confirm(frame);
  await frame.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'hidden' });
  await frame.getByRole('link', { name: title, exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await frame.locator('article').isVisible(), false);
  assert.equal(await frame.locator('#listed-note').isVisible(), false, 'tag links cannot unhide a deleted listing');
  assert.equal(deletes.length, 0, 'the UI must hide before the pending save completes');
  // A canonical response already in flight must not rebind the loader or show the article.
  await page.evaluate(({ slug, readerOrigin }) => document.querySelector('iframe').contentWindow.postMessage({
    type: 'second-brain:canonical-document', slug, html: '<p>Stale response</p>', revision: 'stale', requestId: 'stale',
  }, readerOrigin), { slug, readerOrigin });
  const deleteRequest = page.waitForRequest(request => request.method() === 'DELETE');
  await frame.locator('article').evaluate(() => window.finishSave());
  await deleteRequest;
  const finishDelete = await waitForDelete(0);
  assert.equal(deletes.length, 1);
  await finishDelete();
  await frame.getByRole('heading', { name: 'EM1', exact: true }).waitFor();
  await frame.locator('#listed-note').waitFor({ state: 'hidden' });
  for (const release of heldSnapshots) await release();
  assert.equal(await frame.getByRole('link', { name: title, exact: true }).count(), 0);
  await frame.getByRole('link', { name: 'Another lesson', exact: true }).waitFor();
  assert.equal(await page.locator('output').textContent(), 'No active note');
  assert.equal(await page.getByRole('alert').textContent(), '');
  assert.equal(heldSnapshots.length, 1);
}));

test('failed deletion restores the page and explorer and allows retry', { timeout: 30_000 }, async () => fixture(async ({ page, frame, deletes, waitForDelete }) => {
  const request = page.waitForRequest(request => request.method() === 'DELETE');
  await confirm(frame); await request;
  await frame.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'hidden' });
  await (await waitForDelete(0))(false);
  await frame.getByRole('heading', { name: title, exact: true }).waitFor();
  await frame.getByRole('link', { name: title, exact: true }).waitFor();
  await frame.getByText('Deletion failed. Try again.', { exact: true }).waitFor();
  assert.equal(await frame.locator('article').isVisible(), true);
  assert.equal(await frame.locator('#listed-note').isVisible(), true);
  const retry = page.waitForRequest(request => request.method() === 'DELETE');
  await confirm(frame); await retry;
  await waitForDelete(1);
  assert.equal(deletes.length, 2);
  await deletes[1]();
  await frame.getByRole('heading', { name: 'EM1', exact: true }).waitFor();
}));

test('save failure rolls back hiding without sending a delete', { timeout: 20_000 }, async () => fixture(async ({ frame, deletes }) => {
  await frame.locator('article').evaluate(() => { window.__quartzDocumentEditor = { flush: async () => { throw new Error('Could not save changes'); } }; });
  await confirm(frame);
  await frame.getByText('Could not save changes', { exact: true }).waitFor();
  await frame.getByRole('heading', { name: title, exact: true }).waitFor();
  await frame.getByRole('link', { name: title, exact: true }).waitFor();
  assert.equal(deletes.length, 0);
}));

test('a fresh reader excludes deleted markdown from a stale published explorer index', { timeout: 20_000 }, async () => fixture(async ({ frame }) => {
  await frame.getByRole('link', { name: title, exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await frame.getByRole('link', { name: 'Another lesson', exact: true }).count(), 1);
}, { alreadyDeleted: true }));

test('navigation during a pending save cancels the unsent deletion and restores its explorer entry', { timeout: 20_000 }, async () => fixture(async ({ frame, deletes }) => {
  await frame.locator('article').evaluate(() => {
    window.__quartzDocumentEditor = { flush: () => new Promise(resolve => { window.finishSave = resolve; }) };
  });
  await confirm(frame);
  await frame.getByRole('link', { name: title, exact: true }).waitFor({ state: 'hidden' });
  await frame.locator('article').evaluate(() => {
    document.dispatchEvent(new CustomEvent('prenav', { detail: {} }));
    window.finishSave();
  });
  await frame.getByRole('link', { name: title, exact: true }).waitFor();
  assert.equal(deletes.length, 0);
}));

test('a failed delete still restores the explorer after SPA navigation cleans up the old page', { timeout: 20_000 }, async () => fixture(async ({ frame, waitForDelete }) => {
  await confirm(frame);
  const finishDelete = await waitForDelete(0);
  await frame.locator('article').evaluate(() => document.dispatchEvent(new CustomEvent('prenav', { detail: {} })));
  await finishDelete(false);
  await frame.getByRole('link', { name: title, exact: true }).waitFor();
  await frame.getByText('Deletion failed. Try again.', { exact: true }).waitFor();
}));
