import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("retry and branch switching preserve artifacts attached to earlier responses", () => {
  const cards = source("../src/app/components/hermes/inline-artifact-cards.tsx");
  const runtimePanel = source("../src/app/components/hermes/agent-runtime-panel.tsx");
  const gardenWorkspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");

  for (const source of [cards, runtimePanel, gardenWorkspace]) {
    assert.doesNotMatch(source, /retireVersion|retiredSnapshot|setInlineArtifactRetireVersion/);
  }
  assert.match(cards, /artifact\.assistantMessageId === ownerMessageId/);

  assert.doesNotMatch(cards, /DELETE|archiveArtifact|removeArtifact/);
});

test("a second visualizer version stays in its reply and opens the matching version", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const stubs = {
    "./artifact-viewer": `export default ({artifact}) => artifact ?
      <output data-viewer-version={artifact.version}>{artifact.title}</output> : null;
      export const ARTIFACT_BROWSER_EVENT = 'artifact-test-refresh';
      export const artifactDescription = () => 'Interactive model';
      export const artifactPdfHref = () => null;
      export const artifactUrl = a => '/preview?id=' + a.id + '&version=' + a.version;
      export const ArtifactFileIcon = () => null;`,
    "./artifact-image-studio": "export default () => null;",
    "./artifact-video-studio": "export default () => null;",
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Cards, {InlineArtifactCardsProvider} from './src/app/components/hermes/inline-artifact-cards';
      function Chat() {
        const [chat, setChat] = useState('circuit');
        return <>
          <button onClick={() => setChat(c => c === 'circuit' ? 'other' : 'circuit')}>Switch chat</button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('artifact-test-refresh', {detail:{conversationId:chat}}))}>Refresh artifacts</button>
          <InlineArtifactCardsProvider conversationId={chat}>
            <section data-reply="first"><Cards ownerMessageId="msg_92"/></section>
            <section data-reply="second"><Cards ownerMessageId="msg_94"/></section>
          </InlineArtifactCardsProvider>
        </>;
      }
      createRoot(document.getElementById('root')).render(<Chat/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "unrelated-artifact-editors", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : null);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
  const original = {
    id: "art_circuit", assistantMessageId: "msg_92", conversationId: "circuit", version: 1,
    title: "Electron settling", status: "ready", renderer: "interactive-visualizer", kind: "html",
    sourceSkill: "interactive-visualizer-in-chat", previewAvailable: true, downloadAvailable: true,
  };
  const revised = { ...original, assistantMessageId: "msg_94", version: 2, title: "Full electric field" };
  let publishedRevision = false;
  const queries = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/bundle.js") {
      res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text);
    } else if (url.pathname === "/api/hermes/artifacts") {
      queries.push(url.searchParams.get("presentation"));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ artifacts: url.searchParams.get("conversationId") === "circuit"
        ? publishedRevision ? [revised, original] : [original] : [] }));
    } else if (url.pathname === "/preview") {
      res.setHeader("content-type", "text/html"); res.end(`<p>Scene version ${url.searchParams.get("version")}</p>`);
    } else {
      res.setHeader("content-type", "text/html");
      res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    page.setDefaultTimeout(5_000);
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const first = page.locator('[data-reply="first"]');
    const second = page.locator('[data-reply="second"]');
    await first.getByText("Electron settling", { exact: true }).waitFor();
    const firstFrame = await first.locator('iframe').elementHandle();
    const originalSrc = await first.locator('iframe').getAttribute('src');
    assert.match(originalSrc, /version=1/);
    assert.equal(await second.locator('iframe').count(), 0);
    publishedRevision = true;
    await page.getByRole("button", { name: "Refresh artifacts", exact: true }).click();
    await second.getByText("Full electric field", { exact: true }).waitFor();
    assert.equal(await firstFrame.evaluate(node => node.isConnected), true, "publishing v2 leaves the v1 iframe mounted");
    assert.equal(await first.locator('iframe').getAttribute('src'), originalSrc);
    assert.match(await second.locator('iframe').getAttribute('src'), /version=2/);
    await first.getByRole('button', { name: /Electron settling/ }).click();
    await page.locator('[data-viewer-version="1"]').waitFor();
    await second.getByRole('button', { name: /Full electric field/ }).click();
    await page.locator('[data-viewer-version="2"]').waitFor();
    await second.getByRole('button', { name: /Full electric field/ }).click();
    assert.equal(await page.locator('[data-viewer-version]').count(), 0, "the same version toggles closed");
    await page.reload();
    await first.getByText("Electron settling", { exact: true }).waitFor();
    await second.getByText("Full electric field", { exact: true }).waitFor();
    assert.match(await first.locator('iframe').getAttribute('src'), /version=1/);
    assert.match(await second.locator('iframe').getAttribute('src'), /version=2/);
    await page.getByRole("button", { name: "Switch chat", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
    await page.getByRole("button", { name: "Switch chat", exact: true }).click();
    await first.getByText("Electron settling", { exact: true }).waitFor();
    await second.getByText("Full electric field", { exact: true }).waitFor();
    assert.ok(queries.length >= 3);
    assert.ok(queries.every(value => value === "transcript"));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("artifacts wait for thinking while earlier frames survive retries, branches, refresh and chat switches", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const stubs = {
    "./artifact-viewer": `export default () => null;
      export const ARTIFACT_BROWSER_EVENT = 'artifact-test-refresh';
      export const artifactDescription = () => 'Interactive model';
      export const artifactPdfHref = () => null;
      export const artifactUrl = a => '/preview?id=' + a.id;
      export const ArtifactFileIcon = () => null;`,
    "./artifact-image-studio": "export default () => null;",
    "./artifact-video-studio": "export default () => null;",
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Cards, {InlineArtifactCardsProvider} from './src/app/components/hermes/inline-artifact-cards';
      function Chat() {
        const [chat, setChat] = useState('first');
        const [owner, setOwner] = useState(30);
        const [thinking, setThinking] = useState(true);
        return <>
          <button onClick={() => { setOwner(31); setThinking(true); }}>Retry</button>
          <button onClick={() => setThinking(false)}>Finish thinking</button>
          <button onClick={() => setOwner(30)}>Previous branch</button>
          <button onClick={() => setOwner(31)}>Next branch</button>
          <button onClick={() => setChat(c => c === 'first' ? 'other' : 'first')}>Switch chat</button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('artifact-test-refresh', {detail:{conversationId:chat}}))}>Refresh artifacts</button>
          <InlineArtifactCardsProvider conversationId={chat}>
            <section data-owner="earlier"><Cards ownerMessageId={10}/><Cards ownerMessageId={20}/></section>
            <section data-owner="latest"><Cards ownerMessageId={owner} thinking={thinking}/></section>
          </InlineArtifactCardsProvider>
        </>;
      }
      createRoot(document.getElementById('root')).render(<Chat/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "unrelated-artifact-editors", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : null);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
  const artifacts = [10, 20, 30, 31].map(owner => ({
    id: `art_${owner}`, assistantMessageId: owner, conversationId: "first", version: 1,
    title: `Visual ${owner}`, status: "ready", renderer: "interactive-visualizer", kind: "html",
    sourceSkill: "interactive-visualizer-in-chat", previewAvailable: true, downloadAvailable: true,
  }));
  artifacts.push(
    ...["document", "image"].flatMap(kind => ["ready", "running", "failed"].map(status => ({
      ...artifacts[2], id: `${kind}_${status}`, title: `${kind} ${status}`,
      kind, status, renderer: kind, sourceSkill: undefined,
    }))),
  );
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/bundle.js") {
      res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text);
    } else if (url.pathname === "/api/hermes/artifacts") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ artifacts: url.searchParams.get("conversationId") === "first" ? artifacts : [] }));
    } else if (url.pathname === "/preview") {
      res.setHeader("content-type", "text/html"); res.end("<p>Interactive scene</p>");
    } else {
      res.setHeader("content-type", "text/html");
      res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText("Visual 20", { exact: true }).waitFor();
    const earlierFrames = await page.locator('[data-owner="earlier"] iframe').elementHandles();
    assert.equal(earlierFrames.length, 2);
    const latest = page.locator('[data-owner="latest"]');
    // The API already has ready documents, images and interactive visuals.
    // Neither cached data nor a refresh may reveal them during thinking.
    assert.equal(await latest.locator('section, img, iframe').count(), 0);
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/hermes/artifacts')),
      page.getByRole("button", { name: "Refresh artifacts", exact: true }).click(),
    ]);
    assert.equal(await latest.locator('section, img, iframe').count(), 0);
    await page.getByRole("button", { name: "Finish thinking" }).click();
    await latest.getByText("document ready", { exact: true }).waitFor();
    await latest.getByRole("img", { name: "image ready", exact: true }).waitFor();
    assert.equal(await latest.locator('iframe').count(), 1);
    assert.equal(await latest.getByText(/(?:document|image) (?:running|failed)/).count(), 0);
    for (const [action, title] of [["Retry", "Visual 31"], ["Previous branch", "Visual 30"], ["Next branch", "Visual 31"], ["Refresh artifacts", "Visual 31"]]) {
      await page.getByRole("button", { name: action, exact: true }).click();
      if (action === "Retry") {
        assert.equal(await latest.locator('section, img, iframe').count(), 0);
        for (const frame of earlierFrames) assert.equal(await frame.evaluate(node => node.isConnected), true);
        await page.getByRole("button", { name: "Finish thinking" }).click();
      }
      await page.locator('[data-owner="latest"]').getByText(title, { exact: true }).waitFor();
      assert.equal(await page.locator('[data-owner="earlier"] iframe').count(), 2);
      for (const frame of earlierFrames) assert.equal(await frame.evaluate(node => node.isConnected), true);
    }
    await page.getByRole("button", { name: "Switch chat" }).click();
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
    await page.getByRole("button", { name: "Switch chat" }).click();
    await page.getByText("Visual 20", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Visual 20", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-owner="earlier"] iframe').count(), 2);
    assert.equal(await latest.locator('section, img, iframe').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
