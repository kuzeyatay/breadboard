import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";
import { chromium } from "playwright";

// The standalone build generates this bundle too; a clean test checkout must
// not depend on a developer having launched the dashboard beforehand.
await import("../scripts/build-quartz-reader.mjs");
const { renderQuartzDocument } = await import("../src/lib/generated/quartz-reader.mjs");

const root = path.resolve(import.meta.dirname, "..");
const original = '---\ntitle: Fields\nknowledge_type: learning-page\n---\n\n# Fields\n\nOld introduction.\n\n## Mathematics\n\n$E = F/q$\n\n[[other|Related page]]\n';
const replacement = original.replace("Old introduction.", "The word **electromagnetic** combines electric and magnetic fields.");

test("Apply saves and updates the real reader before publication, including reload and retry", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quartz-live-revision-"));
  const contentRoot = path.join(dir, "content"), garden = path.join(contentRoot, "physics");
  fs.mkdirSync(path.join(garden, "unit"), { recursive: true });
  const file = path.join(garden, "unit/fields.md");
  fs.writeFileSync(file, original);
  const previousRoot = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = contentRoot;
  let browser, appServer, frameServer;
  try {
    const writerBundle = await build({
      entryPoints: [path.join(root, "src/lib/garden-documents.ts")], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{ name: "isolated-garden", setup(builder) {
        builder.onResolve({ filter: /\/(knowledge|quartz-publish|garden-mutation-lease)\.ts$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.includes("knowledge")
          ? `import path from 'node:path';export const slugify=s=>s;export const normalizeTopicTags=()=>[];export const refreshClusterIndex=()=>{};export const walkClusterMarkdown=dir=>[{entry:'fields.md',filePath:path.join(dir,'unit/fields.md'),relPath:'unit/fields.md',folder:'unit'}];`
          : args.path.includes("quartz-publish") ? `export const publishQuartzAfterMutation=()=>new Promise(()=>{});`
          : `export const withGardenMutationLease=(_dir,_operation,action)=>action();` }));
      } }],
    });
    const module = { exports: {} };
    new Function("require", "module", "exports", writerBundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const proposal = { id: 3, status: "pending", kind: "page_revision", garden_id: "physics", page_slug: "unit/fields", payload: JSON.stringify({ patchOrReplacement: "@@\n-Old introduction.\n+The word **electromagnetic** combines electric and magnetic fields." }) };
    const routePath = path.join(root, "src/app/api/gardens/[gardenId]/proposals/[proposalId]/route.ts");
    const tree = ts.createSourceFile("route.ts", fs.readFileSync(routePath, "utf8"), ts.ScriptTarget.Latest, true);
    const handler = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "POST");
    const routeJs = ts.transpileModule(handler.getText(tree).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const deps = {
      requireUserId: async () => 1, authorizeGardenAccess: () => ({ isOwner: true, slug: "physics", clusterId: 1 }),
      getProposalById: () => proposal, readJsonBody: r => r.json(),
      reviseGardenDocument: module.exports.reviseGardenDocument,
      setProposalStatus: (_id, status) => { proposal.status = status; },
      NextResponse: { json: body => Response.json(body) },
      ApiError: class extends Error { constructor(status, _code, message) { super(message); this.status = status; } },
      apiErrorResponse: error => Response.json({ error: error.message }, { status: error.status ?? 500 }),
    };
    const post = new Function(...Object.keys(deps), `${routeJs};return POST`)(...Object.values(deps));
    const publicRoot = path.join(dir, "public");
    fs.mkdirSync(publicRoot);
    // Serve a deliberately stale publication through the production service.
    // Injecting the bridge in the fixture would hide a missing server integration.
    fs.writeFileSync(path.join(publicRoot, "index.html"), `<head></head><body><h1 class="article-title">Fields</h1><div class="markdown-actions" data-note-slug="physics/unit/fields"></div><article class="popover-hint"><p>Old introduction.</p></article><div class="toc"><ul class="toc-content"></ul></div><button id="selection">Selection action</button><script>
        window.addCleanup=()=>{};window.actionCount=0;
        document.addEventListener('nav',()=>{const button=document.querySelector('#selection');const clicked=()=>window.actionCount++;button.addEventListener('click',clicked);window.addCleanup(()=>button.removeEventListener('click',clicked));});
        document.dispatchEvent(new CustomEvent('nav'));
      </script></body>`);
    const portProbe = http.createServer();
    await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
    const framePort = portProbe.address().port;
    await new Promise(resolve => portProbe.close(resolve));
    frameServer = spawn(process.execPath, [path.join(root, "scripts/runtime-v2-quartz-static-service.mjs"), "--port", String(framePort)], {
      env: { ...process.env, BREADBOARD_QUARTZ_PUBLIC_ROOT: publicRoot },
      stdio: "ignore", windowsHide: true,
    });
    const frameOrigin = `http://127.0.0.1:${framePort}`;
    const readyDeadline = Date.now() + 5_000;
    while (true) {
      if (await fetch(`${frameOrigin}/__health`).then(response => response.ok).catch(() => false)) break;
      if (Date.now() >= readyDeadline) throw new Error("Quartz static service did not become ready");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const ui = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
      import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';
      import Cards,{InlineProposalCardsProvider}from'./src/app/components/hermes/inline-proposal-cards';
      import{useCanonicalQuartzDocument}from'./src/app/garden/use-canonical-quartz-document';
      function App(){const frame=useRef(null),[active,setActive]=useState({cluster:'physics',slug:'unit/fields'});
        const reader=useCanonicalQuartzDocument(frame,${JSON.stringify(frameOrigin)},active,setActive);
        return <><iframe title="Garden" ref={frame} src=${JSON.stringify(frameOrigin)} style={{width:700,height:500}}/>
          {reader.error&&<p role="alert">{reader.error}<button onClick={reader.retry}>Retry reader</button></p>}
          <InlineProposalCardsProvider conversationId="conv-test" gardenSlug="physics"><div data-message-id="msg_3"><p>The proposed introduction:</p><Cards ownerMessageId="msg_3"/></div><p>A later message</p></InlineProposalCardsProvider></>;
      }createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"development"' } });
    let failRead = false;
    appServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(ui.outputFiles[0].text); return; }
        if (url.pathname === "/api/hermes/proposals") {
          res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ proposals: proposal.status === "pending" ? [{ id: 3, assistantMessageId: "msg_3", kind: "page_revision", gardenId: "physics", gardenName: "Physics", pageSlug: "unit/fields", title: "Fields", content: proposal.payload, characters: 100 }] : [] })); return;
        }
        if (url.pathname.startsWith("/api/documents/")) {
          const content = fs.readFileSync(file, "utf8");
          res.setHeader("content-type", "application/json");
          if (failRead) { res.statusCode = 500; res.end(JSON.stringify({ error: "Reader unavailable" })); return; }
          const reader = await renderQuartzDocument({ content, relativePath: "physics/unit/fields.md", contentRoot: contentRoot.replaceAll("\\", "/"), allFiles: ["physics/unit/fields.md", "physics/unit/other.md"] });
          res.end(JSON.stringify({ success: true, content, reader })); return;
        }
        if (req.method === "POST") {
          let body = ""; for await (const chunk of req) body += chunk;
          const response = await post(new Request(url, { method: "POST", body }), { params: Promise.resolve({ gardenId: "physics", proposalId: "3" }) });
          res.statusCode = response.status; res.setHeader("content-type", "application/json"); res.end(await response.text()); return;
        }
        res.setHeader("content-type", "text/html"); res.end('<div id="root"></div><script src="/app.js"></script>');
      } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise(resolve => appServer.listen(0, "127.0.0.1", resolve));
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      window.renderedDocuments = 0;
      window.addEventListener("message", event => {
        if (event.source === document.querySelector("iframe")?.contentWindow && event.data?.type === "second-brain:canonical-document-rendered") window.renderedDocuments++;
      });
    });
    await page.goto(`http://127.0.0.1:${appServer.address().port}`);
    const reader = page.frameLocator('iframe[title="Garden"]');
    await reader.locator(".katex").waitFor();
    const started = performance.now();
    await page.getByRole("button", { name: "Apply revision", exact: true }).click();
    await reader.locator("article strong").getByText("electromagnetic", { exact: true }).waitFor();
    const elapsedMs = Math.round(performance.now() - started);
    assert.ok(elapsedMs < 2500, `Save and visible replacement took ${elapsedMs} ms`);
    await page.getByRole("status").getByText("Page revision #3 applied.", { exact: true }).waitFor();
    assert.equal(fs.readFileSync(file, "utf8"), replacement);
    assert.equal(proposal.status, "applied");
    await reader.getByRole("button", { name: "Selection action" }).click();
    assert.equal(await page.frames().find(frame => frame.url().startsWith(frameOrigin)).evaluate(() => window.actionCount), 1, "Re-rendering does not duplicate existing actions");
    assert.equal(await reader.getByText("Old introduction.", { exact: true }).count(), 0);
    assert.match(await reader.getByRole("link", { name: "Related page", exact: true }).getAttribute("href"), /other/);
    // A network retry is acknowledged without rewriting or double-applying.
    const retry = await page.request.post(`http://127.0.0.1:${appServer.address().port}/api/gardens/physics/proposals/3`, { data: { decision: "apply" } });
    assert.equal(retry.status(), 200); assert.equal(fs.readFileSync(file, "utf8"), replacement);
    await page.reload(); await reader.locator("article strong").getByText("electromagnetic", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Apply revision" }).count(), 0);
    // Reloading only the reader keeps the active slug unchanged. Each refresh
    // must still receive an acknowledgement and show the saved revision.
    for (let reload = 0; reload < 3; reload++) {
      const acknowledged = await page.evaluate(() => window.renderedDocuments);
      await page.frames().find(frame => frame.url().startsWith(frameOrigin)).evaluate(() => location.reload());
      await page.waitForFunction(count => window.renderedDocuments > count, acknowledged);
      await reader.locator("article strong").getByText("electromagnetic", { exact: true }).waitFor();
    }
    failRead = true;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("sb:markdown-updated", { detail: { cluster: "physics", slug: "unit/fields" } })));
    await page.getByRole("alert").getByText("Reader unavailable", { exact: false }).waitFor();
    failRead = false; await page.getByRole("button", { name: "Retry reader" }).click();
    await page.getByRole("alert").waitFor({ state: "detached" });
    assert.equal(fs.readFileSync(file, "utf8"), replacement);
    // Neither a mismatched page nor an untrusted sender may overwrite the view.
    await page.evaluate(() => {
      const frame = document.querySelector("iframe");
      frame.contentWindow.postMessage({ type: "second-brain:canonical-document", slug: "physics/unit/other", html: "WRONG PAGE" }, "*");
    });
    assert.equal(await reader.getByText("WRONG PAGE").count(), 0);
    // A visible article alone does not prove refresh succeeded: the original
    // failure banner appeared only after the five-second acknowledgement timer.
    await page.waitForTimeout(5_500);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(errors, []);
    const artifacts = path.join(root, ".tmp-garden-proposal-review"); fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, "revision-applied-live-reader.png") });
    console.log(`Apply → saved file + visible revised article: ${elapsedMs} ms; publication still stalled; reload passed.`);
  } finally {
    await browser?.close();
    if (appServer) await new Promise(resolve => appServer.close(resolve));
    if (frameServer && frameServer.exitCode === null && frameServer.signalCode === null) {
      const closed = new Promise(resolve => frameServer.once("close", resolve));
      frameServer.kill("SIGTERM");
      await closed;
    }
    if (previousRoot === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = previousRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
