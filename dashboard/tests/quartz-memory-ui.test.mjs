import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";

const quartz = path.resolve(import.meta.dirname, "../../quartz");
const resourcePlugin = { name: "inline-resource", setup(build) {
  build.onLoad({ filter: /\.inline\.ts$/ }, args => ({ contents: fs.readFileSync(args.path, "utf8"), loader: "text" }));
} };
async function component(contents) {
  const result = await esbuild.build({
    stdin: { contents, loader: "tsx", resolveDir: quartz },
    bundle: true, write: false, platform: "node", format: "esm", keepNames: true,
    jsx: "automatic", jsxImportSource: "preact", loader: { ".scss": "text" },
    plugins: [resourcePlugin],
  });
  return (await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"))).default;
}
async function script(name) {
  const result = await esbuild.build({ entryPoints: [path.join(quartz, "quartz/components/scripts", name)],
    bundle: true, write: false, platform: "browser", format: "iife" });
  return result.outputFiles[0].text;
}
async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => { if (errors.length) console.error("Page errors:", errors); });
  return { page, origin: `http://127.0.0.1:${server.address().port}`, errors };
}
const cleanup = `window.cleanups=[];window.addCleanup=fn=>window.cleanups.push(fn);window.navigate=slug=>{for(const fn of window.cleanups.splice(0))fn();document.dispatchEvent(new CustomEvent('nav',{detail:{url:slug}}))};`;

for (const legacy of [false, true]) test(`folder export keeps all selections/order with bounded rows and releases them on close (${legacy ? "legacy" : "new"} page)`, { timeout: 60000 }, async t => {
  const rendered = await component(`
    import { render } from 'preact-render-to-string';
    import Export from './quartz/components/FolderPdfExport';
    const C=Export();const allFiles=Array.from({length:4174},(_,i)=>({slug:'demo/note-'+String(i).padStart(4,'0'),frontmatter:{title:'Note '+String(i).padStart(4,'0')}}));
    export default {html:render(<C fileData={{slug:'demo/index',frontmatter:{title:'Demo'}}} allFiles={allFiles}/>),css:C.css};
  `);
  const js = await script("folderPdfExport.inline.ts");
  const legacyRows = legacy ? `<script>const root=document.querySelector('.folder-pdf-export');const documents=JSON.parse(root.dataset.documents);delete root.dataset.documents;for(const note of documents){const row=document.createElement('li');row.className='folder-pdf-item';row.dataset.slug=note.slug;row.dataset.title=note.title;const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=true;row.append(checkbox);root.querySelector('.folder-pdf-list').append(row)}</script>` : "";
  const child = `<style>${rendered.css}</style>${rendered.html}${legacyRows}<script>${cleanup}</script><script>${js}</script><script>navigate('demo/index')</script>`;
  const { page, origin, errors } = await fixture(t, (req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/child" ? child : `<iframe src="/child" style="width:1100px;height:800px"></iframe><script>window.exports=[];addEventListener('message',e=>{if(e.data.type==='second-brain:export-folder-pdf'){exports.push(e.data);e.source.postMessage({type:'second-brain:folder-pdf-result',requestId:e.data.requestId,ok:true},'*')}})</script>`);
  });
  await page.goto(origin);
  const frame = page.frameLocator("iframe");
  await frame.locator(".folder-pdf-open").waitFor();
  assert.equal(await frame.locator(".folder-pdf-item").count(), 0);
  await frame.locator(".folder-pdf-open").click();
  assert.equal(await frame.locator(".folder-pdf-item").count(), 100);
  assert.match(await frame.locator(".folder-pdf-count").innerText(), /4174 of 4174/);
  await frame.locator(".folder-pdf-item input").first().uncheck();
  // Crossing a page boundary moves the model, not just the visible DOM.
  await frame.locator(".folder-pdf-item").nth(99).locator(".folder-pdf-down").click();
  assert.equal(await frame.locator(".folder-pdf-item").first().getAttribute("data-slug"), "demo/note-0099");
  await frame.locator(".folder-pdf-previous").click();
  assert.equal(await frame.locator(".folder-pdf-item input").first().isChecked(), false);
  await frame.locator(".folder-pdf-export-button").click();
  await page.waitForFunction(() => window.exports.length === 1);
  const exported = await page.evaluate(() => window.exports[0].documents.map(note => note.slug));
  assert.equal(exported.length, 4173);
  assert.equal(exported[98], "demo/note-0100");
  assert.equal(exported[99], "demo/note-0099");
  assert.equal(exported.at(-1), "demo/note-4173");
  await frame.locator(".folder-pdf-close").click();
  assert.equal(await frame.locator(".folder-pdf-item").count(), 0);
  await frame.locator(".folder-pdf-open").click();
  assert.equal(await frame.locator(".folder-pdf-item input").first().isChecked(), false);
  await frame.locator(".folder-pdf-clear").click();
  assert.equal(await frame.locator(".folder-pdf-export-button").isDisabled(), true);
  await frame.locator(".folder-pdf-select-all").click();
  assert.match(await frame.locator(".folder-pdf-count").innerText(), /4174 of 4174/);
  await page.frames()[1].evaluate(() => navigate("demo/index"));
  assert.equal(await frame.locator(".folder-pdf-item").count(), 0);
  await frame.locator(".folder-pdf-open").click();
  assert.equal(await frame.locator(".folder-pdf-pagination").count(), 1);
  assert.equal(await frame.locator(".folder-pdf-item").count(), 100);
  assert.deepEqual(errors, []);
});

test("explorer defers closed descendants and binds expansion controls created later", { timeout: 60000 }, async t => {
  const html = await component(`import {render} from 'preact-render-to-string';import Explorer from './quartz/components/Explorer';const C=Explorer({showTitle:false});export default render(<C cfg={{locale:'en-US'}} fileData={{frontmatter:{}}}/>);`);
  const js = await script("explorer.inline.ts");
  const slugs = ["demo/index", "demo/learning/index", "demo/learning/open/index", "demo/learning/open/active", "demo/learning/closed/index", "demo/learning/closed/nested/index",
    ...Array.from({ length: 1000 }, (_, i) => `demo/learning/closed/nested/note-${i}`)];
  const index = Object.fromEntries(slugs.map(slug => [slug, { slug, filePath: slug + ".md", title: slug.split("/").at(-1), tags: [], links: [], content: "" }]));
  const { page, origin, errors } = await fixture(t, (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(`<style>.folder-outer:not(.open){display:none}.folder-icon{width:20px;height:20px}</style>${html}<script>${cleanup}const fetchData=Promise.resolve(${JSON.stringify(index)});</script><script>${js}</script><script>navigate('demo/learning/open/active')</script>`));
  await page.goto(origin + "/demo/learning/open/active");
  await page.locator('a.active[data-for="demo/learning/open/active"]').waitFor();
  assert.equal(await page.locator(".explorer-file").count(), 1);
  const folder = slug => page.locator(`.folder-container[data-folderpath="${slug}/index"]`);
  await folder("demo/learning/closed").locator(".folder-icon").click();
  assert.equal(await page.locator(".explorer-file").count(), 1);
  await folder("demo/learning/closed/nested").locator(".folder-icon").click();
  assert.equal(await page.locator(".explorer-file").count(), 1001);
  await folder("demo/learning/closed/nested").locator(".folder-icon").click();
  await folder("demo/learning/closed/nested").locator(".folder-icon").click();
  assert.equal(await page.locator(".explorer-file").count(), 1001, "reopening must not duplicate rows");
  await page.evaluate(() => navigate("demo/learning/open/active"));
  await page.waitForFunction(() => document.querySelectorAll(".explorer-file").length === 1001);
  assert.deepEqual(errors, []);
});

test("search loads note text on demand, retries failure, and cancels stale navigation", { timeout: 60000 }, async t => {
  const html = await component(`import {render} from 'preact-render-to-string';import Search from './quartz/components/Search';const C=Search({enablePreview:false});export default render(<C cfg={{locale:'en-US'}}/>);`);
  const js = await script("search.inline.ts");
  const index = { "demo/note": {slug:"demo/note",title:"Plain heading",content:"uniquequartzword",tags:["physics"]}, "other/note":{slug:"other/note",title:"Other heading",content:"differentword",tags:["other"]} };
  const { page, origin, errors } = await fixture(t, (_req,res) => res.writeHead(200, { "content-type": "text/html" }).end(`<style>.search-container:not(.active){display:none}</style>${html}<script>${cleanup}window.loads=0;window.failNext=false;window.delayNext=false;const fetchSearchData=async()=>{window.loads++;if(window.failNext){window.failNext=false;throw Error('test failure')}if(window.delayNext){window.delayNext=false;await new Promise(r=>window.releaseLoad=r)}return ${JSON.stringify(index)}};const fetchData=Promise.resolve({});</script><script>${js}</script><script>navigate('demo/note')</script>`));
  await page.goto(origin + "/demo/note");
  assert.equal(await page.evaluate(() => window.loads), 0);
  await page.evaluate(() => window.failNext = true);
  await page.locator(".search-button").click();
  await page.getByText("Could not load search. Type to retry.").waitFor();
  await page.locator(".search-bar").fill("uniquequartzword");
  await page.locator('a.result-card[id="demo/note"]').waitFor();
  assert.equal(await page.evaluate(() => window.loads), 2);
  assert.equal(await page.locator('a.result-card[id="other/note"]').count(), 0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { navigate("demo/note"); window.delayNext=true; });
  await page.locator(".search-button").click();
  await page.waitForFunction(() => typeof window.releaseLoad === "function");
  await page.evaluate(() => { navigate("other/note"); window.releaseLoad(); });
  await page.locator(".search-bar").fill("differentword");
  await page.locator('a.result-card[id="other/note"]').waitFor();
  assert.equal(await page.locator('a.result-card[id="demo/note"]').count(), 0);
  assert.deepEqual(errors, []);
});
