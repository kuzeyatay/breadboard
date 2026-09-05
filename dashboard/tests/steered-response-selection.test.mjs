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
      import SteeredAssistantResponse from "@/app/components/steered-assistant-response";
      import { ChatSelectionMenu } from "@/app/components/chat-text-selection-ui";
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
          <SteeredAssistantResponse {...window.fixture} sourceMessageId="original-response"
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
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("[data-chat-selectable-message]").first().waitFor();
  };
  await mount();
  return { page, mount };
}

// Select through the real browser range/event path. Text offsets deliberately
// come from the rendered prose rather than Markdown or correction bubbles.
async function selectText(page, segment, quote, occurrence = 0) {
  await page.locator("[data-chat-selectable-message]").nth(segment).evaluate((root, { quote, occurrence }) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = "";
    while (walker.nextNode()) { nodes.push({ node: walker.currentNode, start: text.length }); text += walker.currentNode.textContent; }
    let start = -1;
    for (let i = 0; i <= occurrence; i++) start = text.indexOf(quote, start + 1);
    if (start < 0) throw new Error("Missing selected quote");
    const first = nodes.findLast(entry => entry.start <= start);
    const last = nodes.findLast(entry => entry.start < start + quote.length);
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, start + quote.length - last.start);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    root.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, { quote, occurrence });
  await page.getByRole("toolbar", { name: "Selected text actions" }).waitFor();
}

const quote = "No human study identified here connected better morning motivation or learning to a measured post-waking dopamine peak.";
const paragraph = `**Motivation, reward, and learning:** Dopamine neurons help encode reward value and reward-prediction errors. Dopamine also affects willingness to exert effort. **${quote}**`;

test("Terminal steered responses keep the selection controls and saved highlights", async (t) => {
  const { page, mount } = await pageFor(t, {
    content: paragraph,
    corrections: [{ id: "steer", content: "Explain the human evidence", offset: 0 }],
  });
  const points = await page.getByText(quote, { exact: true }).evaluate((element) => {
    const text = element.firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const first = range.getBoundingClientRect();
    range.setStart(text, text.length - 1);
    range.setEnd(text, text.length);
    const last = range.getBoundingClientRect();
    return { start: { x: first.left, y: first.top + first.height / 2 }, end: { x: last.right, y: last.top + last.height / 2 } };
  });
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 20 });
  await page.mouse.up();
  await page.getByRole("toolbar", { name: "Selected text actions" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Ask in chat", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Ask here", exact: true }).isVisible(), true);
  const candidate = await page.evaluate(() => window.selectionCandidate);
  assert.equal(candidate.sourceMessageId, "original-response");
  assert.equal(candidate.quote, quote);
  if (process.env.SELECTION_QA_DIR) {
    fs.mkdirSync(process.env.SELECTION_QA_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SELECTION_QA_DIR, "steered-response-controls.png") });
  }
  await page.getByRole("button", { name: "Highlight blue", exact: true }).click();
  assert.equal(await page.locator("mark").innerText(), quote);
  await mount();
  assert.equal(await page.locator("mark").innerText(), quote, "highlight survives remount from saved anchors");
  await page.locator("mark").click();
  await page.getByRole("button", { name: "Remove highlight", exact: true }).click();
  assert.equal(await page.locator("mark").count(), 0);
  for (const [label, mode] of [["Ask in chat", "chat"], ["Ask here", "inline"]]) {
    await selectText(page, 0, quote);
    await page.getByRole("button", { name: label, exact: true }).click();
    assert.equal(await page.evaluate(() => window.question.mode), mode);
    assert.equal(await page.evaluate(() => window.question.quote), quote);
  }
});

test("later sections use message-relative anchors and disambiguate repeated quotes", async (t) => {
  const first = "Before: **repeated phrase**.\n\n";
  const { page, mount } = await pageFor(t, {
    content: first + "After: **repeated phrase**.",
    corrections: [{ id: "middle", content: "repeated phrase must not be highlighted here", offset: first.length }],
  });
  await selectText(page, 1, "repeated phrase");
  const candidate = await page.evaluate(() => window.selectionCandidate);
  assert.ok(candidate.start > "Before: repeated phrase.".length);
  assert.doesNotMatch(candidate.prefix, /must not be highlighted/);
  await page.getByRole("button", { name: "Highlight green", exact: true }).click();
  await mount();
  assert.equal(await page.locator("[data-chat-selectable-message]").nth(0).locator("mark").count(), 0);
  assert.equal(await page.locator("[data-chat-selectable-message]").nth(1).locator("mark").innerText(), "repeated phrase");
  assert.equal(await page.locator("[data-selection-exclude] mark").count(), 0);
});

test("selections spanning a correction exclude the user text and paint both assistant sections", async (t) => {
  const { page, mount } = await pageFor(t, {
    content: "First section.\n\nSecond section.",
    corrections: [{ id: "middle", content: "User-only instruction", offset: 16 }],
  });
  await page.evaluate(() => {
    const sections = document.querySelectorAll("[data-chat-selectable-message] p");
    const range = document.createRange();
    range.setStart(sections[0].firstChild, 0);
    range.setEnd(sections[1].firstChild, sections[1].textContent.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    sections[1].dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", shiftKey: true, bubbles: true }));
  });
  await page.getByRole("toolbar").waitFor();
  assert.equal(await page.evaluate(() => window.selectionCandidate.quote), "First section.Second section.");
  await page.getByRole("button", { name: "Highlight pink", exact: true }).click();
  await mount();
  assert.deepEqual(await page.locator("mark").allInnerTexts(), ["First section.", "Second section."]);
  assert.equal(await page.locator("[data-selection-exclude] mark").count(), 0);
});

test("the Terminal steered branch supplies the same actions and anchors as ordinary responses", () => {
  const panel = fs.readFileSync(path.join(root, "src/app/components/hermes/agent-runtime-panel.tsx"), "utf8");
  const branch = panel.match(/<SteeredAssistantResponse[\s\S]*?\/>/)?.[0] ?? "";
  for (const prop of ["sourceMessageId", "annotations", "onSelection", "onOpenAnnotation"]) {
    assert.ok(branch.includes(`${prop}=`), `missing ${prop} on Terminal's steered branch`);
  }
});
