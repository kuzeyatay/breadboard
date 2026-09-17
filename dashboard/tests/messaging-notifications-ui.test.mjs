import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("messaging switches save independently, survive reload, and retain their state on failure", { timeout: 60_000 }, async t => {
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Settings from './src/app/components/settings-messaging';createRoot(document.getElementById('root')).render(<Settings/>);`, loader: "tsx", resolveDir: root },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  const cssInput = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8")
    .replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/settings-messaging*.tsx"; @source "./components/settings-telegram.tsx"; @source "./components/settings-whatsapp.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssInput, { from: path.join(root, "src/app/globals.css") })).css;
  const saved = {
    whatsapp: { enabled: false, recipient: "", recipients: [{ id: "31612345678@s.whatsapp.net", label: "Your WhatsApp · +31612345678" }], available: true, lastError: null, lastSentAt: null },
    telegram: { enabled: false, recipient: "", recipients: [{ id: "123", label: "Your Telegram" }, { id: "456", label: "Second account" }], available: true, lastError: null, lastSentAt: null },
  };
  let failSave = false;
  const writes = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture.test");
    if (url.pathname === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/api/messaging-notifications") {
        if (req.method === "PATCH") {
          let body = ""; for await (const chunk of req) body += chunk;
          const patch = JSON.parse(body); writes.push(patch);
          if (failSave) { res.statusCode = 500; res.end(JSON.stringify({ error: "Couldn’t save notification settings." })); return; }
          Object.assign(saved[patch.channel], { enabled: patch.enabled, recipient: patch.recipient });
          res.end(JSON.stringify({ settings: saved[patch.channel] }));
        } else res.end(JSON.stringify({ settings: saved[url.searchParams.get("channel")] }));
        return;
      }
      const common = { available: true, state: "connected", error: null, autostart: true, managedByAnotherUser: false, chats: [], blocked: [] };
      const status = url.pathname === "/api/telegram" ? { ...common, linked: true, botUsername: "breadboard_bot", botName: "Breadboard", allowedUsers: ["123", "456"] }
        : { ...common, paired: true, linkedNumber: "31612345678", linkedName: "Owner", mode: "self-chat", allowedNumbers: [], log: [], dependenciesInstalled: true };
      res.end(JSON.stringify({ status })); return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="en"><head><link rel="stylesheet" href="/style.css"></head><body style="padding:24px;background:var(--paper)"><main style="max-width:560px;margin:0 auto"><h1 style="font-size:20px;margin-bottom:20px">Settings · Messaging</h1><div id="root"></div></main><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 760, height: 1050 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const whatsappSwitch = page.getByRole("switch", { name: "Send notifications via WhatsApp" });
  await whatsappSwitch.waitFor();
  await page.waitForFunction(() => !document.getElementById("whatsapp-notification-switch").disabled);
  assert.equal(await whatsappSwitch.getAttribute("aria-checked"), "false");
  await whatsappSwitch.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.getElementById("whatsapp-notification-switch").getAttribute("aria-checked") === "true");
  assert.equal(writes.at(-1).recipient, "31612345678@s.whatsapp.net");
  await page.reload();
  await page.waitForFunction(() => document.getElementById("whatsapp-notification-switch")?.getAttribute("aria-checked") === "true");
  await page.getByRole("tab", { name: "Telegram" }).click();
  const telegramSwitch = page.getByRole("switch", { name: "Send notifications via Telegram" });
  await page.getByLabel("Send to", { exact: true }).waitFor();
  assert.equal(await telegramSwitch.isDisabled(), true);
  await page.getByLabel("Send to", { exact: true }).selectOption("123");
  await page.waitForFunction(() => !document.getElementById("telegram-notification-switch").disabled);
  await telegramSwitch.click();
  await page.waitForFunction(() => document.getElementById("telegram-notification-switch").getAttribute("aria-checked") === "true");
  assert.equal(saved.whatsapp.enabled, true);
  const output = path.join(root, ".tmp-messaging-notifications-qa"); fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "telegram-light.png"), fullPage: true });
  failSave = true;
  await telegramSwitch.click();
  await page.getByRole("alert").waitFor();
  assert.equal(await telegramSwitch.getAttribute("aria-checked"), "true");
  failSave = false;
  await telegramSwitch.click();
  await page.waitForFunction(() => document.getElementById("telegram-notification-switch").getAttribute("aria-checked") === "false");
  await page.getByRole("tab", { name: "WhatsApp" }).click();
  await page.waitForFunction(() => document.getElementById("whatsapp-notification-switch")?.getAttribute("aria-checked") === "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "whatsapp-narrow.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
