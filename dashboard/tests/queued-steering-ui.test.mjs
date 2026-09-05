import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright";

test("queued corrections steer once, retain rejected input, and keep attachments and chats isolated", { timeout: 45_000 }, async () => {
  const bundle = await esbuild.build({
    stdin: {
      contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {useQueuedFollowUps} from './src/app/components/hermes/queued-follow-ups';
        window.steered = []; window.sent = []; window.mode = 'accept';
        function App() {
          const [busy, setBusy] = useState(true);
          const [chat, setChat] = useState('first');
          const queue = useQueuedFollowUps({
            conversationKey: chat, runInFlight: busy, steerableRunActive: busy,
            onSteer: async (text, attachments) => {
              window.steered.push({text, attachments, chat});
              if (window.mode === 'defer') return new Promise(resolve => {window.resolveSteer = resolve});
              if (window.mode === 'error') throw new Error('Delivery failed');
              return window.mode === 'accept';
            },
            onRestoreDraft: () => {},
            onSendQueued: async (text, attachments) => {window.sent.push({text, attachments, chat}); setBusy(true)},
          });
          window.queue = queue.queueFollowUp; window.busy = setBusy; window.chat = setChat;
          return <div>{queue.headerContent}</div>;
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

    await page.evaluate(() => window.queue("Inspect this", [{ type: "image", name: "image.png", dataUrl: "data:image/png;base64,AA==" }]));
    const attachmentSteer = page.getByRole("button", { name: "Steer the active response with: Inspect this", exact: true });
    assert.equal(await attachmentSteer.getAttribute("aria-disabled"), "true");
    // aria-disabled is explanatory; the handler still shows the reason.
    await attachmentSteer.dispatchEvent("click");
    await page.getByText("Messages with attachments send as a follow-up when the turn finishes.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.steered.length), 2);
    await page.evaluate(() => window.busy(false));
    await page.waitForFunction(() => window.sent.length === 2);
    assert.equal(await page.evaluate(() => window.sent[1].attachments[0].name), "image.png");

    await page.evaluate(() => { window.mode = "defer"; window.queue("Original chat only"); });
    await page.getByRole("button", { name: "Steer the active response with: Original chat only", exact: true }).click();
    await page.evaluate(() => { window.chat("second"); window.busy(false); });
    await page.evaluate(() => window.resolveSteer(false));
    await page.waitForFunction(() => !document.body.textContent.includes("Original chat only"));
    assert.equal(await page.evaluate(() => window.sent.length), 2);
    await page.evaluate(() => window.chat("first"));
    await page.waitForFunction(() => window.sent.length === 3);
    assert.deepEqual(await page.evaluate(() => window.sent[2]), { text: "Original chat only", attachments: [], chat: "first" });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
