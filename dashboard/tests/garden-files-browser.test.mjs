import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { GardenFileStore } from '../src/lib/garden-files/store.ts';
import { gardenFilePreview } from '../src/lib/garden-files/preview.ts';
import { loadGardenFileEditor, saveGardenFileEditor, saveGardenNativeBytes } from '../src/lib/garden-files/editor.ts';
import AdmZip from 'adm-zip';
import './helpers/genoffice-node-loader.mjs';

const root = path.resolve(import.meta.dirname, '..'), hostOrigin = 'http://localhost:53307', readerOrigin = 'http://localhost:53308';
const explorer = await build({ entryPoints: [path.join(root, '../quartz/quartz/components/scripts/explorer.inline.ts')], bundle: true, write: false, platform: 'browser', format: 'iife' });
const host = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useRef}from'react';import{createRoot}from'react-dom/client';
import GardenFilesBridge from './src/app/garden/garden-files-bridge';
function Host(){const ref=useRef(null);return <><iframe data-quartz-reader ref={ref} src="${readerOrigin}/demo/index"/><GardenFilesBridge iframeRef={ref} quartzOrigin="${readerOrigin}" initialCluster="demo"/></>}
createRoot(document.getElementById('root')).render(<Host/>);` }, outfile: 'host.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'unrelated-native-surfaces', setup(builder) {
    builder.onResolve({ filter: /(?:cad\/model-viewer|pdf-viewer-client|garden-file-knowledge)$/ }, () => ({ path: 'native-viewer', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default function NativeViewer(){return null}', loader: 'js' }));
  } }],
});
const hostJs = host.outputFiles.find(file => file.path.endsWith('.js')).text, hostCss = host.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), ...fs.readdirSync(path.join(os.homedir(), 'AppData/Local/ms-playwright')).filter(name => name.startsWith('chromium-')).map(name => path.join(os.homedir(), 'AppData/Local/ms-playwright', name, 'chrome-win64/chrome.exe')), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(value => value && fs.existsSync(value));

async function fixture(t, { word = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-file-browser-')), database = new Database(':memory:');
  database.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE clusters(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);INSERT INTO clusters VALUES(1)');
  const store = new GardenFileStore(database, path.join(directory, 'files')), scope = { gardenId: 'demo', clusterId: 1, ownerId: 1, userId: 1 };
  const put = async (name, bytes) => store.import(scope, name, await store.stage(Readable.from([bytes])));
  const text = await put('notes/Project brief.txt', 'Hello from the original.\r\nSecond line.\r\n');
  await put('notes/measurements.csv', 'Name,Value\n"A, B",42\nC,8');
  await put('archive.weird', Buffer.from([0,255,10,13]));
  let docx;
  if (word) {
    const { buildBlankDocx } = await import('../src/vendor/genoffice/docx-engine/src/index.ts');
    const zip = new AdmZip(Buffer.from(await buildBlankDocx()));
    zip.addFile('word/document.xml', Buffer.from(zip.readAsText('word/document.xml').replace('<w:p/>', '<w:p><w:r><w:t>Original Word document</w:t></w:r></w:p>')));
    docx = await put('Letter.docx', zip.toBuffer());
  }
  const browser = await chromium.launch({ executablePath, headless: true }), page = await browser.newPage({ viewport: { width: 1260, height: 850 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route(`${hostOrigin}/**`, async route => {
    const req = route.request(), url = new URL(req.url());
    try {
      if (url.pathname.startsWith('/genoffice-editor/')) {
        const target = path.join(root, 'public', url.pathname);
        const extension = path.extname(target);
        return route.fulfill({ body: fs.readFileSync(target), contentType: ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.ttf':'font/ttf' })[extension] || 'application/octet-stream' });
      }
      if (url.pathname === '/api/documents') return route.fulfill({ json: { documents: [{ relPath: 'notes/legacy.md', title: 'Existing garden note', folder: 'notes' }] } });
      if (url.pathname.startsWith('/api/gardens/demo/files')) {
        const [,id,operation] = url.pathname.split('/files');
        const parts = url.pathname.slice('/api/gardens/demo/files'.length).split('/').filter(Boolean), fileId = parts[0];
        const body = ['PATCH','PUT'].includes(req.method()) && req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null;
        let result;
        if (!fileId && req.method() === 'GET') result = { files: store.list(scope, url.searchParams.get('trash') === '1'), canEdit: true };
        else if (!fileId && req.method() === 'POST') {
          if (req.headers()['content-type']?.startsWith('application/json')) result = { file: store.createFolder(scope, req.postDataJSON().path) };
          else result = { file: store.import(scope, decodeURIComponent(req.headers()['x-file-path']), await store.stage(Readable.from([req.postDataBuffer() ?? Buffer.alloc(0)])), req.headers()['x-file-import-key']) };
        } else if (parts[1] === 'preview') result = await gardenFilePreview(store, scope, fileId);
        else if (parts[1] === 'edit') result = req.method() === 'PUT' ? { file: body ? await saveGardenFileEditor(store, scope, fileId, body) : await saveGardenNativeBytes(store, scope, fileId, Number(req.headers()['x-file-revision']), Readable.toWeb(Readable.from([req.postDataBuffer()])), undefined, req.headers()['x-file-copy'] === '1') } : await loadGardenFileEditor(store, scope, fileId);
        else if (parts[1] === 'versions') result = { versions: store.versions(scope, fileId) };
        else if (parts[1] === 'content') { const entry = store.get(scope, fileId); return route.fulfill({ body: fs.readFileSync(store.content(scope, fileId).path), contentType: entry.mimeType, headers: { 'X-Breadboard-File-Revision': String(entry.revision), 'X-Breadboard-File-Name': encodeURIComponent(entry.name) } }); }
        else if (req.method() === 'PATCH') {
          const change = { move: () => store.move(scope, fileId, body.revision, body.path), copy: () => store.copy(scope, fileId), trash: () => store.trash(scope, fileId, body.revision), restore: () => store.restore(scope, fileId), share: () => store.share(scope, fileId, body.revision, body.visibility), 'restore-version': () => store.restoreVersion(scope, fileId, body.revision, body.version) };
          result = { file: change[body.action]() };
        } else result = { file: store.get(scope, fileId) };
        return route.fulfill({ json: result });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>body{margin:0;font:14px system-ui;background:#e6f0e6;--paper-surface:#faf7ef;--ink:#13201b;--ink-muted:#50615a;--line:#d5dacf}button,input,textarea{font:inherit}button{cursor:pointer}button,a{color:inherit}button{background:none;border:0}iframe[data-quartz-reader]{width:100%;height:100vh;border:0}*{box-sizing:border-box}${hostCss}</style></head><body><div id="root"></div><script>${hostJs}</script></body></html>` });
    } catch (error) { return route.fulfill({ status: error.status || 500, json: { error: error.message } }); }
  });
  const index = { 'demo/index': { slug: 'demo/index', filePath: 'demo/_index.md', title: 'My garden', links: [], tags: [], content: '' }, 'demo/notes/index': { slug: 'demo/notes/index', filePath: 'demo/notes/_index.md', title: 'Notes', links: [], tags: [], content: '' }, 'demo/notes/legacy': { slug: 'demo/notes/legacy', filePath: 'demo/notes/legacy.md', title: 'Existing garden note', links: [], tags: [], content: '' } };
  await page.route(`${readerOrigin}/**`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
    body{font:14px system-ui;margin:0;background:#faf7ef;color:#13201b}.explorer{position:absolute;width:275px;top:30px;padding:12px}.center{margin-left:300px;margin-right:20px;padding-top:30px}.folder-container{display:flex;align-items:center;min-height:34px}.folder-outer{display:none}.folder-outer.open{display:block}.explorer a{color:inherit;text-decoration:none;display:flex;padding:6px}.explorer ul{list-style:none;padding-left:12px}button{border:0;background:transparent;cursor:pointer;color:inherit}.explorer-file-type{font-size:9px;margin-right:6px;color:#50615a}.explorer-flag-menu{display:none}.garden-file-open .center{visibility:hidden}.explorer-folder-action{padding:4px}.explorer-search{display:none}
    </style></head><body data-slug="demo/index"><div class="explorer" data-behavior="link" data-collapsed="open" data-savestate="true"><ul class="explorer-ul"></ul></div><main class="center"><h1>My garden</h1><p>Your notes and files in one place.</p></main>
    <template id="template-folder"><li><div class="folder-container"><svg class="folder-icon"></svg><div><button class="folder-button"><span class="folder-title"></span></button></div></div><div class="folder-outer"><ul></ul></div></li></template><template id="template-file"><li><a></a></li></template>
    <script>window.addCleanup=()=>{};window.fetchData=Promise.resolve(${JSON.stringify(index)});window.spaNavigate=url=>{document.querySelector('.center').textContent='Existing garden note';document.dispatchEvent(new CustomEvent('nav',{detail:{url:'demo/notes/legacy'}}));parent.postMessage({type:'second-brain:navigate',slug:'demo/notes/legacy'},'${hostOrigin}')};</script><script>${explorer.outputFiles[0].text}</script><script>document.dispatchEvent(new CustomEvent('nav',{detail:{url:'demo/index'}}));parent.postMessage({type:'second-brain:navigate',slug:'demo/index'},'${hostOrigin}');</script></body></html>` }));
  t.after(async () => { await browser.close(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await page.goto(hostOrigin);
  const frame = page.frameLocator('[data-quartz-reader]');
  await frame.getByRole('link', { name: 'Project brief.txt' }).waitFor();
  return { page, frame, store, scope, text, docx, errors };
}

test('the existing tree opens, edits and versions originals without replacing the garden shell', { timeout: 60000 }, async t => {
  const { page, frame, store, scope, text, errors } = await fixture(t);
  await frame.getByRole('link', { name: 'Project brief.txt' }).click();
  await page.getByText('Hello from the original.', { exact: false }).waitFor();
  assert.equal(await frame.getByRole('link', { name: 'Existing garden note' }).count(), 1);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit Project brief.txt' }).fill('Edited in the garden.\nStill here.\n');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
  await page.getByText('Unsaved changes', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(fs.readFileSync(store.content(scope, text.id).path, 'utf8'), 'Edited in the garden.\r\nStill here.\r\n');
  assert.equal(store.versions(scope, text.id).length, 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('File actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'File name' }).fill('Renamed brief.txt');
  await page.getByRole('button', { name: 'Rename', exact: true }).last().click();
  await frame.getByRole('link', { name: 'Renamed brief.txt' }).waitFor();
  assert.equal(store.get(scope, text.id).name, 'Renamed brief.txt');
  fs.mkdirSync(path.join(root, 'artifacts/garden-files'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/garden-files/text-reader.png') });
  assert.deepEqual(errors, []);
});

test('imports keep both names, show tables and offer a useful unknown-file fallback', { timeout: 60000 }, async t => {
  const { page, frame, store, scope, errors } = await fixture(t);
  await frame.getByRole('button', { name: 'Add files to garden', exact: true }).click();
  const inputs = page.locator('input[type=file]');
  await inputs.first().setInputFiles([{ name: 'archive.weird', mimeType: 'application/octet-stream', buffer: Buffer.from([1,2,3]) }, { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) }]);
  await frame.getByRole('link', { name: 'archive (2).weird' }).waitFor();
  await frame.getByRole('link', { name: 'empty.txt' }).waitFor();
  assert.equal(store.list(scope).filter(entry => entry.name === 'archive.weird').length, 1);
  await frame.getByRole('link', { name: 'measurements.csv' }).click();
  await page.getByRole('cell', { name: 'A, B', exact: true }).waitFor();
  await frame.getByRole('link', { name: 'archive (2).weird' }).click();
  await page.getByText('No preview is available for this file type.').waitFor();
  await page.getByRole('link', { name: 'Download archive (2).weird', exact: true }).waitFor();
  assert.deepEqual(errors, []);
});

test('a conflicting save keeps the draft visible and saves an independent copy', { timeout: 60000 }, async t => {
  const { page, frame, store, scope, text, errors } = await fixture(t);
  await frame.getByRole('link', { name: 'Project brief.txt' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Edit Project brief.txt' });
  await editor.fill('My unsaved draft.');
  await page.getByText('Unsaved changes', { exact: true }).waitFor();
  await page.evaluate(() => { const link = document.createElement('a'); link.id = 'workspace-navigation'; link.href = '/gardens/demo'; link.textContent = 'Back to workspace'; link.style.cssText='position:fixed;left:0;top:0;z-index:99'; document.body.append(link); });
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#workspace-navigation').click();
  assert.equal(await editor.inputValue(), 'My unsaved draft.');
  await page.locator('#workspace-navigation').evaluate(element => element.remove());
  store.save(scope, text.id, text.revision, await store.stage(Readable.from(['Edited in another window.'])));
  await page.evaluate(entry => window.dispatchEvent(new CustomEvent('sb:garden-file-updated', { detail: entry })), store.get(scope, text.id));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await editor.inputValue(), 'My unsaved draft.', 'A background update cannot replace the open draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save a copy', exact: true }).waitFor();
  assert.equal(await editor.inputValue(), 'My unsaved draft.');
  await page.getByRole('button', { name: 'Save a copy', exact: true }).click();
  await frame.getByRole('link', { name: 'Project brief (2).txt' }).waitFor();
  const copy = store.list(scope).find(entry => entry.name === 'Project brief (2).txt');
  assert.equal(fs.readFileSync(store.content(scope, copy.id).path, 'utf8'), 'My unsaved draft.');
  assert.equal(fs.readFileSync(store.content(scope, text.id).path, 'utf8'), 'Edited in another window.');
  assert.ok(page.url().includes(copy.id));
  assert.deepEqual(errors, []);
});

test('the built Word editor opens a library file, reports unsaved changes and saves its real DOCX bytes', { timeout: 60000 }, async t => {
  const { page, frame, store, scope, docx, errors } = await fixture(t, { word: true });
  await frame.getByRole('link', { name: 'Letter.docx' }).click();
  const preview = page.frameLocator('iframe[title="Preview Letter.docx"]');
  await preview.getByText('Original Word document', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const wordFrame = page.frameLocator('iframe[title="Edit Letter.docx"]');
  const editor = wordFrame.locator('.tiptap[contenteditable=true]').first();
  await editor.waitFor();
  await editor.click(); await editor.press('Control+End'); await page.keyboard.insertText(' Word edit verified.');
  await page.getByText('Unsaved changes', { exact: true }).waitFor();
  const saved = page.waitForResponse(response => response.url().includes(`/${docx.id}/edit`) && response.request().method() === 'PUT');
  await editor.press('Control+s');
  assert.equal((await saved).status(), 200);
  await page.getByText('Unsaved changes', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(store.get(scope, docx.id).version, 2);
  const edited = new AdmZip(fs.readFileSync(store.content(scope, docx.id).path));
  assert.match(edited.readAsText('word/document.xml'), /Word edit verified/);
  const original = new AdmZip(fs.readFileSync(store.content(scope, docx.id, 1).path));
  assert.doesNotMatch(original.readAsText('word/document.xml'), /Word edit verified/);
  await page.screenshot({ path: path.join(root, 'artifacts/garden-files/word-editor.png') });
  await editor.press('Control+End'); await page.keyboard.insertText(' My conflict copy.');
  await page.getByText('Unsaved changes', { exact: true }).waitFor();
  const other = new AdmZip(fs.readFileSync(store.content(scope, docx.id).path));
  other.addFile('word/document.xml', Buffer.from(other.readAsText('word/document.xml').replace('Word edit verified.', 'Changed in another window.')));
  store.save(scope, docx.id, store.get(scope, docx.id).revision, await store.stage(Readable.from([other.toBuffer()])));
  await editor.press('Control+s');
  await page.getByRole('button', { name: 'Save a copy', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save a copy', exact: true }).click();
  await frame.getByRole('link', { name: 'Letter (2).docx' }).waitFor();
  await page.frameLocator('iframe[title="Preview Letter (2).docx"]').getByText('My conflict copy.', { exact: false }).first().waitFor();
  assert.match(new AdmZip(fs.readFileSync(store.content(scope, docx.id).path)).readAsText('word/document.xml'), /Changed in another window/);
  assert.deepEqual(errors, []);
});

test('opening a folder clears the file link and accepts a drop into the reading pane', { timeout: 60000 }, async t => {
  const { page, frame, store, scope, errors } = await fixture(t);
  await frame.getByRole('link', { name: 'Project brief.txt' }).click();
  await page.getByText('Hello from the original.', { exact: false }).waitFor();
  await frame.locator('[data-garden-file-folder]').filter({ hasText: /^Notes$/ }).click();
  await page.getByRole('textbox', { name: 'Find files' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('file'), false);
  await page.getByRole('textbox', { name: 'Find files' }).evaluate(element => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['Dropped in the folder.'], 'Dropped.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await page.getByRole('button', { name: 'Dropped.txt', exact: true }).waitFor();
  assert.ok(store.list(scope).some(file => file.path === 'notes/Dropped.txt'));
  assert.deepEqual(errors, []);
});
