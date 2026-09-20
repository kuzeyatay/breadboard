import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("hidden workspace pages defer theme painting and catch up when shown", { timeout: 30_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import Runtime from './src/app/components/app-theme-runtime';
      import {usePageAppearance} from './src/app/components/use-page-appearance';
      import {applyAppTheme} from './src/lib/app-theme';
      function App() {
        const appearance = usePageAppearance('theme-test', 'new-tab');
        return <><Runtime/><output>{appearance.theme}</output></>;
      }
      window.pickTheme = applyAppTheme;
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  });
  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://theme.test/**", route => route.fulfill({
    contentType: "text/html", body: '<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>',
  }));
  await page.goto("http://theme.test/?theme=light");
  await page.evaluate(() => {
    window.themeCalls = [];
    window.testVisibility = "visible";
    Object.defineProperty(document, "visibilityState", { get: () => window.testVisibility });
    window.breadboardDesktop = { setTheme: async (theme, schedule) => { window.themeCalls.push({ theme, schedule }); return true; } };
    window.fetch = async () => new Response("{}", { headers: { "Content-Type": "application/json" } });
    localStorage.setItem("breadboard:theme", "light");
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect.poll(() => page.evaluate(() => window.themeCalls.length)).toBeGreaterThan(0);
  await expect(page.locator("output")).toHaveText("light");
  const callsBefore = await page.evaluate(() => {
    window.testVisibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    return window.themeCalls.length;
  });
  // A different tab picks dark while this renderer is parked.
  await page.evaluate(() => {
    localStorage.setItem("breadboard:theme", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "breadboard:theme", newValue: "dark" }));
    window.dispatchEvent(new CustomEvent("breadboard:theme-change", { detail: "dark" }));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  assert.equal(await page.locator("output").textContent(), "light");
  assert.equal(await page.evaluate(() => window.themeCalls.length), callsBefore);
  await page.evaluate(() => {
    window.testVisibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("output")).toHaveText("dark");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(new URL(page.url()).searchParams.get("theme"), "dark");
  assert.equal(await page.evaluate(() => window.themeCalls.at(-1).theme), "dark");
  // Manual reversals still apply immediately and preserve this document.
  await page.evaluate(() => { window.documentMarker = {}; window.pickTheme("light"); window.pickTheme("dark"); window.pickTheme("light"); });
  await expect(page.locator("output")).toHaveText("light");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  assert.equal(await page.evaluate(() => !!window.documentMarker), true);
  // A sunset while the app is hidden is resolved on return, without waking
  // the parked renderer or repainting its wallpaper in the background.
  await page.clock.setFixedTime(new Date(2026, 8, 20, 23));
  const beforeSunset = await page.evaluate(() => {
    window.testVisibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    localStorage.setItem("breadboard:theme-mode", "sun");
    localStorage.removeItem("breadboard:theme-override-until");
    window.dispatchEvent(new Event("breadboard:theme-mode-change"));
    return window.themeCalls.length;
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  assert.equal(await page.evaluate(() => window.themeCalls.length), beforeSunset);
  await page.evaluate(() => {
    window.testVisibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("output")).toHaveText("dark");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.evaluate(() => window.themeCalls.at(-1).schedule.mode), "sun");
  assert.deepEqual(errors, []);
});
