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
        const [value, setValue] = useState({reasoning: 'Comparing the notes with the question.', answer: '', active: true, notes: []});
        window.update = (patch) => setValue(previous => ({...previous, ...patch}));
        return <ActivityPanel activities={[]} connection={value.active ? 'streaming' : 'idle'}
          reasoning={value.reasoning} progressNotes={value.notes} answerContent={value.answer}
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
    const toggle = page.getByRole("button", { name: /Thinking/ });
    await toggle.click();
    const updates = page.getByRole("list", { name: "Thinking updates" });
    await updates.waitFor({ state: "visible" });
    assert.equal(await updates.textContent(), "Comparing the notes with the question.");
    await page.evaluate(() => { window.thinkingNode = document.querySelector('[data-response-progress] li'); window.update({reasoning: 'Comparing the notes with the question. Checking the examples.'}); });
    await page.getByText("Comparing the notes with the question. Checking the examples.", {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.thinkingNode === document.querySelector('[data-response-progress] li')), true);
    await page.evaluate(() => window.update({active: false, answer: 'The finished introduction.'}));
    await page.getByRole("button", {name: /^Thought/}).waitFor();
    assert.equal(await updates.isVisible(), true);
    await page.evaluate(() => window.update({reasoning: 'The finished introduction.'}));
    await updates.waitFor({state: "detached"});
    assert.equal(await page.getByRole("button", {name: /^Thought/}).count(), 0);
    await page.evaluate(() => window.update({reasoning: 'Saved thinking summary.', notes: ['I checked the source notes.']}));
    await page.getByRole("button", {name: /^Thought/}).waitFor();
    assert.equal(await updates.locator('li').count(), 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
