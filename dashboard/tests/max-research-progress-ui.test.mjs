import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

test("delegated research shows real milestones without a mounted worker card, reconnects, and restores after hand-back", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useMaxResearchProgress} from './src/app/components/hermes/use-max-research-progress';
      import {delegatedResearchProgressForMessage, delegatedThinkingUpdates} from './src/lib/hermes/super-agent-activity';
      import ActivityPanel from './src/app/components/hermes/activity-panel';
      window.streams = [];
      window.EventSource = class {
        listeners = new Map(); closed = false;
        constructor(url) { this.url = url; window.streams.push(this); }
        addEventListener(type, listener) { this.listeners.set(type, listener); }
        close() { this.closed = true; }
        emit(event) { this.listeners.get(event.type)?.({data: JSON.stringify(event)}); }
      };
      const base = [
        {role: 'user', content: 'Research cold showers'},
        {role: 'assistant', content: '', delegatedAgentPreamble: 'Sending this to Max Research.'},
        {role: 'assistant', content: '', delegatedAgentRun: true, maxResearchRun: {runId: 'run-test'}, externalAgentOutcome: 'running'},
      ];
      function App() {
        const [messages, setMessages] = useState(() => JSON.parse(localStorage.getItem('messages') || 'null') || base);
        window.finish = () => {
          const next = [...base.slice(0, 2), {...base[2], externalAgentOutcome: 'completed'},
            {role:'user', content:'Internal hand-back', internalAgentContinuation:true},
            {role:'assistant', content:'The research answer.'}];
          localStorage.setItem('messages', JSON.stringify(next)); setMessages(next);
        };
        const finished = messages.length > 3;
        const progress = useMaxResearchProgress(messages);
        const index = finished ? 4 : 1;
        const research = delegatedResearchProgressForMessage(messages, index, progress);
        const notes = delegatedThinkingUpdates(messages[index], finished ? 'Sending this to Max Research.' : '', research);
        return <main><ActivityPanel activities={[]} connection={finished ? 'idle' : 'streaming'}
          pendingPermission={null} onPermissionDecision={() => {}}
          stateLabel={finished ? 'Thought' : ['Delegating to Max Research agent', research.stage].filter(Boolean).join(' · ')}
          responseDurationMs={2525000} usage={{inputTokens:168000, outputTokens:0, totalTokens:168000, scope:'response'}}
          progressNotes={notes}/>{finished && <p>The research answer.</p>}</main>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, alias: { "@": path.join(root, "src") }, logLevel: "silent",
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const styles = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, "utf8"), { from: stylesheet })).css;
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, executablePath });
  const events = [
    {type: "plan.started"},
    {type: "plan.completed", payload: {participants: [{participant: "deep_research"}, {participant: "get_doc"}, {participant: "aris"}]}},
    {type: "wave.started", payload: {wave: 0}},
    {type: "participant.started", payload: {participant: "deep_research"}},
    {type: "participant.started", payload: {participant: "get_doc"}},
    {type: "participant.settled", payload: {participant: "get_doc", status: "completed", websites: [{}, {}, {}]}},
    {type: "participant.retrying", payload: {participant: "aris", reason: "PRIVATE DIAGNOSTIC"}},
    {type: "synthesis.started"},
    {type: "review.started"},
    {type: "review.completed", payload: {revised: true}},
    {type: "run.completed", payload: {result: "PRIVATE WORKER RESULT"}},
  ].map((event, index) => ({ ...event, sequenceNumber: index + 1, payload: event.payload ?? {} }));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://research.test/", route => route.fulfill({contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>'}));
    await page.route("**/api/max-research/runs/run-test/events?since=0", route => route.fulfill({json: {ok: true, events}}));
    const mount = async () => {
      await page.goto("http://research.test/");
      await page.addStyleTag({content: styles});
      await page.addStyleTag({content: 'body { margin: 0; padding: 32px 20px; background: var(--paper-bg); color: var(--ink); font-family: Arial, sans-serif; } main { max-width: 940px; margin: 60px auto; }'});
      await page.addScriptTag({content: bundle.outputFiles[0].text});
    };
    await mount();
    await page.waitForFunction(() => window.streams.some(stream => !stream.closed));
    await page.getByRole("button", {name: /Delegating to Max Research/}).click();
    const emit = async entries => page.evaluate(values => {
      const stream = window.streams.findLast(stream => !stream.closed);
      values.forEach(event => stream.emit(event));
    }, entries);
    await emit(events.slice(0, 7));
    await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('3 source pages'));
    assert.match(await page.locator(".assistant-response-label").innerText(), /Gathering sources/);
    const notes = page.getByRole("list", {name: "Thinking updates"}).getByRole("listitem");
    const beforeReconnect = await notes.allInnerTexts();
    await page.evaluate(() => window.streams.findLast(stream => !stream.closed).onerror());
    await page.waitForFunction(() => window.streams.some(stream => !stream.closed && stream.url.endsWith("since=7")));
    await emit([events[6], events[7], events[8]]);
    await page.waitForFunction(() => document.querySelector('.assistant-response-label')?.textContent.includes('Checking evidence and citations'));
    assert.deepEqual((await notes.allInnerTexts()).slice(0, beforeReconnect.length), beforeReconnect);
    assert.equal(await notes.count(), beforeReconnect.length + 2);
    for (const width of [1280, 375]) {
      await page.setViewportSize({width, height: 900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('[data-response-progress]').evaluate(el => el.scrollHeight === el.clientHeight), true);
      if (process.env.MAX_RESEARCH_QA_DIR) {
        fs.mkdirSync(process.env.MAX_RESEARCH_QA_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.MAX_RESEARCH_QA_DIR, `research-${width}.png`), fullPage: true});
      }
    }
    await emit(events.slice(9));
    await page.waitForFunction(() => window.streams.every(stream => stream.closed));
    await page.evaluate(() => window.finish());
    await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('The research answer.'));
    const completedNotes = await notes.allInnerTexts();
    assert.equal(completedNotes.at(-1), "Max Research has finished and returned its findings.");
    await mount();
    await page.getByRole("button", {name: /^Thought/}).click();
    await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('returned its findings'));
    assert.deepEqual(await notes.allInnerTexts(), completedNotes);
    assert.equal(await page.evaluate(() => window.streams.length), 0, "finished runs restore with one history read and no stream");
    assert.doesNotMatch(await page.locator('main').innerText(), /PRIVATE/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
