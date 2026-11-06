import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";
import { compileInlineScript } from "../../quartz/quartz/cli/handlers.js";

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
  return compileInlineScript(path.join(quartz, "quartz/components/scripts", name));
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
  // A size-contained reading column establishes a fixed-position containing
  // block. Opening halfway down a long folder must still show the dialog.
  const child = `<style>${rendered.css}.center{container-type:inline-size;min-height:6000px;padding-top:900px}</style><div class="center">${rendered.html}</div>${legacyRows}<script>${cleanup}</script><script>${js}</script><script>navigate('demo/index')</script>`;
  const { page, origin, errors } = await fixture(t, (req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/child" ? child : `<iframe src="/child" style="width:1100px;height:800px"></iframe><script>window.exports=[];addEventListener('message',e=>{if(e.data.type==='second-brain:export-folder-pdf'){exports.push(e.data);e.source.postMessage({type:'second-brain:folder-pdf-result',requestId:e.data.requestId,ok:true,message:'Saved to Downloads: demo.pdf'},'*')}})</script>`);
  });
  await page.goto(origin);
  const frame = page.frameLocator("iframe");
  await frame.locator(".folder-pdf-open").waitFor();
  assert.equal(await frame.locator(".folder-pdf-item").count(), 0);
  await frame.locator(".folder-pdf-open").click();
  const modalBounds = await frame.locator(".folder-pdf-panel").boundingBox();
  assert.ok(modalBounds.y >= 0 && modalBounds.y + modalBounds.height <= 820, "dialog stays in the iframe viewport");
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
  await frame.locator(".folder-pdf-status").filter({ hasText: "Saved to Downloads: demo.pdf" }).waitFor();
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

test("folder PDF search finds notes across pages and keeps selection and order", { timeout: 60000 }, async t => {
  const rendered = await component(`
    import {render} from 'preact-render-to-string';import Export from './quartz/components/FolderPdfExport';
    const C=Export(), allFiles=Array.from({length:230},(_,i)=>({slug:'demo/'+(i===202?'target-path-0202':'note-'+String(i).padStart(4,'0')),frontmatter:{title:i===150?'Target title 0150':'Note '+String(i).padStart(4,'0')}}));
    export default {html:render(<C fileData={{slug:'demo/index',frontmatter:{title:'Demo'}}} allFiles={allFiles}/>),css:C.css};
  `);
  const js = await script("folderPdfExport.inline.ts");
  const child = `<style>:root{--light:#e8f1e8;--lightgray:#afc5b7;--dark:#18251f;--gray:#53675d;--secondary:#446a5c}body{margin:0;font-family:Arial}button,input{font:inherit}${rendered.css}</style>${rendered.html}<script>${cleanup}</script><script>${js}</script><script>navigate('demo/index')</script>`;
  const { page, origin, errors } = await fixture(t, (req, res) => res.writeHead(200, { "content-type": "text/html" }).end(
    req.url === "/child" ? child : `<iframe src="/child" style="width:1100px;height:800px"></iframe><script>window.exports=[];addEventListener('message',e=>{if(e.data.type==='second-brain:export-folder-pdf'){exports.push(e.data);e.source.postMessage({type:'second-brain:folder-pdf-result',requestId:e.data.requestId,ok:true},'*')}})</script>`,
  ));
  await page.goto(origin);
  const frame = page.frameLocator("iframe");
  await frame.locator(".folder-pdf-open").click();
  await frame.locator(".folder-pdf-clear").click();
  const search = frame.locator(".folder-pdf-search-input");
  await search.fill("  TARGET  ");
  assert.deepEqual(await frame.locator(".folder-pdf-item").evaluateAll(rows => rows.map(row => row.dataset.slug)), ["demo/target-path-0202", "demo/note-0150"]);
  assert.equal(await frame.locator(".folder-pdf-search-count").innerText(), "2 matches");
  await frame.locator(".folder-pdf-select-all").click();
  assert.match(await frame.locator(".folder-pdf-count").innerText(), /2 of 230/);
  await frame.locator(".folder-pdf-item").first().locator(".folder-pdf-down").click();
  assert.equal(await frame.locator(".folder-pdf-item").first().getAttribute("data-slug"), "demo/note-0150");
  await search.fill("note 0");
  assert.equal(await frame.locator(".folder-pdf-item").count(), 100);
  assert.match(await frame.locator(".folder-pdf-pagination").innerText(), /of 229/);
  await frame.locator(".folder-pdf-next").click();
  assert.match(await frame.locator(".folder-pdf-pagination").innerText(), /Notes 101–200 of 229/);
  await frame.locator(".folder-pdf-clear").click();
  assert.match(await frame.locator(".folder-pdf-count").innerText(), /1 of 230/);
  await search.fill("target");
  assert.equal(await frame.locator(".folder-pdf-item").first().locator("input").isChecked(), true);
  assert.equal(await frame.locator(".folder-pdf-item").last().locator("input").isChecked(), false);
  await frame.locator(".folder-pdf-select-all").click();
  await search.fill("missing note");
  assert.equal(await frame.locator(".folder-pdf-item").count(), 0);
  assert.match(await frame.locator(".folder-pdf-empty").innerText(), /No notes match/);
  assert.equal(await frame.locator(".folder-pdf-select-all").isDisabled(), true);
  await search.fill("");
  assert.equal(await frame.locator(".folder-pdf-item").count(), 100);
  await frame.locator(".folder-pdf-export-button").click();
  await page.waitForFunction(() => window.exports.length === 1);
  assert.deepEqual(await page.evaluate(() => window.exports[0].documents.map(note => note.slug)), ["demo/note-0150", "demo/target-path-0202"]);
  assert.deepEqual(errors, []);
});

test("folder PDF starts in the garden's nested, numeric reading order", { timeout: 60000 }, async t => {
  const files = [
    ["demo/10.-Fiber/index", "10. Fiber"],
    ["demo/10.-Fiber/first", "A fiber note"],
    ["demo/2.-Signals/index", "2. Signals"],
    ["demo/2.-Signals/tenth", "2.10 Signal ten"],
    ["demo/2.-Signals/second", "2.2 Signal two"],
    ["demo/1.-Channels/index", "1. Channels"],
    ["demo/1.-Channels/first", "Z channel note"],
    ["demo/overview", "Overview", "topic-overview"],
    ["demo/learning/index", "Study plan"],
    ["demo/learning/start", "Start here"],
    ["demo/index", "Demo"],
    ["other/note", "Unrelated"],
  ].map(([slug, title, knowledge_type]) => ({ slug, filePath: `${slug}.md`, frontmatter: { title, knowledge_type } }));
  const rendered = await component(`
    import {render} from 'preact-render-to-string';
    import Export from './quartz/components/FolderPdfExport';
    import Explorer from './quartz/components/Explorer';
    const C=Export(), E=Explorer({folderDefaultState:'open',useSavedState:false});
    const props={cfg:{locale:'en-US'},fileData:{slug:'demo/index',frontmatter:{title:'Demo'}},allFiles:${JSON.stringify(files)}};
    export default {html:render(<><C {...props}/><E {...props}/></>),css:C.css};
  `);
  const index = Object.fromEntries(files.map(file => [file.slug, {
    slug: file.slug, filePath: file.filePath, title: file.frontmatter.title,
    knowledgeType: file.frontmatter.knowledge_type, tags: [], links: [], content: "",
  }]));
  const js = await script("folderPdfExport.inline.ts");
  const explorerJs = await script("explorer.inline.ts");
  const { page, origin, errors } = await fixture(t, (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(
    `<style>${rendered.css}</style>${rendered.html}<script>${cleanup}const fetchData=Promise.resolve(${JSON.stringify(index)});</script><script>${js}</script><script>${explorerJs}</script><script>navigate('demo/index')</script>`,
  ));
  await page.goto(origin + "/demo/index");
  await page.locator('.explorer-file a[data-for="demo/2.-Signals/second"]').waitFor();
  await page.locator(".folder-pdf-open").click();
  const order = await page.locator(".folder-pdf-item").evaluateAll(rows => rows.map(row => row.dataset.slug));
  assert.deepEqual(order, ["demo/learning/start", "demo/overview", "demo/1.-Channels/first", "demo/2.-Signals/second", "demo/2.-Signals/tenth", "demo/10.-Fiber/first"]);
  assert.deepEqual(order, await page.locator('.explorer-file a[data-for^="demo/"]').evaluateAll(links => links.map(link => link.dataset.for)));
  assert.deepEqual(errors, []);
});

for (const [length, width] of [[3, 1200], [33, 1200], [33, 390], [103, 1200]]) {
  test(`folder PDF arrows keep the moved note under the pointer (${length} notes, ${width}px)`, { timeout: 60000 }, async t => {
    const rendered = await component(`
      import {render} from 'preact-render-to-string';import Export from './quartz/components/FolderPdfExport';
      const C=Export(), allFiles=Array.from({length:${length}},(_,i)=>({slug:'demo/note-'+i,frontmatter:{title:'Note '+i}}));
      export default {html:render(<C fileData={{slug:'demo/index',frontmatter:{title:'Demo'}}} allFiles={allFiles}/>),css:C.css};
    `);
    const js = await script("folderPdfExport.inline.ts");
    const child = `<style>:root{--light:#e8f1e8;--lightgray:#afc5b7;--dark:#18251f;--gray:#53675d;--secondary:#446a5c}body{margin:0;font-family:Arial}button,input{font:inherit}${rendered.css}</style>${rendered.html}<script>${cleanup}</script><script>${js}</script><script>navigate('demo/index')</script>`;
    const { page, origin, errors } = await fixture(t, (req, res) => res.writeHead(200, { "content-type": "text/html" }).end(
      req.url === "/child" ? child : `<style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe src="/child"></iframe><script>window.exports=[];addEventListener('message',e=>{if(e.data.type==='second-brain:export-folder-pdf'){exports.push(e.data);e.source.postMessage({type:'second-brain:folder-pdf-result',requestId:e.data.requestId,ok:true},'*')}})</script>`,
    ));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    const frame = page.frameLocator("iframe");
    await frame.locator(".folder-pdf-open").click();
    const row = frame.locator('.folder-pdf-item[data-slug="demo/note-0"]');
    const down = row.locator(".folder-pdf-down");
    const anchor = await down.boundingBox();
    // Click the exact same screen coordinate repeatedly, including both list
    // edges and the boundary between the 100-row pages.
    for (let index = 1; index < length; index++) {
      await page.mouse.click(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
      assert.equal(await row.getAttribute("data-index"), String(index));
      const current = await down.boundingBox();
      assert.ok(Math.abs(current.y - anchor.y) <= 1, `note moved on Down ${index}: ${current.y} vs ${anchor.y}`);
      if (index < length - 1) assert.equal(await down.evaluate(button => button === document.activeElement), true);
    }
    assert.equal(await down.isDisabled(), true);
    const up = row.locator(".folder-pdf-up");
    const upAnchor = await up.boundingBox();
    for (let index = length - 2; index >= 0; index--) {
      await page.mouse.click(upAnchor.x + upAnchor.width / 2, upAnchor.y + upAnchor.height / 2);
      assert.equal(await row.getAttribute("data-index"), String(index));
      assert.ok(Math.abs((await up.boundingBox()).y - upAnchor.y) <= 1, `note moved on Up ${index}`);
    }
    assert.equal(await up.isDisabled(), true);
    await down.click();
    await frame.locator('.folder-pdf-item[data-slug="demo/note-1"] input').uncheck();
    await down.click();
    await frame.locator(".folder-pdf-export-button").click();
    await page.waitForFunction(() => window.exports.length === 1);
    assert.deepEqual(await page.evaluate(() => window.exports[0].documents.map(note => note.slug)), ["demo/note-2", "demo/note-0", ...Array.from({ length: length - 3 }, (_, i) => `demo/note-${i + 3}`)]);
    await frame.locator(".folder-pdf-close").click();
    await frame.locator(".folder-pdf-open").click();
    assert.equal(await row.getAttribute("data-index"), "2");
    assert.equal(await frame.locator('.folder-pdf-item[data-slug="demo/note-1"] input').isChecked(), false);
    if (length === 33 && width === 1200) {
      const last = frame.locator('.folder-pdf-item[data-slug="demo/note-32"]');
      const lastUp = last.locator(".folder-pdf-up");
      await lastUp.scrollIntoViewIfNeeded();
      const bottomAnchor = await lastUp.boundingBox();
      await lastUp.focus();
      for (let index = 31; index >= 0; index--) {
        if (index === 31) await page.keyboard.press("Space");
        else await page.mouse.click(bottomAnchor.x + bottomAnchor.width / 2, bottomAnchor.y + bottomAnchor.height / 2);
        assert.equal(await last.getAttribute("data-index"), String(index));
        assert.ok(Math.abs((await lastUp.boundingBox()).y - bottomAnchor.y) <= 1, `bottom note moved on Up ${index}`);
      }
    }
    assert.deepEqual(errors, []);
  });
}

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
