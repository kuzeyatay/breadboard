import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import http from 'node:http';
import { build } from "esbuild";
import { chromium } from "playwright";
import { installCanonicalQuartzReader as installLegacyReader } from "../scripts/quartz-canonical-reader-bridge.mjs";
import { installCanonicalQuartzReader } from "../../quartz/quartz/components/scripts/canonicalReader.mjs";
import { compileInlineScript } from '../../quartz/quartz/cli/handlers.js';

const root = path.resolve(import.meta.dirname, "..");
const quartz = path.resolve(root, "../quartz");
// Keepalive requests issued during pagehide outlive Playwright's page routes.
// Use a real endpoint so the reload test verifies server-observed release.
let leaseHandler;
const leaseServer = http.createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const result = leaseHandler?.(request.method, JSON.parse(Buffer.concat(chunks).toString() || '{}')) ?? { status: 503, body: {} };
  response.writeHead(result.status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(result.body));
});
await new Promise(resolve => leaseServer.listen(0, '127.0.0.1', resolve));
test.after(() => { leaseServer.closeAllConnections(); return new Promise(resolve => leaseServer.close(resolve)); });
const dashboardOrigin = `http://127.0.0.1:${leaseServer.address().port}`, quartzOrigin = "http://localhost:53242";
const stubs = new Map([
  ["@/app/components/use-garden-title", "export const useGardenTitle=()=>{}"],
  ["@/app/components/toast", "export const Toaster=()=>null;export const useToast=()=>({toasts:[],dismissToast:()=>{}})"],
  ["@/lib/folder-pdf-export-client", "export const exportFolderPdf=async()=>({})"],
  ["@/lib/quartz-assistant-selection", "export const quartzAssistantSelectionRequest=()=>null,quartzInlineAnswerStopRequest=()=>null"],
  ["@/lib/quartz-topology-investigation", "export const quartzTopologyInvestigationRequest=()=>null"],
  ["../use-canonical-garden-folders", "export const useCanonicalGardenFolders=()=>{}"],
  ["./use-canonical-garden-folders", "export const useCanonicalGardenFolders=()=>{}"],
  ["./use-quartz-reader-layout", "export const useQuartzReaderLayout=()=>({readerLayoutStyle:{},setAssistantWidth:()=>{}})"],
  ["./garden-markdown-artifacts", "export default ()=>null"],
  ["../use-quartz-reader-layout", "export const useQuartzReaderLayout=()=>({readerLayoutStyle:{},setAssistantWidth:()=>{}})"],
  ["@/app/components/hermes/garden-assistant-switch", "import React from 'react';export default ({activeMarkdown})=>React.createElement('output',{'data-assistant-context':true},JSON.stringify(activeMarkdown))"],
  ...["../quartz-inline-answer-popover", "../garden-markdown-artifacts"].map(name => [name, "export default ()=>null"]),
]);
await import('../scripts/build-quartz-editor.mjs');
const host = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import GardenClient from './src/app/garden/[clusterSlug]/garden-client';
    import LibraryGardenClient from './src/app/garden/library-garden-client';
    const note=new URL(location.href).searchParams.get('note')||undefined;
    createRoot(document.getElementById('root')).render(location.pathname==='/library'?<LibraryGardenClient src="${quartzOrigin}/demo/folder/first" title="Demo garden"/>:<GardenClient clusterSlug="demo" clusterName="Demo" quartzBaseUrl="${quartzOrigin}" note={note}/>);
  ` },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env": "{}" },
  alias: { "@": path.join(root, "src") },
  plugins: [{ name: "unrelated-reader-widgets", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => stubs.has(args.path) ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs.get(args.path), loader: "js", resolveDir: root }));
  } }],
});
const editorBundle = await build({
  stdin: { resolveDir: quartz, loader: "tsx", contents: `
    import {h} from 'preact';import render from 'preact-render-to-string';import factory from './quartz/components/MarkdownActions';
    const Component=factory();export const editor=slug=>render(h(Component,{fileData:{slug}}));export const script=Component.afterDOMLoaded;export const css=Component.css;
  ` }, bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", jsxImportSource: "preact",
  plugins: [{ name: 'quartz-inline-scripts', setup(builder) {
    builder.onLoad({ filter: /\.inline\.(ts|js)$/ }, async args => ({ contents: await compileInlineScript(args.path), loader: 'text' }));
  } }],
});
const editor = await import(`data:text/javascript;base64,${Buffer.from(editorBundle.outputFiles[0].text).toString("base64")}`);
const spaScript = await compileInlineScript(path.join(quartz, 'quartz/components/scripts/spa.inline.ts'));

async function fixture(run, library = false, options = {}) {
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
    const errors = [], loads = [], leases = [], documentReads = [], paints = [];
    await page.exposeFunction('recordGardenPaint', value => paints.push(value));
    await page.addInitScript(() => {
      let previous;
      const sample = () => {
        const article = document.querySelector('article.popover-hint');
        if (article && getComputedStyle(article).visibility !== 'hidden') {
          const value = JSON.stringify({ body: article.textContent, title: document.querySelector('h1.article-title')?.textContent });
          if (value !== previous) { previous = value; void window.recordGardenPaint(JSON.parse(value)); }
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    leaseHandler = (method, { viewId }) => {
      leases.push({ method, viewId });
      const failed = method === 'POST' && (options.failLeases || leases.filter(event => event.method === 'POST').length <= (options.leaseFailures ?? 0));
      return failed ? { status: 429, body: { error: 'Too many active Quartz views.' } } : { status: 200, body: { ok: true, expiresInMs: 70_000 } };
    };
    page.on("pageerror", error => errors.push(error.message));
    const notes = new Map([
      ["folder/first", { title: "First note", body: "Original first body" }],
      ["folder/Second,-note", { title: "Second note", body: "Original second body" }],
    ]);
    const publishedTitles = new Map([...notes].map(([slug, note]) => [slug, note.title]));
    await page.route(`${dashboardOrigin}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/quartz/view-lease') {
        return route.continue();
      }
      if(url.pathname.startsWith('/quartz-editor/')) return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(root,'public',url.pathname.slice(1)),'utf8')});
      if (url.pathname.startsWith("/api/documents/")) {
        const slug = decodeURIComponent(url.pathname.slice("/api/documents/".length));
        const note = notes.get(slug);
        if (route.request().method() === 'GET') documentReads.push(slug);
        if (!note) return route.fulfill({ status: 404, json: { error: "Note not found" } });
        // The real document API returns the Markdown basename, not the full
        // Quartz path. It must not overwrite the editor reply's document ID.
        const fileSlug = slug.split('/').at(-1).replaceAll('-', ' ');
        if (route.request().method() === 'DELETE') {
          notes.delete(slug);
          return route.fulfill({ json: { success: true, slug: fileSlug } });
        }
        if (route.request().method() === "PATCH") {
          Object.assign(note, route.request().postDataJSON());
          note.revision = String(Date.now());
          return route.fulfill({ json: { success: true, slug: fileSlug, revision: note.revision, title: note.title, tags: [] } });
        }
        if (url.searchParams.get('render') === '1') {
          if (options.readDelay) await new Promise(resolve => setTimeout(resolve, options.readDelay));
          if (options.failReadSlug === slug) return route.fulfill({ status: 503, json: { error: 'Could not load the saved page.' } });
        }
        return route.fulfill({ json: { success: true, ...note, slug: fileSlug, content: note.body, tags: [], revision:note.revision || "initial", canEdit:true, accountId:"1", reader: url.searchParams.get('render') === '1' ? {
          slug: `demo/${slug}`, title: note.title, html: `<p>${note.body}</p>`, toc: [],
        } : undefined } });
      }
      return route.fulfill({ contentType: "text/html", body: `<style>iframe{width:100%;height:1000px}body{margin:0}</style><div id="root"></div><script>${host.outputFiles[0].text}</script>` });
    });
    await page.route(`${quartzOrigin}/**`, async route => {
      const url = new URL(route.request().url()), slug = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
      loads.push(slug);
      const note = notes.get(slug.replace(/^demo\//, ""));
      // Publication intentionally stays stale. The live reader must render the
      // saved source without waiting for the static site build to finish.
      const publishedTitle = publishedTitles.get(slug.replace(/^demo\//, '')) || 'Garden';
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><title>${publishedTitle}</title><style>:root{--light:#fff;--dark:#222;--secondary:#385845;--lightgray:#ddd;--gray:#666}${editor.css}</style><script>(${installLegacyReader.toString()})();${options.bridgeDelay ? `setTimeout(${installCanonicalQuartzReader.toString()},${options.bridgeDelay});` : `(${installCanonicalQuartzReader.toString()})();`}</script></head><body data-slug="${slug}"><nav><a href="/demo/folder/first">First</a><a href="/demo/folder/Second,-note">Second</a><a href="/demo">Garden home</a></nav><div class="explorer"><a data-for="${slug}">${publishedTitle}</a></div><nav class="breadcrumb-container"><div class="breadcrumb-element"><a href="">${publishedTitle}</a></div></nav><h1 class="article-title">${publishedTitle}</h1>${note ? editor.editor(slug) : ""}<article class="popover-hint"><p>Old published content</p></article><script>${editor.script}</script><script>${options.spa ? spaScript : `document.dispatchEvent(new CustomEvent('nav',{detail:{url:${JSON.stringify(slug)}}}));parent.postMessage({type:'second-brain:navigate',slug:${JSON.stringify(slug)},title:document.title},'${dashboardOrigin}')`}</script></body></html>` });
    });
    await page.goto(`${dashboardOrigin}${library ? "/library" : "/garden/demo?note=folder%2Ffirst&chat=1"}`);
    const frame = page.frameLocator('iframe[title="Demo garden"]');
    if (!options.deferReady) await frame.locator("article").getByText("Original first body", { exact: true }).waitFor({ timeout: 5000 }).catch(async error => {
      throw new Error(`${error.message}\n${JSON.stringify({ errors, loads, frames: page.frames().map(frame => frame.url()), parent: await page.locator('body').innerText() })}`);
    });
    await run({ page, frame, notes, loads, errors, leases, documentReads, paints });
  } finally { await browser.close(); }
}

test("saving markdown updates the visible article and title without reloading the iframe", { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame, loads, errors }) => {
    const trash = frame.getByRole('button', { name: 'Delete page', exact: true });
    assert.equal((await trash.textContent()).trim(), '');
    assert.equal(await trash.locator('svg[aria-hidden=true]').count(), 1);
    assert.equal(await trash.evaluate(node => getComputedStyle(node).color), 'rgb(180, 35, 50)');
    await frame.getByRole("switch", { name: "Edit page", exact: true }).click();
    assert.equal(await trash.evaluate(node => getComputedStyle(node).color), 'rgb(180, 35, 50)', 'editor styles retain the red icon');
    await frame.locator(".ProseMirror").fill("Saved body appears immediately");
    await frame.locator("h1.article-title").fill("Updated title");
    const before = loads.length;
    await page.keyboard.press("Control+s");
    await frame.locator(".markdown-action-status").filter({hasText:/^Saved$/}).waitFor();
    await frame.locator("article").getByText("Saved body appears immediately", { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await frame.locator("h1.article-title").textContent(), "Updated title");
    assert.equal(await frame.locator('.explorer a').textContent(), 'Updated title');
    assert.equal(await frame.locator('.breadcrumb-element a').textContent(), 'Updated title');
    assert.equal(await frame.locator('body').evaluate(() => document.title), 'Updated title');
    assert.equal(loads.length, before, "save refreshes content in the existing frame");
    await page.waitForTimeout(1100);
    assert.deepEqual(errors, [], "save does not attempt a forbidden cross-origin reload");
  });
});

for (const library of [false, true]) test(`${library ? 'library' : 'garden'} retains assistant content after a repeated navigation snapshot`, async () => {
  await fixture(async ({ page }) => {
    const context = page.locator('[data-assistant-context]');
    await page.waitForFunction(() => {
      const state = JSON.parse(document.querySelector('[data-assistant-context]').textContent);
      return state?.content === 'Original first body' && state.loading === false;
    });
    const before = await context.textContent();
    await page.evaluate(origin => {
      const frame = document.querySelector('iframe');
      frame.contentWindow.postMessage({ type: 'second-brain:request-navigation' }, origin);
      frame.contentWindow.postMessage({ type: 'second-brain:request-navigation' }, origin);
    }, quartzOrigin);
    await page.waitForTimeout(100);
    assert.equal(await context.textContent(), before, 'a repeated page announcement keeps the canonical content and loading state');
  }, library);
});

test("Ctrl+R restores the selected nested note and returning home clears the note URL", { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame }) => {
    await frame.getByRole("link", { name: "Second", exact: true }).click();
    await frame.locator("article").getByText("Original second body", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("note"), "folder/Second,-note");
    assert.equal(new URL(page.url()).searchParams.get("chat"), "1");
    await page.reload();
    await frame.locator("article").getByText("Original second body", { exact: true }).waitFor();
    const original = page.url();
    await page.evaluate(() => window.postMessage({ type: "second-brain:navigate", slug: "private/secret" }, "*"));
    assert.equal(page.url(), original, "untrusted windows cannot change the saved location");
    await frame.getByRole("link", { name: "Garden home", exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has("note"));
    await page.reload();
    await frame.getByRole("heading", { name: "Garden", exact: true }).waitFor();
  });
});

for (const library of [false, true]) test(`${library ? 'library' : 'garden'} paints only saved content on SPA navigation, reopening and reload`, { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame, paints, notes, errors }) => {
    await frame.getByRole('link', { name: 'Second', exact: true }).click();
    // During the delayed canonical read the previous page remains visible.
    assert.equal(await frame.locator('article').innerText(), 'Original first body');
    await frame.locator('article').getByText('Original second body', { exact: true }).waitFor();
    await frame.getByRole('switch', { name: 'Edit page', exact: true }).click();
    await frame.locator('.ProseMirror').fill('Saved second body');
    await frame.locator('h1.article-title').fill('Renamed second note');
    await page.keyboard.press('Control+s');
    await frame.locator('.markdown-action-status').filter({ hasText: /^Saved$/ }).waitFor();
    assert.equal(notes.get('folder/Second,-note').title, 'Renamed second note');
    await frame.getByRole('link', { name: 'First', exact: true }).click();
    await frame.locator('article').getByText('Original first body', { exact: true }).waitFor();
    const before = paints.length;
    await frame.getByRole('link', { name: 'Second', exact: true }).click();
    await frame.locator('article').getByText('Saved second body', { exact: true }).waitFor();
    await frame.getByRole('heading', { name: 'Renamed second note', exact: true }).waitFor();
    if (library) await frame.locator('body').evaluate(() => location.reload());
    else await page.reload();
    await frame.locator('article').getByText('Saved second body', { exact: true }).waitFor();
    await page.waitForTimeout(100);
    assert.ok(!paints.some(paint => paint.body.includes('Old published content')), JSON.stringify(paints));
    assert.ok(!paints.slice(before).some(paint => paint.title === 'Second note'), 'the old title never paints on reopening');
    assert.equal(await frame.locator('.breadcrumb-element a').textContent(), 'Renamed second note');
    assert.deepEqual(errors, []);
  }, library, { spa: true, readDelay: 220 });
});

test('a title-only refresh updates navigation metadata without replacing unchanged article nodes', { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame }) => {
    await frame.locator('article p').evaluate(node => { window.originalParagraph = node; });
    await page.evaluate(origin => document.querySelector('iframe').contentWindow.postMessage({
      type: 'second-brain:canonical-document', slug: 'demo/folder/first', requestId: 'title-only',
      html: '<p>Original first body</p>', title: 'Only the title changed', toc: [],
    }, origin), quartzOrigin);
    await frame.getByRole('heading', { name: 'Only the title changed' }).waitFor();
    assert.equal(await frame.locator('article p').evaluate(node => node === window.originalParagraph), true);
    assert.equal(await frame.locator('.explorer a').textContent(), 'Only the title changed');
  });
});

test('failed canonical navigation retains the current page and retries the same destination', { timeout: 30_000 }, async () => {
  const options = { spa: true, failReadSlug: 'folder/Second,-note' };
  await fixture(async ({ frame, errors }) => {
    await frame.getByRole('link', { name: 'Second', exact: true }).click();
    await frame.getByRole('alert').filter({ hasText: 'Could not load the saved page.' }).waitFor();
    assert.equal(await frame.locator('article').innerText(), 'Original first body');
    options.failReadSlug = undefined;
    await frame.getByRole('button', { name: 'Retry', exact: true }).click();
    await frame.locator('article').getByText('Original second body', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  }, false, options);
});

test('opening editing during a slow initial read reveals the draft without replacing it', { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame, errors }) => {
    await frame.getByRole('switch', { name: 'Edit page' }).click();
    // The canonical response acknowledges the mounted editor, then reveals it.
    await frame.locator('.ProseMirror').fill('Draft entered during loading');
    await page.waitForTimeout(1300);
    assert.equal(await frame.locator('.ProseMirror').innerText(), 'Draft entered during loading');
    assert.equal(await frame.locator('article').evaluate(node => getComputedStyle(node).visibility), 'visible');
    assert.deepEqual(errors, []);
  }, false, { deferReady: true, readDelay: 1200 });
});

for (const library of [false, true]) test(`${library ? 'library' : 'individual'} reader retries a refused view in place without a second saved-page error`, { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame, errors, documentReads }) => {
    await page.getByRole('alert').filter({ hasText: 'Garden did not respond' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open Quartz directly' }).count(), 0);
    assert.equal(await page.getByText('Could not refresh the saved page.', { exact: true }).count(), 0);
    assert.equal(documentReads.length, 0, 'do not fetch canonical content before the frame can load');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await frame.locator('article').getByText('Original first body', { exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.locator('iframe').count(), 1);
    assert.deepEqual(errors, []);
  }, library, { leaseFailures: 1, deferReady: true, bridgeDelay: 700 });
});

test('temporary view failures retry automatically and a delayed reader bridge acknowledges the current note', { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame, leases, errors }) => {
    assert.equal(leases.filter(event => event.method === 'POST').length, 3);
    assert.equal(await page.getByRole('alert').count(), 0);
    await frame.getByRole('switch', { name: 'Edit page' }).click();
    await frame.locator('.ProseMirror').fill('Recovered reader edit');
    await page.keyboard.press('Control+s');
    await frame.locator('.markdown-action-status').filter({ hasText: /^Saved$/ }).waitFor();
    assert.deepEqual(errors, []);
  }, false, { leaseFailures: 2, bridgeDelay: 700 });
});

test('reload releases the old view and a missed renewal keeps the current reader mounted', { timeout: 30_000 }, async () => {
  const options = {};
  await fixture(async ({ page, frame, leases, loads, errors }) => {
    const firstId = leases.find(event => event.method === 'POST').viewId;
    await page.reload();
    await frame.locator('article').getByText('Original first body', { exact: true }).waitFor();
    assert.ok(leases.some(event => event.method === 'DELETE' && event.viewId === firstId), 'pagehide releases the view on a full reload');
    const before = loads.length, renewed = leases.length;
    options.failLeases = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForResponse(response => response.url().endsWith('/api/quartz/view-lease') && response.status() === 429);
    assert.ok(leases.length > renewed);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(loads.length, before, 'a missed renewal does not reload or discard the page');
    assert.equal(await frame.locator('article').innerText(), 'Original first body');
    assert.deepEqual(errors, []);
  }, false, options);
});

test('the trash icon confirms deletion and still receives its reply after an in-place reader refresh', { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame, notes, errors }) => {
    await page.evaluate(origin => document.querySelector('iframe').contentWindow.postMessage({
      type: 'second-brain:canonical-document', slug: 'demo/folder/first', requestId: 'refresh-before-delete',
      html: '<p>Refreshed first body</p>', title: 'First note', toc: [],
    }, origin), quartzOrigin);
    await frame.locator('article').getByText('Refreshed first body', { exact: true }).waitFor();
    const trash = frame.getByRole('button', { name: 'Delete page', exact: true });
    page.once('dialog', dialog => dialog.dismiss());
    await trash.click();
    assert.equal(notes.has('folder/first'), true, 'cancelling keeps the note');
    page.once('dialog', dialog => dialog.accept());
    await trash.click();
    await frame.getByRole('heading', { name: 'Garden', exact: true }).waitFor();
    assert.equal(notes.has('folder/first'), false);
    assert.equal(notes.has('folder/Second,-note'), true);
    assert.deepEqual(errors, []);
  });
});


test("the library view edits through the same bridge and navigation flushes a pending draft", {timeout:30000}, async()=>{
  await fixture(async({page,frame,notes})=>{
    await frame.getByRole('switch',{name:'Edit page'}).click();await frame.locator('.ProseMirror').fill('Library draft');
    await frame.getByRole('link',{name:'Second',exact:true}).click();
    await frame.locator('article').getByText('Original second body',{exact:true}).waitFor();
    assert.equal(notes.get('folder/first').body,'Library draft');assert.equal(notes.get('folder/Second,-note').body,'Original second body');
    assert.equal(await frame.getByRole('switch',{name:'Edit page'}).getAttribute('aria-checked'),'false');
    await frame.getByRole('switch',{name:'Edit page'}).click();
    await frame.locator('.ProseMirror').fill('Edited the second note');
    await page.keyboard.press('Control+s');
    await frame.locator('.markdown-action-status').filter({hasText:/^Saved$/}).waitFor();
    assert.equal(notes.get('folder/Second,-note').body,'Edited the second note');
    assert.equal(notes.get('folder/first').body,'Library draft');
  },true);
});
