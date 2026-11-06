import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import { embedOcrTextLayer } from "../src/lib/pdf-text-layer.ts";

test("PDF.js selects the word under the pointer at different zooms and page rotations", {timeout: 60_000}, async t => {
  const words = [
    {text: "Linear", box: [0.08, 0.2, 0.26, 0.235]},
    {text: "algebra", box: [0.31, 0.205, 0.40, 0.24]},
    {text: "everywhere", box: [0.47, 0.195, 0.9, 0.23]},
  ];
  const doc = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const page = doc.addPage([800, 1000]);
    page.setCropBox(70, 120, 600, 800);
    page.setRotation(degrees(rotation));
  }
  const {bytes} = await embedOcrTextLayer({pdf: await doc.save(),
    pages: [1, 2, 3, 4].map(pageNumber => ({pageNumber, text: "", lines: words}))});
  const require = createRequire(import.meta.url);
  const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const routes = {
    "/pdf.mjs": ["legacy/build/pdf.mjs", "text/javascript"],
    "/pdf.worker.mjs": ["legacy/build/pdf.worker.mjs", "text/javascript"],
    "/viewer.css": ["web/pdf_viewer.css", "text/css"],
  };
  const server = createServer((req, res) => {
    if (req.url === "/fixture.pdf") { res.setHeader("Content-Type", "application/pdf"); res.end(bytes); return; }
    const asset = routes[req.url];
    if (asset) {res.setHeader("Content-Type", asset[1]); res.end(fs.readFileSync(path.join(pdfjsRoot, asset[0]))); return;}
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><link rel="stylesheet" href="/viewer.css"><style>
      body{margin:0}#page{position:relative;margin:20px;--scale-round-x:1px;--scale-round-y:1px}.textLayer{opacity:1}
      </style><div id="page"></div><script type="module">
      import {getDocument,TextLayer,GlobalWorkerOptions} from '/pdf.mjs';
      GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
      const pdf=await getDocument('/fixture.pdf').promise;
      window.showPage=async(number,scale)=>{
        getSelection().removeAllRanges();
        const page=await pdf.getPage(number),viewport=page.getViewport({scale});
        const host=document.getElementById('page');host.replaceChildren();
        host.style.width=viewport.width+'px';host.style.height=viewport.height+'px';
        host.style.setProperty('--total-scale-factor',String(scale));
        const container=document.createElement('div');container.className='textLayer';host.append(container);
        await new TextLayer({textContentSource:await page.getTextContent(),container,viewport}).render();
      };window.ready=true;
    </script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 1800, height: 1800}});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready);
  for (const pageNumber of [1, 2, 3, 4]) {
    for (const scale of [0.75, 1.5, 2]) {
      await page.evaluate(([n, s]) => window.showPage(n, s), [pageNumber, scale]);
      const host = await page.locator("#page").boundingBox();
      for (const word of words) {
        const [x0, y0, x1, y1] = word.box;
        const expected = {x: host.x + x0 * host.width, y: host.y + y0 * host.height,
          width: (x1 - x0) * host.width, height: (y1 - y0) * host.height};
        const actual = await page.locator(".textLayer span").filter({hasText: new RegExp(`^${word.text}$`)}).boundingBox();
        assert.ok(actual);
        for (const key of ["x", "y", "width", "height"]) {
          assert.ok(Math.abs(actual[key] - expected[key]) < 1.5,
            `page ${pageNumber}, zoom ${scale}, ${word.text}, ${key}: ${actual[key]} vs ${expected[key]}`);
        }
        await page.mouse.dblclick(expected.x + expected.width / 2, expected.y + expected.height / 2);
        assert.equal(await page.evaluate(() => getSelection().toString().trim()), word.text);
      }
    }
  }
});
