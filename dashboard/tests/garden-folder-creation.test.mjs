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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-folder-"));
  const content = path.join(dir, "content");
  fs.mkdirSync(path.join(content, "physics"), { recursive: true });
  const previous = process.env.QUARTZ_CONTENT_PATH;
  // Exercise the same extended Windows paths used by the desktop runtime.
  process.env.QUARTZ_CONTENT_PATH = path.toNamespacedPath(content);
  const state = { allowed: true, busy: false, leased: false, publishes: 0 };
  globalThis.__folderFixture = state;
  const normalization = fs.readFileSync(path.join(root, "src/lib/garden-documents.ts"), "utf8")
    .match(/export function normalizeGardenFolder\(value: unknown\): string \{[\s\S]*?\n\}/)[0];
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/server-auth": `export async function requireOwnedClusterFromSlug(slug) {
      if (!globalThis.__folderFixture.allowed || slug !== 'physics') throw Error('Forbidden');
      return {cluster:{slug,id:1},userId:7};
    } export const routeErrorResponse=e=>Response.json({error:e.message},{status:403});`,
    "./db.ts": "export default {};",
    "./runtime-paths.ts": "export const dashboardDataDir=()=>'';",
    "./knowledge.ts": `export const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      export const refreshClusterIndex=()=>{throw Error('Empty folder scanned every note')};
      export const walkClusterMarkdown=()=>[];`,
    "./garden-documents.ts": `import {slugify} from './knowledge.ts'; ${normalization}`,
    "./quartz-publish.ts": `export async function publishQuartzAfterMutation(){
      const state=globalThis.__folderFixture;
      if(state.leased) throw Error('Publication holds mutation lease');
      state.publishes++; return new Promise(()=>{});
    }`,
    "./garden-mutation-recovery.ts": `export function acquireGardenMutationLeaseWithIngestionRecovery(){
      const state=globalThis.__folderFixture;
      if(state.busy) throw Object.assign(Error('Garden busy'),{code:'garden_busy',status:409});
      state.leased=true;return {release(){state.leased=false}};
    }`,
    "@/lib/garden-mutation-lease": "export const isGardenMutationBusyError=e=>e.code==='garden_busy';",
  };
  const bundle = await build({
    entryPoints: [path.join(root, "src/app/api/folders/route.ts")],
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "folder-fixture", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => stubs[args.path] === undefined ? undefined : { path: args.path, namespace: "fixture" });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "ts" }));
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
      assert.equal(await row(folder).getByRole("link").count(), 0, "Unpublished folders do not navigate to a 404");
      await row(folder).getByRole("button", { name: "New sub-folder", exact: true }).click();
      await frame.getByLabel("Folder name", { exact: true }).fill("Child");
      await frame.getByRole("button", { name: "Create folder", exact: true }).click();
      await row(`${folder}/child`).waitFor({ state: "visible" });
      await page.reload();
      await row(`${folder}/child`).waitFor({ state: "visible" });
      assert.equal(await row(folder).count(), 1, "Snapshot updates do not duplicate the tree");
      assert.equal(await row("learning/1.-Fields-and-Space").count(), 1);
      assert.equal(await row("learning/1. Fields and Space").count(), 0,
        "Canonical disk names merge into their existing Quartz slugs");
      assert.equal(await frame.locator(".overflow-end").count(), 1);
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
