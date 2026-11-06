import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

test("saved notes and updated titles override the cached index and open by mouse and keyboard", { timeout: 30000 }, async () => {
  const explorer = await build({
    entryPoints: [path.resolve(import.meta.dirname, "../../quartz/quartz/components/scripts/explorer.inline.ts")],
    bundle: true, write: false, platform: "browser", format: "iife",
  });
  const slugs = ["physics/notes/vector-spaces-1790162151482", "physics/notes/dot-products-1790162261565"];
  const titles = ["Vector spaces", "Dot products"];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/explorer.js") {
      response.setHeader("content-type", "text/javascript"); response.end(explorer.outputFiles[0].text); return;
    }
    response.setHeader("content-type", "text/html");
    const note = slugs.indexOf(url.pathname.slice(1));
    if (note >= 0) { response.end(`<h1>${titles[note]}</h1><p>The saved lesson opens.</p>`); return; }
    if (url.pathname === "/") {
      response.end(`<iframe title="Garden" src="/physics/index.html"></iframe><script>
        window.addEventListener('message',event=>{
          if(event.source!==document.querySelector('iframe').contentWindow||event.data?.type!=='second-brain:request-folders')return;
          event.source.postMessage({type:'second-brain:documents',cluster:'physics',complete:true,documents:${JSON.stringify(slugs.map((slug, i) => ({ relPath: slug.slice("physics/".length) + ".md", title: titles[i] }))) }},location.origin);
          event.source.postMessage({type:'second-brain:folders',cluster:'physics',complete:true,folders:[{folder:'notes',name:'Notes'}]},location.origin);
        });</script>`); return;
    }
    response.end(`<div class="explorer" data-behavior="link" data-collapsed="open" data-savestate="false">
      <ul class="explorer-ul"><li class="overflow-end"></li></ul></div>
      <template id="template-folder"><li><div class="folder-container"><svg class="folder-icon"></svg><div><button class="folder-button"><span class="folder-title"></span></button></div></div><div class="folder-outer"><ul></ul></div></li></template>
      <template id="template-file"><li><a></a></li></template>
      <script>window.addCleanup=()=>{};window.fetchData=Promise.resolve({
        'physics/index':{slug:'physics/index',filePath:'physics/_index.md',title:'Physics',links:[],tags:[],content:''},
        '${slugs[0]}':{slug:'${slugs[0]}',filePath:'${slugs[0]}.md',title:'Obsolete published title',links:[],tags:[],content:''}
      });</script><script src="/explorer.js"></script>
      <script>document.dispatchEvent(new CustomEvent('nav',{detail:{url:'physics/index'}}));</script>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const keyboard of [false, true]) {
      await page.goto(origin);
      const reader = page.frameLocator('iframe[title="Garden"]');
      const index = keyboard ? 1 : 0;
      const link = reader.getByRole("link", { name: titles[index], exact: true });
      await link.waitFor();
      if (!keyboard) {
        await reader.locator('.explorer').evaluate((node, slug) => document.dispatchEvent(new CustomEvent('bb:document-title', { detail: { slug, title: 'Renamed while editing' } })), slugs[0]);
        await reader.getByRole('link', { name: 'Renamed while editing', exact: true }).waitFor();
        await reader.locator('.explorer').evaluate(() => document.dispatchEvent(new CustomEvent('nav', { detail: { url: 'physics/index' } })));
        await reader.getByRole('link', { name: 'Renamed while editing', exact: true }).waitFor();
        await reader.locator('.explorer').evaluate((node, slug) => document.dispatchEvent(new CustomEvent('bb:document-title', { detail: { slug, title: 'Vector spaces' } })), slugs[0]);
      }
      assert.equal(await link.getAttribute("aria-disabled"), null);
      assert.equal(new URL(await link.getAttribute("href"), `${origin}/physics/index.html`).pathname, `/${slugs[index]}`);
      if (keyboard) { await link.focus(); await page.keyboard.press("Enter"); }
      else await link.click();
      await reader.getByRole("heading", { name: titles[index], exact: true }).waitFor();
      assert.equal(await reader.getByText("The saved lesson opens.").count(), 1);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
