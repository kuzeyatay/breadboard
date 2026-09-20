import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const quartz = path.resolve(import.meta.dirname, "../../quartz");
const scripts = path.join(quartz, "quartz/components/scripts");
const read = name => fs.readFileSync(path.join(scripts, name), "utf8");
const { compileString } = createRequire(path.join(quartz, "package.json"))("sass");
const css = compileString(fs.readFileSync(path.join(quartz, "quartz/components/styles/longDocument.scss"), "utf8")).css;
const rendering = await build({
  stdin: { resolveDir: quartz, loader: "ts", contents: `
    import {deferLongDocumentBlocks} from './quartz/util/longDocument';
    import {toHtml} from 'hast-util-to-html';
    export {deferLongDocumentBlocks};
    export const renderBlocks = children => toHtml(deferLongDocumentBlocks({type:'root',children}), {allowDangerousHtml:true});
  ` }, bundle: true, write: false, platform: "node", format: "esm",
});
const { renderBlocks, deferLongDocumentBlocks } = await import(`data:text/javascript;base64,${Buffer.from(rendering.outputFiles[0].text).toString("base64")}`);
const block = (tagName, id, html) => ({ type: "element", tagName, properties: { id }, children: [{ type: "raw", value: html }] });
const bundled = await build({
  stdin: { resolveDir: scripts, loader: "ts", contents: read("highlighter.inline.ts") +
    "\nwindow.readerTest = { buildTextMap, render };" },
  bundle: true, write: false, platform: "browser", format: "iife",
});
const toc = await build({
  stdin: { resolveDir: scripts, loader: "ts", contents: read("toc.inline.ts") },
  bundle: true, write: false, platform: "browser", format: "iife",
});
const visuals = await build({
  entryPoints: [path.join(scripts, "sourceVisuals.inline.ts")],
  bundle: true, write: false, platform: "browser", format: "iife",
});

async function fixture(run) {
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(5_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const stored = new Map();
    await page.route("**/*", route => {
      if (route.request().url().endsWith("/api/text-highlights")) {
        const input = route.request().postDataJSON();
        const entries = stored.get(input.key) ?? new Map((input.entries ?? []).map(entry => [entry.id, entry]));
        for (const mutation of input.mutations ?? []) {
          if (mutation.value === null) entries.delete(mutation.id);
          else entries.set(mutation.id, mutation.value);
        }
        stored.set(input.key, entries);
        return route.fulfill({ json: { entries: [...entries.values()], acknowledged: (input.mutations ?? []).map(m => m.operationId) } });
      }
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><style>
        ${css} body{margin:0 auto;max-width:800px} p{line-height:24px} .bb-highlight-menu{position:fixed;top:0;left:0;background:white}
        </style></head><body data-slug="demo/book"><article class="popover-hint"></article>
        <div class="bb-highlighter" hidden><div class="bb-highlight-menu"><button data-highlight-color="blue">Blue</button><button data-highlight-action="erase">Erase</button></div></div>
        <script>window.cleanups=[];window.addCleanup=fn=>cleanups.push(fn);window.walks=0;window.visits=0;
        const createWalker=document.createTreeWalker.bind(document);document.createTreeWalker=(...args)=>{
          walks++;const walker=createWalker(...args);const next=walker.nextNode.bind(walker);
          walker.nextNode=()=>{visits++;return next()};return walker;
        };</script></body></html>` });
    });
    await page.goto("http://localhost:53248/book");
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

test("long articles defer offscreen prose without losing find, anchors, selection or print content", { timeout: 30_000 }, async () => {
  await fixture(async page => {
    const html = renderBlocks(Array.from({ length: 160 }, (_, i) => [
      block("h2", `chapter-${i}`, `Chapter ${i}`),
      block("p", `passage-${i}`, `${i === 159 ? "Unique end of book phrase" : "Readable prose with an equation."} ${"More text. ".repeat(50)}`),
    ]).flat());
    await page.evaluate(html => { document.querySelector("article").innerHTML = html; }, html);
    assert.equal(await page.locator("#passage-159").evaluate(el => getComputedStyle(el).contentVisibility), "auto");
    assert.equal(await page.locator("#chapter-159").evaluate(el => getComputedStyle(el).contentVisibility), "visible");
    assert.equal(await page.locator("article p").count(), 160);
    assert.equal(await page.evaluate(() => window.find("Unique end of book phrase")), true);
    assert.equal(await page.evaluate(() => getSelection().toString()), "Unique end of book phrase");
    await page.evaluate(() => { getSelection().removeAllRanges(); location.hash = "chapter-130"; });
    await page.waitForFunction(() => {
      const rect = document.getElementById("chapter-130").getBoundingClientRect();
      return rect.top >= -1 && rect.top < innerHeight;
    });
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator("#passage-159").evaluate(el => getComputedStyle(el).contentVisibility), "visible");
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(html => { document.querySelector("article").innerHTML = html; }, renderBlocks([block("p", "short", "Short note")]));
    assert.equal(await page.locator("article p").evaluate(el => getComputedStyle(el).contentVisibility), "visible");
  });
});

test("highlighting skips math subtrees and does no text walks for unselected clicks or unannotated refreshes", { timeout: 30_000 }, async () => {
  await fixture(async page => {
    const html = renderBlocks(Array.from({ length: 100 }, (_, i) => block("p", `p-${i}`,
      `Passage ${i} <span class="katex">${"<span>math glyph</span>".repeat(200)}</span><em>selectable words</em>`)));
    await page.evaluate(html => { document.querySelector("article").innerHTML = html; }, html);
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await page.evaluate(() => document.dispatchEvent(new Event("nav")));
    await page.locator("#p-0").click();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
    assert.equal(await page.evaluate(() => walks), 0, "opening and clicking an unannotated book needs no text index");
    await page.evaluate(() => document.querySelector("article").append(document.createTextNode("Updated tail")));
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
    assert.equal(await page.evaluate(() => walks), 0);
    const map = await page.evaluate(() => {
      const map = readerTest.buildTextMap(document.querySelector("article"));
      return { text: map.text, visits, size: map.entries.length };
    });
    assert.equal(map.text.includes("math glyph"), false);
    assert.match(map.text, /Passage 99 selectable words/);
    assert.equal(map.size, 201);
    assert.ok(map.visits < 300, "the 20,000 math glyphs never enter the text walk");
    await page.evaluate(() => {
      const node = document.querySelector("#p-0").firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 7);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    });
    await page.getByRole("button", { name: "Blue", exact: true }).click();
    assert.equal(await page.locator("mark.bb-hl").textContent(), "Passage");
    const before = await page.evaluate(() => walks);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    assert.equal(await page.evaluate(() => walks), before, "our mark wrappers do not trigger another repaint");
    await page.evaluate(() => {
      const controls = document.createElement("div"); controls.dataset.noHighlight = "true";
      controls.textContent = "Saving…"; document.querySelector("article").append(controls);
    });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
    assert.equal(await page.evaluate(() => walks), before, "excluded controls do not re-index the article");
    await page.evaluate(() => document.querySelector("article").prepend(document.createTextNode("New prefix ")));
    await page.waitForFunction(count => walks > count, before);
    assert.equal(await page.locator("mark.bb-hl").textContent(), "Passage", "annotations re-anchor after real edits");
  });
});

test("deferred rendering preserves the source tree, heading IDs, tables, widgets, and existing classes", () => {
  const heading = block("h2", "chapter", "Chapter");
  const widget = block("div", "widget", '<button>Interactive</button>');
  const table = { ...block("div", "table", '<table><tr><td>Cell</td></tr></table>'), properties: { className: "table-container wide" } };
  const root = { type: "root", children: [heading, widget, table, ...Array.from({ length: 100 }, (_, i) => block("p", `p-${i}`, "Prose"))] };
  const original = JSON.stringify(root);
  const result = deferLongDocumentBlocks(root);
  assert.equal(JSON.stringify(root), original);
  assert.equal(result.children[0], heading);
  assert.equal(result.children[1], widget);
  assert.deepEqual(result.children[2].properties.className, ["table-container", "wide", "quartz-deferred-block"]);
  assert.deepEqual(deferLongDocumentBlocks(result), result, "repeated publication does not duplicate classes");
  const short = { type: "root", children: [heading, block("p", "short", "Prose")] };
  assert.equal(deferLongDocumentBlocks(short), short);
});

test("TOC intersections use cached links, including duplicate entries, and release the cache on navigation", async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      document.querySelector("article").innerHTML = '<h2 id="topic">Topic</h2>';
      const toc = document.createElement("nav"); toc.className = "toc";
      toc.innerHTML = '<a data-for="topic">First</a><a data-for="topic">Second</a>'; document.body.append(toc);
      window.IntersectionObserver = class {
        constructor(callback) { window.intersect = callback; }
        observe() {}
        disconnect() {}
      };
      window.queries = 0;
      const query = document.querySelectorAll.bind(document);
      document.querySelectorAll = (...args) => { queries++; return query(...args); };
    });
    await page.addScriptTag({ content: toc.outputFiles[0].text });
    const result = await page.evaluate(() => {
      document.dispatchEvent(new Event("nav")); queries = 0;
      const event = { target: document.getElementById("topic"), rootBounds: { height: 900 }, boundingClientRect: { y: 20 } };
      for (let i = 0; i < 100; i++) intersect([event]);
      const queryCount = queries;
      const links = [...document.getElementsByClassName("toc")[0].children];
      const active = links.every(link => link.classList.contains("in-view"));
      cleanups.forEach(fn => fn()); links.forEach(link => link.classList.remove("in-view"));
      intersect([event]);
      return { queryCount, active, cleared: links.every(link => !link.classList.contains("in-view")) };
    });
    assert.deepEqual(result, { queryCount: 0, active: true, cleared: true });
  });
});

test("source images reflow on width changes and image loads, without relayout on book height changes", async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      document.querySelector("article").innerHTML = '<figure class="breadboard-source-visual"><img alt="Diagram"></figure>';
      window.ResizeObserver = class {
        constructor(callback) { window.resizeImages = callback; }
        observe() {}
        disconnect() {}
      };
      window.framesScheduled = 0;
      const frame = requestAnimationFrame;
      window.requestAnimationFrame = callback => { framesScheduled++; return frame(callback); };
    });
    await page.addScriptTag({ content: visuals.outputFiles[0].text });
    const result = await page.evaluate(() => {
      document.dispatchEvent(new Event("nav"));
      const target = document.querySelector("article");
      resizeImages([{ target, contentRect: { width: 800, height: 1000 } }]);
      const initial = framesScheduled;
      for (let height = 1100; height < 10000; height += 100) resizeImages([{ target, contentRect: { width: 800, height } }]);
      const afterHeight = framesScheduled;
      resizeImages([{ target, contentRect: { width: 600, height: 10000 } }]);
      const afterWidth = framesScheduled;
      document.querySelector("img").dispatchEvent(new Event("load"));
      const afterLoad = framesScheduled;
      cleanups.forEach(fn => fn());
      return { initial, afterHeight, afterWidth, afterLoad };
    });
    assert.deepEqual(result, { initial: 1, afterHeight: 1, afterWidth: 2, afterLoad: 3 });
  });
});

test("canonical Markdown rendering marks long prose while preserving equations and heading anchors", async () => {
  const { renderQuartzDocument } = await import("../src/lib/generated/quartz-reader.mjs");
  const result = await renderQuartzDocument({
    content: "# Long document\n\n" + Array.from({ length: 100 }, (_, i) => `Paragraph ${i} with $E=mc^2$.`).join("\n\n"),
    relativePath: "demo/long.md", contentRoot: path.join(quartz, "content"), allFiles: ["demo/long.md"],
  });
  assert.equal((result.html.match(/quartz-deferred-block/g) ?? []).length, 100);
  assert.equal((result.html.match(/class="katex"/g) ?? []).length, 100);
  assert.match(result.html, /id="long-document"/);
});
