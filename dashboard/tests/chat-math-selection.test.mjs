import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await esbuild.build({
  stdin: {
    contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import {
        ChatSelectionMenu,
        QuotedChatSelection,
        SelectableAssistantMarkdown,
        SelectionComposerContext,
      } from "@/app/components/chat-text-selection-ui";
      function Fixture() {
        const [selection, setSelection] = useState(null);
        const [annotations, setAnnotations] = useState(() => JSON.parse(localStorage.getItem("highlights") || "[]"));
        const save = (next) => {
          setAnnotations(next);
          localStorage.setItem("highlights", JSON.stringify(next));
          setSelection(null);
          getSelection()?.removeAllRanges();
        };
        const ask = (mode) => { window.question = { mode, ...selection }; setSelection(null); };
        return <>
          <SelectableAssistantMarkdown content={window.fixture.content} sourceMessageId="math-response"
            annotations={annotations}
            onSelection={(next) => { window.selectionCandidate = next; setSelection(next); }}
            onOpenAnnotation={(id, anchor) => setSelection({ ...annotations.find(a => a.id === id), anchor })} />
          {selection && <ChatSelectionMenu selection={selection}
            highlighted={annotations.some(a => a.id === selection.id)}
            onHighlightColor={(color) => save([{ ...selection, id: "saved-highlight", kind: "highlight", color }])}
            onRemoveHighlight={() => save([])}
            onAskInChat={() => ask("chat")}
            onAskHere={() => ask("inline")}
            onClose={() => setSelection(null)} />}
          {window.question && <div data-previews>
            <SelectionComposerContext selection={window.question} onCancel={() => {}} />
            <QuotedChatSelection selection={window.question} />
          </div>}
        </>;
      }
      createRoot(document.getElementById("root")).render(<Fixture />);
    `,
    loader: "jsx",
    resolveDir: root,
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  alias: { "@": path.join(root, "src") }, logLevel: "silent",
});

let browser;
let css;
before(async () => {
  const stylesheet = path.join(root, "src/app/globals.css");
  css = (await postcss([tailwindcss({ base: root })]).process(
    fs.readFileSync(stylesheet, "utf8"), { from: stylesheet },
  )).css;
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find((candidate) => candidate && fs.existsSync(candidate));
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close(); });

async function pageFor(t, fixture) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  t.after(() => page.close());
  await page.route("http://selection.test/", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html data-theme="light"><head></head><body><div id="root" style="max-width:800px;margin:90px auto"></div></body></html>',
  }));
  await page.addInitScript((data) => { window.fixture = data; }, fixture);
  const mount = async () => {
    await page.goto("http://selection.test/");
    await page.addStyleTag({ content: css });
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, "node_modules/katex/dist/katex.min.css"), "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("[data-chat-selectable-message]").first().waitFor();
  };
  await mount();
  return { page, mount };
}

/** Select from inside one DOM text node to inside another (or into KaTeX output). */
async function selectBetween(page, startSelector, startOffset, endSelector, endOffset) {
  await page.evaluate(({ startSelector, startOffset, endSelector, endOffset }) => {
    const textNode = (selector) => {
      const element = document.querySelector(selector);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      return walker.nextNode();
    };
    const range = document.createRange();
    range.setStart(textNode(startSelector), startOffset);
    range.setEnd(textNode(endSelector), endOffset);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.querySelector("[data-chat-selectable-message]").dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, { startSelector, startOffset, endSelector, endOffset });
  await page.getByRole("toolbar", { name: "Selected text actions" }).waitFor();
}

const inline = "E = mc^2";
const display = "\\int_0^1 x^2\\,dx = \\frac{1}{3}";
const content = `Einstein wrote $${inline}$ for rest energy.\n\n$$\n${display}\n$$\n\nThat integral is a third.`;

test("a selection through inline math captures the formula as its TeX source", async (t) => {
  const { page, mount } = await pageFor(t, { content });
  // From "wrote" in the first paragraph through the middle of the rendered formula.
  await selectBetween(page, "[data-chat-selectable-message] p", 9, ".katex-html .mord", 0);
  const candidate = await page.evaluate(() => window.selectionCandidate);
  assert.equal(candidate.quote, `wrote $${inline}$`);
  assert.equal(candidate.sourceMessageId, "math-response");
  await page.getByRole("button", { name: "Highlight blue", exact: true }).click();
  const painted = () => page.locator("mark .katex").count();
  assert.equal(await painted(), 1, "the highlight wraps the rendered formula");
  assert.equal(await page.locator("mark").first().innerText(), "wrote ");
  await mount();
  assert.equal(await painted(), 1, "the highlight relocates onto the formula after a remount");
});

test("selecting rendered display math highlights the block and previews render it", async (t) => {
  const { page, mount } = await pageFor(t, { content });
  // From inside the display formula's KaTeX output through the last paragraph.
  await selectBetween(page, ".katex-display .katex-html .mord", 0, "[data-chat-selectable-message] p:last-of-type", 13);
  const candidate = await page.evaluate(() => window.selectionCandidate);
  assert.equal(candidate.quote, `$$${display}$$\nThat integral`);
  await page.getByRole("button", { name: "Highlight green", exact: true }).click();
  assert.equal(await page.locator("mark > .katex-display").count(), 1, "the whole display block sits inside the mark");
  assert.equal(await page.locator("mark > .katex-display").evaluate(el => getComputedStyle(el.parentElement).display), "block");
  await mount();
  assert.equal(await page.locator("mark > .katex-display").count(), 1);
  await page.locator("mark").first().click();
  await page.getByRole("button", { name: "Remove highlight", exact: true }).click();
  assert.equal(await page.locator("mark").count(), 0);

  await selectBetween(page, ".katex-display .katex-html .mord", 0, "[data-chat-selectable-message] p:last-of-type", 13);
  await page.getByRole("button", { name: "Ask in chat", exact: true }).click();
  assert.equal(await page.evaluate(() => window.question.quote), `$$${display}$$\nThat integral`);
  const previews = page.locator("[data-previews]");
  await previews.waitFor();
  assert.equal(await previews.locator(".bb-selection-quote-math .katex").count(), 2, "composer chip and quoted turn both render the formula");
  assert.equal(await previews.locator(".katex-error").count(), 0);
  assert.doesNotMatch(await previews.innerText(), /\\frac/, "no raw TeX leaks into the preview");
  assert.match(await previews.innerText(), /That integral/);
  if (process.env.SELECTION_QA_DIR) {
    fs.mkdirSync(process.env.SELECTION_QA_DIR, { recursive: true });
    await selectBetween(page, "[data-chat-selectable-message] p", 9, ".katex-display .katex-html .mord", 0);
    await page.getByRole("button", { name: "Highlight pink", exact: true }).click();
    await page.screenshot({ path: path.join(process.env.SELECTION_QA_DIR, "math-selection.png") });
  }
});

test("prose dollars stay prose in the selection preview", async (t) => {
  const { page } = await pageFor(t, { content: "It costs $5 and $10 a month, or $x$ when $x = 7$." });
  await selectBetween(page, "[data-chat-selectable-message] p", 0, "[data-chat-selectable-message] p", 30);
  const candidate = await page.evaluate(() => window.selectionCandidate);
  assert.equal(candidate.quote, "It costs $5 and $10 a month, o");
  await page.getByRole("button", { name: "Ask in chat", exact: true }).click();
  const previews = page.locator("[data-previews]");
  await previews.waitFor();
  assert.equal(await previews.locator(".katex").count(), 0);
  assert.match(await previews.innerText(), /\$5 and \$10/);
});
