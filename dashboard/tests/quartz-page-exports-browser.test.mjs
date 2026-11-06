import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { installCanonicalQuartzReader } from "../scripts/quartz-canonical-reader-bridge.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = "---\ntitle: Fields\n---\n# Fields\n\n**Scalar** and $F_i(x)$.\n\n```ts\nconst x = 1\n```\n";

test("bottom page actions copy source, download Markdown and export a PDF after saving", async () => {
  const { compile } = createRequire(new URL("../../quartz/package.json", import.meta.url))("sass");
  const understandingStyle = compile(path.join(root, "../quartz/quartz/components/styles/pageUnderstanding.scss")).css;
  const footer = await build({ entryPoints: [path.join(root, "../quartz/quartz/components/scripts/pageExports.inline.ts")],
    bundle: true, write: false, format: "iife", platform: "browser" });
  const host = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
    import React,{useRef}from'react';import{createRoot}from'react-dom/client';
    import Bridge from './src/app/garden/garden-document-editor-bridge';
    function App(){const ref=useRef(null);return <><iframe ref={ref} src="http://localhost:53159/demo/notes/fields" title="Note" style={{width:'100%',height:'900px',border:0}}/><Bridge iframeRef={ref} quartzOrigin="http://localhost:53159"/></>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": path.join(root, "src") } });
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(value => value && fs.existsSync(value));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let content = source, failRead = false, failPdf = false, reads = 0, pdfs = 0;
    await page.route("http://localhost:53158/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/documents/")) {
        reads++;
        assert.equal(decodeURIComponent(url.pathname), "/api/documents/notes/fields");
        assert.equal(url.searchParams.get("clusterSlug"), "demo");
        return route.fulfill(failRead ? { status: 500, json: { error: "Cannot read the note. Try again." } } :
          { json: { success: true, content, fileName: "Fields.md", title: "Fields", folderTitle: "Notes", sourceSlug: "demo/notes/fields" } });
      }
      if (url.pathname === "/api/markdown-to-pdf") {
        pdfs++;
        assert.deepEqual(route.request().postDataJSON(), { clusterSlug: "demo", slug: "demo/notes/fields", fileName: "Fields.md", content, title: "Fields", folderTitle: "Notes" });
        return route.fulfill(failPdf ? { status: 500, json: { error: "PDF export unavailable. Try again." } } :
          { contentType: "application/pdf", body: "%PDF-1.7\nfixture\n%%EOF", headers: { "Content-Disposition": "attachment; filename=fields.pdf; filename*=UTF-8''Fields%20notes.pdf" } });
      }
      return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${host.outputFiles[0].text}</script>` });
    });
    await page.route("http://localhost:53159/**", route => route.fulfill({ contentType: "text/html", body: `
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
      :root{--light:#e7f0e6;--secondary:#496f68;--lightgray:#acc5b6;--darkgray:#333;--highlight:#d6e5d7}body{background:var(--light);font:16px system-ui;margin:30px}article{min-height:200px}
      ${understandingStyle}
      </style><script>(${installCanonicalQuartzReader.toString()})();</script></head><body data-slug="demo/notes/fields">
      <h1>Fields</h1><div class="markdown-actions" data-note-slug="demo/notes/fields"></div>
      <article class="popover-hint"><h2>Scalar fields</h2><p>Rendered content is intentionally different from Markdown.</p><div class="bb-page-understanding"><label><input type="checkbox"> I understand this</label></div></article>
      <script>window.copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}});</script>
      <script>${footer.outputFiles[0].text}</script><script>document.dispatchEvent(new Event('nav'))</script></body></html>` }));
    await page.goto("http://localhost:53158/");
    const frame = page.frameLocator('iframe[title="Note"]');
    const buttons = frame.getByRole("group", { name: "Copy or download this page" });
    await buttons.waitFor();
    assert.equal(await buttons.locator("button").count(), 3);
    assert.equal(await buttons.evaluate(element => element.parentElement.matches(".bb-page-understanding")), true);
    await frame.getByRole("button", { name: "Copy Markdown", exact: true }).click();
    await frame.getByRole("status").filter({ hasText: "Markdown copied." }).waitFor();
    assert.deepEqual(await frame.locator("body").evaluate(() => window.copied), [source]);

    // The iframe saves edits before asking the authenticated host to export.
    content = source + "\nLatest saved edit.\n";
    await frame.locator("body").evaluate(() => { window.flushes = 0; window.__quartzDocumentEditor = { flush: async () => { window.flushes++; } }; });
    let downloaded = page.waitForEvent("download");
    await frame.getByRole("button", { name: "Download .md", exact: true }).click();
    const markdown = await downloaded;
    assert.equal(markdown.suggestedFilename(), "Fields.md");
    assert.equal(fs.readFileSync(await markdown.path(), "utf8"), content);
    assert.equal(await frame.locator("body").evaluate(() => window.flushes), 1);
    await frame.getByRole("status").filter({ hasText: "Markdown download started." }).waitFor();

    downloaded = page.waitForEvent("download");
    await frame.getByRole("button", { name: "Download PDF", exact: true }).click();
    const pdf = await downloaded;
    assert.equal(pdf.suggestedFilename(), "Fields notes.pdf");
    assert.match(fs.readFileSync(await pdf.path(), "utf8"), /^%PDF-/);
    await frame.getByRole("status").filter({ hasText: "PDF download started." }).waitFor();
    assert.equal(pdfs, 1);

    // An article refresh keeps exactly one footer and binds its buttons once.
    await page.evaluate(() => document.querySelector("iframe").contentWindow.postMessage({
      type: "second-brain:canonical-document", slug: "demo/notes/fields", html: "<h2>Refreshed fields</h2><p>New content</p>",
    }, "http://localhost:53159"));
    await frame.getByText("Refreshed fields", { exact: true }).waitFor();
    assert.equal(await buttons.count(), 1);
    const before = reads;
    await frame.getByRole("button", { name: "Copy Markdown", exact: true }).click();
    await frame.getByRole("status").filter({ hasText: "Markdown copied." }).waitFor();
    assert.equal(reads, before + 1);

    failRead = true;
    await frame.getByRole("button", { name: "Copy Markdown", exact: true }).click();
    await frame.getByRole("status").filter({ hasText: "Cannot read the note." }).waitFor();
    assert.equal(await buttons.locator("button:disabled").count(), 0);
    failRead = false; failPdf = true;
    await frame.getByRole("button", { name: "Download PDF", exact: true }).click();
    await frame.getByRole("status").filter({ hasText: "PDF export unavailable." }).waitFor();
    assert.equal(await buttons.locator("button:disabled").count(), 0);
    failPdf = false;

    // Desktop exports use the acknowledged native save path.
    await page.evaluate(() => { window.breadboardDesktop = { savePdfDownload: async request => { window.pdfSaved = request; return { ok: true, filename: "Fields notes (1).pdf" }; } }; });
    await frame.getByRole("button", { name: "Download PDF", exact: true }).click();
    await frame.getByRole("status").filter({ hasText: "Saved to Downloads: Fields notes (1).pdf" }).waitFor();
    assert.equal(await page.evaluate(() => new TextDecoder().decode(window.pdfSaved.data)), "%PDF-1.7\nfixture\n%%EOF");

    // Clipboard fallback works in an iframe without delegated clipboard access.
    await frame.locator("body").evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new Error("Permission denied"); };
      document.execCommand = command => { window.fallbackCopy = document.activeElement.value; return command === "copy"; };
    });
    await frame.getByRole("button", { name: "Copy Markdown", exact: true }).click();
    await frame.getByRole("status").filter({ hasText: "Markdown copied." }).waitFor();
    assert.equal(await frame.locator("body").evaluate(() => window.fallbackCopy), content);
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(await buttons.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await page.screenshot({ path: path.join(root, "../qa/quartz-page-exports-mobile.png") });
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.screenshot({ path: path.join(root, "../qa/quartz-page-exports.png") });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
