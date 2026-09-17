import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright";

async function withQueuePage(check) {
  const bundle = await esbuild.build({
    stdin: {
      contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {useQueuedFollowUps} from './src/app/components/hermes/queued-follow-ups';
        window.steered = []; window.sent = []; window.restored = []; window.mode = 'accept';
        function App() {
          const [busy, setBusy] = useState(true);
          const [chat, setChat] = useState('first');
          const queue = useQueuedFollowUps({
            conversationKey: chat, runInFlight: busy, steerableRunActive: busy,
            onSteer: async (text, attachments, textSelection) => {
              window.steered.push({text, attachments, chat, ...(textSelection ? {textSelection} : {})});
              if (window.mode === 'defer') return new Promise(resolve => {window.resolveSteer = resolve});
              if (window.mode === 'error') throw new Error('Delivery failed');
              return window.mode === 'accept';
            },
            onRestoreDraft: (text, attachments, textSelection) => {window.restored.push({text, attachments, chat, ...(textSelection ? {textSelection} : {})})},
            onSendQueued: async (text, attachments, textSelection) => {window.sent.push({text, attachments, chat, ...(textSelection ? {textSelection} : {})}); setBusy(true)},
          });
          window.queue = queue.queueFollowUp; window.busy = setBusy; window.chat = setChat;
          return <div>{queue.headerContent}<textarea aria-label="Message draft"/><input aria-label="Search"/></div>;
        }
        createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/app.js" ? "application/javascript" : "text/html");
    response.end(request.url === "/app.js" ? bundle.outputFiles[0].text : '<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/chromium"].find(candidate => fs.existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.queue === "function");
    await check(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

test("queued corrections steer once, retain rejected input, and keep attachments and chats isolated", { timeout: 45_000 }, async () => {
  await withQueuePage(async (page) => {
    await page.evaluate(() => window.queue("Use SQLite"));
    await page.getByRole("button", { name: "Steer the active response with: Use SQLite", exact: true }).click();
    await page.waitForFunction(() => !document.body.textContent.includes("Use SQLite"));
    assert.equal(await page.evaluate(() => window.steered.length), 1);
    assert.equal(await page.evaluate(() => window.sent.length), 0);

    await page.evaluate(() => { window.mode = "reject"; window.queue("Include tests"); });
    await page.getByRole("button", { name: "Steer the active response with: Include tests", exact: true }).click();
    await page.getByText("The answer moved on before the correction landed", { exact: false }).waitFor();
    await page.evaluate(() => window.busy(false));
    await page.waitForFunction(() => window.sent.length === 1);
    assert.equal(await page.evaluate(() => window.sent[0].text), "Include tests");

    await page.evaluate(() => { window.mode = "accept"; window.queue("Inspect this", [{ type: "image", name: "image.png", dataUrl: "data:image/png;base64,AA==" }]); });
    const attachmentSteer = page.getByRole("button", { name: "Steer the active response with: Inspect this", exact: true });
    assert.equal(await attachmentSteer.getAttribute("aria-disabled"), "false");
    await attachmentSteer.click();
    await attachmentSteer.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.steered[2].attachments[0].name), "image.png");
    assert.equal(await page.evaluate(() => window.sent.length), 1);

    // The screenshot's file-only row must steer too, and keep its file when
    // the turn completes before the runtime accepts the correction.
    await page.evaluate(() => { window.mode = "reject"; window.queue("", [{ type: "document", name: "blood results.pdf", blobId: "document-01", format: "pdf", text: "Lab results" }]); });
    const fileSteer = page.getByRole("button", { name: "Steer the active response with: blood results.pdf", exact: true });
    assert.equal(await fileSteer.getAttribute("aria-disabled"), "false");
    await fileSteer.click();
    await page.getByText("The answer moved on before the correction landed", { exact: false }).waitFor();
    await page.evaluate(() => window.busy(false));
    await page.waitForFunction(() => window.sent.length === 2);
    assert.equal(await page.evaluate(() => window.sent[1].attachments[0].name), "blood results.pdf");

    await page.evaluate(() => { window.mode = "defer"; window.queue("Original chat only"); });
    await page.getByRole("button", { name: "Steer the active response with: Original chat only", exact: true }).click();
    await page.evaluate(() => { window.chat("second"); window.busy(false); });
    await page.evaluate(() => window.resolveSteer(false));
    await page.waitForFunction(() => !document.body.textContent.includes("Original chat only"));
    assert.equal(await page.evaluate(() => window.sent.length), 2);
    await page.evaluate(() => window.chat("first"));
    await page.waitForFunction(() => window.sent.length === 3);
    assert.deepEqual(await page.evaluate(() => window.sent[2]), { text: "Original chat only", attachments: [], chat: "first" });
  });
});

test("queue deletion undo restores order and attachments without reviving edited or sent messages", { timeout: 45_000 }, async () => {
  await withQueuePage(async (page) => {
    const queuedMessages = () => page.getByRole("button", { name: /^Delete queued message:/ }).evaluateAll(
      buttons => buttons.map(button => button.getAttribute("aria-label").replace("Delete queued message: ", "")),
    );
    const remove = (text) => page.getByRole("button", { name: `Delete queued message: ${text}`, exact: true }).click();
    const attachments = [
      { type: "image", name: "image.png", dataUrl: "data:image/png;base64,AA==" },
      { type: "text", name: "notes.txt", text: "Keep these notes" },
    ];
    await page.evaluate((files) => {
      window.queue("First"); window.queue("Middle", files); window.queue("Last");
    }, attachments);
    await remove("Middle");
    assert.equal(await page.getByRole("group", { name: "Queued messages" }).evaluate(node => node === document.activeElement), true);
    for (const shortcut of ["z", "Control+Shift+z", "Control+Alt+z"]) {
      await page.keyboard.press(shortcut);
      assert.deepEqual(await queuedMessages(), ["First", "Last"]);
    }
    await page.keyboard.press("Control+z");
    assert.deepEqual(await queuedMessages(), ["First", "Middle", "Last"]);

    // A stack restores several removals, including the last visible row.
    await remove("Middle"); await remove("First"); await remove("Last");
    assert.deepEqual(await queuedMessages(), []);
    assert.equal(await page.getByText("Queued message deleted.", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Undo delete queued message", exact: true }).count(), 0);
    await page.keyboard.press("Control+z");
    assert.deepEqual(await queuedMessages(), ["Last"]);
    await page.keyboard.press("Control+z");
    assert.deepEqual(await queuedMessages(), ["First", "Last"]);
    await page.keyboard.press("Meta+z");
    assert.deepEqual(await queuedMessages(), ["First", "Middle", "Last"]);
    await page.keyboard.press("Control+z");
    assert.deepEqual(await queuedMessages(), ["First", "Middle", "Last"]);

    // If an earlier row sends before undo, recover ahead of the surviving
    // successor instead of letting the original numeric index reorder it.
    await remove("Middle");
    await page.evaluate(() => window.busy(false));
    await page.waitForFunction(() => window.sent.length === 1);
    await page.getByRole("group", { name: "Queued messages" }).focus();
    await page.keyboard.press("Control+z");
    assert.deepEqual(await queuedMessages(), ["Middle", "Last"]);
    await page.getByRole("button", { name: "Edit queued message: Middle", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.restored[0]), { text: "Middle", attachments, chat: "first" });
    await page.getByRole("group", { name: "Queued messages" }).focus();
    await page.keyboard.press("Control+z");
    assert.deepEqual(await queuedMessages(), ["Last"]);
    assert.deepEqual(await page.evaluate(() => window.sent.map(item => item.text)), ["First"]);
  });
});

test("queue undo stays in its conversation and leaves native text undo intact", { timeout: 45_000 }, async () => {
  await withQueuePage(async (page) => {
    const remove = (text) => page.getByRole("button", { name: `Delete queued message: ${text}`, exact: true }).click();
    const queue = page.getByRole("group", { name: "Queued messages" });
    await page.evaluate(() => window.queue("First chat"));
    await remove("First chat");
    await page.evaluate(() => window.chat("second"));
    await queue.waitFor({ state: "detached" });
    await page.keyboard.press("Control+z");
    assert.equal(await page.getByRole("button", { name: /^Delete queued message:/ }).count(), 0);
    await page.evaluate(() => window.queue("Second chat"));
    await remove("Second chat");

    for (const label of ["Message draft", "Search"]) {
      const editor = page.getByRole("textbox", { name: label, exact: true });
      await editor.focus();
      await page.keyboard.type("Text to undo");
      await page.keyboard.press("Control+z");
      assert.equal(await editor.inputValue(), "");
      assert.equal(await queue.count(), 1);
      assert.equal(await page.getByRole("button", { name: /^Delete queued message:/ }).count(), 0);
    }

    await queue.focus();
    await page.keyboard.press("Control+z");
    await page.getByRole("button", { name: "Delete queued message: Second chat", exact: true }).waitFor();
    await page.evaluate(() => window.chat("first"));
    await queue.focus();
    await page.keyboard.press("Control+z");
    await page.getByRole("button", { name: "Delete queued message: First chat", exact: true }).waitFor();
    await page.evaluate(() => window.busy(false));
    await page.waitForFunction(() => window.sent.length === 1);
    assert.deepEqual(await page.evaluate(() => window.sent[0]), { text: "First chat", attachments: [], chat: "first" });
    await page.keyboard.press("Control+z");
    assert.equal(await queue.count(), 0);
    assert.equal(await page.getByRole("button", { name: /^Delete queued message:/ }).count(), 0);
  });
});

test("queued quotes stay attached when edited, steered, rejected, or sent later", { timeout: 45_000 }, async () => {
  await withQueuePage(async (page) => {
    const quote = "The electric field points to the right because of surface charges.";
    const textSelection = { id: "selection:field", mode: "chat", sourceMessageId: "answer:field", start: 0, end: quote.length, quote };
    const attachments = [{ type: "text", name: "wire.txt", text: "A resistive wire" }];
    const text = "/interactive-visualizer-in-chat visualize the wire";
    const payload = { text, attachments, textSelection, chat: "first" };
    const enqueue = () => page.evaluate(({ text, attachments, textSelection }) => window.queue(text, attachments, textSelection), payload);
    await enqueue();
    const row = page.locator("[data-queued-message]").filter({ hasText: text });
    assert.ok((await row.innerText()).includes(quote), "the quote and correction share one queued row");
    await page.getByRole("button", { name: `Edit queued message: ${text}`, exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.restored[0]), payload);
    await enqueue();
    await page.getByRole("button", { name: `Steer the active response with: ${text}`, exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.steered[0]), payload);
    assert.equal(await row.count(), 0);

    await page.evaluate(() => { window.mode = "error"; });
    await enqueue();
    await page.getByRole("button", { name: `Steer the active response with: ${text}`, exact: true }).click();
    await page.getByText("Delivery failed", { exact: true }).waitFor();
    assert.ok((await row.innerText()).includes(quote));
    await page.evaluate(() => window.busy(false));
    await page.waitForFunction(() => window.sent.length === 1);
    assert.deepEqual(await page.evaluate(() => window.sent[0]), payload);
    await page.evaluate(() => window.queue("An unrelated follow-up"));
    assert.equal(await page.getByText(`“${quote}”`, { exact: false }).count(), 0);
  });
});
