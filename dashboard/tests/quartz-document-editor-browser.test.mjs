import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { installQuartzDocumentEditor } from '../../quartz/quartz/components/scripts/documentEditorLoader.mjs';
import { installCanonicalQuartzReader } from '../scripts/quartz-canonical-reader-bridge.mjs';

const root = path.resolve(import.meta.dirname, '..'), quartz = path.resolve(root, '../quartz');
const dashboardOrigin = 'http://localhost:53281', quartzOrigin = 'http://localhost:53282';
const editor = await build({ entryPoints: [path.join(root, 'src/lib/quartz-editor/index.ts')], outfile: 'editor.js', bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'BreadboardDocumentEditor',
  plugins: process.env.QUARTZ_EDITOR_BASELINE_DIR ? [{ name: 'baseline', setup(builder) {
    builder.onLoad({ filter: /quartz-editor[\\/][^\\/]+\.(ts|css)$/ }, args => {
      const baseline = path.join(process.env.QUARTZ_EDITOR_BASELINE_DIR, path.basename(args.path));
      if (fs.existsSync(baseline)) return { contents: fs.readFileSync(baseline, 'utf8'), loader: args.path.endsWith('.css') ? 'css' : 'ts', resolveDir: path.dirname(args.path) };
    });
  } }] : [],
});
const host = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useRef}from'react';import{createRoot}from'react-dom/client';
import Bridge from './src/app/garden/garden-document-editor-bridge';
function Host(){const ref=useRef(null);return <><iframe ref={ref} src="${quartzOrigin}/demo/note"/><Bridge iframeRef={ref} quartzOrigin="${quartzOrigin}"/></>}
createRoot(document.getElementById('root')).render(<Host/>);
` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const highlighter = await build({ entryPoints: [path.join(quartz, 'quartz/components/scripts/highlighter.inline.ts')], bundle: true, write: false, platform: 'browser', format: 'iife' });
const highlighterUi = await build({ stdin: { resolveDir: quartz, loader: 'tsx', contents: `
import{h}from'preact';import render from'preact-render-to-string';import factory from './quartz/components/Highlighter';
export const html=render(h(factory(),{}));` }, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', jsxImportSource: 'preact',
  plugins: [{ name: 'styles', setup(builder) { builder.onLoad({ filter: /(?:\.scss|\.inline\.ts)$/ }, () => ({ contents: '', loader: 'text' })); } }] });
const { html: menu } = await import(`data:text/javascript;base64,${Buffer.from(highlighterUi.outputFiles[0].text).toString('base64')}`);
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
const saved = frame => frame.locator('.markdown-action-status').filter({hasText:/^Saved$/}).waitFor();
const draft = frame => frame.locator('.ProseMirror').evaluate(()=>window.__quartzDocumentEditor.getDraft().body);
const flush = frame => frame.locator('.ProseMirror').evaluate(()=>window.__quartzDocumentEditor.flush());

async function fixture(run, body = 'First paragraph.\n\nSecond paragraph.\n', options = {}) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } }); page.setDefaultTimeout(options.timeout ?? 10_000);
  await page.addInitScript(() => { window.textWalks = 0; const walk = document.createTreeWalker.bind(document); document.createTreeWalker = (...args) => { window.textWalks++; return walk(...args); }; });
  const errors = [], saves = [], pendingSaves = [], annotations = new Map(), uploads = [], reads = [], deletes = [], imageRequests = [], previews = [];
  await page.addInitScript(() => {
    window.recoveryWrites = 0; window.savedRevisions = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'drafts') window.recoveryWrites++; return put.apply(this, args); };
    document.addEventListener('bb:editor-saved', event => window.savedRevisions.push(event.detail.revision));
  });
  const document = { body, title: 'A garden page', tags: ['example'], revision: 'r1', accountId: '1', canEdit: options.canEdit ?? true };
  let revision = 1, fail = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${dashboardOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    if (options.imageAssets?.has(url.pathname)) {
      imageRequests.push(url.href);
      return route.fulfill({ contentType: 'image/png', body: options.imageAssets.get(url.pathname) });
    }
    if (url.pathname === '/quartz-editor/editor.js') return route.fulfill({ contentType: 'application/javascript', body: editor.outputFiles.find(f => f.path.endsWith('.js')).text });
    if (url.pathname === '/quartz-editor/editor.css') return route.fulfill({ contentType: 'text/css', body: editor.outputFiles.find(f => f.path.endsWith('.css')).text });
    if (url.pathname === '/api/markdown-images') return new Promise(resolve => uploads.push(async markdown => { await route.fulfill({json:{success:true,markdown}}); resolve(); }));
    if (url.pathname.startsWith('/api/documents/')) {
      if (route.request().method() === 'DELETE') {
        deletes.push(url.href);
        return route.fulfill(fail ? { status: 503, json: { error: 'Could not delete this page.' } } : { json: { success: true } });
      }
      if (route.request().method() === 'GET') {
        reads.push(url.href);
        if (options.getDelay) await new Promise(resolve => setTimeout(resolve, options.getDelay));
      }
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON();
        previews.push(...input.fragments);
        return route.fulfill({ json: { success: true, fragments: await Promise.all(input.fragments.map(async f => ({ id: f.id, html: options.render ? await options.render(f.source) : `<pre>${f.source.replaceAll('<','&lt;')}</pre>` }))) } });
      }
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON(); saves.push(patch);
        if (fail) return route.fulfill({ status: 503, json: { error: 'Offline' } });
        if (options.pauseSaves) await new Promise(resolve => pendingSaves.push(resolve));
        if (patch.baseRevision !== document.revision) return route.fulfill({ status: 409, json: { ...document, error: 'Changed elsewhere' } });
        Object.assign(document, patch, { revision: `r${++revision}` });
      }
      return route.fulfill({ json: { ...document, content: document.body, success: true,
        ...(url.searchParams.get('render') === '1' ? { reader: {
          slug: 'demo/note', title: document.title,
          html: options.render ? await options.render(document.body) : '<p>First paragraph.</p><p>Second paragraph.</p>', toc: [],
        } } : {}),
      } });
    }
    if (url.pathname === '/api/text-highlights') {
      if (options.highlightDelay) await new Promise(resolve=>setTimeout(resolve,options.highlightDelay));
      const input = route.request().postDataJSON();
      const entries = annotations.get(input.key) ?? new Map((input.entries ?? []).map(item => [item.id, item]));
      for (const mutation of input.mutations ?? []) { if (mutation.value === null) entries.delete(mutation.id); else entries.set(mutation.id, mutation.value); }
      annotations.set(input.key, entries);
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': quartzOrigin }, json: { success: true, entries: [...entries.values()], acknowledged: (input.mutations ?? []).map(m=>m.operationId) } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0}iframe{width:100%;height:890px;border:0}</style><div id="root"></div><script>${host.outputFiles[0].text}</script>` });
  });
  await page.route(`${quartzOrigin}/**`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
:root{--light:#e6f0e6;--dark:#13201b;--lightgray:#a6bdad;--gray:#50615a;--secondary:#4f6f68;--highlight:#84a59d33;--codeFont:monospace}body{margin:2rem auto;max-width:850px;background:var(--light);color:var(--dark);font:18px/1.6 system-ui}button,input,select{font:inherit}article{margin-top:1rem}.bb-highlighter{position:absolute;background:white;border:1px solid gray;padding:8px}.bb-highlight-menu{display:flex;gap:8px}.bb-highlight-note-editor[hidden]{display:none}mark.bb-hl{background:#d0e9ff}
</style><style>${options.styles ?? ''}</style><script>(${installCanonicalQuartzReader.toString()})();(${installQuartzDocumentEditor.toString()})();</script></head><body data-slug="demo/note"><h1 class="article-title">A garden page</h1><div class="markdown-actions" data-note-slug="demo/note"><button class="markdown-edit-button">Edit</button><button class="markdown-delete-button">Delete</button><span class="markdown-action-status"></span></div><article class="popover-hint"><p>First paragraph.</p><p>Second paragraph.</p></article>${menu}<script>${highlighter.outputFiles[0].text}</script><script>document.dispatchEvent(new Event('nav'))</script></body></html>` }));
  try {
    await page.goto(dashboardOrigin); const frame = page.frameLocator('iframe');
    const started = performance.now();
    if (options.activate !== false) {
      await frame.getByRole('switch', { name: 'Edit page' }).click();
      await frame.locator('.ProseMirror[contenteditable=true]').waitFor();
    }
    await run({ page, frame, document, saves, pendingSaves, errors, annotations, uploads, reads, deletes, imageRequests, previews, mountMs:performance.now()-started, fail: value => { fail = value; } });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

test('click-to-type, autosave, mode switches, selection, and undo retain one editor', async () => fixture(async ({ page, frame, document, saves }) => {
  assert.equal(saves.length, 0);
  await frame.locator('.ProseMirror p').first().click(); await page.keyboard.press('Home'); await page.keyboard.type('Edited '); await saved(frame);
  assert.equal(document.body, 'Edited First paragraph.\n\nSecond paragraph.\n');
  await frame.getByRole('switch').click(); await frame.locator('.ProseMirror[contenteditable=false]').waitFor();
  await frame.getByRole('switch').click(); await page.keyboard.press('Control+z'); await saved(frame);
  assert.equal(document.body, 'First paragraph.\n\nSecond paragraph.\n');
  await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+Shift+End');
  const text = await frame.locator('.ProseMirror').evaluate(() => window.getSelection().toString()); assert.match(text, /First paragraph/); assert.match(text, /Second paragraph/);
  await page.screenshot({ path: path.resolve(root, '../qa/quartz-document-editor.png') });
}));
test('source mode applies and undo restores the document', async () => fixture(async ({ page, frame, document }) => {
  await frame.getByLabel('Advanced editing').selectOption('source'); await frame.getByLabel('Markdown source').fill('## New heading\n\nNew body.\n');
  await frame.getByRole('button', { name: 'Apply source', exact: true }).click();
  await frame.locator('.ProseMirror h2').waitFor(); await flush(frame); assert.match(document.body, /^## New heading/);
  await page.keyboard.press('Control+z'); await frame.locator('.ProseMirror p').filter({ hasText: 'First paragraph.' }).waitFor();
}));
test('network failures and conflicts preserve the local draft', async () => fixture(async ({ page, frame, document, fail }) => {
  fail(true); await page.keyboard.press('Control+Home'); await page.keyboard.type('Mine '); await page.keyboard.press('Control+s');
  await frame.getByRole('button', { name: 'Retry save' }).waitFor(); assert.match(await draft(frame), /Mine First/);
  fail(false); Object.assign(document, { body: 'External change.', revision: 'external' });
  await frame.getByRole('button', { name: 'Retry save' }).click(); await frame.getByRole('button', { name: 'Keep my version' }).waitFor();
  await frame.getByRole('button', { name: 'Keep my version' }).click(); await saved(frame); assert.match(document.body, /Mine First/);
}));
test('canonical refresh cannot replace the live editor or its cursor', async () => fixture(async ({ page, frame }) => {
  await page.keyboard.press('Control+Home'); await page.keyboard.type('Keep ');
  await page.evaluate(({ quartzOrigin }) => document.querySelector('iframe').contentWindow.postMessage({ type: 'second-brain:canonical-document', slug: 'demo/note', requestId: 'stale', html: '<p>Stale HTML</p>' }, quartzOrigin), { quartzOrigin });
  await page.keyboard.type('typing '); assert.match(await draft(frame), /Keep typing First/);
}));
test('annotations map through typing, remain separate from markdown, and survive delete/undo', async () => fixture(async ({ page, frame, document }) => {
  await frame.locator('.ProseMirror').evaluate(() => window.__quartzDocumentEditor.renderHighlights([{ id: 'hl-one', text: 'First', start: 0, end: 5, prefix: '', suffix: ' paragraph.', color: 'blue', note: 'Keep this note', createdAt: Date.now() }]));
  await frame.locator('mark.bb-hl').waitFor(); await page.keyboard.press('Control+Home'); await page.keyboard.type('New ');
  assert.equal(await frame.locator('mark.bb-hl').innerText(), 'First'); await flush(frame); assert.doesNotMatch(document.body, /mark|bb-hl/);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  let entries = await frame.locator('.ProseMirror').evaluate(() => window.__quartzDocumentEditor.getHighlights()); assert.equal(entries[0].detached,true);
  await page.keyboard.press('Control+z'); entries = await frame.locator('.ProseMirror').evaluate(() => window.__quartzDocumentEditor.getHighlights());
  assert.equal(entries[0].note, 'Keep this note'); assert.equal(entries[0].detached, false);
}));
test('objects remain selected blocks with text on both sides and persistent source', async () => fixture(async ({ page, frame, document }) => {
  await frame.locator('.bb-document-object').waitFor(); await frame.locator('.bb-document-object').click();
  await frame.getByRole('button', { name: 'Edit whiteboard', exact: true }).click(); await frame.getByRole('button', { name: 'Return to document', exact: true }).click();
  await page.keyboard.press('Control+Home'); await page.keyboard.type('New '); await flush(frame); assert.match(document.body, /```penecho\nid: 1720000000000-abcdefgh\n```/);
}, 'Before.\n\n```penecho\nid: 1720000000000-abcdefgh\n```\n\nAfter.\n'));
test('formatted paste, Markdown typing, tables and IME composition work', async () => fixture(async ({page,frame,document}) => {
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
  await frame.locator('.ProseMirror').evaluate(el => {const data=new DataTransfer();data.setData('text/html','<p><strong>Bold paste</strong> and <em>italic</em></p>');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));});
  await frame.locator('.ProseMirror strong').filter({hasText:'Bold paste'}).waitFor();
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('## Heading shortcut');
  await frame.locator('.ProseMirror h2').filter({hasText:'Heading shortcut'}).waitFor();
  await page.keyboard.press('Enter'); await frame.getByLabel('Insert content').selectOption('table');
  await frame.locator('th').first().click(); await page.keyboard.type('Cell'); await frame.getByRole('button',{name:'Add row',exact:true}).click();
  assert.equal(await frame.locator('tr').count(),3); await page.keyboard.press('Control+Home');
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition',{text:'漢字',selectionStart:2,selectionEnd:2}); await session.send('Input.insertText',{text:'漢字'});
  await flush(frame); assert.match(document.body,/\*\*Bold paste\*\*/); assert.match(document.body,/## Heading shortcut/); assert.match(document.body,/漢字/);
}));
test('uploads stay anchored and undo cancels a pending insertion', async () => fixture(async ({page,frame,document,uploads}) => {
  const picker=frame.locator('.bb-document-toolbar input[type=file]'); await page.keyboard.press('Control+Home');
  await picker.setInputFiles({name:'one.png',mimeType:'image/png',buffer:Buffer.from('fixture')}); await frame.getByText('Uploading…',{exact:true}).waitFor();
  await page.keyboard.type('Beside upload ');
  await assertSoon(()=>uploads.length>0); await uploads.shift()('![First](/assets/one.png)');
  await frame.getByText('Uploading…',{exact:true}).waitFor({state:'hidden'}); assert.match(await draft(frame),/one.png/);
  await picker.setInputFiles({name:'cancel.png',mimeType:'image/png',buffer:Buffer.from('fixture')}); await frame.getByText('Uploading…',{exact:true}).waitFor();
  await page.keyboard.press('Control+z'); await assertSoon(()=>uploads.length>0); await uploads.shift()('![Cancelled](/assets/cancel.png)');
  await flush(frame); assert.doesNotMatch(document.body,/cancel.png/); assert.match(document.body,/one.png/); assert.match(document.body,/Beside upload/);
  await page.keyboard.press('Control+Shift+z'); await frame.getByText('Uploading…',{exact:true}).waitFor({state:'hidden'});
  await flush(frame); assert.match(document.body,/cancel.png/,'redo can intentionally restore the completed insertion');
}));
async function assertSoon(check) { const deadline=Date.now()+5000; while(!check() && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20)); assert.ok(check()); }

for (const mode of ['read', 'edit', 'older reader']) test(`equations support mouse drag, LaTeX copy and persistent highlights in ${mode} mode`, async () => {
  const editing = mode === 'edit';
  const { renderQuartzDocument } = await import('../src/lib/generated/quartz-reader.mjs');
  const { compile } = createRequire(path.join(quartz, 'package.json'))('sass');
  const styles = fs.readFileSync(path.join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8') + compile(path.join(quartz, 'quartz/components/styles/highlighter.scss')).css;
  const body = 'Before $x^2 + y^2 = z^2$ after.\n\n$$\nE = mc^2\n$$\n\nTail.\n';
  const render = async content => {
    const {html} = await renderQuartzDocument({ content, relativePath:'demo/note.md',contentRoot:'/garden',allFiles:['demo/note.md'] });
    return mode === 'older reader' ? html.replace(/ data-bb-math-source="[^"]*"/g,'') : html;
  };
  await fixture(async ({page,frame,document}) => {
    const equations = frame.locator('article .katex'); await equations.nth(1).waitFor();
    await frame.locator('article [data-bb-math-source]').nth(1).waitFor();
    for (const [index, quote] of [[0,'$x^2 + y^2 = z^2$'],[1,'$$E = mc^2$$']]) {
      await equations.nth(index).scrollIntoViewIfNeeded();
      const glyphs = equations.nth(index).locator('.katex-html');
      const box = await glyphs.boundingBox();
      await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, {steps:16}); await page.mouse.up();
      assert.ok(await frame.locator('article').evaluate(() => window.getSelection().toString().trim()), 'a real left-button drag selects visible equation text');
      await frame.locator('.bb-highlighter:not([hidden])').waitFor();
      const copied = await frame.locator('article').evaluate(el => {
        const data = new DataTransfer();
        el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));
        return data.getData('text/plain');
      });
      assert.equal(copied, quote);
      await frame.locator('[data-highlight-color="blue"]').click();
      const highlighted = frame.locator('.bb-hl-math[data-hl-color="blue"]').filter({has: frame.locator('.katex-html')});
      assert.equal(await highlighted.count(), index + 1);
      assert.equal(await highlighted.nth(index).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(143, 195, 235)');
    }
    assert.equal(document.body, body, 'selection, copy and highlights never alter equation source');
    if (editing) {
      const entries = await frame.locator('article').evaluate(() => window.__quartzDocumentEditor.getHighlights());
      assert.deepEqual(entries.map(entry=>entry.text), ['$x^2 + y^2 = z^2$', '$$E = mc^2$$']);
    }
    await page.reload();
    await frame.locator('.bb-hl-math').nth(1).waitFor();
    assert.equal(await frame.locator('.bb-hl-math').count(), 2, 'equation highlights survive reload into read mode');
    if (editing) { await frame.getByRole('switch', {name:'Edit page'}).click(); await frame.locator('.ProseMirror[contenteditable=true]').waitFor(); }
    const paragraph = frame.locator('article p').first();
    const bounds = await paragraph.boundingBox();
    const mathBounds = await frame.locator('article .katex').first().boundingBox();
    await page.mouse.move(mathBounds.x + mathBounds.width - 2, mathBounds.y + mathBounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x + 1, mathBounds.y + mathBounds.height / 2, {steps:16}); await page.mouse.up();
    const mixed = await frame.locator('article').evaluate(el => {
      const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data})); return data.getData('text/plain');
    });
    assert.equal(mixed,'Before $x^2 + y^2 = z^2$','backward drags from equations include surrounding prose and one copy of the LaTeX');
  }, body, {activate:editing,render,styles});
});

test('pasted images load from saved assets while editing and after a reader reload without publication', async () => {
  const { renderQuartzDocument } = await import('../src/lib/generated/quartz-reader.mjs');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64');
  await fixture(async ({page,frame,document,uploads,imageRequests,previews})=>{
    const clipboardFileSize=await frame.locator('.ProseMirror').evaluate((_el,bytes)=>{
      const clipboard=new DataTransfer();
      clipboard.items.add(new File([new Uint8Array(bytes)],'clipboard.png',{type:'image/png'}));
      document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
      return clipboard.files[0].size;
    },[...png]);
    assert.equal(clipboardFileSize,png.length);
    await assertSoon(()=>uploads.length>0);
    const pasted=frame.locator('article img[src^="blob:"]');
    await pasted.waitFor({timeout:1000});await pasted.evaluate(img=>img.decode());
    await pasted.evaluate(img=>{window.pastedImageNode=img;window.pastedImageTop=img.getBoundingClientRect().top+scrollY;});
    assert.equal(await pasted.evaluate(img=>img.naturalWidth),1,'clipboard pixels render before the upload completes');
    await uploads.shift()('![Clipboard diagram](/demo/assets/clipboard.png)');
    const image=frame.locator('article img[alt="Clipboard diagram"]');
    await image.waitFor();await image.scrollIntoViewIfNeeded();
    await image.evaluate(img=>img.decode());
    assert.equal(await image.evaluate(img=>img===window.pastedImageNode),true,'upload completion keeps the same decoded image');
    assert.equal(await image.evaluate(img=>img.getBoundingClientRect().top+scrollY),await image.evaluate(()=>window.pastedImageTop));
    assert.equal(await image.evaluate(img=>img.naturalWidth),1);
    await flush(frame);
    assert.match(document.body,/!\[Clipboard diagram\]\(\/demo\/assets\/clipboard\.png\)/);
    assert.ok(!document.body.includes(dashboardOrigin),'saved Markdown stays portable');
    await page.reload();await image.waitFor();await image.scrollIntoViewIfNeeded();await image.evaluate(img=>img.decode());
    assert.equal(await image.evaluate(img=>img.naturalWidth),1);
    assert.ok(imageRequests.length>=1,'saved reader requests the canonical image');
    assert.equal(previews.length,0,'ordinary image rendering does not wait for a server preview');
    await frame.getByRole('switch',{name:'Edit page'}).click();
    await image.waitFor();await image.evaluate(img=>img.decode());
    const before=await frame.locator('.ProseMirror p').last().boundingBox();
    await image.click({force:true});
    const after=await frame.locator('.ProseMirror p').last().boundingBox();
    assert.equal(after.y,before.y,'image controls do not move surrounding text');
  },undefined,{imageAssets:new Map([['/demo/assets/clipboard.png',png]]),render:async content=>(await renderQuartzDocument({content,relativePath:'demo/note.md',contentRoot:'/fixture',allFiles:['demo/note.md']})).html});
});
test('reload recovers a failed-save draft and defaults to reading', async () => fixture(async ({page,frame,document,fail}) => {
  fail(true); await page.keyboard.press('Control+Home');await page.keyboard.type('Recovered ');await page.keyboard.press('Control+s'); await frame.getByRole('button',{name:'Retry save'}).waitFor();
  page.on('dialog',dialog=>dialog.accept()); await page.reload(); await frame.getByRole('switch',{name:'Edit page'}).waitFor(); assert.equal(await frame.locator('.ProseMirror').count(),0);
  fail(false); await frame.getByRole('switch',{name:'Edit page'}).click(); await frame.locator('.ProseMirror').filter({hasText:'Recovered First'}).waitFor();
  await flush(frame); assert.match(document.body,/Recovered First/);
}));
test('read-only capability hides editing while content stays readable', async () => fixture(async ({frame,saves}) => {
  await frame.getByRole('switch',{name:'Edit page'}).waitFor({state:'hidden'}); assert.match(await frame.locator('article').innerText(),/First paragraph/);assert.equal(saves.length,0);
  assert.equal(await frame.getByRole('button', { name: 'Delete page', exact: true }).count(), 0);
},undefined,{canEdit:false,activate:false}));

test('page deletion uses a themed sheet and every cancellation preserves the page', async () => fixture(async ({ page, frame, deletes }) => {
  const nativeDialogs = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
  const trigger = frame.getByRole('button', { name: 'Delete page', exact: true });
  for (const dismiss of ['cancel', 'escape', 'backdrop']) {
    await trigger.click();
    const dialog = frame.getByRole('alertdialog', { name: 'Delete this page?' });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /A garden page/);
    assert.equal(await dialog.getByRole('button', { name: 'Cancel' }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.getByRole('button', { name: 'Delete page', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal(await frame.locator('body').evaluate(() => document.body.style.overflow), 'hidden');
    if (dismiss === 'cancel') await dialog.getByRole('button', { name: 'Cancel' }).click();
    if (dismiss === 'escape') await page.keyboard.press('Escape');
    if (dismiss === 'backdrop') await page.mouse.click(8, 8);
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    assert.equal(await frame.locator('body').evaluate(() => document.body.style.overflow), '');
  }
  assert.equal(deletes.length, 0);
  assert.deepEqual(nativeDialogs, []);
  assert.equal(await frame.locator('.ProseMirror').count(), 0);
}, undefined, { activate: false }));

test('page deletion waits for saved edits, reports failure, and allows a confirmed retry', async () => fixture(async ({ page, frame, deletes, fail }) => {
  fail(true);
  await frame.locator('article').evaluate(() => {
    window.__quartzDocumentEditor = { getHighlights: () => [], flush: () => new Promise(resolve => { window.finishDeleteFlush = resolve; }) };
  });
  await frame.getByRole('button', { name: 'Delete page', exact: true }).click();
  await frame.getByRole('alertdialog').getByRole('button', { name: 'Delete page', exact: true }).click();
  await frame.locator('.markdown-delete-button:disabled').waitFor();
  assert.equal(deletes.length, 0);
  await frame.locator('article').evaluate(() => window.finishDeleteFlush());
  await frame.locator('.markdown-action-status').filter({ hasText: 'Could not delete this page.' }).waitFor();
  assert.equal(deletes.length, 1);
  assert.equal(await frame.locator('.markdown-delete-button').isEnabled(), true);
  fail(false);
  await frame.locator('article').evaluate(() => { window.__quartzDocumentEditor = undefined; });
  await frame.getByRole('button', { name: 'Delete page', exact: true }).click();
  await frame.getByRole('alertdialog').getByRole('button', { name: 'Delete page', exact: true }).click();
  await assertSoon(() => page.frames().some(item => item.url() === quartzOrigin + '/demo/'));
  assert.equal(deletes.length, 2);
}, undefined, { activate: false }));

test('page deletion cancels on navigation and fits long titles on small screens', async () => fixture(async ({ page, frame, deletes }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.locator('iframe').evaluate(el => { el.style.height = '640px'; });
  await frame.locator('h1').evaluate(el => { el.textContent = 'From Abstract Vector Spaces to Electromagnetic Fields'; });
  await frame.getByRole('button', { name: 'Delete page', exact: true }).click();
  const dialog = frame.getByRole('alertdialog');
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 16 && bounds.x + bounds.width <= 359);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 640);
  const screenshotDirectory = process.env.QUARTZ_DELETE_SCREENSHOTS;
  if (screenshotDirectory) {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDirectory, 'mobile-light.png') });
    await page.setViewportSize({ width: 1137, height: 797 });
    await page.locator('iframe').evaluate(el => { el.style.height = '797px'; });
    await page.screenshot({ path: path.join(screenshotDirectory, 'desktop-light.png') });
    await frame.locator('html').evaluate(el => {
      el.setAttribute('saved-theme', 'dark');
      for (const [name, value] of Object.entries({ light: '#171916', dark: '#e0e8df', lightgray: '#353d37', gray: '#a7b5aa', secondary: '#91b7a1', 'neu-q-surface': '#20211f', 'neu-q-border': '#353d37', 'neu-q-highlight': '#ffffff0f' })) el.style.setProperty('--' + name, value);
    });
    await page.screenshot({ path: path.join(screenshotDirectory, 'desktop-dark.png') });
  }
  await frame.locator('body').evaluate(() => document.dispatchEvent(new Event('prenav')));
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await frame.locator('body').evaluate(() => document.body.style.overflow), '');
  assert.equal(deletes.length, 0);
}, undefined, { activate: false }));
test('a document containing only an embed accepts text before and after it', async()=>fixture(async({page,frame,document})=>{
  await page.keyboard.press('Control+Home');await page.keyboard.type('Before');
  await page.keyboard.press('Control+End');await page.keyboard.type('After');await flush(frame);
  assert.match(document.body,/Before[\s\S]*```artifact[\s\S]*After/);
},'```artifact\n{"id":"a","conversationId":"c","kind":"html","version":1}\n```'));
test('an empty document accepts text and Markdown formatting shortcuts',async()=>fixture(async({page,frame,document})=>{
  await page.keyboard.type('**Bold** and `code`');await flush(frame);
  assert.match(document.body,/\*\*Bold\*\*/);assert.match(document.body,/`code`/);
},''));
test('selection notes and assistant questions use the current draft and retain detached answers',async()=>fixture(async({page,frame})=>{
  await page.evaluate(origin=>{window.selectionQuestions=[];window.selectionPopovers=[];addEventListener('message',event=>{if(event.data?.type==='second-brain:assistant-ask-here')window.selectionQuestions.push(event.data);if(event.data?.type==='second-brain:assistant-inline-popover'&&event.data.open)window.selectionPopovers.push(event.data);});document.querySelector('iframe').contentWindow.postMessage({type:'second-brain:assistant-inline-popover-host'},origin);},quartzOrigin);
  await page.keyboard.press('Control+Home');await page.keyboard.type('Draft ');await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+ArrowRight');
  await frame.getByRole('button',{name:'Add note',exact:true}).click();await frame.getByLabel('Note about highlighted text').fill('Personal note');await frame.getByRole('button',{name:'Save note',exact:true}).click();
  await frame.locator('.ProseMirror').click();await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+ArrowRight');
  await frame.getByRole('button',{name:'Attach an answer to this highlight',exact:true}).click();
  await page.waitForFunction(()=>window.selectionPopovers.length>0);
  await page.evaluate(origin=>{const answer=window.selectionPopovers.at(-1);document.querySelector('iframe').contentWindow.postMessage({type:'second-brain:assistant-inline-popover-action',action:'retry',question:'About draft',requestId:answer.requestId,highlightId:answer.highlightId},origin);},quartzOrigin);
  await page.waitForFunction(()=>window.selectionQuestions.length===1);
  const question=await page.evaluate(()=>window.selectionQuestions[0]);assert.equal(question.text,'Draft');assert.match(question.suffix,/First paragraph/);
  await page.evaluate(({origin,question})=>document.querySelector('iframe').contentWindow.postMessage({...question,type:'second-brain:assistant-inline-answer',state:'complete',question:'About draft',answer:'Preserved answer'},origin),{origin:quartzOrigin,question});
  await frame.locator('.ProseMirror').click();await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');await flush(frame);
  await frame.getByRole('button',{name:'Annotations',exact:true}).click();
  await frame.getByText('Personal note',{exact:true}).waitFor();await frame.getByText(/Unattached/).first().waitFor();
  await frame.locator('dialog').getByText('Preserved answer',{exact:true}).waitFor();
}));

test('editor notes underline plain text and preserve manually applied highlights', async()=>fixture(async({page,frame})=>{
  const liveFrame=page.frames().find(f=>f.url().startsWith(quartzOrigin));
  const css=createRequire(path.join(quartz,'package.json'))('sass').compile(path.join(quartz,'quartz/components/styles/highlighter.scss')).css;
  await liveFrame.addStyleTag({content:css});
  await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+ArrowRight');
  await frame.getByRole('button',{name:'Add note',exact:true}).click();
  await frame.getByLabel('Note about highlighted text').fill('Keep this thought');
  await frame.getByRole('button',{name:'Save note',exact:true}).click();
  const mark=frame.locator('mark[data-hl-note]');
  assert.equal(await mark.getAttribute('data-hl-note-only'),'true');
  assert.equal(await mark.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await mark.evaluate(el=>getComputedStyle(el).textDecorationLine),'underline');
  await mark.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));});
  await frame.locator('[data-highlight-color="blue"]').click();
  assert.equal(await mark.getAttribute('data-hl-note-only'),null);
  assert.equal(await mark.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(143, 195, 235)');
  assert.equal(await mark.evaluate(el=>getComputedStyle(el).textDecorationLine),'underline');
  const entries=await frame.locator('.ProseMirror').evaluate(()=>window.__quartzDocumentEditor.getHighlights());
  assert.equal(entries[0].note,'Keep this thought');assert.notEqual(entries[0].noteOnly,true);
}));

test('Ask here leaves character positions and saved Markdown unchanged while editing', async()=>fixture(async({page,frame,document,saves})=>{
  const liveFrame=page.frames().find(f=>f.url().startsWith(quartzOrigin));
  const css=createRequire(path.join(quartz,'package.json'))('sass').compile(path.join(quartz,'quartz/components/styles/highlighter.scss')).css;
  await liveFrame.addStyleTag({content:css});
  const positions=()=>frame.locator('.ProseMirror p').first().evaluate(el=>{
    const result=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode()) for(let i=0;i<node.length;i++) {
      const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);
      const r=range.getBoundingClientRect();result.push({text:node.data[i],x:r.x+scrollX,y:r.y+scrollY});
    }
    return result;
  });
  const before=await positions();
  await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+ArrowRight');
  await frame.locator('[data-highlight-action="ask-inline"]').click();
  await frame.locator('mark.bb-hl[data-hl-answer="complete"]').waitFor();
  const after=await positions();assert.equal(after.length,before.length);
  for (let i=0;i<before.length;i++) { assert.equal(after[i].text,before[i].text);assert.equal(after[i].y,before[i].y);assert.ok(Math.abs(after[i].x-before[i].x)<0.1,'annotations must not add spacing'); }
  await flush(frame);assert.equal(document.body,'First paragraph.\n\nSecond paragraph.\n');assert.equal(saves.length,0);
}));

test('clicking Edit again during a reader refresh mounts one toolbar and keeps one undo history', async () => fixture(async ({ page, frame, reads }) => {
  await frame.getByRole('switch', { name: 'Edit page' }).click();
  await assertSoon(() => reads.filter(url => !new URL(url).searchParams.has('render')).length >= 2);
  await page.evaluate(origin => document.querySelector('iframe').contentWindow.postMessage({
    type: 'second-brain:canonical-document', slug: 'demo/note', requestId: 'during-mount', html: '<p>Refreshed reader</p>',
  }, origin), quartzOrigin);
  await frame.locator('article').getByText('Refreshed reader').waitFor();
  await frame.getByRole('switch', { name: 'Edit page' }).click();
  await frame.locator('.ProseMirror[contenteditable=true]').waitFor();
  await page.waitForTimeout(700);
  assert.equal(await frame.getByRole('button', { name: 'Annotations', exact: true }).count(), 1);
  assert.equal(await frame.getByRole('toolbar', { name: 'Document formatting' }).count(), 1);
  assert.equal(await frame.getByLabel('Page tags', { exact: true }).count(), 1);
  await frame.locator('.ProseMirror p').first().click(); await page.keyboard.press('Home'); await page.keyboard.type('Retained ');
  for (let i = 0; i < 3; i++) {
    await frame.getByRole('switch', { name: 'Edit page' }).click();
    await frame.locator('.ProseMirror[contenteditable=false]').waitFor();
    await frame.getByRole('switch', { name: 'Edit page' }).click();
    await frame.locator('.ProseMirror[contenteditable=true]').waitFor();
  }
  assert.equal(await frame.locator('.bb-document-toolbar').count(), 1);
  await page.keyboard.press('Control+z');
  assert.equal(await draft(frame), 'First paragraph.\n\nSecond paragraph.\n');
}, undefined, { activate: false, getDelay: 500 }));

test('a failed editor mount restores the reader and retry adds only one set of controls', async () => fixture(async ({ frame }) => {
  await frame.locator('article').evaluate(article => {
    const append = article.appendChild;
    article.appendChild = function(node) {
      article.appendChild = append;
      throw new Error('Simulated mount failure');
    };
  });
  await frame.getByRole('switch', { name: 'Edit page' }).click();
  await frame.locator('.markdown-action-status').filter({ hasText: 'Simulated mount failure' }).waitFor();
  assert.equal(await frame.locator('.bb-document-toolbar').count(), 0);
  assert.equal(await frame.getByRole('button', { name: 'Annotations', exact: true }).count(), 0);
  assert.equal(await frame.locator('article').innerText(), 'First paragraph.\n\nSecond paragraph.');
  await frame.getByRole('switch', { name: 'Edit page' }).click();
  await frame.locator('.ProseMirror[contenteditable=true]').waitFor();
  assert.equal(await frame.locator('.bb-document-toolbar').count(), 1);
  assert.equal(await frame.getByRole('button', { name: 'Annotations', exact: true }).count(), 1);
}, undefined, { activate: false }));

test('leaving the article while the editor opens cancels the stale mount', async () => fixture(async ({ frame, reads }) => {
  await frame.getByRole('switch', { name: 'Edit page' }).click();
  await assertSoon(() => reads.filter(url => !new URL(url).searchParams.has('render')).length >= 2);
  await frame.locator('article').evaluate(article => {
    const next = article.cloneNode(false); next.textContent = 'Another page'; article.replaceWith(next);
  });
  await frame.locator('.markdown-action-status').filter({ hasText: 'The page changed while editing was opening.' }).waitFor();
  assert.equal(await frame.locator('.bb-document-toolbar').count(), 0);
  assert.equal(await frame.locator('.ProseMirror').count(), 0);
  assert.equal(await frame.locator('article').innerText(), 'Another page');
}, undefined, { activate: false, getDelay: 500 }));

test('reader refresh retains annotations even when the browser cache is unavailable and sync is slow',async()=>{
  const options={activate:false,highlightDelay:0};
  await fixture(async({page,frame,annotations})=>{
    await frame.locator('.bb-highlighter[data-bound="true"]').waitFor({state:'attached'});
    await frame.locator('article p').first().evaluate(el=>{
      Storage.prototype.setItem=()=>{throw new Error('Browser cache full')};
      const range=document.createRange();range.setStart(el.firstChild,0);range.setEnd(el.firstChild,5);
      getSelection().removeAllRanges();getSelection().addRange(range);
      document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));
    });
    await frame.locator('[data-highlight-action="ask-inline"]').click();
    await frame.locator('mark.bb-hl[data-hl-answer="complete"]').waitFor();
    await page.keyboard.press('Escape');
    await assertSoon(()=>[...annotations.values()].some(entries=>[...entries.values()].some(entry=>entry.requestId)));
    // Let the completed initial writes release their in-flight request slots.
    await page.waitForTimeout(150);
    options.highlightDelay=1200;
    await frame.locator('article').evaluate(root=>{
      window.readerAnnotationFrames=[];
      window.readerObserver=new MutationObserver(()=>{
        if(root.textContent.includes('AI introduction.'))window.readerAnnotationFrames.push({marks:root.querySelectorAll('mark.bb-hl').length,answers:root.querySelectorAll('mark[data-hl-answer]').length});
      });window.readerObserver.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-hl-answer']});
    });
    await page.evaluate(origin=>document.querySelector('iframe').contentWindow.postMessage({type:'second-brain:canonical-document',slug:'demo/note',revision:'ai-saved',html:'<p>AI introduction.</p><p>First paragraph.</p><p>Second paragraph.</p>'},origin),quartzOrigin);
    await frame.locator('article p').first().filter({hasText:'AI introduction.'}).waitFor();
    await frame.locator('mark.bb-hl[data-hl-answer="complete"]').waitFor();
    const frames=await frame.locator('article').evaluate(()=>{window.readerObserver.disconnect();return window.readerAnnotationFrames});
    assert.ok(frames.length>0);
    assert.ok(frames.every(frame=>frame.marks===1&&frame.answers===1),JSON.stringify(frames));
  },undefined,options);
});

test('accepting an AI-saved revision preserves highlights and Ask here on the first updated frame', async()=>fixture(async({page,frame,document})=>{
  await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+ArrowRight');
  await frame.locator('[data-highlight-action="ask-inline"]').click();
  await frame.locator('mark.bb-hl[data-hl-answer="complete"]').waitFor();
  await page.keyboard.press('Escape');
  await frame.locator('.ProseMirror').evaluate(()=>{
    const api=window.__quartzDocumentEditor;
    api.renderHighlights([...api.getHighlights(),{id:'saved-note',text:'Second',start:16,end:22,prefix:'First paragraph.',suffix:' paragraph.',color:'blue',note:'Keep this note',noteOnly:true}]);
  });
  await flush(frame);
  const ids=await frame.locator('mark.bb-hl').evaluateAll(marks=>marks.map(mark=>mark.dataset.hlId));
  document.body='AI introduction.\n\nFirst paragraph.\n\nSecond paragraph.\n';document.revision='ai-saved';
  await page.evaluate(origin=>document.querySelector('iframe').contentWindow.postMessage({type:'second-brain:canonical-document',slug:'demo/note',revision:'ai-saved',html:'<p>AI introduction.</p><p>First paragraph.</p><p>Second paragraph.</p>'},origin),quartzOrigin);
  await frame.getByRole('button',{name:'Use saved version',exact:true}).waitFor();
  await frame.locator('.ProseMirror').evaluate((root,ids)=>{
    window.annotationGaps=[];
    window.annotationObserver=new MutationObserver(()=>{
      if(!root.textContent.includes('AI introduction.'))return;
      const missing=ids.filter(id=>!root.querySelector(`mark[data-hl-id="${id}"]`));
      if(missing.length)window.annotationGaps.push(missing);
    });
    window.annotationObserver.observe(root,{childList:true,subtree:true});
  },ids);
  await frame.getByRole('button',{name:'Use saved version',exact:true}).click();
  await frame.locator('.ProseMirror p').first().filter({hasText:'AI introduction.'}).waitFor();
  const state=await frame.locator('.ProseMirror').evaluate(root=>{
    window.annotationObserver.disconnect();
    return {gaps:window.annotationGaps,ids:[...root.querySelectorAll('mark.bb-hl')].map(mark=>mark.dataset.hlId),answers:root.querySelectorAll('mark[data-hl-answer="complete"]').length,note:root.querySelector('[data-hl-note-text]')?.getAttribute('data-hl-note-text')};
  });
  assert.deepEqual(state.gaps,[],'new content must never paint without its surviving annotations');
  assert.deepEqual(state.ids,ids);assert.equal(state.answers,1);assert.equal(state.note,'Keep this note');
  await frame.locator('mark[data-hl-answer]').click();
  assert.equal(await frame.locator('.bb-highlight-answer').isVisible(),true,'the original Ask here is still attached and opens');
}));

test('interactive embeds stay mounted through typing, annotations, autosave and scrolling', async()=>{
  const body='First paragraph.\n\n```artifact\n{"id":"visual","conversationId":"c","kind":"html","version":1}\n```\n\n'+Array.from({length:85},(_,i)=>`Paragraph ${i}.`).join('\n\n')+'\n';
  await fixture(async({page,frame,previews})=>{
    const visual=frame.locator('iframe[title="Persistent visualizer"]');
    await visual.waitFor();
    const child=await visual.elementHandle().then(el=>el.contentFrame());
    await child.waitForSelector('input');
    await child.locator('input').fill('Keep simulation state');
    const token=await child.evaluate(()=>window.runToken);
    await visual.evaluate(el=>{window.visualNode=el;window.visualLoads=0;el.addEventListener('load',()=>window.visualLoads++);});
    await frame.locator('.ProseMirror p').first().click();
    await page.keyboard.press('Control+Home');await page.keyboard.type('Edited ');
    await flush(frame);
    await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+ArrowRight');
    await frame.locator('[data-highlight-action="ask-inline"]').click();
    await frame.locator('mark.bb-hl[data-hl-answer="complete"]').waitFor();
    await page.keyboard.press('Escape');
    // Background answer-store refreshes still run with every popup closed.
    // Changes to distant marks must not make the DOM observer rebuild embeds.
    await frame.locator('.ProseMirror').evaluate(async()=>{
      const api=window.__quartzDocumentEditor;
      const highlights=api.getHighlights();
      api.renderHighlights([...highlights,{id:'chat',start:0,end:5,text:'First',prefix:'Edited ',suffix:' paragraph.',color:'blue',chatLink:{chatId:'chat-1',selectionId:'s1',surface:'garden'}}]);
      for(let i=0;i<4;i++) {
        api.setAnswerStates(highlights.map(entry=>({highlightId:entry.id,state:i%2?'complete':'streaming'})));
        api.renderHighlights(api.getHighlights());
        await new Promise(resolve=>setTimeout(resolve,40));
      }
    });
    for(let i=0;i<3;i++) {
      await frame.locator('mark.bb-hl[data-hl-answer]').click();
      await frame.locator('.ProseMirror').evaluate(()=>{
        const api=window.__quartzDocumentEditor;api.renderHighlights(api.getHighlights());
        document.dispatchEvent(new CustomEvent('bb:canonical-editor-update',{detail:{revision:'r1'}}));
      });
      await frame.locator('.ProseMirror p').last().scrollIntoViewIfNeeded();
      await frame.locator('.ProseMirror p').first().scrollIntoViewIfNeeded();
      await frame.getByRole('switch',{name:'Edit page'}).click();
      await frame.getByRole('switch',{name:'Edit page'}).click();
    }
    await page.keyboard.press('Control+End');await page.keyboard.type(' Still editing.');await flush(frame);
    await visual.scrollIntoViewIfNeeded();
    assert.equal(await visual.evaluate(el=>el===window.visualNode),true);
    assert.equal(await visual.evaluate(()=>window.visualLoads),0,'iframe browsing context never reloads');
    assert.equal(await child.evaluate(()=>window.runToken),token);
    assert.equal(await child.locator('input').inputValue(),'Keep simulation state');
    assert.equal(previews.length,1,'the same embed is rendered only once');
  },body,{render:async()=>'<iframe title="Persistent visualizer" srcdoc="<input aria-label=Simulation><script>window.runToken=Math.random()</script>"></iframe>'});
});

async function recoveryDraft(frame) {
  return frame.locator('.markdown-actions').evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('breadboard-document-drafts', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('drafts').objectStore('drafts').get('http://localhost:53281:1:demo/note');
      read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
}

test('source recovery survives an older save acknowledgement and repeated source opening', async () => fixture(async ({page,frame,pendingSaves,document}) => {
  await page.keyboard.press('Control+Home'); await page.keyboard.type('Earlier '); await page.keyboard.press('Control+s');
  await assertSoon(() => pendingSaves.length === 1);
  await frame.getByLabel('Advanced editing').selectOption('source');
  const newer = '# Newer source draft\n\nDo not lose this.';
  await frame.getByLabel('Markdown source').fill(newer);
  await frame.getByLabel('Advanced editing').selectOption('source');
  assert.equal(await frame.getByLabel('Markdown source').inputValue(), newer);
  assert.equal(await frame.getByRole('toolbar', {name:'Document formatting'}).getByRole('button', {name:'Bold',exact:true}).isDisabled(), true);
  pendingSaves.shift()();
  await page.frame({url:`${quartzOrigin}/demo/note`}).waitForFunction(() => window.savedRevisions.length === 1);
  assert.match(document.body, /^Earlier/);
  assert.equal((await recoveryDraft(frame)).draft.body, newer);
  assert.match(await frame.locator('.markdown-action-status').textContent(), /Source changes/);
  await page.keyboard.press('Control+s'); await assertSoon(() => pendingSaves.length === 1); pendingSaves.shift()();
  await saved(frame); assert.equal(document.body, newer);
}, undefined, {pauseSaves:true}));

test('source typing batches recovery writes and cancels redundant snapshot deadlines', async () => fixture(async ({page,frame,document}) => {
  await frame.getByLabel('Advanced editing').selectOption('source');
  await frame.getByLabel('Markdown source').fill('');
  await page.keyboard.type('A source draft typed quickly.');
  assert.equal(await frame.locator('.markdown-actions').evaluate(() => window.recoveryWrites), 0, 'no IndexedDB clone per key');
  await page.frame({url:`${quartzOrigin}/demo/note`}).waitForFunction(() => window.recoveryWrites === 1);
  await page.waitForTimeout(5100);
  assert.equal(await frame.locator('.markdown-actions').evaluate(() => window.recoveryWrites), 1, 'idle snapshot cancels the maximum timer');
  assert.equal(document.body, 'First paragraph.\n\nSecond paragraph.\n', 'unapplied source stays local');
  await frame.getByRole('button', {name:'Cancel source changes'}).click();
  await saved(frame); assert.equal(await recoveryDraft(frame), undefined);
}));

test('retry captures typing that has not reached the autosave debounce', async () => fixture(async ({page,frame,document,fail,saves}) => {
  fail(true); await page.keyboard.press('Control+Home'); await page.keyboard.type('First edit '); await page.keyboard.press('Control+s');
  await frame.getByRole('button', {name:'Retry save'}).waitFor();
  fail(false); await page.keyboard.type('Newest edit '); await frame.getByRole('button', {name:'Retry save'}).click();
  await saved(frame); assert.match(document.body, /^First edit Newest edit /);
  assert.match(saves.at(-1).body, /^First edit Newest edit /);
}));

test('formatting controls track marks, history and reversible Markdown shortcuts', async () => fixture(async ({page,frame,document}) => {
  const toolbar = frame.getByRole('toolbar', {name:'Document formatting'});
  const bold = toolbar.getByRole('button', {name:'Bold',exact:true});
  assert.equal(await toolbar.getByRole('button',{name:'Undo',exact:true}).isDisabled(), true);
  await page.keyboard.type('## '); await frame.locator('.ProseMirror h2').waitFor();
  await page.keyboard.press('Backspace'); assert.equal(await frame.locator('.ProseMirror').innerText(), '## ');
  await page.keyboard.press('Control+a'); await page.keyboard.type('Words'); await page.keyboard.press('Control+a');
  await bold.click(); assert.equal(await bold.getAttribute('aria-pressed'), 'true');
  await bold.click(); assert.equal(await bold.getAttribute('aria-pressed'), 'false');
  await toolbar.getByRole('button', {name:'Inline code',exact:true}).click();
  await flush(frame); assert.match(document.body, /`Words`/);
  await toolbar.getByRole('button', {name:'Undo',exact:true}).click();
  assert.equal(await toolbar.getByRole('button', {name:'Redo',exact:true}).isEnabled(), true);
}, ''));

test('clearing the page title cannot silently save the previous title', async () => fixture(async ({frame,saves}) => {
  await frame.getByLabel('Page title').fill('');
  await assert.rejects(flush(frame), /Enter a page title/);
  assert.equal(saves.length, 0);
  assert.equal((await recoveryDraft(frame)).draft.title, '');
}));

test('overlapping source saves apply one undoable replacement', async () => fixture(async ({page,frame,document}) => {
  await frame.getByLabel('Advanced editing').selectOption('source');
  await frame.getByLabel('Markdown source').fill('## One replacement');
  await frame.locator('.markdown-actions').evaluate(() => Promise.all([window.__quartzDocumentEditor.flush(),window.__quartzDocumentEditor.flush()]));
  assert.equal(document.body, '## One replacement');
  await frame.getByRole('button',{name:'Apply source',exact:true}).click();
  await page.keyboard.press('Control+z'); await flush(frame);
  assert.equal(document.body, 'First paragraph.\n\nSecond paragraph.\n');
}));

test('IME typing saves promptly after composition outlasts the idle timer', async () => fixture(async ({page,frame,document}) => {
  await page.keyboard.press('Control+Home');
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', {text:'漢字',selectionStart:2,selectionEnd:2});
  await page.waitForTimeout(900);
  await session.send('Input.insertText', {text:'漢字'});
  await frame.locator('.markdown-action-status').filter({hasText:/^Saved$/}).waitFor({timeout:2000});
  assert.match(document.body, /^漢字/);
}));

for (const keepMine of [true, false]) test(`source conflict resolution keeps the ${keepMine ? 'local' : 'saved'} version and clears stale recovery`, async () => fixture(async ({page,frame,document}) => {
  Object.assign(document, {body:'Saved elsewhere.', revision:'external'});
  await page.keyboard.press('Control+Home'); await page.keyboard.type('Local '); await page.keyboard.press('Control+s');
  await frame.getByRole('button', {name:'Keep my version'}).waitFor();
  await frame.getByLabel('Advanced editing').selectOption('source');
  await frame.getByLabel('Markdown source').fill('Newest local source.');
  await frame.getByRole('button', {name:keepMine ? 'Keep my version' : 'Use saved version'}).click();
  await frame.locator('.bb-document-conflict').waitFor({state:'hidden'});
  await flush(frame);
  assert.equal(document.body, keepMine ? 'Newest local source.' : 'Saved elsewhere.');
  assert.equal(await frame.getByLabel('Markdown source').inputValue(), document.body);
  assert.equal(await recoveryDraft(frame), undefined);
}));

test('typing in a long note does not rewrite the editor root attributes', async () => fixture(async ({page,frame}) => {
  await frame.locator('.ProseMirror').evaluate(el => {
    window.editorRootMutations = [];
    new MutationObserver(records => { window.editorRootMutations.push(...records.map(r => ({name:r.attributeName, before:r.oldValue, after:el.getAttribute(r.attributeName)}))); }).observe(el, {attributes:true,attributeOldValue:true});
  });
  await page.keyboard.type('Typing quickly ');
  assert.deepEqual(await frame.locator('.ProseMirror').evaluate(() => window.editorRootMutations), []);
}, Array.from({length:100}, (_, i) => `Paragraph ${i}.`).join('\n\n')));

test('Markdown paste, heading shortcuts and large source replacements stay usable on narrow screens', async () => fixture(async ({page,frame,document}) => {
  await frame.locator('.ProseMirror').evaluate(el => {
    const data=new DataTransfer(); data.setData('text/markdown','# Working notes\n\nA **formatted** Markdown paste.');
    el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));
  });
  await frame.locator('.ProseMirror strong').waitFor();
  await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+Alt+2');
  await frame.locator('.ProseMirror h2').waitFor();
  await page.screenshot({path:path.resolve(root,'../qa/quartz-experience-desktop-20261106.png')});
  await frame.getByLabel('Advanced editing').selectOption('source');
  await frame.getByLabel('Markdown source').fill(Array.from({length:100}, (_, i) => `Paragraph ${i}.`).join('\n\n'));
  await frame.getByRole('button',{name:'Apply source',exact:true}).click();
  await frame.locator('.ProseMirror.bb-document-long').waitFor();
  await flush(frame); assert.match(document.body, /Paragraph 99/);
  await page.setViewportSize({width:390,height:844});
  const width=await frame.locator('body').evaluate(() => ({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(width.scroll <= width.viewport, 'formatting controls fit without horizontal scrolling');
  await page.screenshot({path:path.resolve(root,'../qa/quartz-experience-mobile-20261106.png')});
}, ''));

if (process.env.QUARTZ_EDITOR_BENCHMARK === '1') {
  const results=[];
  for (const [name,relative] of [['Maxwell','../qa/maxwell-website-import/full-website.md'],['Electromagnetics','../quartz/content/electromagnetism-1/sources/engineering-electromagnetics-9th-ed-9nbsped-compress.md']]) {
    test(`benchmark ${name}`, {timeout:120_000}, async () => {
      const raw=fs.readFileSync(path.resolve(root,relative),'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n){0,2}/,'');
      await fixture(async ({page,frame,mountMs,document})=>{
        const before=await frame.locator('.ProseMirror').evaluate(el=>{window.editorTimings=[];let start;document.addEventListener('keydown',()=>{start=performance.now();},true);document.addEventListener('keyup',()=>{window.editorTimings.push(performance.now()-start);},true);return window.textWalks;});
        const profiler = process.env.QUARTZ_EDITOR_PROFILE ? await page.context().newCDPSession(page) : null;
        if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
        const started=performance.now();await page.keyboard.press('Control+Home');await page.keyboard.type('Benchmark ');const typeMs=performance.now()-started;
        let profile;
        if (profiler) {
          const {profile:rawProfile}=await profiler.send('Profiler.stop');
          const counts=new Map(); for(const id of rawProfile.samples ?? []) counts.set(id,(counts.get(id) ?? 0)+1);
          profile=rawProfile.nodes.map(node=>({name:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber+1,samples:counts.get(node.id) ?? 0})).filter(n=>n.samples).sort((a,b)=>b.samples-a.samples).slice(0,25);
          await profiler.detach();
        }
        const after=await frame.locator('.ProseMirror').evaluate(()=>window.textWalks);
        const startSave=performance.now();await flush(frame);const saveMs=performance.now()-startSave;
        const warmSnapshotMs = await frame.locator('.ProseMirror').evaluate(() => {
          window.__quartzDocumentEditor.getDraft(); const start = performance.now();
          for (let i = 0; i < 100; i++) window.__quartzDocumentEditor.getDraft();
          return performance.now() - start;
        });
        assert.equal(after,before,'typing does not scan the article');assert.match(document.body,/Benchmark/);
        const domElements=await frame.locator('.ProseMirror *').count(); const keyEventMs=await frame.locator('.ProseMirror').evaluate(()=>window.editorTimings);
        await page.waitForTimeout(2000);
        await frame.locator('.ProseMirror').evaluate(() => { window.editorTimings=[]; });
        const warmStart=performance.now(); await page.keyboard.type('Warm edit '); const warmTypeMs=performance.now()-warmStart;
        const warmKeyEventMs=await frame.locator('.ProseMirror').evaluate(()=>window.editorTimings);
        await flush(frame);
        results.push({name,bytes:Buffer.byteLength(raw),mountMs:Math.round(mountMs),typeMs:Math.round(typeMs),saveMs:Math.round(saveMs),warmSnapshotMs,domElements,keyEventMs,warmTypeMs:Math.round(warmTypeMs),warmKeyEventMs,textWalksDuringTyping:after-before,...(profile ? {profile} : {})});
        fs.writeFileSync(path.resolve(root,process.env.QUARTZ_EDITOR_BENCHMARK_OUTPUT || '../qa/quartz-document-editor-benchmark.json'),JSON.stringify(results,null,2));
      },raw,{timeout:90_000});
    });
  }
}
