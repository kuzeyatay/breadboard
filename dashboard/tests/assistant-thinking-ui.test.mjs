import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";

test("thinking opens with provider text alone, streams in place, and survives restored responses", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import ActivityPanel from './src/app/components/hermes/activity-panel';
      function App() {
        const [value, setValue] = useState({reasoning: 'Comparing the notes with the question.', answer: '', active: true, notes: [], label: 'Thinking', completedAt: undefined});
        window.update = (patch) => setValue(previous => ({...previous, ...patch}));
        return <ActivityPanel activities={[]} connection={value.active ? 'streaming' : 'idle'}
          reasoning={value.reasoning} progressNotes={value.notes} answerContent={value.answer}
          restoredActivityLabel={value.label}
          responseCompletedAt={value.completedAt}
          responseDurationMs={345440}
          pendingPermission={null} onPermissionDecision={() => {}} />;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, alias: { "@": path.join(root, "src") }, logLevel: "silent",
  });
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.update({label: 'Compacting conversation'}));
    await page.getByRole('button', {name: /Compacting conversation/}).waitFor({timeout: 2000});
    assert.equal(await page.getByRole('list', {name: 'Thinking updates'}).count(), 0);
    await page.evaluate(() => window.update({label: 'Thinking'}));
    const toggle = page.getByRole("button", { name: /Thinking/ });
    await toggle.click();
    const updates = page.getByRole("list", { name: "Thinking updates" });
    await updates.waitFor({ state: "visible" });
    assert.equal(await updates.textContent(), "Comparing the notes with the question.");
    await page.evaluate(() => { window.thinkingNode = document.querySelector('[data-response-progress] li'); window.update({reasoning: 'Comparing the notes with the question. Checking the examples.'}); });
    await page.getByText("Comparing the notes with the question. Checking the examples.", {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.thinkingNode === document.querySelector('[data-response-progress] li')), true);
    await page.evaluate(() => window.update({completedAt: '2026-09-23T14:37:07.984Z', answer: 'The finished introduction.'}));
    await page.getByRole("button", {name: /^Thought/}).waitFor();
    assert.equal(await page.locator('.assistant-response-meta').getAttribute('data-response-state'), 'complete', 'durable completion overrides a stale streaming connection');
    assert.match(await page.locator('.assistant-response-metrics').textContent(), /5m 45s/);
    assert.equal(await page.locator('.thinking-shimmer,.thinking-token-arrow').count(), 0);
    await page.evaluate(() => window.update({completedAt: undefined, answer: ''}));
    await page.getByRole("button", {name: /^Thinking/}).waitFor();
    await page.evaluate(() => window.update({active: false, answer: 'The finished introduction.'}));
    await page.getByRole("button", {name: /^Thought/}).waitFor();
    assert.equal(await updates.isVisible(), true);
    await page.evaluate(() => window.update({reasoning: 'The finished introduction.'}));
    await updates.waitFor({state: "detached"});
    assert.equal(await page.getByRole("button", {name: /^Thought/}).count(), 0);
    await page.evaluate(() => window.update({reasoning: 'Saved thinking summary.', notes: ['I checked the source notes.']}));
    await page.getByRole("button", {name: /^Thought/}).waitFor();
    assert.equal(await updates.locator('li').count(), 2);
    const transferFunction = String.raw`H(s)=\frac{1+s/\omega_z}{(1+s/\omega_{p1})(1+s/\omega_{p2})}`;
    const ordering = String.raw`\omega_{p1}<\omega_{p2}<\omega_z`;
    const values = String.raw`1,\ 10,\ 100\ \mathrm{rad/s}`;
    const mathNote = `I'll plot magnitude and phase for\n\\[\n${transferFunction}\n\\]\nThe screenshot gives only \\(${ordering}\\), so use \\(${values}\\).`;
    await page.evaluate(note => window.update({reasoning: '', notes: [note, 'Checking MATLAB workspace access.']}), mathNote);
    await updates.locator('.katex').first().waitFor({timeout: 2000});
    assert.deepEqual(await updates.locator('annotation[encoding="application/x-tex"]').allTextContents(), [transferFunction, ordering, values]);
    assert.equal(await updates.locator('.katex-display').count(), 1);
    assert.equal(await updates.locator('.katex-error').count(), 0);
    assert.equal(await updates.locator('li').count(), 2);
    assert.equal(await updates.locator('li').last().textContent(), 'Checking MATLAB workspace access.');
    await page.evaluate(note => window.update({active: true, answer: '', reasoning: note, notes: []}), mathNote);
    await page.getByRole('button', {name: /^Thinking/}).waitFor();
    assert.deepEqual(await updates.locator('annotation[encoding="application/x-tex"]').allTextContents(), [transferFunction, ordering, values]);
    await page.evaluate(() => window.update({reasoning: 'Streaming $x_1'}));
    await updates.getByText('Streaming $x_1', {exact: true}).waitFor();
    await page.evaluate(() => window.update({reasoning: 'Streaming $x_1$\n$$x^2$$'}));
    await updates.locator('.katex-display').waitFor();
    assert.deepEqual(await updates.locator('annotation[encoding="application/x-tex"]').allTextContents(), ['x_1', 'x^2']);
    const literalNote = 'The meter costs $5 and the cable costs $10.\n`\\(x_1\\)`\n\n```tex\n\\[x^2\\]\n```';
    await page.evaluate(note => window.update({active: false, reasoning: '', notes: [note]}), literalNote);
    await page.getByRole('button', {name: /^Thought/}).waitFor();
    assert.equal(await updates.locator('.katex').count(), 0);
    assert.match(await updates.textContent(), /costs \$5 and the cable costs \$10/);
    assert.deepEqual(await updates.locator('code').allTextContents(), [String.raw`\(x_1\)`, String.raw`\[x^2\]` + '\n']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
