import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

test("PDF session restoration settles with inline options and still follows document scope", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import React, {useEffect, useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {useAgentSession} from './src/app/components/hermes/use-agent-session';
        import {useChatAutoScroll} from './src/app/components/use-chat-auto-scroll';
        window.loadingChanges = [];
        window.renders = 0;
        window.errors = [];
        class Boundary extends React.Component {
          state = {failed: false};
          static getDerivedStateFromError() { return {failed: true}; }
          componentDidCatch(error) { window.errors.push(error.message); }
          render() { return this.state.failed ? <p>Session crashed</p> : this.props.children; }
        }
        function PdfSession() {
          const [documentKey, setDocumentKey] = useState('pdf:first');
          const [revision, setRevision] = useState(0);
          // The PDF assistant passes a fresh object on each render.
          const session = useAgentSession('dashboard_terminal', {
            pageSlug: documentKey,
            title: 'PDF revision ' + revision,
          });
          const scroll = useChatAutoScroll({
            isResponding: false,
            responseKey: 'no-user-message',
            contentKey: 'empty',
            conversationKey: session.sessionId,
            enabled: !session.loadingSession,
          });
          useEffect(() => {
            window.loadingChanges.push(session.loadingSession);
          }, [session.loadingSession]);
          // Bound a regression so a restore loop fails without hanging Chromium.
          if (++window.renders > 60) throw new Error('Session restore did not settle');
          return <>
            <div ref={scroll.ref} style={{display: 'none'}} />
            <output>{session.loadingSession ? 'Loading' : 'Ready'}:{session.sessionId ?? 'new'}</output>
            <button onClick={() => setRevision(n => n + 1)}>Rerender</button>
            <button onClick={() => setDocumentKey('pdf:second')}>Change document</button>
            <p>{session.messages.map(message => message.content).join(' ')}</p>
          </>;
        }
        createRoot(document.getElementById('root')).render(<Boundary><PdfSession/></Boundary>);
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "artifact-boundary",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/inline-artifact-cards$/ }, () => ({ path: "artifacts", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const primeInlineArtifacts = async () => [];" }));
      },
    }],
  });
  const historyRequests = [];
  const session = {
    id: "conv_second_pdf",
    pageSlug: "pdf:second",
    messages: [{ role: "assistant", content: "Saved PDF discussion" }],
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/bundle.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (url.pathname.startsWith("/api/")) {
      response.setHeader("content-type", "application/json");
      if (url.pathname === "/api/hermes/sessions") {
        historyRequests.push(url.pathname);
        response.end(JSON.stringify({ sessions: [session] }));
      } else if (url.pathname === `/api/hermes/sessions/${session.id}`) {
        response.end(JSON.stringify({ session }));
      } else {
        response.end("{}");
      }
    } else {
      response.setHeader("content-type", "text/html");
      response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "/usr/bin/chromium",
    ].find(existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelector("output")?.textContent === "Ready:new" || window.errors.length > 0);
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.errors), []);
    assert.deepEqual(await page.evaluate(() => window.loadingChanges), [true, false]);
    for (let index = 0; index < 3; index += 1) {
      await page.getByRole("button", { name: "Rerender", exact: true }).click();
    }
    assert.deepEqual(await page.evaluate(() => window.loadingChanges), [true, false], "rendering and title changes must not restart restoration");
    assert.equal(historyRequests.length, 1);
    await page.getByRole("button", { name: "Change document" }).click();
    await page.waitForFunction(() => document.querySelector("output")?.textContent === "Ready:conv_second_pdf");
    assert.equal(await page.getByText("Saved PDF discussion").count(), 1);
    assert.deepEqual(await page.evaluate(() => window.loadingChanges), [true, false, true, false]);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.errors), []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
