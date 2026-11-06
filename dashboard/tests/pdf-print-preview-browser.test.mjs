import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test("PDF Print and Ctrl+P preview saved pages before printing; navigation, zoom, cancel and retry work", { timeout: 90_000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pdf = await PDFDocument.create();
  for (let page = 1; page <= 13; page++) {
    const sheet = pdf.addPage([595, 842]);
    sheet.drawText(`Circuit cards - page ${page}`, { x: 40, y: 760, size: 24 });
    if (page === 2) sheet.setRotation(degrees(90));
  }
  const field = pdf.getForm().createTextField("Note");
  field.setText("Original annotation");
  field.addToPage(pdf.getPage(0), { x: 40, y: 650, width: 400, height: 40 });
  let bytes = await pdf.save();
  let printed = null;
  const bundle = await build({
    bundle: true, write: false, outfile: "bundle.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Viewer from './src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client';
      createRoot(document.getElementById('root')).render(<Viewer clusterSlug="demo" documentSlug="paper" title="EC2 circuit cards" showNavbarFlowers={false}/>);
    ` },
    plugins: [{ name: "surrounding-controls", setup(builder) {
      const stubs = {
        "next/navigation": "export const useRouter=()=>({back(){},push(){},refresh(){}});",
        "next/link": "export default function Link({children,...props}){return <a {...props}>{children}</a>}",
        "@/app/components/navigation-progress": "export const startNavigationProgress=()=>{};",
        "@/app/components/startup-readiness": "export const useStartupLoading=()=>{};",
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
  const css = (await postcss([tailwind({ base: root })]).process(
    '@import "tailwindcss" source(none); @source "../src/app/gardens";',
    { from: path.join(root, "tests/pdf-print-fixture.css") },
  )).css + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/bundle.js") {
      response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); return;
    }
    if (url.pathname === "/printed" || url.pathname === "/api/documents/paper/source-pdf") {
      if (request.method === "PUT") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        if (url.pathname === "/printed") printed = Buffer.concat(chunks);
        else bytes = Buffer.concat(chunks);
        response.setHeader("content-type", "application/json"); response.end("{}"); return;
      }
      response.setHeader("content-type", "application/pdf"); response.end(bytes); return;
    }
    if (url.pathname.startsWith("/api/pdfjs/")) {
      const name = path.basename(url.pathname);
      if (name === "pdf.mjs") {
        // Exercise failure recovery with the real PDF.js parser/worker otherwise.
        response.setHeader("content-type", "text/javascript");
        response.end(`export * from './pdf-real.mjs'; import * as real from './pdf-real.mjs';
          export function getDocument(options) {
            if (window.failPreview && options.data) { window.failPreview=false; return {promise:Promise.reject(new Error('Preview test failure')),destroy:async()=>{}}; }
            const task=real.getDocument(options); task.promise.then(doc=>{if(options.data) window.previewBytes=options.data.byteLength;
              const getPage=doc.getPage.bind(doc);doc.getPage=async(...args)=>{const page=await getPage(...args);
                if(!page.printObserved){page.printObserved=true;const render=page.render.bind(page);page.render=(options)=>{
                  if(options.intent==='print') window.printRenderCount=(window.printRenderCount||0)+1; return render(options);};}return page;};
            }).catch(()=>{}); return task;
          }`); return;
      }
      const relative = name === "pdf-real.mjs" ? "build/pdf.mjs" : name === "pdf.worker.mjs" ? "build/pdf.worker.mjs" : `web/${name}`;
      const asset = path.join(root, "node_modules/pdfjs-dist", relative);
      if (existsSync(asset)) {
        response.setHeader("content-type", name.endsWith(".css") ? "text/css" : "text/javascript"); response.end(readFileSync(asset)); return;
      }
      response.writeHead(404); response.end(); return;
    }
    if (url.pathname.startsWith("/api/")) { response.setHeader("content-type", "application/json"); response.end('{"count":0}'); return; }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><style>${css}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.process = { env: {} };
    window.printCalls = 0;
    // Stop at the OS printing boundary: never spend ink during an automated test.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { get() {
      if (this.getAttribute("aria-hidden") !== "true") return descriptor.get.call(this);
      const frame = this;
      return { focus() {}, print() {
        if (window.failPrint) { window.failPrint = false; throw new Error("Printer test failure"); }
        window.printCalls++;
        void fetch(frame.src).then(response => response.arrayBuffer()).then(body => fetch("/printed", { method: "PUT", body }));
      } };
    } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const print = page.getByRole("button", { name: "Print", exact: true });
  await expect(print).toBeEnabled();
  const annotation = page.locator('.annotationLayer input[type="text"]');
  await expect(annotation).toBeVisible();
  await annotation.fill("Edited annotation for printing");
  await print.click();
  const dialog = page.getByRole("dialog", { name: "Print preview" });
  const proceed = dialog.getByRole("button", { name: "Continue to print" });
  await expect(proceed).toBeEnabled();
  await expect(dialog.getByRole("img", { name: "Print preview, page 1 of 13" })).toBeVisible();
  assert.equal(await page.evaluate(() => window.printCalls), 0, "opening the preview never prints");
  assert.equal(await page.evaluate(() => window.printRenderCount), 1, "only the visible page is rendered with print intent");
  await dialog.getByRole("button", { name: "Next page", exact: true }).click();
  const landscape = dialog.getByRole("img", { name: "Print preview, page 2 of 13" });
  await expect(landscape).toBeVisible();
  const bounds = await landscape.boundingBox();
  assert.ok(bounds.width > bounds.height, "rotated page keeps its printed orientation");
  const number = dialog.getByRole("textbox", { name: "Preview page number" });
  await number.fill("13"); await number.press("Enter");
  await expect(dialog.getByRole("img", { name: "Print preview, page 13 of 13" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await number.fill("999"); await number.press("Enter"); await expect(number).toHaveValue("13");
  await dialog.getByRole("combobox", { name: "Preview zoom" }).selectOption("2");
  await expect(proceed).toBeEnabled();
  assert.equal(await dialog.locator("canvas").count(), 1);
  await dialog.getByRole("combobox", { name: "Preview zoom" }).selectOption("fit");
  await number.fill("1"); await number.press("Enter");
  await expect(proceed).toBeEnabled();
  await page.keyboard.press("Control+f");
  assert.equal(await page.getByPlaceholder("Find in PDF").evaluate(input => input === document.activeElement), false);
  if (process.env.BB_PRINT_PREVIEW_SCREENSHOT) await page.screenshot({ path: process.env.BB_PRINT_PREVIEW_SCREENSHOT });
  await page.evaluate(() => { window.failPrint = true; });
  await proceed.click();
  await expect(dialog.getByRole("alert")).toContainText("Printer test failure");
  await proceed.click();
  await expect.poll(() => printed !== null).toBe(true);
  const delivered = await PDFDocument.load(printed);
  assert.equal(delivered.getPageCount(), 13);
  assert.equal(delivered.getForm().getTextField("Note").getText(), "Edited annotation for printing");
  await expect(proceed).toBeEnabled();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(print).toBeFocused();
  await page.keyboard.press("Control+p"); await expect(proceed).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.printCalls), 1, "cancel and keyboard preview do not print");
  await page.evaluate(() => { window.failPreview = true; });
  await print.click();
  await expect(dialog.getByRole("alert")).toContainText("Preview test failure");
  await expect(proceed).toBeDisabled();
  await dialog.getByRole("button", { name: "Retry preview" }).click();
  await expect(proceed).toBeEnabled();
  await page.setViewportSize({ width: 480, height: 700 });
  await expect(proceed).toBeEnabled();
  const small = await dialog.boundingBox();
  assert.ok(small.x >= 0 && small.y >= 0 && small.x + small.width <= 480 && small.y + small.height <= 700);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(errors, []);
});
