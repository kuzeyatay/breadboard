import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import esbuild from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { expect } from "@playwright/test";

test("download settings save, cancel, recover from errors, and survive a page reload", { timeout: 45_000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import DownloadSettings from './src/app/profile/download-settings-panel';
      createRoot(document.getElementById('root')).render(<React.StrictMode><DownloadSettings/></React.StrictMode>);
    ` }, bundle: true, write: false, format: "iife", platform: "browser",
  });
  const cssInput = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8")
    .replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./profile/download-settings-panel.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssInput, { from: path.join(root, "src/app/globals.css") })).css;
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); }
    else if (req.url === "/app.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
    else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html data-theme="light"><link rel="stylesheet" href="/app.css"><body style="padding:24px;max-width:560px;margin:auto"><main id="root"></main><script src="/app.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 560, height: 400 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const initial = { directory: "C:\\Users\\Example\\Downloads", askWhereToSave: false };
      const read = () => JSON.parse(localStorage.getItem("downloads") || JSON.stringify(initial));
      const save = settings => { localStorage.setItem("downloads", JSON.stringify(settings)); return { ok: true, settings }; };
      window.breadboardDesktop = {
        getDownloadSettings: async () => { if (window.failRead) throw new Error("Unavailable"); return read(); },
        setDownloadPrompt: async askWhereToSave => window.failWrite ? { ok: false, error: "Could not save preference." } : save({ ...read(), askWhereToSave }),
        chooseDownloadDirectory: async () => window.cancelFolder ? { ok: true, settings: read() }
          : save({ ...read(), directory: "D:\\Research\\Exports" }),
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/settings`);
    const toggle = page.getByRole("switch", { name: "Ask where to save each file" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Files save automatically to your download folder.")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.evaluate(() => { window.cancelFolder = true; });
    await page.getByRole("button", { name: "Change…" }).click();
    await expect(page.getByText("C:\\Users\\Example\\Downloads", { exact: true })).toBeVisible();
    await page.evaluate(() => { window.cancelFolder = false; });
    await page.getByRole("button", { name: "Change…" }).click();
    await expect(page.getByText("D:\\Research\\Exports", { exact: true })).toBeVisible();
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("D:\\Research\\Exports", { exact: true })).toBeVisible();
    await page.evaluate(() => { window.failWrite = true; });
    await toggle.click();
    await expect(page.getByRole("alert")).toContainText("Could not save preference.");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.evaluate(() => { window.failWrite = false; });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.setViewportSize({ width: 360, height: 500 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.BREADBOARD_DOWNLOAD_SETTINGS_SCREENSHOT) {
      const screenshot = path.resolve(process.env.BREADBOARD_DOWNLOAD_SETTINGS_SCREENSHOT);
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, fullPage: true });
    }
    await page.evaluate(() => { window.failRead = true; window.dispatchEvent(new Event("focus")); });
    await expect(page.getByRole("alert")).toContainText("Could not load download preferences.");
    await page.evaluate(() => { window.failRead = false; });
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
