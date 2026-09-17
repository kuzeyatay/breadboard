import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { PDFDocument } from "@cantoo/pdf-lib";

test("Back leaves the real PDF viewer while saves and retries continue, and reopening keeps edits", { timeout: 90_000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pdf = await PDFDocument.create();
  const pdfPage = pdf.addPage([400, 300]);
  const field = pdf.getForm().createTextField("Name");
  field.setText("Original");
  field.addToPage(pdfPage, { x: 30, y: 180, width: 300, height: 35 });
  let savedBytes = await pdf.save();
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import Viewer from './src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client';
      import Status from './src/app/components/pdf-save-status';
      import Gate from './src/app/components/interaction-hydration-gate';
      window.router={push(){window.leave()},back(){window.leave()},refresh(){}};
      function App(){const [open,setOpen]=useState(true);window.leave=()=>setOpen(false);
        return <><Status/>{open ? <Viewer clusterSlug="demo" documentSlug="paper" title="Paper" showNavbarFlowers={false}/>
        : <button onClick={()=>setOpen(true)}>Reopen PDF</button>}</>;}
      createRoot(document.getElementById('root')).render(<Gate><App/></Gate>);
    ` }, bundle: true, write: false, outfile: "bundle.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "surrounding-controls", setup(builder) {
      const stubs = {
        "next/navigation": "export const useRouter=()=>window.router;",
        "next/link": "export default function Link({children,...props}){return <a {...props}>{children}</a>}",
        "@/app/components/navigation-progress": "export const startNavigationProgress=()=>{};",
        "@/app/components/fastread-reader": "export default function Reader(){return null}",
        "@/app/components/breadboard-loader": "export default function Loader(){return null}",
        "@/app/components/navbar-flower-wind": "export default function Flowers(){return null}",
        "@/app/components/pdf-tools-panel": "export default function Tools(){return null}",
        "@/app/components/pdf-assistant": "export default function Assistant(){return null}",
        "@/app/components/hermes/artifact-ai-edit": "export const queueArtifactAiEdit=()=>{};",
        "@/lib/pdf-tools": "export const stampImage=()=>{};",
        "@/lib/fastread-source": "export const fetchFastReadNote=()=>{};export const pdfTextToMarkdown=()=>'';",
      };
      builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
  const uploads = [], requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/bundle.js") {
      response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find(f => f.path.endsWith(".js")).text); return;
    }
    if (url.pathname.startsWith("/api/pdfjs/")) {
      const name = path.basename(url.pathname);
      if (name === "pdf.mjs") {
        response.setHeader("content-type", "text/javascript");
        response.end(`export * from '/api/pdfjs/pdf-real.mjs';import {getDocument as load} from '/api/pdfjs/pdf-real.mjs';
          export function getDocument(options){const task=load(options);task.promise.then(doc=>{
            const getPage=doc.getPage.bind(doc);doc.getPage=async(...args)=>{
              const page=await getPage(...args);const render=page.render.bind(page);
              page.render=(...args)=>{const task=render(...args);const painted=task.promise.then(()=>{
                if(!window.initialPaintReleased)return new Promise(resolve=>{window.finishInitialPaint=()=>{window.initialPaintReleased=true;resolve()}});
              });return new Proxy(task,{get(target,key){if(key==='promise')return painted;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
              return page;
            };
            const save=doc.saveDocument.bind(doc);doc.saveDocument=()=>{const bytes=save();
              return window.holdSerialization ? bytes.then(data=>new Promise(resolve=>{window.finishSerialize=()=>resolve(data)})) : bytes;};
          });return task;}`); return;
      }
      const relative = name === "pdf-real.mjs" ? "build/pdf.mjs" : name === "pdf.worker.mjs" ? "build/pdf.worker.mjs" : `web/${name}`;
      const asset = path.join(root, "node_modules/pdfjs-dist", relative);
      if (existsSync(asset)) { response.setHeader("content-type", name.endsWith(".css") ? "text/css" : "text/javascript"); response.end(readFileSync(asset)); return; }
      response.writeHead(404); response.end(); return;
    }
    if (url.pathname.endsWith("/history")) { response.end('{"count":0}'); return; }
    if (url.pathname === "/api/documents/paper/source-pdf") {
      if (request.method === "PUT") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        uploads.push(Buffer.concat(chunks)); requests.push(response); return;
      }
      response.setHeader("content-type", "application/pdf"); response.end(savedBytes); return;
    }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><style>
      body{margin:0}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.hidden{display:none}
      #viewerContainer{position:absolute;inset:0;overflow:auto;height:500px;width:100vw}
      .pdfViewer{position:relative}.fixed{position:fixed;bottom:5px;left:5px;z-index:10000;background:white}
    </style><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => { window.process = { env: {} }; });
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const waitUploads = async count => {
    const deadline = Date.now() + 10_000;
    while (uploads.length < count) { assert.ok(Date.now() < deadline, `Expected ${count} uploads, got ${uploads.length}`); await delay(20); }
  };
  const accept = index => { savedBytes = uploads[index]; requests[index].end("{}"); };
  const textIn = async bytes => (await PDFDocument.load(bytes)).getForm().getTextField("Name").getText();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.finishInitialPaint)).catch(async error => {
    throw new Error(`${error.message}\nPage: ${await page.locator('body').innerText()}\nBrowser errors: ${errors.join('; ')}`);
  });
  assert.equal(await page.locator('html').getAttribute('data-breadboard-startup'), 'loading', 'PDF controls alone do not finish startup');
  await page.evaluate(() => window.finishInitialPaint());
  await page.waitForFunction(() => document.documentElement.dataset.breadboardStartup === 'ready');
  const input = page.locator('.textWidgetAnnotation input');
  await input.waitFor().catch(async error => {
    throw new Error(`${error.message}\nPage: ${await page.locator('body').innerText()}\nBrowser errors: ${errors.join('; ')}`);
  });
  assert.equal(await input.inputValue(), "Original");
  await input.click();
  await delay(120);
  assert.equal(uploads.length, 0, "clicking an unchanged PDF must not upload it");
  await input.fill("First edit");
  await input.press("Tab");
  await waitUploads(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Reopen PDF" }).waitFor();
  assert.equal(requests[0].writableEnded, false, "Back must not wait for the upload");
  await page.getByRole("button", { name: "Reopen PDF" }).click();
  await input.waitFor();
  assert.equal(await input.inputValue(), "First edit", "reopen must use pending bytes");
  await input.fill("Second edit");
  await input.press("Tab");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Reopen PDF" }).waitFor();
  accept(0);
  await waitUploads(2);
  assert.equal(await textIn(uploads[1]), "Second edit");
  requests[1].writeHead(409, { "content-type": "application/json" });
  requests[1].end(JSON.stringify({ code: "GARDEN_MUTATION_BUSY", retryable: true, retryAfterMs: 20 }));
  await waitUploads(3);
  assert.equal(await textIn(uploads[2]), "Second edit");
  requests[2].writeHead(500, { "content-type": "application/json" }); requests[2].end('{"error":"Temporary failure"}');
  await page.getByRole("button", { name: "Retry saving" }).click();
  await waitUploads(4);
  accept(3);
  await page.getByRole("button", { name: "Reopen PDF" }).click();
  await input.waitFor();
  assert.equal(await input.inputValue(), "Second edit");
  await page.evaluate(() => { window.holdSerialization = true; });
  await input.fill("Last edit");
  await input.press("Tab");
  await page.waitForFunction(() => Boolean(window.finishSerialize));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Reopen PDF" }).waitFor();
  assert.equal(uploads.length, 4, "navigation also works while serialization is pending");
  await page.evaluate(() => { window.finishSerialize(); });
  await waitUploads(5);
  assert.equal(await textIn(uploads[4]), "Last edit");
  accept(4);
  await page.waitForFunction(() => !document.body.textContent.includes("in the background"));
  assert.deepEqual(errors, []);
});
