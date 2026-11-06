import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Learn Markdown picker selects nested folders, shows partial selection, and locks the current run", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { LearnMarkdownSources } from './src/app/components/learn-markdown-sources';
      import { toggleLearnSourceSelection } from './src/lib/learn-source-selection';
      const documents = [
        { slug: 'note', title: 'My note', type: 'user-note', relPath: 'notes/note.md' },
        { slug: 'saved', title: 'Saved answer', type: 'learning-page', relPath: 'generated/saved.md' },
        { slug: 'nested', title: 'Nested note', type: 'generated-note', relPath: 'generated/week-1/nested.md' },
        { slug: 'guide', title: 'Study guide', type: 'user-note', relPath: 'generated/week-1/guide.md' },
        { slug: 'legacy', title: 'Legacy topic', type: 'knowledge-topic', relPath: 'generated/legacy.md' },
      ];
      function App() {
        const [selected, setSelected] = useState(['note']);
        const [locked, setLocked] = useState(false);
        return <><LearnMarkdownSources documents={documents} selectedIds={new Set(selected)}
          syllabusId="guide" locked={locked}
          onToggle={ids => setSelected(current => toggleLearnSourceSelection(documents, current, ids, 'guide'))} />
          <button onClick={() => setLocked(value => !value)}>Lock selection</button>
          <output>{selected.join(',')}</output></>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  });
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
    } else {
      res.setHeader("content-type", "text/html");
      res.end('<div id="root"></div><script src="/app.js"></script>');
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const generated = page.getByRole("checkbox", { name: "Select folder generated", exact: true });
    const nested = page.getByRole("checkbox", { name: /Nested note/ });
    const guide = page.getByRole("checkbox", { name: /Study guide/ });
    await generated.check();
    assert.equal(await page.locator("output").textContent(), "note,saved,nested");
    assert.equal(await nested.isChecked(), true);
    assert.equal(await guide.isDisabled(), true);
    assert.equal(await guide.isChecked(), false);
    assert.equal(await page.getByText("Legacy topic").count(), 0);
    await nested.uncheck();
    assert.equal(await generated.getAttribute("aria-checked"), "mixed");
    assert.equal(await generated.evaluate(input => input.indeterminate), true);
    await generated.check();
    assert.equal(await page.locator("output").textContent(), "note,saved,nested");
    await generated.uncheck();
    assert.equal(await page.locator("output").textContent(), "note");
    await page.getByRole("button", { name: "Lock selection" }).click();
    for (const checkbox of await page.getByRole("checkbox").all()) {
      assert.equal(await checkbox.isDisabled(), true);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
