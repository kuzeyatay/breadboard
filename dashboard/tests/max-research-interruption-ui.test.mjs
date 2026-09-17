import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

test("failed research hand-back displays its saved report and recorded usage after reload", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {delegatedResponsePresentation} from './src/lib/hermes/delegated-response';
      import {delegatedTurnTotalUsage} from './src/lib/hermes/super-agent-activity';
      import ActivityPanel from './src/app/components/hermes/activity-panel';
      import ChatMarkdown from './src/app/components/chat-markdown';
      const saved = [
        {role:'user',content:'Research this'},
        {role:'assistant',content:'Investigating',usage:{inputTokens:167581,outputTokens:749,totalTokens:168330,cachedInputTokens:0,reasoningTokens:0,scope:'turn'}},
        {role:'user',content:'Brief',internalAgentContinuation:true},
        {role:'assistant',content:'',delegatedAgentRun:true,externalAgentOutcome:'completed',externalAgentResult:'# Saved research\\n\\nFinding with a [primary source](https://example.test/study).'},
        {role:'user',content:'Hand-back',internalAgentContinuation:true},
        {role:'assistant',content:'',failed:true,runtimeError:'failed',internalAgentContinuation:true},
      ];
      const messages = JSON.parse(localStorage.getItem('transcript') || JSON.stringify(saved));
      localStorage.setItem('transcript', JSON.stringify(messages));
      const view = delegatedResponsePresentation(messages,5);
      createRoot(document.getElementById('root')).render(<main>
        <ActivityPanel activities={[]} connection="idle" pendingPermission={null} onPermissionDecision={()=>{}}
          stateLabel={view.stateLabel} stateFailed={view.failed} usage={delegatedTurnTotalUsage(messages,5,undefined)}
          responseDurationMs={1620742}/>
        <ChatMarkdown content={view.fallbackContent}/>
      </main>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent", alias: { "@": `${root}/src` },
  });
  const server = createServer((req, res) => {
    res.setHeader("content-type", req.url === "/app.js" ? "application/javascript" : "text/html");
    res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : '<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.waitForSelector('a[href="https://example.test/study"]');
      const text = await page.locator("main").innerText();
      assert.match(text, /Response interrupted/);
      assert.match(text, /Saved research/);
      assert.match(text, /168k recorded tokens/);
      assert.doesNotMatch(text, /Research synthesized/);
      assert.equal(await page.locator(".animate-pulse").count(), 0);
      if (attempt === 0) await page.reload();
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("research reconnects after restart, stops its timer, and stays interrupted after reload", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import InlineMaxResearchRun from './src/app/components/hermes/inline-max-research-run';
      import {interruptedDelegationMessage} from './src/lib/hermes/super-agent-activity';
      import ActivityPanel from './src/app/components/hermes/activity-panel';
      import ChatMarkdown from './src/app/components/chat-markdown';
      window.streams = [];
      window.terminals = [];
      window.EventSource = class {
        listeners = new Map(); closed = false;
        constructor(url) { this.url = url; window.streams.push(this); }
        addEventListener(name, listener) { this.listeners.set(name, listener); }
        close() { this.closed = true; }
        emit(type, sequenceNumber, payload, at) {
          this.listeners.get(type)?.({data: JSON.stringify({type, sequenceNumber, payload, at})});
        }
      };
      const parent = {role: 'assistant', content: 'Max Research is now investigating.', responseStartedAt: '2026-09-06T19:15:56.283Z'};
      function App() {
        const [worker, setWorker] = useState(() => JSON.parse(localStorage.getItem('worker') || 'null') || {
          role: 'assistant', content: '', delegatedAgentRun: true, externalAgentOutcome: 'running',
        });
        const message = interruptedDelegationMessage(parent, [worker]);
        return <>
          <div hidden><InlineMaxResearchRun runId="job_interrupted" query="Research"
            persistedOutcome={worker.externalAgentOutcome} persistedContent={worker.externalAgentResult}
            onTerminal={result => {
              window.terminals.push(result);
              const next = {...worker, externalAgentOutcome: result.outcome, externalAgentResult: result.content,
                responseCompletedAt: new Date(result.terminalAtMs).toISOString()};
              localStorage.setItem('worker', JSON.stringify(next)); setWorker(next);
            }}/></div>
          <main><ActivityPanel activities={[]} connection={message.interrupted ? 'idle' : 'streaming'}
            pendingPermission={null} onPermissionDecision={() => {}} responseDurationMs={message.responseDurationMs}
            stateLabel={message.interrupted ? 'Interrupted' : undefined} stateFailed={message.interrupted}/>
            <ChatMarkdown content={message.content}/></main>
        </>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent",
    alias: { "@": `${root}/src` },
  });
  const server = createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("content-type", "application/javascript");
      res.end(bundle.outputFiles[0].text);
    } else {
      res.setHeader("content-type", "text/html");
      res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.streams?.some(stream => !stream.closed));
    await page.evaluate(() => {
      const stream = window.streams.findLast(stream => !stream.closed);
      stream.emit("participant.started", 12, { participant: "deep_research" });
      stream.onerror();
    });
    assert.equal(await page.evaluate(() => window.terminals.length), 0, "disconnection alone must not stop a live job");
    await page.waitForFunction(() => window.streams.some(stream => !stream.closed && stream.url.endsWith("since=12")));
    await page.evaluate(() => {
      const stream = window.streams.findLast(stream => !stream.closed);
      stream.emit("run.aborted", 697, { interrupted: true }, "2026-09-06T20:18:28.852Z");
      stream.onerror();
    });
    await page.waitForFunction(() => document.querySelector("main")?.textContent.includes("Interrupted"));
    const content = await page.locator("main").innerText();
    assert.doesNotMatch(content, /Thinking|investigating|Retry|Details/);
    assert.equal(await page.locator("main .animate-pulse").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.terminals), [{
      outcome: "aborted", content: "Interrupted", terminalAtMs: 1788725908852,
    }]);
    const count = await page.evaluate(() => window.streams.length);
    await page.waitForTimeout(3_200);
    assert.equal(await page.evaluate(() => window.streams.length), count, "terminal streams must not reconnect");
    assert.equal(await page.locator("main").innerText(), content, "the elapsed time stays fixed");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("main")?.textContent.includes("Interrupted"));
    assert.equal(await page.evaluate(() => window.streams.length), 0, "restored terminal work does not restart");
    assert.equal(await page.locator("main").innerText(), content);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
