import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { installCanonicalQuartzReader } from "../scripts/quartz-canonical-reader-bridge.mjs";

const root = path.resolve(import.meta.dirname, "..");
const quartz = path.resolve(root, "../quartz");
const dashboardOrigin = "http://localhost:53241", quartzOrigin = "http://localhost:53242";
const stubs = new Map([
  ["@/app/components/use-garden-title", "export const useGardenTitle=()=>{}"],
  ["@/app/components/toast", "export const Toaster=()=>null;export const useToast=()=>({toasts:[],dismissToast:()=>{}})"],
  ["@/lib/folder-pdf-export-client", "export const exportFolderPdf=async()=>({})"],
  ["@/lib/quartz-assistant-selection", "export const quartzAssistantSelectionRequest=()=>null,quartzInlineAnswerStopRequest=()=>null"],
  ["@/lib/quartz-topology-investigation", "export const quartzTopologyInvestigationRequest=()=>null"],
  ["../use-canonical-garden-folders", "export const useCanonicalGardenFolders=()=>{}"],
  ["../use-quartz-view-lease", "export const useQuartzViewLease=()=>({ready:true,failed:false})"],
  ["../use-quartz-reader-layout", "export const useQuartzReaderLayout=()=>({readerLayoutStyle:{},setAssistantWidth:()=>{}})"],
  ...["@/app/components/hermes/garden-assistant-switch", "../quartz-inline-answer-popover", "../garden-markdown-artifacts"].map(name => [name, "export default ()=>null"]),
]);
const host = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import GardenClient from './src/app/garden/[clusterSlug]/garden-client';
    const note=new URL(location.href).searchParams.get('note')||undefined;
    createRoot(document.getElementById('root')).render(<GardenClient clusterSlug="demo" clusterName="Demo" quartzBaseUrl="${quartzOrigin}" note={note}/>);
  ` },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env": "{}" },
  alias: { "@": path.join(root, "src") },
  plugins: [{ name: "unrelated-reader-widgets", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => stubs.has(args.path) ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs.get(args.path), loader: "js" }));
  } }],
});
const editorBundle = await build({
  stdin: { resolveDir: quartz, loader: "tsx", contents: `
    import {h} from 'preact';import render from 'preact-render-to-string';import factory from './quartz/components/MarkdownActions';
    const Component=factory();export const editor=slug=>render(h(Component,{fileData:{slug}}));export const script=Component.afterDOMLoaded;export const css=Component.css;
  ` }, bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", jsxImportSource: "preact",
});
const editor = await import(`data:text/javascript;base64,${Buffer.from(editorBundle.outputFiles[0].text).toString("base64")}`);

async function fixture(run) {
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
    const errors = [], loads = [];
    page.on("pageerror", error => errors.push(error.message));
    const notes = new Map([
      ["folder/first", { title: "First note", body: "Original first body" }],
      ["folder/Second,-note", { title: "Second note", body: "Original second body" }],
    ]);
    await page.route(`${dashboardOrigin}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/documents/")) {
        const slug = decodeURIComponent(url.pathname.slice("/api/documents/".length));
        const note = notes.get(slug);
        if (!note) return route.fulfill({ status: 404, json: { error: "Note not found" } });
        if (route.request().method() === "PATCH") {
          Object.assign(note, route.request().postDataJSON());
          return route.fulfill({ json: { success: true } });
        }
        return route.fulfill({ json: { success: true, ...note, content: note.body, tags: [], reader: {
          slug: `demo/${slug}`, title: note.title, html: `<p>${note.body}</p>`, toc: [],
        } } });
      }
      return route.fulfill({ contentType: "text/html", body: `<style>iframe{width:100%;height:1000px}body{margin:0}</style><div id="root"></div><script>${host.outputFiles[0].text}</script>` });
    });
    await page.route(`${quartzOrigin}/**`, async route => {
      const url = new URL(route.request().url()), slug = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
      loads.push(slug);
      const note = notes.get(slug.replace(/^demo\//, ""));
      // Publication intentionally stays stale. The live reader must render the
      // saved source without waiting for the static site build to finish.
      return route.fulfill({ contentType: "text/html", body: `<style>:root{--light:#fff;--dark:#222;--secondary:#385845;--lightgray:#ddd;--gray:#666}${editor.css}</style><script>(${installCanonicalQuartzReader.toString()})();</script><nav><a href="/demo/folder/first">First</a><a href="/demo/folder/Second,-note">Second</a><a href="/demo">Garden home</a></nav><h1 class="article-title">${note?.title || "Garden"}</h1>${note ? editor.editor(slug) : ""}<article class="popover-hint"><p>Old published content</p></article><script>${editor.script}</script><script>document.dispatchEvent(new Event('nav'));parent.postMessage({type:'second-brain:navigate',slug:${JSON.stringify(slug)},title:document.title},'${dashboardOrigin}')</script>` });
    });
    await page.goto(`${dashboardOrigin}/garden/demo?note=folder%2Ffirst&chat=1`);
    const frame = page.frameLocator('iframe[title="Demo garden"]');
    await frame.locator("article").getByText("Original first body", { exact: true }).waitFor({ timeout: 5000 }).catch(async error => {
      throw new Error(`${error.message}\n${JSON.stringify({ errors, loads, frames: page.frames().map(frame => frame.url()), parent: await page.locator('body').innerText() })}`);
    });
    await run({ page, frame, notes, loads, errors });
  } finally { await browser.close(); }
}

test("saving markdown updates the visible article and title without reloading the iframe", { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame, loads, errors }) => {
    await frame.getByRole("button", { name: "Edit markdown", exact: true }).click();
    await frame.locator(".markdown-editor-textarea").fill("Saved body appears immediately");
    await frame.locator(".markdown-editor-title").fill("Updated title");
    const before = loads.length;
    await frame.getByRole("button", { name: "Save", exact: true }).click();
    await frame.locator("article").getByText("Saved body appears immediately", { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await frame.locator("h1.article-title").textContent(), "Updated title");
    assert.equal(loads.length, before, "save refreshes content in the existing frame");
    await page.waitForTimeout(1100);
    assert.deepEqual(errors, [], "save does not attempt a forbidden cross-origin reload");
  });
});

test("Ctrl+R restores the selected nested note and returning home clears the note URL", { timeout: 30_000 }, async () => {
  await fixture(async ({ page, frame }) => {
    await frame.getByRole("link", { name: "Second", exact: true }).click();
    await frame.locator("article").getByText("Original second body", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("note"), "folder/Second,-note");
    assert.equal(new URL(page.url()).searchParams.get("chat"), "1");
    await page.reload();
    await frame.locator("article").getByText("Original second body", { exact: true }).waitFor();
    const original = page.url();
    await page.evaluate(() => window.postMessage({ type: "second-brain:navigate", slug: "private/secret" }, "*"));
    assert.equal(page.url(), original, "untrusted windows cannot change the saved location");
    await frame.getByRole("link", { name: "Garden home", exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has("note"));
    await page.reload();
    await frame.getByRole("heading", { name: "Garden", exact: true }).waitFor();
  });
});
