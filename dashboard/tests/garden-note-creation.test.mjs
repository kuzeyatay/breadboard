import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-note-"));
  const content = path.join(dir, "content");
  for (const folder of ["notes", "notepad"]) fs.mkdirSync(path.join(content, "physics", folder), { recursive: true });
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = path.toNamespacedPath(content);
  const state = { allowed: true, busy: false, leased: false, publications: 0, failPublication: false };
  globalThis.__noteFixture = state;
  const stubs = {
    "next/server": "export const NextResponse=Response;",
    "@/lib/server-auth": `export async function requireOwnedClusterFromSlug(slug){
      if(!globalThis.__noteFixture.allowed || slug!=='physics') throw Object.assign(Error('Forbidden'),{status:403});
      return {cluster:{slug,id:1},userId:7};
    } export const requireReadableClusterFromSlug=requireOwnedClusterFromSlug;
    export const routeErrorResponse=e=>Response.json({error:e.message},{status:e.status||500});`,
    "./knowledge.ts": `export const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      export const normalizeTopicTags=tags=>tags;export const refreshClusterIndex=()=>{};export const walkClusterMarkdown=()=>[];`,
    "@/lib/knowledge": "export const listClusterFolders=()=>[];export const scanClusterKnowledge=()=>({nodes:[],edges:[],stats:{}});",
    "./quartz-publish.ts": `export async function publishQuartzAfterMutation(){
      const state=globalThis.__noteFixture;assertReleased();state.publications++;
      if(state.failPublication) throw Error('Static build failed');return new Promise(()=>{});
    } function assertReleased(){if(globalThis.__noteFixture.leased)throw Error('Publish holds the lease');}`,
    "./garden-mutation-lease.ts": `export async function withGardenMutationLease(dir,operation,action){
      const state=globalThis.__noteFixture;if(state.busy)throw Object.assign(Error('Garden busy'),{status:409});
      state.leased=true;try{return await action()}finally{state.leased=false}
    }`,
    "./garden-revision.ts": "export const applyGardenRevision=()=>{};",
    "./hermes/route-core.ts": "export class ApiError extends Error{}",
  };
  const result = await build({ entryPoints: [path.join(root, "src/app/api/documents/route.ts")],
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "note-fixture", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => stubs[args.path] === undefined ? undefined : { path: args.path, namespace: "fixture" });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "ts" }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return { ...module.exports, content, state, close() {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = previous;
    delete globalThis.__noteFixture;
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}

const request = (overrides = {}) => new Request("http://localhost/api/documents", {
  method: "POST", body: JSON.stringify({ clusterSlug: "physics", title: "My note", content: "# Electric fields\n\nSaved text.", folder: "notes", ...overrides }),
});
const promptly = promise => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(Error("Note save waited for publication")), 1500); timer.unref();
})]);

test("Markdown API confirms persistence during stalled/failed publication and enforces ownership and write failures", async () => {
  const app = await fixture();
  try {
    const response = await promptly(app.POST(request()));
    assert.equal(response.status, 200);
    const note = await response.json();
    assert.equal(note.success, true);
    assert.match(fs.readFileSync(path.join(app.content, "physics", note.relPath), "utf8"), /# Electric fields\n\nSaved text\./);
    assert.equal(app.state.leased, false);
    assert.equal(app.state.publications, 1);
    app.state.failPublication = true;
    const failedBuild = await promptly(app.POST(request({ title: "Another note", folder: "" })));
    assert.equal(failedBuild.status, 200);
    assert.ok(fs.existsSync(path.join(app.content, "physics", (await failedBuild.json()).relPath)));
    app.state.busy = true;
    assert.equal((await app.POST(request())).status, 409);
    app.state.busy = false;
    fs.writeFileSync(path.join(app.content, "physics/occupied"), "Existing content");
    const published = app.state.publications;
    assert.equal((await app.POST(request({ folder: "occupied" }))).status, 500);
    assert.equal(app.state.publications, published);
    assert.equal((await app.POST(request({ title: "" }))).status, 400);
    app.state.allowed = false;
    assert.equal((await app.POST(request())).status, 403);
  } finally { app.close(); }
});

test("New note dialog closes after saving; notes, notepad and Markdown persist in the Explorer across reloads", async () => {
  const app = await fixture();
  const saved = [];
  let server, browser;
  try {
    const explorer = await build({ entryPoints: [path.join(root, "../quartz/quartz/components/scripts/explorer.inline.ts")], bundle: true, write: false, platform: "browser", format: "iife" });
    const host = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
      import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';
      import NewNoteButton from './src/app/components/new-note-button';
      import {useCanonicalGardenFolders} from './src/app/garden/use-canonical-garden-folders';
      function App(){const iframeRef=useRef(null);useCanonicalGardenFolders(iframeRef,location.origin,'physics');
        return <><NewNoteButton clusterSlug='physics'/><iframe ref={iframeRef} src='/garden' style={{width:'100%',height:750}}/></>;
      }createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: "iife", platform: "browser" });
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        if (["/host.js", "/explorer.js"].includes(url.pathname)) {
          res.setHeader("content-type", "text/javascript");res.end((url.pathname === "/host.js" ? host : explorer).outputFiles[0].text);return;
        }
        if (url.pathname === "/api/folders") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ folders: ["notes", "notepad"].map(folder => ({ folder, name: folder })) }));return;
        }
        if (url.pathname === "/api/documents") {
          res.setHeader("content-type", "application/json");
          if (req.method === "GET") { res.end(JSON.stringify({ documents: saved }));return; }
          let body = "";for await (const chunk of req) body += chunk;
          const response = await app.POST(new Request(url, { method: "POST", body }));
          const json = await response.json();
          if (response.ok) saved.push({ ...json, title: JSON.parse(body).title });
          res.writeHead(response.status);res.end(JSON.stringify(json));return;
        }
        res.setHeader("content-type", "text/html");
        if (url.pathname !== "/garden") { res.end('<div id="root"></div><script src="/host.js"></script>');return; }
        res.end(`<style>[hidden]{display:none!important}.folder-outer{display:none}.folder-outer.open{display:block}.folder-title{pointer-events:none}</style>
          <div class="explorer" data-behavior="link" data-collapsed="collapsed" data-savestate="true" data-graph-clusters='["physics"]' data-garden-scope="private">
          <ul class="explorer-ul"><li class="overflow-end"></li></ul></div>
          <template id="template-folder"><li><div class="folder-container"><svg class="folder-icon"></svg><div><button class="folder-button"><span class="folder-title"></span></button></div></div><div class="folder-outer"><ul></ul></div></li></template>
          <template id="template-file"><li><a></a></li></template>
          <script>window.addCleanup=()=>{};window.fetchData=Promise.resolve({'physics/index':{slug:'physics/index',filePath:'physics/_index.md',title:'Physics',links:[],tags:[],content:''}});</script>
          <script src="/explorer.js"></script><script>document.dispatchEvent(new CustomEvent('nav',{detail:{url:'physics/index'}}))</script>`);
      } catch (error) { res.statusCode = 500;res.end(error.message); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = [];page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const frame = page.frameLocator("iframe");
    for (const folder of ["notes", "notepad"]) await frame.locator(`[data-folderpath="physics/${folder}/index"]`).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("EM introduction");
    await page.getByPlaceholder("Write your markdown here…").fill("# My notes\n\nA saved Markdown note.");
    await page.getByRole("dialog").getByRole("combobox").selectOption("notes");
    const start = performance.now();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await frame.getByText("EM introduction", { exact: true }).waitFor({ state: "visible" });
    assert.ok(performance.now() - start < 2500);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].folder, "notes");
    assert.match(fs.readFileSync(path.join(app.content, "physics", saved[0].relPath), "utf8"), /A saved Markdown note/);
    assert.equal(await frame.getByText("EM introduction", { exact: true }).getAttribute("href"), null, "Unpublished notes do not lead to a 404");
    await page.reload();
    await frame.getByText("EM introduction", { exact: true }).waitFor({ state: "visible" });
    for (const folder of ["notes", "notepad"]) assert.equal(await frame.locator(`[data-folderpath="physics/${folder}/index"]`).count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    app.close();
  }
});
