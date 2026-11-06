import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const hostOrigin = 'http://localhost:53287', readerOrigin = 'http://localhost:53288';
const cluster = 'electromagnetism-1', folder = 'learning/1. Fields and Space';
const title = 'From abstract vector spaces to electromagnetism';
const from = `${cluster}/lesson`, to = `${cluster}/learning/1.-Fields-and-Space/lesson`;
const originalDocuments = [{ relPath: 'lesson.md', title }, { relPath: 'notes/other.md', title: 'Another lesson' }];
const folders = [{ folder: 'notes', name: 'Notes' }, { folder: 'learning', name: 'Learning' }, { folder, name: '1. Fields and Space' }];
const explorer = await build({ entryPoints: [path.join(root, '../quartz/quartz/components/scripts/explorer.inline.ts')], bundle: true, write: false, platform: 'browser', format: 'iife' });
const host = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useRef}from'react';import{createRoot}from'react-dom/client';
import {useCanonicalGardenFolders} from './src/app/garden/use-canonical-garden-folders';
function Host(){const ref=useRef(null);useCanonicalGardenFolders(ref,'${readerOrigin}','${cluster}');
return <iframe ref={ref} src="${readerOrigin}/${cluster}/index"/>}
createRoot(document.getElementById('root')).render(<Host/>);` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));

async function fixture(run) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(8_000);
  const errors = [], moves = [], waiters = new Map(), snapshots = [];
  let documents = originalDocuments.map(item => ({ ...item })), holdSnapshot = false, frameLoads = 0;
  const waitForMove = index => moves[index] ? Promise.resolve(moves[index]) : new Promise(resolve => waiters.set(index, resolve));
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${hostOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/folders' && route.request().method() === 'PATCH') {
      const input = route.request().postDataJSON();
      const move = { input, finish: async (ok = true) => {
        const relPath = (input.toFolder ? input.toFolder + '/' : '') + input.slug.split('/').pop();
        if (ok) documents = documents.map(item => item.relPath === input.slug ? { ...item, relPath } : item);
        await route.fulfill({ status: ok ? 200 : 409, json: ok
          ? { success: true, relPath, folder: input.toFolder, previousRelPath: input.slug }
          : { error: 'The folder is busy. Try again.' } });
      } };
      moves.push(move); waiters.get(moves.length - 1)?.(move);
      return;
    }
    if (url.pathname === '/api/folders') return route.fulfill({ json: { folders } });
    if (url.pathname === '/api/documents') {
      const snapshot = documents.map(item => ({ ...item }));
      if (holdSnapshot) { holdSnapshot = false; snapshots.push(() => route.fulfill({ json: { documents: snapshot } }).catch(() => {})); return; }
      return route.fulfill({ json: { documents: snapshot } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<style>iframe{width:100%;height:850px;border:0}</style><div id="root"></div><script>${host.outputFiles[0].text}</script>` });
  });
  await page.route(`${readerOrigin}/**`, route => {
    frameLoads++;
    const requested = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
    if (requested !== `${cluster}/index`) {
      const note = documents.find(item => `${cluster}/${item.relPath.slice(0, -3).replaceAll(' ', '-')}` === requested);
      return route.fulfill({ status: note ? 200 : 404, contentType: 'text/html', body: `<h1>${note ? 'Opened moved document' : 'Missing document'}</h1>` });
    }
    const index = Object.fromEntries([[`${cluster}/index`, { filePath: `${cluster}/_index.md`, title: 'EM1' }],
      ...folders.map(item => [`${cluster}/${item.folder.replaceAll(' ', '-')}/index`, { filePath: `${cluster}/${item.folder}/_index.md`, title: item.name }]),
      ...originalDocuments.map(item => [`${cluster}/${item.relPath.slice(0, -3)}`, { filePath: `${cluster}/${item.relPath}`, title: item.title }])]
      .map(([slug, entry]) => [slug, { slug, ...entry, links: [], tags: [], content: '' }]));
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
      body{font:16px system-ui}.folder-container{display:flex;align-items:center;min-height:36px}.folder-outer{display:none}.folder-outer.open{display:block}.explorer{max-width:700px}a{display:inline-block;padding:8px}button{padding:8px}.explorer-flag-menu{display:none}
      </style></head><body data-slug="${cluster}/index"><h1>Garden reader</h1>
      <div class="explorer" data-behavior="link" data-collapsed="open" data-savestate="true"><ul class="explorer-ul"></ul></div>
      <template id="template-folder"><li><div class="folder-container"><svg class="folder-icon"></svg><div><button class="folder-button"><span class="folder-title"></span></button></div></div><div class="folder-outer"><ul></ul></div></li></template>
      <template id="template-file"><li><a></a></li></template>
      <script>window.addCleanup=()=>{};window.fetchData=Promise.resolve(${JSON.stringify(index)});</script><script>${explorer.outputFiles[0].text}</script>
      <script>document.dispatchEvent(new CustomEvent('nav',{detail:{url:'${cluster}/index'}}));</script></body></html>` });
  });
  try {
    await page.goto(hostOrigin);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('link', { name: title, exact: true }).waitFor();
    await frame.locator(`.folder-container[data-folderpath="${cluster}/learning/1.-Fields-and-Space/index"]`).waitFor();
    const drop = async (source = from, destination = `${cluster}/learning/1.-Fields-and-Space/index`) => {
      await frame.locator(`a[data-for="${source}"]`).dragTo(frame.locator(`.folder-container[data-folderpath="${destination}"]`));
    };
    await run({ page, frame, moves, waitForMove, drop, snapshots, frameLoads: () => frameLoads,
      holdSnapshot: () => { holdSnapshot = true; } });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

test('a drop moves the row immediately and stale snapshots cannot leave a ghost or duplicate', { timeout: 30_000 }, async () => fixture(async ({ page, frame, waitForMove, drop, holdSnapshot, snapshots, frameLoads }) => {
  holdSnapshot();
  const staleRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/documents');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await staleRequest;
  await drop();
  const move = await waitForMove(0);
  assert.deepEqual(move.input, { clusterSlug: cluster, slug: 'lesson.md', toFolder: folder });
  await frame.locator(`a[data-for="${to}"]`).waitFor();
  assert.equal(await frame.locator(`a[data-for="${from}"]`).count(), 0);
  assert.equal(await frame.getByRole('link', { name: title, exact: true }).count(), 1);
  assert.equal(await frame.locator(`a[data-for="${to}"]`).locator('..').getAttribute('aria-busy'), 'true');
  await move.finish();
  await frame.locator('li[aria-busy=true]').waitFor({ state: 'detached' });
  for (const release of snapshots) await release();
  // Another tree rebuild must not restore the old published root entry.
  await frame.locator('.explorer').evaluate(() => document.dispatchEvent(new CustomEvent('nav', { detail: { url: 'electromagnetism-1/index' } })));
  await frame.locator(`a[data-for="${to}"]`).waitFor();
  assert.equal(await frame.locator(`a[data-for="${from}"]`).count(), 0);
  assert.equal(await frame.getByRole('link', { name: title, exact: true }).count(), 1);
  assert.equal(frameLoads(), 1, 'a move must not reload the reader');
  assert.equal(snapshots.length, 1);
}));

test('failed moves restore the source and retry relocates one row', { timeout: 30_000 }, async () => fixture(async ({ frame, drop, waitForMove, moves }) => {
  await drop(); const first = await waitForMove(0);
  await frame.locator(`a[data-for="${to}"]`).waitFor();
  await first.finish(false);
  await frame.locator(`a[data-for="${from}"]`).waitFor();
  assert.equal(await frame.locator(`a[data-for="${to}"]`).count(), 0);
  await frame.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  const retry = await waitForMove(1);
  assert.deepEqual(retry.input, first.input);
  await retry.finish();
  await frame.locator(`a[data-for="${to}"]`).waitFor();
  assert.equal(await frame.locator(`a[data-for="${from}"]`).count(), 0);
  assert.equal(moves.length, 2);
}));

test('clicking the pending destination opens its real new path after persistence', { timeout: 30_000 }, async () => fixture(async ({ page, frame, drop, waitForMove, frameLoads }) => {
  await drop(); const move = await waitForMove(0);
  const link = frame.locator(`a[data-for="${to}"]`);
  await link.focus(); await page.keyboard.press('Enter');
  assert.equal(frameLoads(), 1, 'pending clicks cannot open a missing file');
  await move.finish();
  await frame.getByRole('heading', { name: 'Opened moved document' }).waitFor();
  assert.equal(frameLoads(), 2);
}));

test('moving back to Files and dropping into the same folder leaves one entry', { timeout: 30_000 }, async () => fixture(async ({ frame, drop, waitForMove, moves }) => {
  await drop(); await (await waitForMove(0)).finish();
  await frame.locator('li[aria-busy=true]').waitFor({ state: 'detached' });
  await drop(to, `${cluster}/index`);
  const back = await waitForMove(1);
  assert.deepEqual(back.input, { clusterSlug: cluster, slug: `${folder}/lesson.md`, toFolder: '' });
  await frame.locator(`a[data-for="${from}"]`).waitFor();
  await back.finish();
  await frame.locator('li[aria-busy=true]').waitFor({ state: 'detached' });
  await drop(from, `${cluster}/index`);
  assert.equal(moves.length, 2);
  assert.equal(await frame.getByRole('link', { name: title, exact: true }).count(), 1);
  assert.equal(await frame.locator(`a[data-for="${to}"]`).count(), 0);
}));

test('independent drops can finish out of order without undoing another pending move', { timeout: 30_000 }, async () => fixture(async ({ frame, drop, waitForMove }) => {
  await drop(); const first = await waitForMove(0);
  await drop(`${cluster}/notes/other`); const second = await waitForMove(1);
  await second.finish(false);
  await frame.locator(`a[data-for="${cluster}/notes/other"]`).waitFor();
  await frame.locator(`a[data-for="${to}"]`).waitFor();
  assert.equal(await frame.locator(`a[data-for="${from}"]`).count(), 0);
  await first.finish();
  await frame.locator('li[aria-busy=true]').waitFor({ state: 'detached' });
  assert.equal(await frame.getByRole('link', { name: title, exact: true }).count(), 1);
  assert.equal(await frame.getByRole('link', { name: 'Another lesson', exact: true }).count(), 1);
}));

test('moving the open page updates the tree before saving and opens the new path after persistence', { timeout: 30_000 }, async () => fixture(async ({ frame, drop, waitForMove, moves }) => {
  await frame.locator('h1').evaluate((node, slug) => {
    const actions = document.createElement('div'); actions.className = 'markdown-actions'; actions.dataset.noteSlug = slug;
    document.body.append(actions);
    window.__quartzDocumentEditor = { flush: () => new Promise(resolve => { window.finishSave = resolve; }) };
  }, from);
  await drop();
  await frame.locator(`a[data-for="${to}"]`).waitFor();
  assert.equal(moves.length, 0);
  assert.equal(await frame.locator(`a[data-for="${from}"]`).count(), 0);
  await frame.locator('h1').evaluate(() => window.finishSave());
  await (await waitForMove(0)).finish();
  await frame.getByRole('heading', { name: 'Opened moved document' }).waitFor();
}));
