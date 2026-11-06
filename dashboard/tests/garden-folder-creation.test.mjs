import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { canonicalQuartzReaderShell } from "../scripts/quartz-reader-shell.mjs";
import { withCanonicalQuartzReader } from "../../quartz/quartz/components/scripts/canonicalReader.mjs";

const root = path.resolve(import.meta.dirname, "..");

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-folder-"));
  const content = path.join(dir, "content");
  fs.mkdirSync(path.join(content, "physics"), { recursive: true });
  const previous = process.env.QUARTZ_CONTENT_PATH;
  // Exercise the same extended Windows paths used by the desktop runtime.
  process.env.QUARTZ_CONTENT_PATH = path.toNamespacedPath(content);
  const state = { allowed: true, busy: false, leased: false, publishes: 0, refreshes: 0 };
  globalThis.__folderFixture = state;
  const normalization = fs.readFileSync(path.join(root, "src/lib/garden-documents.ts"), "utf8")
    .match(/export function normalizeGardenFolder\(value: unknown\): string \{[\s\S]*?\n\}/)[0];
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/server-auth": `export async function requireOwnedClusterFromSlug(slug) {
      if (!globalThis.__folderFixture.allowed || slug !== 'physics') throw Error('Forbidden');
      return {cluster:{slug,id:1},userId:7};
    } export const requireReadableClusterFromSlug=requireOwnedClusterFromSlug;
    export const routeErrorResponse=e=>Response.json({error:e.message},{status:403});`,
    "./db.ts": "export default {};",
    "./runtime-paths.ts": "export const dashboardDataDir=()=>'';",
    "./knowledge.ts": `import fs from 'node:fs';import path from 'node:path';
      export const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      export const refreshClusterIndex=()=>{globalThis.__folderFixture.refreshes++};
      export const walkClusterMarkdown=root=>{const files=[];const walk=(dir,folder='')=>{
        for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
          const filePath=path.join(dir,entry.name),relPath=folder?folder+'/'+entry.name:entry.name;
          if(entry.isDirectory())walk(filePath,relPath);
          else if(entry.name.endsWith('.md'))files.push({entry:entry.name,filePath,relPath,folder});
        }
      };walk(root);return files;};`,
    "./garden-documents.ts": `import {slugify} from './knowledge.ts'; ${normalization}`,
    "./quartz-publish.ts": `export async function publishQuartzAfterMutation(){
      const state=globalThis.__folderFixture;
      if(state.leased) throw Error('Publication holds mutation lease');
      state.publishes++; return new Promise(()=>{});
    }`,
    "./garden-mutation-recovery.ts": `export function acquireGardenMutationLeaseWithIngestionRecovery(){
      const state=globalThis.__folderFixture;
      if(state.busy) throw Object.assign(Error('Garden busy'),{code:'garden_busy',status:409});
      state.leased=true;return {lock:{buildId:'fixture-exclusive'},release(){state.leased=false}};
    }`,
    "@/lib/garden-mutation-lease": "export const isGardenMutationBusyError=e=>e.code==='garden_busy';",
  };
  const bundle = await build({
    entryPoints: [path.join(root, "src/app/api/folders/route.ts")],
    bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "folder-fixture", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => stubs[args.path] === undefined ? undefined : { path: args.path, namespace: "fixture" });
      builder.onResolve({ filter: /generated\/quartz-reader\.mjs$/ }, () => ({ path: path.join(root, '../quartz/quartz/reader.ts') }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "ts" }));
      builder.onLoad({ filter: /(?:\.scss|\.inline\.(?:ts|js))$/ }, () => ({ contents: '', loader: 'text' }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return { ...module.exports, state, content, close() {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
    delete globalThis.__folderFixture;
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}

const createRequest = folder => new Request("http://localhost/api/folders", {
  method: "POST", body: JSON.stringify({ clusterSlug: "physics", folder }),
});

test("saved folder pages render empty folders, recursive totals, and current contents before publication", async () => {
  const app = await fixture();
  const read = folder => app.GET(new Request(`http://localhost/api/folders?${new URLSearchParams({ clusterSlug: 'physics', folder, render: '1' })}`));
  try {
    await app.POST(createRequest('Introduction'));
    let response = await read('introduction');
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    let { reader } = await response.json();
    assert.equal(reader.slug, 'physics/introduction/index');
    assert.equal(reader.title, 'Introduction');
    assert.match(reader.html, /page-listing/);
    assert.match(reader.contentMetaHtml, /0 words/);
    assert.doesNotMatch(reader.folderActionsHtml, /folder-pdf-export/);
    fs.mkdirSync(path.join(app.content, 'physics/introduction/More & examples'), { recursive: true });
    fs.writeFileSync(path.join(app.content, 'physics/introduction/lesson.md'), '---\ntitle: From abstract vector spaces to electromagnetism\n---\n\n' + 'field '.repeat(201));
    fs.writeFileSync(path.join(app.content, 'physics/introduction/More & examples/example.md'), '---\ntitle: Nested example\n---\n\n' + 'vector '.repeat(399));
    fs.writeFileSync(path.join(app.content, 'physics/outside.md'), 'outside '.repeat(5000));
    ({ reader } = await (await read('introduction')).json());
    assert.match(reader.html, /From abstract vector spaces to electromagnetism/);
    assert.match(reader.html, /More &amp; examples/);
    assert.doesNotMatch(reader.html, /Nested example|outside/);
    assert.match(reader.contentMetaHtml, /600 words/);
    assert.match(reader.contentMetaHtml, /3 min read total/);
    assert.match(reader.folderActionsHtml, /Nested example/);
    assert.match(reader.folderActionsHtml, /Knowledge Map/);
    assert.equal(Object.keys(reader.index).length, 4);
    const nested = await (await read('introduction/More--and--examples')).json();
    assert.equal(nested.reader.title, 'More & examples');
    assert.match(nested.reader.html, /Nested example/);
    fs.renameSync(path.join(app.content, 'physics/introduction/lesson.md'), path.join(app.content, 'physics/lesson.md'));
    ({ reader } = await (await read('introduction')).json());
    assert.doesNotMatch(reader.html, /From abstract vector spaces/);
    assert.match(reader.contentMetaHtml, /399 words/);
    assert.equal((await read('../introduction')).status, 404);
    assert.equal((await read('missing')).status, 404);
    app.state.allowed = false;
    assert.equal((await read('introduction')).status, 403);
  } finally { app.close(); }
});

test("custom folder names open a live folder page by mouse and keyboard, with reload and retry", { timeout: 30_000 }, async () => {
  const app = await fixture();
  let server, browser;
  try {
    await app.POST(createRequest('Introduction'));
    const bundle = await build({ stdin: { resolveDir: root, contents: `
      import '../quartz/quartz/components/scripts/explorer.inline.ts';
      import '../quartz/quartz/components/scripts/spa.inline.ts';
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    const host = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';
      import Bridge from './src/app/garden/garden-document-editor-bridge';
      import {useCanonicalGardenFolders} from './src/app/garden/use-canonical-garden-folders';
      function App(){const iframeRef=useRef(null);useCanonicalGardenFolders(iframeRef,location.origin,'physics');
        return <><Bridge iframeRef={iframeRef} quartzOrigin={location.origin}/><iframe ref={iframeRef} src='/physics/start' style={{width:'100%',height:750}}/></>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    const template = `<html><head><title>Start</title><style data-persist>[hidden]{display:none!important}.folder-outer{display:none}.folder-outer.open{display:block}</style>
      <script data-persist>window.fetchData=Promise.resolve({'physics/index':{slug:'physics/index',filePath:'physics/_index.md',title:'Physics',links:[],tags:[],content:''}});</script>
      <script src='/quartz.js' defer data-persist></script></head><body data-slug='physics/start'>
      <div class='explorer' data-behavior='link' data-collapsed='collapsed' data-savestate='true' data-graph-clusters='["physics"]' data-garden-scope='private'><ul class='explorer-ul'><li class='overflow-end'></li></ul></div>
      <template id='template-folder'><li><div class='folder-container'><svg class='folder-icon'></svg><div><button class='folder-button'><span class='folder-title'></span></button></div></div><div class='folder-outer'><ul></ul></div></li></template>
      <template id='template-file'><li><a></a></li></template>
      <h1 class='article-title'>Start</h1><p class='content-meta'>Old metadata</p>
      <div class="markdown-actions" data-note-slug='physics/start'><button>Edit</button></div>
      <article class='popover-hint'><p>Published start</p></article></body></html>`;
    let failRead = false;
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/quartz.js' || url.pathname === '/host.js') {
          res.setHeader('content-type', 'text/javascript'); res.end((url.pathname === '/quartz.js' ? bundle : host).outputFiles[0].text); return;
        }
        if (url.pathname === '/api/folders') {
          const response = failRead && url.searchParams.has('render') ? Response.json({ error: 'Read interrupted' }, { status: 503 }) : await app.GET(new Request(url));
          res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
        }
        if (url.pathname.startsWith('/api/documents')) {
          res.setHeader('content-type', 'application/json');
          if (url.pathname === '/api/documents') res.end(JSON.stringify({ documents: [] }));
          else if (url.pathname === '/api/documents/start') res.end(JSON.stringify({ success: true, reader: { slug: 'physics/start', title: 'Start', html: '<p>Saved start</p>', toc: [] } }));
          else if (url.pathname === '/api/documents/introduction') res.end(JSON.stringify({ success: true, reader: { slug: 'physics/introduction', title: 'Wrong same-named note', html: '<p>Not the folder</p>', toc: [] } }));
          else { res.statusCode = 404; res.end(JSON.stringify({ error: 'Note not found' })); }
          return;
        }
        res.setHeader('content-type', 'text/html');
        if (!url.pathname.startsWith('/physics/')) { res.end('<div id="root"></div><script src="/host.js"></script>'); return; }
        const slug = decodeURIComponent(url.pathname).replace(/^\/|\/$/g, '');
        res.end(withCanonicalQuartzReader(slug === 'physics/start' ? template : canonicalQuartzReaderShell(template, '/physics/start.html', slug)));
      } catch (error) { res.statusCode = 500; res.end(error.stack); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(5_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const frame = page.frameLocator('iframe');
    const folder = frame.locator('[data-folderpath="physics/introduction/index"]');
    await folder.getByRole('link', { name: 'Introduction', exact: true }).waitFor();
    assert.equal(await folder.getByRole('link').getAttribute('href'), '/physics/introduction/index');
    await frame.getByText('Saved start', { exact: true }).waitFor();
    await folder.locator('.folder-icon').dispatchEvent('click');
    assert.equal(await frame.locator('h1.article-title').textContent(), 'Start', 'The chevron only expands');
    await folder.getByRole('link', { name: 'Introduction', exact: true }).focus();
    await page.keyboard.press('Enter');
    await frame.locator('.page-listing').waitFor();
    assert.equal(await frame.locator('h1.article-title').textContent(), 'Introduction');
    assert.match(await frame.locator('.content-meta').textContent(), /0 words/);
    assert.equal(await frame.locator('.markdown-actions').count(), 0);
    assert.equal(await frame.locator('.graph').count(), 1, 'Saved folder includes the standard topology surface');
    fs.writeFileSync(path.join(app.content, 'physics/introduction/lesson.md'), '---\ntitle: From abstract vector spaces to electromagnetism\n---\n\n' + 'field '.repeat(201));
    await folder.getByRole('link', { name: 'Introduction', exact: true }).click();
    await frame.locator('.page-listing').getByRole('link', { name: 'From abstract vector spaces to electromagnetism' }).waitFor();
    assert.match(await frame.locator('.content-meta').textContent(), /201 words/);
    await page.locator('iframe').evaluate(element => element.contentWindow.location.reload());
    await frame.locator('.page-listing').getByRole('link', { name: 'From abstract vector spaces to electromagnetism' }).waitFor();
    failRead = true;
    await folder.getByRole('link', { name: 'Introduction', exact: true }).click();
    await frame.getByRole('alert').getByRole('button', { name: 'Retry' }).waitFor();
    assert.equal(await frame.locator('h1.article-title').textContent(), 'Introduction', 'A failed navigation keeps the current folder visible');
    failRead = false;
    fs.renameSync(path.join(app.content, 'physics/introduction/lesson.md'), path.join(app.content, 'physics/lesson.md'));
    await frame.getByRole('button', { name: 'Retry', exact: true }).click();
    await frame.getByRole('alert').waitFor({ state: 'detached' });
    await frame.locator('.page-listing a').waitFor({ state: 'detached' });
    assert.equal(await frame.locator('.page-listing a').count(), 0);
    assert.match(await frame.locator('.content-meta').textContent(), /0 words/);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    app.close();
  }
});

test("document moves acknowledge persistence before publication and preserve exact files and folder names", { timeout: 5_000 }, async () => {
  const app = await fixture();
  try {
    const root = path.join(app.content, "physics"), target = "learning/1. Fields and Space";
    for (const folder of ["notes", "other", target]) fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, "notes/lesson.md"), "The moved lesson");
    fs.writeFileSync(path.join(root, "other/lesson.md"), "Another lesson with the same basename");
    const move = (slug, toFolder) => app.PATCH(new Request("http://localhost/api/folders", {
      method: "PATCH", body: JSON.stringify({ clusterSlug: "physics", slug, toFolder }),
    }));
    assert.equal((await move("lesson", target)).status, 409, "ambiguous basenames must not move the wrong file");
    app.state.allowed = false;
    assert.equal((await move("notes/lesson.md", target)).status, 403);
    app.state.allowed = true;
    let timer;
    const response = await Promise.race([move("notes/lesson.md", target), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Move waited for a stalled Quartz publication")), 1_000);
    })]).finally(() => clearTimeout(timer));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, slug: "lesson", folder: target,
      relPath: `${target}/lesson.md`, previousRelPath: "notes/lesson.md" });
    assert.equal(fs.existsSync(path.join(root, "notes/lesson.md")), false);
    assert.equal(fs.readFileSync(path.join(root, target, "lesson.md"), "utf8"), "The moved lesson");
    assert.equal(fs.existsSync(path.join(root, "learning/1-fields-and-space")), false);
    assert.equal(app.state.leased, false);
    assert.equal(app.state.publishes, 1);
    assert.equal((await move(`${target}/lesson.md`, "")).status, 200);
    assert.equal((await move("lesson.md", "notes")).status, 200, "a root path remains exact despite a duplicate basename");
    assert.equal((await move("other/lesson.md", "notes")).status, 409);
    assert.equal(fs.readFileSync(path.join(root, "other/lesson.md"), "utf8"), "Another lesson with the same basename");
  } finally { app.close(); }
});

test("folder API confirms real persistence before a stalled rebuild, with safe retries and ownership", async () => {
  const app = await fixture();
  try {
    const start = performance.now();
    const response = await Promise.race([
      app.POST(createRequest("My Notes/Nested")),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("Save waited for publication")), 1500); timer.unref(); }),
    ]);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, folder: "my-notes/nested" });
    assert.ok(performance.now() - start < 1500);
    const index = path.join(app.content, "physics/my-notes/nested/_index.md");
    assert.match(fs.readFileSync(index, "utf8"), /title: "Nested"/);
    assert.equal(app.state.leased, false);
    assert.equal(app.state.publishes, 1);
    assert.equal(app.state.refreshes, 0, "Empty folder creation does not scan every note");
    fs.writeFileSync(index, "Existing content\n");
    await app.POST(createRequest("My Notes/Nested"));
    assert.equal(fs.readFileSync(index, "utf8"), "Existing content\n", "Retry preserves existing contents");
    const listing = await app.GET(new Request("http://localhost/api/folders?clusterSlug=physics"));
    assert.deepEqual(await listing.json(), { folders: [
      { folder: "my-notes", name: "My Notes" }, { folder: "my-notes/nested", name: "Nested" },
    ] });
    assert.equal(listing.headers.get("cache-control"), "no-store");
    app.state.busy = true;
    const busy = await app.POST(createRequest("blocked"));
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).retryable, true);
    assert.equal(fs.existsSync(path.join(app.content, "physics/blocked")), false);
    app.state.busy = false;
    assert.equal((await app.POST(createRequest(""))).status, 400);
    fs.writeFileSync(path.join(app.content, "physics/occupied"), "An existing note");
    const publishesBeforeFailure = app.state.publishes;
    assert.equal((await app.POST(createRequest("occupied"))).ok, false);
    assert.equal(app.state.publishes, publishesBeforeFailure, "A failed disk write is never published as success");
    app.state.allowed = false;
    assert.equal((await app.POST(createRequest("forbidden"))).status, 403);
    assert.equal((await app.GET(new Request("http://localhost/api/folders?clusterSlug=physics"))).status, 403);
  } finally { app.close(); }
});

test("folder copies preserve originals, nested contents and links while reserving unique names and note identities", async () => {
  const app = await fixture();
  const request = (method, body) => new Request("http://localhost/api/folders", {
    method, body: JSON.stringify({ clusterSlug: "physics", ...body }),
  });
  try {
    const root = path.join(app.content, "physics");
    fs.mkdirSync(path.join(root, "learning/1. Fields and Space/empty"), { recursive: true });
    fs.writeFileSync(path.join(root, "learning/_index.md"), '---\ntitle: "Electromagnetism"\n---\n[[learning/lesson|Start]]\n');
    const original = '---\ntitle: "Lesson"\n---\n[[exercise]]\n[Exercise](1.%20Fields%20and%20Space/exercise.md)\n![Figure](figure.png)\n';
    fs.writeFileSync(path.join(root, "learning/lesson.md"), original);
    fs.writeFileSync(path.join(root, "learning/1. Fields and Space/exercise.md"), '---\ntitle: "Exercise"\n---\n[[physics/learning/lesson#field|Lesson]]');
    fs.writeFileSync(path.join(root, "learning/figure.png"), Buffer.from([1, 2, 3]));
    const copy = await app.POST(request("POST", { action: "copy", folder: "learning" }));
    assert.equal(copy.status, 200);
    assert.deepEqual(await copy.json(), { success: true, folder: "learning", newFolder: "learning-copy", name: "Learning copy" });
    assert.equal(fs.readFileSync(path.join(root, "learning/lesson.md"), "utf8"), original);
    assert.ok(fs.statSync(path.join(root, "learning-copy/1. Fields and Space/empty")).isDirectory());
    assert.deepEqual(fs.readFileSync(path.join(root, "learning-copy/figure.png")), Buffer.from([1, 2, 3]));
    assert.match(fs.readFileSync(path.join(root, "learning-copy/lesson-copy.md"), "utf8"), /exercise-copy/);
    assert.match(fs.readFileSync(path.join(root, "learning-copy/lesson-copy.md"), "utf8"), /\[Exercise\]\(1\.%20Fields%20and%20Space\/exercise-copy\.md\)/);
    assert.match(fs.readFileSync(path.join(root, "learning-copy/_index.md"), "utf8"), /title: "Learning copy"/);
    assert.match(fs.readFileSync(path.join(root, "learning-copy/1. Fields and Space/exercise-copy.md"), "utf8"), /lesson-copy#field\|Lesson/);
    const second = await app.POST(request("POST", { action: "copy", folder: "learning" }));
    assert.equal((await second.json()).newFolder, "learning-copy-2");
    assert.ok(fs.existsSync(path.join(root, "learning-copy-2/lesson-copy-2.md")));
    for (const folder of ["learning", "sources", "artifacts", "Concepts", "notepad", "notes"]) {
      fs.mkdirSync(path.join(root, folder), { recursive: true });
      const result = await app.PUT(request("PUT", { folder, name: "changed" }));
      assert.equal(result.status, 400, `${folder} is protected in the API`);
      assert.match((await result.json()).error, /cannot be renamed/);
      assert.ok(fs.existsSync(path.join(root, folder)));
    }
    const renamed = await app.PUT(request("PUT", { folder: "learning-copy", name: "My revision" }));
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).newFolder, "my-revision");
    assert.equal(fs.existsSync(path.join(root, "learning-copy")), false);
    assert.ok(fs.existsSync(path.join(root, "my-revision/lesson-copy.md")));
    assert.match(fs.readFileSync(path.join(root, "my-revision/_index.md"), "utf8"), /title: "My revision"/);
    assert.match(fs.readFileSync(path.join(root, "my-revision/_index.md"), "utf8"), /\[\[my-revision\/lesson-copy\|Start\]\]/);
    assert.equal((await app.PUT(request("PUT", { folder: "my-revision", name: "Learning" }))).status, 400);
    assert.equal((await app.PUT(request("PUT", { folder: "my-revision", name: "Learning copy 2" }))).status, 409);
    assert.equal((await app.PUT(request("PUT", { folder: "my-revision", name: "a/b" }))).status, 400);
    assert.equal((await app.POST(request("POST", { action: "copy", folder: "../physics/learning" }))).status, 400);
    assert.equal((await app.POST(request("POST", { action: "copy", folder: "missing" }))).status, 404);
    app.state.busy = true;
    assert.equal((await app.POST(request("POST", { action: "copy", folder: "learning" }))).status, 409);
    assert.equal(fs.existsSync(path.join(root, "learning-copy-3")), false);
    app.state.busy = false;
    app.state.allowed = false;
    assert.equal((await app.POST(request("POST", { action: "copy", folder: "learning" }))).status, 403);
    assert.equal(app.state.leased, false);
  } finally { app.close(); }
});

test("folder API copies Sources, Concepts and Artifacts with independent PDF and media references", async () => {
  const app = await fixture();
  try {
    const root = path.join(app.content, "physics");
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "assets/source.pdf"), "%PDF original");
    fs.writeFileSync(path.join(root, "assets/lecture.mp3"), "audio original");
    for (const folder of ["sources", "Concepts", "artifacts"]) {
      fs.mkdirSync(path.join(root, folder));
      fs.writeFileSync(path.join(root, folder, `${folder}-note.md`), `---\ntitle: ${folder}\nknowledge_type: source-document\nsource_document: parent\nartifact_id: original\nsource_pdf: /physics/assets/source.pdf\nsource_media: /physics/assets/lecture.mp3\n---\n\nBody\n`);
      const response = await app.POST(new Request("http://localhost/api/folders", {
        method: "POST", body: JSON.stringify({ clusterSlug: "physics", action: "copy", folder }),
      }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).newFolder, `${folder}-copy`);
      const copied = fs.readFileSync(path.join(root, `${folder}-copy/${folder}-note-copy.md`), "utf8");
      assert.match(copied, /knowledge_type: note/);
      assert.match(copied, new RegExp(`source_pdf: /physics/${folder}-copy/assets/`));
      assert.match(copied, new RegExp(`source_media: /physics/${folder}-copy/assets/`));
      assert.doesNotMatch(copied, /^source_document:|^artifact_id:/m);
    }
    assert.equal(app.state.publishes, 3);
    assert.equal(app.state.leased, false);
  } finally { app.close(); }
});

test("Explorer closes promptly, displays normalized and nested folders, and restores them after reload", async () => {
  const app = await fixture();
  // EM1 has canonical folder names with spaces and punctuation. Its static
  // index uses Quartz slugs, while /api/folders returns those disk names.
  fs.mkdirSync(path.join(app.content, "physics/learning/1. Fields and Space"), { recursive: true });
  fs.mkdirSync(path.join(app.content, "physics/persisted"), { recursive: true });
  let server, browser;
  try {
    const explorer = await build({ entryPoints: [path.join(root, "../quartz/quartz/components/scripts/explorer.inline.ts")], bundle: true, write: false, platform: "browser", format: "iife" });
    // Exercise the real snapshot hook and the actual creation branch used by each host.
    for (const clientPath of ["src/app/garden/[clusterSlug]/garden-client.tsx", "src/app/garden/library-garden-client.tsx"]) {
      fs.mkdirSync(path.join(app.content, "physics/published-folder"), { recursive: true });
      fs.writeFileSync(path.join(app.content, "physics/published-folder/_index.md"), '---\ntitle: "Published folder"\n---\n');
      const source = fs.readFileSync(path.join(root, clientPath), "utf8");
      const branchStart = source.indexOf("        const folder = typeof data.folder", source.indexOf("if (data.type === 'second-brain:move-note')"));
      const end = source.indexOf("        return;", branchStart) + "        return;".length;
      const creation = source.slice(branchStart, end);
      assert.doesNotMatch(creation, /reloadGarden/);
      assert.match(creation, /normalizedFolder: body.folder/);
      const host = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
        import React,{useRef,useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
        import {useCanonicalGardenFolders} from './src/app/garden/use-canonical-garden-folders';
        function Folders({iframeRef}){useCanonicalGardenFolders(iframeRef,location.origin);return null;}
        function App(){const iframeRef=useRef(null);const [hydrated,setHydrated]=useState(false);
          useEffect(()=>{const timer=setTimeout(()=>setHydrated(true),1000);return()=>clearTimeout(timer)},[]);
          useEffect(()=>{const handler=event=>{
            const data=event.data;if(event.source!==iframeRef.current?.contentWindow || data?.type!=='second-brain:create-folder')return;
            if(window.ignoreFolderCreates){window.blockedFolderRequests=(window.blockedFolderRequests||0)+1;return;}
            const folderCluster=data.cluster;
            const postToQuartz=message=>iframeRef.current?.contentWindow?.postMessage(message,location.origin);
            ${creation}
          };window.addEventListener('message',handler);return()=>window.removeEventListener('message',handler)},[]);
          return <>{hydrated && <Folders iframeRef={iframeRef}/>}<iframe ref={iframeRef} src='/garden' style={{width:'100%',height:750}}/></>;
        }createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: "iife", platform: "browser" });
      server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          if (url.pathname === "/host.js" || url.pathname === "/explorer.js") {
            res.setHeader("content-type", "text/javascript"); res.end((url.pathname === "/host.js" ? host : explorer).outputFiles[0].text); return;
          }
          if (url.pathname === "/api/folders") {
            let body = ""; for await (const chunk of req) body += chunk;
            const request = new Request(url, { method: req.method, ...(body ? { body } : {}) });
            const response = await app[req.method](request);
            res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
          }
          res.setHeader("content-type", "text/html");
          if (url.pathname !== "/garden") { res.end('<div id="root"></div><script src="/host.js"></script>'); return; }
          res.end(`<style>[hidden]{display:none!important}.folder-outer{display:none}.folder-outer.open{display:block}.folder-title{pointer-events:none}</style>
            <div class="explorer" data-behavior="link" data-collapsed="collapsed" data-savestate="true" data-graph-clusters='["physics"]' data-garden-scope="private">
            <ul class="explorer-ul"><li class="overflow-end"></li></ul></div>
            <template id="template-folder"><li><div class="folder-container"><svg class="folder-icon"></svg><div><button class="folder-button"><span class="folder-title"></span></button></div></div><div class="folder-outer"><ul></ul></div></li></template>
            <template id="template-file"><li><a></a></li></template>
            <script>window.addCleanup=()=>{};window.fetchData=Promise.resolve({
              'physics/index':{slug:'physics/index',filePath:'physics/_index.md',title:'Physics',links:[],tags:[],content:''},
              'physics/published-folder/index':{slug:'physics/published-folder/index',filePath:'physics/published-folder/_index.md',title:'Published folder',links:[],tags:[],content:''},
              'physics/learning/1.-Fields-and-Space/index':{slug:'physics/learning/1.-Fields-and-Space/index',filePath:'physics/learning/1. Fields and Space/_index.md',title:'1. Fields and Space',links:[],tags:[],content:''}
            });</script>
            <script src="/explorer.js"></script><script>document.dispatchEvent(new CustomEvent('nav',{detail:{url:'physics/index'}}))</script>`);
        } catch (error) { res.statusCode = 500; res.end(error.message); }
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
      browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
      const page = await browser.newPage();
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const frame = page.frameLocator("iframe");
      const suffix = clientPath.includes("[clusterSlug]") ? "garden" : "library";
      const name = `Notepad ${suffix}`, folder = `notepad-${suffix}`;
      const row = slug => frame.locator(`[data-folderpath="physics/${slug ? slug + '/' : ''}index"]`);
      await row("persisted").waitFor({ state: "visible", timeout: 5000 });
      await row("").getByRole("button", { name: "New sub-folder", exact: true }).click();
      await frame.getByLabel("Folder name", { exact: true }).fill(name);
      const start = performance.now();
      await frame.getByRole("button", { name: "Create folder", exact: true }).click();
      await frame.getByRole("dialog").waitFor({ state: "hidden" });
      await row(folder).waitFor({ state: "visible" });
      assert.ok(performance.now() - start < 2500, "Save and visible confirmation are prompt even with a stalled build");
      assert.ok(fs.statSync(path.join(app.content, "physics", folder)).isDirectory());
      assert.equal(await row(folder).getByRole("link").count(), 1, "Unpublished folders open their saved folder page");
      await row(folder).getByRole("button", { name: "New sub-folder", exact: true }).click();
      await frame.getByLabel("Folder name", { exact: true }).fill("Child");
      await frame.getByRole("button", { name: "Create folder", exact: true }).click();
      await row(`${folder}/child`).waitFor({ state: "visible" });
      let releaseFolders;
      const heldFolders = new Promise(resolve => { releaseFolders = resolve; });
      await page.route('**/api/folders?*', async route => { await heldFolders; await route.continue(); });
      await page.reload();
      await row(`${folder}/child`).waitFor({ state: "visible", timeout: 1000 });
      assert.equal(await row(folder).getByRole('link').count(), 1, 'Custom folders are usable before the next folder scan finishes');
      releaseFolders();
      await page.unroute('**/api/folders?*');
      assert.equal(await row(folder).count(), 1, "Snapshot updates do not duplicate the tree");
      // Collapsed descendants are populated lazily; expand before checking
      // that canonical disk paths merge into the existing Quartz section.
      await row("learning").locator(".folder-icon").dispatchEvent("click");
      await row("learning/1.-Fields-and-Space").waitFor({ state: "visible" });
      assert.equal(await row("learning/1.-Fields-and-Space").count(), 1);
      assert.equal(await row("learning/1. Fields and Space").count(), 0,
        "Canonical disk names merge into their existing Quartz slugs");
      assert.equal(await frame.locator(".overflow-end").count(), 1);
      // Both embedding hosts use the real shared bridge for copy and rename.
      const learning = row("learning");
      assert.equal(await learning.getByRole("button", { name: "Rename folder", exact: true }).isDisabled(), true);
      await learning.getByRole("button", { name: "Copy folder", exact: true }).click();
      await frame.getByRole("dialog").waitFor({ state: "hidden" });
      // The first host's renamed copy no longer reserves learning-copy.
      const copied = row("learning-copy");
      await copied.waitFor({ state: "visible" });
      assert.match(await copied.textContent(), /Learning copy/);
      assert.equal(await copied.getByRole("button", { name: "Rename folder", exact: true }).isEnabled(), true);
      await copied.getByRole("button", { name: "Rename folder", exact: true }).click();
      await frame.getByLabel("Folder name", { exact: true }).fill(`Revision ${suffix}`);
      await frame.getByRole("button", { name: "Save name", exact: true }).click();
      await frame.getByRole("dialog").waitFor({ state: "hidden" });
      await row(`revision-${suffix}`).waitFor({ state: "visible" });
      assert.equal(await copied.count(), 0, "Old folder disappears even before Quartz rebuilds");
      await page.reload();
      await row(`revision-${suffix}`).waitFor({ state: "visible" });
      assert.equal(await learning.getByRole("button", { name: "Rename folder", exact: true }).isDisabled(), true);
      await row("published-folder").getByRole("button", { name: "Rename folder", exact: true }).click();
      await frame.getByLabel("Folder name", { exact: true }).fill(`Published ${suffix}`);
      await frame.getByRole("button", { name: "Save name", exact: true }).click();
      await row(`published-${suffix}`).waitFor({ state: "visible" });
      await page.reload();
      await row(`published-${suffix}`).waitFor({ state: "visible" });
      assert.equal(await row("published-folder").count(), 0, "Reload suppresses stale published folder paths after rename");
      // A missing bridge response must release the dialog and allow a retry.
      await page.route("**/api/folders", route => route.abort());
      await row("").getByRole("button", { name: "New sub-folder", exact: true }).click();
      await frame.getByLabel("Folder name", { exact: true }).fill("Retry folder");
      await frame.getByRole("button", { name: "Create folder", exact: true }).click();
      await frame.getByRole("alert").getByText("Could not confirm folder creation.", { exact: false }).waitFor();
      assert.equal(await frame.getByRole("button", { name: "Create folder", exact: true }).isEnabled(), true);
      await frame.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.unroute("**/api/folders");
      app.state.busy = true;
      await row("").getByRole("button", { name: "New sub-folder", exact: true }).click();
      await frame.getByLabel("Folder name", { exact: true }).fill(`Busy ${suffix}`);
      await frame.getByRole("button", { name: "Create folder", exact: true }).click();
      await frame.getByRole("button", { name: "Waiting...", exact: true }).waitFor();
      app.state.busy = false;
      await row(`busy-${suffix}`).waitFor({ state: "visible" });
      // If the embedding host never responds, the iframe's own deadline ends
      // both Creating and retry timers instead of trapping the user forever.
      await page.evaluate(() => { window.ignoreFolderCreates = true; });
      await frame.locator("body").evaluate(element => {
        const win = element.ownerDocument.defaultView;
        const setTimeout = win.setTimeout.bind(win);
        win.setTimeout = (callback, delay, ...args) => setTimeout(callback, delay === 30_000 ? 100 : delay, ...args);
      });
      await row("").getByRole("button", { name: "New sub-folder", exact: true }).click();
      await frame.getByLabel("Folder name", { exact: true }).fill("Missing response");
      await frame.getByRole("button", { name: "Create folder", exact: true }).click();
      await page.waitForFunction(() => window.blockedFolderRequests === 1);
      await frame.getByRole("alert").getByText("Could not confirm folder creation.", { exact: false }).waitFor({ timeout: 3000 });
      assert.equal(await frame.getByRole("button", { name: "Create folder", exact: true }).isEnabled(), true);
      assert.deepEqual(errors, []);
      await browser.close(); browser = null;
      await new Promise(resolve => server.close(resolve)); server = null;
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    app.close();
  }
});
