import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "@cantoo/pdf-lib";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import Database from "better-sqlite3";
import { ensurePdfReadingPositionSchema, readPdfReadingPosition, writePdfReadingPosition } from "../src/lib/pdf-reading-position-store.ts";

test("PDF navigation restores its page across browser/server restarts and changed ports", { timeout: 90_000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const directory = mkdtempSync(path.join(tmpdir(), "breadboard-pdf-restart-"));
  const databasePath = path.join(directory, "reading.db");
  let db = new Database(databasePath);
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1)");
  ensurePdfReadingPositionSchema(db);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const pdf = await PDFDocument.create();
  for (let page = 1; page <= 65; page++) {
    pdf.addPage([600, 800]).drawText(`Page ${page}`, { x: 40, y: 740 });
  }
  const bytes = await pdf.save();
  const bundle = await build({
    bundle: true, write: false, outfile: "bundle.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Viewer from './src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client';
      createRoot(document.getElementById('root')).render(<Viewer title="Navigation test" sourceUrl={new URLSearchParams(location.search).get('source') || '/fixture.pdf'} readOnly showNavbarFlowers={false}/>);
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
        "@/app/components/pdf-tools-panel": "export default function Tools({getBytes,applyBytes}){return <button onClick={async()=>{await applyBytes(await getBytes());window.toolReloaded=true}}>Reload PDF bytes</button>}",
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
    { from: path.join(root, "tests/pdf-navigation-fixture.css") },
  )).css;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/pdf-reading-position") {
      response.setHeader("content-type", "application/json");
      if (request.method === "PUT") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const value = JSON.parse(body);
        writePdfReadingPosition(db, 1, value.source, value.page, value.observedAt);
        response.end('{"ok":true}');
      } else {
        // A slow read must finish before startup events are allowed to save page 1.
        await new Promise(resolve => setTimeout(resolve, 150));
        response.end(JSON.stringify({ page: readPdfReadingPosition(db, 1, url.searchParams.get("source")) }));
      }
      return;
    }
    if (url.pathname === "/bundle.js") {
      response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); return;
    }
    if (url.pathname === "/fixture.pdf" || url.pathname === "/other.pdf") {
      response.setHeader("content-type", "application/pdf"); response.end(bytes); return;
    }
    if (url.pathname.startsWith("/api/pdfjs/")) {
      const name = path.basename(url.pathname);
      const asset = path.join(root, "node_modules/pdfjs-dist", name === "pdf.mjs" || name === "pdf.worker.mjs" ? "build" : "web", name);
      if (existsSync(asset)) {
        response.setHeader("content-type", name.endsWith(".css") ? "text/css" : "text/javascript"); response.end(readFileSync(asset)); return;
      }
      response.writeHead(404); response.end(); return;
    }
    if (url.pathname.startsWith("/api/")) { response.setHeader("content-type", "application/json"); response.end("{}"); return; }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><style>${css}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
  let browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.process = { env: {} };
    window.findSoundNotes = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = create.call(this), start = oscillator.start.bind(oscillator);
      oscillator.start = (...args) => { window.findSoundNotes++; start(...args); };
      return oscillator;
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const field = page.getByRole("textbox", { name: "Page number", exact: true });
  await expect(field).toBeEnabled();
  await expect(page.locator('.page[data-page-number="1"] canvas')).toBeVisible();
  await expect(field).toHaveValue("1");
  const scrollToPage = async number => {
    await page.locator("#viewerContainer").evaluate((container, number) => {
      const target = container.querySelector(`[data-page-number="${number}"]`);
      container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    }, number);
    await expect(field).toHaveValue(String(number));
  };
  await scrollToPage(3);
  // A wheel scroll does not blur the page field, so a draft used to mask all later updates.
  await field.fill("1");
  await expect(field).toBeFocused();
  await scrollToPage(5);
  await expect(field).toBeFocused();
  await scrollToPage(2);
  await field.fill("12");
  await field.press("Enter");
  await expect(field).toHaveValue("12");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(field).toHaveValue("13");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(field).toHaveValue("12");
  await field.fill("8");
  await field.press("Escape");
  await expect(field).toHaveValue("12");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await scrollToPage(14);
  await page.setViewportSize({ width: 900, height: 700 });
  await scrollToPage(15);
  await page.reload();
  await expect(field).toHaveValue("15");
  const style = await field.evaluate(input => {
    const css = getComputedStyle(input), count = input.nextElementSibling;
    const inputBox = input.getBoundingClientRect(), countBox = count.getBoundingClientRect();
    return { top: css.borderTopWidth, right: css.borderRightWidth, bottom: css.borderBottomWidth, left: css.borderLeftWidth,
      radius: css.borderRadius, background: css.backgroundColor, height: inputBox.height,
      rowDelta: Math.abs((inputBox.top + inputBox.height / 2) - (countBox.top + countBox.height / 2)) };
  });
  assert.deepEqual([style.top, style.right, style.bottom, style.left], ["0px", "0px", "1px", "0px"]);
  assert.equal(style.radius, "0px");
  assert.equal(style.background, "rgba(0, 0, 0, 0)");
  assert.ok(style.height <= 25, `Compact page field: ${JSON.stringify(style)}`);
  assert.ok(style.rowDelta < 2, `Page and count share a row: ${JSON.stringify(style)}`);

  // Breadboard's shared find bar calls this provider instead of searching rendered DOM.
  await expect(page.getByPlaceholder("Find in PDF")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next match", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous match", exact: true })).toHaveCount(0);
  const search = request => page.evaluate(request => window[Symbol.for("breadboard:document-find")](request), request);
  assert.deepEqual(await search({ text: "no-such-phrase-in-this-pdf" }), { matches: 0, activeMatchOrdinal: 0 });
  const firstMatch = await search({ text: "Page " });
  assert.equal(firstMatch.matches, 65, "counts every PDF page, including unrendered pages");
  const nextMatch = await search({ text: "Page ", findNext: true });
  assert.equal(nextMatch.activeMatchOrdinal, firstMatch.activeMatchOrdinal % 65 + 1);
  const previousMatch = await search({ text: "Page ", findNext: true, forward: false });
  assert.equal(previousMatch.activeMatchOrdinal, firstMatch.activeMatchOrdinal);
  assert.deepEqual(await search({ text: "Page 61" }), { matches: 1, activeMatchOrdinal: 1 });
  await expect(field).toHaveValue("61");
  await expect(page.locator(".textLayer .highlight.selected")).toBeVisible();
  await search(null);
  await expect(page.locator(".textLayer .highlight")).toHaveCount(0);
  const raced = await page.evaluate(async () => {
    const find = window[Symbol.for("breadboard:document-find")];
    return Promise.all([find({ text: "obsolete query" }), find({ text: "Page 55" })]);
  });
  assert.equal(raced[0], null, "superseded searches are discarded");
  assert.deepEqual(raced[1], { matches: 1, activeMatchOrdinal: 1 });
  await search({ text: "" });
  await expect(page.locator(".textLayer .highlight")).toHaveCount(0);
  assert.deepEqual(errors, []);

  await field.fill("37");
  await field.press("Enter");
  await expect.poll(() => readPdfReadingPosition(db, 1, "/fixture.pdf")).toBe(37);
  const oldPort = server.address().port;
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  db.close();
  db = new Database(databasePath);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  assert.notEqual(server.address().port, oldPort);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const reopened = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await reopened.addInitScript(() => { window.process = { env: {} }; });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await reopened.goto(origin);
  assert.equal(await reopened.evaluate(() => localStorage.length), 0, "restart has no browser position cache");
  const reopenedField = reopened.getByRole("textbox", { name: "Page number", exact: true });
  await expect(reopenedField).toHaveValue("37");
  await expect(reopened.locator('.page[data-page-number="37"] canvas')).toBeVisible();
  assert.equal(readPdfReadingPosition(db, 1, "/fixture.pdf"), 37);

  await reopened.goto(`${origin}?source=/other.pdf`);
  await expect(reopenedField).toHaveValue("1");
  await expect(reopenedField).toBeEnabled();
  assert.equal(readPdfReadingPosition(db, 1, "/fixture.pdf"), 37, "same title does not alias a different PDF");
  await reopened.goto(`${origin}#page=8`);
  await expect(reopenedField).toHaveValue("8");
  await expect(reopened.locator('.page[data-page-number="8"] canvas')).toBeVisible();
  await expect.poll(() => readPdfReadingPosition(db, 1, "/fixture.pdf")).toBe(8);

  await reopened.evaluate(() => localStorage.setItem("sb:pdf-last-page:artifact:Navigation test", "6"));
  await reopened.goto(`${origin}?source=/other.pdf`);
  await expect(reopenedField).toHaveValue("6");
  await expect.poll(() => readPdfReadingPosition(db, 1, "/other.pdf")).toBe(6);

  await reopenedField.fill("10");
  await reopenedField.press("Enter");
  await reopened.getByRole("button", { name: "Tools", exact: true }).click();
  await reopened.getByRole("button", { name: "Reload PDF bytes" }).click();
  await expect.poll(() => reopened.evaluate(() => window.toolReloaded)).toBe(true);
  await expect(reopenedField).toHaveValue("10");
  await expect(reopened.locator('.page[data-page-number="10"] canvas')).toBeVisible();
});
