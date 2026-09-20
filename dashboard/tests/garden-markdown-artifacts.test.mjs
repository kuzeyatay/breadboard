import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import { artifactReferenceMarkdown, parseArtifactReference } from "../../quartz/quartz/util/artifactReference.ts";
import { installCanonicalQuartzReader } from "../scripts/quartz-canonical-reader-bridge.mjs";

const root = path.resolve(import.meta.dirname, "..");
const quartz = path.resolve(root, "../quartz");
const reference = { id: "video-1", conversationId: "chat-1", title: "Lecture recording", kind: "video", version: 2 };

test("artifact references round-trip without allowing titles to escape the fence", () => {
  const ref = { ...reference, title: "A title\n```\n<script>alert(1)</script>" };
  const markdown = artifactReferenceMarkdown(ref);
  assert.equal(markdown.match(/```/g).length, 2);
  assert.deepEqual(parseArtifactReference(markdown.split("\n")[1]), ref);
  for (const value of ["null", "{}", '{"id":"../private","conversationId":"chat"}', JSON.stringify({ ...ref, conversationId: "https://evil.example" })]) {
    assert.equal(parseArtifactReference(value), null);
  }
});

test("notes attach, persist and reopen garden artifacts; video and whiteboard insertion remain available", { timeout: 60_000 }, async () => {
  await import("../scripts/build-quartz-reader.mjs");
  const { renderQuartzDocument } = await import("../src/lib/generated/quartz-reader.mjs");
  const component = await build({ stdin: { resolveDir: quartz, loader: "tsx", contents: `
    import {h} from 'preact'; import render from 'preact-render-to-string';
    import factory from './quartz/components/MarkdownActions';
    const Component = factory();
    export const html=render(h(Component,{fileData:{slug:'demo/lesson'}}));
    export const script=Component.afterDOMLoaded; export const css=Component.css;
  ` }, bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", jsxImportSource: "preact" });
  const editor = await import(`data:text/javascript;base64,${Buffer.from(component.outputFiles[0].text).toString("base64")}`);
  const cards = await build({ entryPoints: [path.join(quartz, "quartz/components/scripts/breadboardArtifact.inline.ts")], bundle: true, write: false, format: "iife", platform: "browser" });
  const { compileString } = createRequire(path.join(quartz, "package.json"))("sass");
  const cardStyle = compileString(fs.readFileSync(path.join(quartz, "quartz/components/styles/breadboardArtifact.inline.scss"), "utf8")).css;
  const host = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
    import React,{useRef}from'react';import{createRoot}from'react-dom/client';
    import Attachments from './src/app/garden/garden-markdown-artifacts';
    function App(){const ref=useRef(null);return <><iframe ref={ref} src="http://localhost:53147/lesson" title="Note" style={{width:'100%',height:'850px'}}/><Attachments iframeRef={ref} quartzOrigin="http://localhost:53147"/></>}
    createRoot(document.getElementById('root')).render(<App/>);
    window.addEventListener('message',async e=>{
      const data=e.data;if(e.origin!=='http://localhost:53147')return;
      if(data.type==='second-brain:get-markdown'){
        const body=await fetch('/api/documents/lesson').then(r=>r.json());
        e.source.postMessage({type:'second-brain:markdown-content-result',slug:data.slug,ok:true,title:'Lesson',body:body.markdown},e.origin);
      }
      if(data.type==='second-brain:save-markdown'){
        await fetch('/api/documents/lesson',{method:'PATCH',body:JSON.stringify({markdown:data.body})});
        e.source.postMessage({type:'second-brain:markdown-save-result',slug:data.slug,ok:true},e.origin);
      }
      if(data.type==='second-brain:upload-markdown-video'){
        window.uploadedVideo=data.file.name;
        e.source.postMessage({type:'second-brain:markdown-video-result',slug:data.slug,ok:true,markdown:'![Clip](/demo/assets/clip.mp4)'},e.origin);
      }
    });
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": path.join(root, "src") }, plugins: [{ name: "viewer-boundary", setup(builder) {
    builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: "dynamic", namespace: "fixture" }));
    builder.onResolve({ filter: /\/artifact-viewer$/ }, () => ({ path: "viewer", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root, contents: args.path === "dynamic" ? `
      import React from 'react';export default loader=>{const Component=React.lazy(loader);return props=><React.Suspense fallback={null}><Component {...props}/></React.Suspense>}
    ` : `
      import React from 'react';export default function Viewer({artifact,onClose}){return <aside role="dialog" aria-label="Artifact viewer"><h2>{artifact.title}</h2><span>{artifact.id}</span><button onClick={onClose}>Close artifact</button></aside>}
    ` }));
  } }] });

  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    page.setDefaultTimeout(8_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let markdown = "Before\n\nAfter";
    let listFailure = false, missing = false, wrongGarden = false, listRequests = 0, openRequests = 0;
    let extraArtifacts = [], previewFailure = false, previewRequests = 0;
    const ready = { ...reference, gardenId: "demo", status: "ready", previewAvailable: true, downloadAvailable: true, filename: "lecture.mp4" };
    await page.route("http://localhost:53146/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/documents/lesson") {
        if (route.request().method() === "PATCH") markdown = route.request().postDataJSON().markdown;
        return route.fulfill({ json: { markdown } });
      }
      if (url.pathname === "/api/hermes/artifacts") {
        listRequests++;
        assert.equal(url.searchParams.get("gardenSlug"), "demo");
        assert.equal(url.searchParams.get("sourceSurface"), "garden_chat");
        return route.fulfill(listFailure ? { status: 500, json: { error: "Temporary failure." } } : { json: { artifacts: [ready, ...extraArtifacts,
          { ...ready, id: "private", gardenId: "private", title: "Private item" },
          { ...ready, id: "failed", status: "failed", title: "Failed item" },
          { ...ready, id: "generating", status: "generating", title: "Pending item" },
        ] } });
      }
      if (url.pathname === "/api/hermes/artifacts/video-1") {
        openRequests++;
        assert.equal(url.searchParams.get("conversationId"), "chat-1");
        assert.equal(url.searchParams.get("version"), "2");
        return route.fulfill(missing ? { status: 404, json: { error: "Artifact not found." } } : { json: { artifact: { ...ready, gardenId: wrongGarden ? "private" : "demo" } } });
      }
      const item = extraArtifacts.find(item => url.pathname === `/api/hermes/artifacts/${item.id}` || url.pathname === `/api/hermes/artifacts/${item.id}/preview`);
      if (item) {
        if (!url.pathname.endsWith("/preview")) return route.fulfill({ json: { artifact: { ...item, gardenId: wrongGarden ? "private" : "demo" } } });
        previewRequests++;
        if (previewFailure) return route.fulfill({ status: 500, body: "Unavailable" });
        const interactive = item.renderer === "interactive-visualizer";
        return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; ${interactive ? "script-src 'unsafe-inline';" : ""} frame-ancestors 'self'; base-uri 'none'; form-action 'none'` }, body: interactive ? `
          <h2>Interactive controls</h2><button id="play">Play model</button>
          <script>
            const channel=new URLSearchParams(location.search).get('channel')||'standalone';
            document.querySelector('button').onclick=()=>document.querySelector('button').textContent='Playing';
            addEventListener('message',event=>{const d=event.data;if(event.source===parent&&d.channel===channel){if(d.type==='host-theme')document.documentElement.dataset.theme=d.theme;if(d.type==='host-presentation')document.documentElement.dataset.presentation=d.presentation;}});
            parent.postMessage({protocol:'breadboard:interactive-visualizer:v1',type:'ready',channel,height:620},'*');
          </script>` : `<style>body{font:16px system-ui;padding:24px;background:#eff7f1;color:#244432}h2{font-size:28px}</style><h2>Energy dashboard</h2><p>A web artifact rendered inside the garden.</p><script>document.querySelector('h2').textContent='UNSAFE SCRIPT EXECUTED'</script>` });
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<div id="root"></div><script>${host.outputFiles[0].text}</script>` });
    });
    await page.route("http://localhost:53147/**", async route => {
      const rendered = await renderQuartzDocument({ content: markdown, relativePath: "demo/lesson.md", contentRoot: quartz, allFiles: ["demo/lesson.md"] });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--light:#fff;--dark:#222;--secondary:#385845;--lightgray:#ddd;--gray:#666;--codeFont:monospace}body{font-family:system-ui}${editor.css}${cardStyle}</style>${editor.html}<article class="popover-hint">${rendered.html}</article><script>(${installCanonicalQuartzReader.toString()})();</script><script>${editor.script}</script><script>${cards.outputFiles[0].text}</script><script>document.dispatchEvent(new Event('nav'))</script>` });
    });
    await page.goto("http://localhost:53146/");
    const frame = page.frameLocator('iframe[title="Note"]');
    const refreshArticle = async (html) => {
      await page.evaluate(html => new Promise(resolve => {
        const requestId = crypto.randomUUID();
        const rendered = event => {
          if (event.data?.type !== "second-brain:canonical-document-rendered" || event.data.requestId !== requestId) return;
          window.removeEventListener("message", rendered);
          resolve();
        };
        window.addEventListener("message", rendered);
        document.querySelector('iframe').contentWindow.postMessage({
          type: "second-brain:canonical-document", slug: "demo/lesson", requestId, html,
        }, "http://localhost:53147");
      }), html);
    };
    // The real dashboard replaces the published article with canonical content.
    // It cleans up window listeners but preserves the already-bound editor.
    await frame.locator(".markdown-actions").evaluate(el => { el.lifecycleProbe = true; });
    await refreshArticle("<p>Before</p><p>After</p>");
    assert.equal(await frame.locator(".markdown-actions").evaluate(el => el.lifecycleProbe), true);
    await frame.getByRole("button", { name: "Edit markdown", exact: true }).click();
    await frame.locator(".markdown-editor-textarea").waitFor({ state: "visible" });
    await frame.locator(".markdown-editor-textarea").evaluate(el => el.setSelectionRange(6, 6));
    await frame.getByRole("button", { name: "Attach artifact", exact: true }).click();
    await frame.getByRole("button", { name: "Attach Lecture recording" }).waitFor({ timeout: 5000 }).catch(async error => {
      await page.screenshot({ path: path.join(root, ".tmp-artifact-attachments.png") });
      throw new Error(`${error.message}\n${JSON.stringify({ errors, listRequests, status: await frame.locator(".markdown-editor-artifacts").innerHTML() })}`);
    });
    assert.equal(await frame.locator(".markdown-editor-artifact-item").count(), 1);
    await frame.getByRole("searchbox").fill("no-match");
    await frame.getByText("No matching artifacts.", { exact: true }).waitFor();
    await frame.getByRole("searchbox").fill("lecture");
    await frame.getByRole("button", { name: "Attach Lecture recording" }).click();
    const edited = await frame.locator(".markdown-editor-textarea").inputValue();
    assert.ok(edited.indexOf("Before") < edited.indexOf("```artifact"));
    assert.ok(edited.indexOf("```artifact") < edited.indexOf("After"));
    await refreshArticle("<p>Refreshed while editing</p>");
    assert.equal(await frame.locator(".markdown-editor-textarea").inputValue(), edited, "refresh preserves the draft");
    await frame.getByRole("button", { name: "Attach artifact", exact: true }).click();
    await frame.getByRole("button", { name: "Attach Lecture recording" }).waitFor({ timeout: 5000 });
    assert.equal(listRequests, 2, "refresh rebinds replies without duplicating button handlers");
    await frame.getByRole("button", { name: "Close", exact: true }).click();
    await frame.getByRole("button", { name: "Save", exact: true }).click();
    await frame.locator(".markdown-editor-modal").waitFor({ state: "hidden" });
    await page.reload();
    await frame.getByRole("button", { name: "Open video", exact: true }).click();
    await page.getByRole("dialog", { name: "Artifact viewer" }).waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Artifact viewer" }).getByRole("heading").textContent(), "Lecture recording");
    await page.getByRole("button", { name: "Close artifact" }).click();

    missing = true;
    await frame.getByRole("button", { name: "Open video", exact: true }).click();
    await frame.getByText("Artifact not found.", { exact: true }).waitFor();
    missing = false; wrongGarden = true;
    await frame.getByRole("button", { name: "Open video", exact: true }).click();
    await frame.getByText("This artifact does not belong to this garden.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Artifact viewer" }).count(), 0);

    await frame.getByRole("button", { name: "Edit markdown", exact: true }).click();
    await frame.locator(".markdown-editor-placement").selectOption("bottom");
    await frame.getByRole("button", { name: "Add whiteboard", exact: true }).click();
    assert.match(await frame.locator(".markdown-editor-textarea").inputValue(), /```penecho\nid: \d+-[a-zA-Z0-9-]+/);
    await frame.locator(".markdown-editor-video-input").setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("video fixture") });
    await frame.getByText("Video inserted in editor. Click Save to publish.", { exact: true }).first().waitFor();
    assert.match(await frame.locator(".markdown-editor-textarea").inputValue(), /!\[Clip\]\(\/demo\/assets\/clip.mp4\)/);
    listFailure = true;
    await frame.getByRole("button", { name: "Attach artifact", exact: true }).click();
    await frame.getByText("Temporary failure. Select Refresh to try again.", { exact: true }).waitFor();
    listFailure = false;
    await frame.getByRole("button", { name: "Refresh", exact: true }).click();
    await frame.getByRole("button", { name: "Attach Lecture recording" }).waitFor();
    await frame.getByRole("searchbox").press("Escape");
    assert.equal(await frame.getByRole("button", { name: "Attach artifact", exact: true }).getAttribute("aria-expanded"), "false");
    await frame.getByRole("button", { name: "Save", exact: true }).click();
    await frame.locator(".markdown-editor-modal").waitFor({ state: "hidden" });
    const rendered = await renderQuartzDocument({ content: markdown, relativePath: "demo/lesson.md", contentRoot: quartz, allFiles: ["demo/lesson.md"] });
    assert.match(rendered.html, /breadboard-artifact-block/);
    assert.match(rendered.html, /penecho-board-block/);
    assert.match(rendered.html, /<video[^>]*controls/);

    wrongGarden = false;
    const htmlArtifact = { ...ready, id: "html-1", title: "Energy dashboard", kind: "html", renderer: "html-file", filename: "energy-dashboard.html", version: 1 };
    const modelArtifact = { ...htmlArtifact, id: "model-1", title: "Interactive controls", renderer: "interactive-visualizer", filename: "controls.html" };
    extraArtifacts = [htmlArtifact, modelArtifact];
    await frame.getByRole("button", { name: "Edit markdown", exact: true }).click();
    await frame.getByRole("button", { name: "Attach artifact", exact: true }).click();
    await frame.getByRole("button", { name: "Attach Energy dashboard", exact: true }).waitFor();
    await frame.getByRole("button", { name: "Web & interactive", exact: true }).click();
    assert.equal(await frame.locator(".markdown-editor-artifact-item").count(), 2);
    await frame.getByRole("searchbox").fill("energy html");
    assert.equal(await frame.locator(".markdown-editor-artifact-item").count(), 1);
    await frame.getByRole("searchbox").fill("");
    await page.screenshot({ path: path.join(root, ".tmp-artifact-attachments-desktop.png") });
    await frame.getByRole("button", { name: "Attach Energy dashboard", exact: true }).click();
    await frame.getByRole("button", { name: "Attach artifact", exact: true }).click();
    await frame.getByRole("button", { name: "Attach Interactive controls", exact: true }).click();
    await frame.getByRole("button", { name: "Save", exact: true }).click();
    await frame.locator(".markdown-editor-modal").waitFor({ state: "hidden" });
    await page.reload();
    const htmlPreview = frame.frameLocator('iframe[title="Energy dashboard preview"]');
    const modelPreview = frame.frameLocator('iframe[title="Interactive controls preview"]');
    await htmlPreview.getByRole("heading", { name: "Energy dashboard", exact: true }).waitFor();
    assert.equal(await frame.locator('iframe[title="Energy dashboard preview"]').getAttribute("sandbox"), "");
    assert.equal(await page.getByRole("dialog", { name: "Artifact viewer" }).count(), 0, "HTML opens inside the note without opening a viewer");
    await modelPreview.getByRole("button", { name: "Play model" }).click();
    await modelPreview.getByRole("button", { name: "Playing", exact: true }).waitFor();
    await frame.locator('iframe[title="Interactive controls preview"][style*="620px"]').waitFor();
    assert.equal(await modelPreview.locator("html").getAttribute("data-presentation"), "inline");
    await frame.locator("html").evaluate(el => el.setAttribute("saved-theme", "dark"));
    await modelPreview.locator('html[data-theme="dark"]').waitFor();
    assert.equal(await frame.locator('iframe[title="Interactive controls preview"]').getAttribute("sandbox"), "allow-scripts");
    const canonical = await renderQuartzDocument({ content: markdown, relativePath: "demo/lesson.md", contentRoot: quartz, allFiles: ["demo/lesson.md"] });
    await refreshArticle(canonical.html);
    await htmlPreview.getByRole("heading", { name: "Energy dashboard", exact: true }).waitFor();
    await modelPreview.getByRole("button", { name: "Play model" }).waitFor();
    previewFailure = true;
    await refreshArticle(canonical.html + "<p>Updated preview</p>");
    await frame.getByRole("button", { name: "Retry preview", exact: true }).first().waitFor();
    previewFailure = false;
    await frame.getByRole("button", { name: "Retry preview", exact: true }).first().click();
    await htmlPreview.getByRole("heading", { name: "Energy dashboard", exact: true }).waitFor();
    wrongGarden = true;
    const previewCountBeforeForbidden = previewRequests;
    await refreshArticle(canonical.html + "<p>Restricted preview</p>");
    await frame.getByText("This artifact does not belong to this garden.", { exact: true }).first().waitFor();
    assert.equal(previewRequests, previewCountBeforeForbidden, "a cross-garden reference never fetches its HTML");
    wrongGarden = false;

    await page.setViewportSize({ width: 390, height: 900 });
    await frame.getByRole("button", { name: "Attach artifact", exact: true }).waitFor({ state: "hidden" });
    await frame.getByRole("button", { name: "Edit markdown", exact: true }).click();
    await frame.getByRole("button", { name: "Attach artifact", exact: true }).click();
    await frame.getByRole("button", { name: "Attach Lecture recording" }).waitFor();
    const panel = frame.locator(".markdown-editor-panel");
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "the editor fits a narrow viewport");
    await page.screenshot({ path: path.join(root, ".tmp-artifact-attachments.png") });

    const before = { listRequests, openRequests };
    await page.evaluate(() => window.postMessage({ type: "second-brain:list-markdown-artifacts", slug: "demo/lesson", requestId: "forged" }, "*"));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual({ listRequests, openRequests }, before, "messages from other windows are ignored");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

