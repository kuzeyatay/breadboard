import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { DEFAULT_GESTURE_SETTINGS } from "../../desktop/src/shared/gesture-control.ts";

test("embedded gesture screen starts paused, follows live status, and stops/reopens the camera", { timeout: 60000 }, async t => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: { loader: "tsx", resolveDir: root, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import GestureScreen from './src/app/gestures/gesture-screen';
      window.commands=[];
      const defaults=${JSON.stringify(DEFAULT_GESTURE_SETTINGS)};
      window.camera={available:true,phase:'running',paused:true,status:'PAUSED',detail:'Hold a fist for 3 seconds',display:'DISPLAY2 · 1920 × 1080',image:null,settings:JSON.parse(localStorage.getItem('settings')||'null')||defaults,settingsDefaults:defaults};
      if(!location.search.includes('no-desktop')) window.breadboardDesktop={gestureControl:async(action,settings)=>{
        window.commands.push(action);
        if(action==='start') { await new Promise(r=>setTimeout(r,150)); window.camera.phase='running';window.camera.paused=true;window.camera.error=undefined; }
        if(action==='pause') {window.camera.paused=true;window.camera.status='PAUSED';}
        if(action==='stop') {window.camera.phase='stopped';window.camera.image=null;}
        if(action==='save-settings') {
          if(window.rejectSettings) return {...window.camera,error:'Could not save settings. Please retry.'};
          window.camera.settings={...settings};window.camera.paused=true;window.camera.status='PAUSED';localStorage.setItem('settings',JSON.stringify(settings));
        }
        return {...window.camera};
      }};
      createRoot(document.getElementById('root')).render(<GestureScreen/>);` },
    absWorkingDir: root, bundle: true, write: false, outdir: "fixture", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "page-shell-fixture", setup(builder) {
      builder.onResolve({ filter: /components\/(navigation-link|use-page-loading)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root,
        contents: args.path.endsWith("navigation-link") ? `import React from 'react';export default function Link({href,children,className}){return <a href={href} className={className}>{children}</a>}` :
          `import {useEffect} from 'react';export function usePageLoading(pending){useEffect(()=>{document.documentElement.dataset.pending=String(pending)},[pending]);}` }));
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const server = http.createServer((request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(js); return; }
    if (request.url === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css); return; }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><style>
      :root{--background:#111a16;--foreground:#e6eee8;--muted:#98aa9e;--surface:#18241d;--surface-raised:#223128;--border:#32463a;--accent:#99bba5}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}button,a{-webkit-tap-highlight-color:transparent}button{color:inherit}
    </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  await page.getByRole("button", { name: "Stop camera", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Pause", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("heading", { name: "Hold for 3 seconds to start" }).isVisible(), true);
  assert.equal(await page.locator("aside li").count(), 7);
  await page.waitForFunction(() => document.documentElement.dataset.pending === "false");
  const artifacts = path.join(root, "artifacts", "gesture-screen-qa");
  await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: true });
  await page.evaluate(() => { window.camera.paused = false; window.camera.status = "POINTER"; });
  await page.getByRole("status").filter({ hasText: "Control on" }).waitFor();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForFunction(() => window.commands.includes("pause"));
  await page.getByRole("status").filter({ hasText: "Paused" }).waitFor();
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  await page.getByRole("button", { name: "Open camera", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  await page.getByRole("button", { name: "Stop camera", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.commands.filter(action => action === "start").length), 2);
  assert.equal(await page.getByRole("switch").count(), 3);
  await page.getByRole("switch", { name: "Use V sign while paused", exact: true }).check();
  await page.getByRole("status").filter({ hasText: "Pointer paused" }).waitFor();
  assert.equal(await page.evaluate(() => window.camera.settings.v_while_paused), true);
  assert.equal(await page.evaluate(() => window.camera.paused), true);
  assert.equal(await page.getByRole("switch", { name: "Use Bent L while paused", exact: true }).isChecked(), false);
  await page.reload();
  await page.getByRole("button", { name: "Stop camera", exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.pending === "false");
  assert.equal(await page.getByRole("switch", { name: "Use V sign while paused", exact: true }).isChecked(), true);
  await page.screenshot({ path: path.join(artifacts, "shortcuts-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, "shortcuts-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page.evaluate(() => { window.rejectSettings = true; });
  await page.getByRole("switch", { name: "Use V sign while paused", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("switch", { name: "Use V sign while paused", exact: true }).isChecked(), true);
  await page.evaluate(() => { window.rejectSettings = false; });
  await page.getByRole("switch", { name: "Use V sign while paused", exact: true }).uncheck();
  await page.waitForFunction(() => window.camera.settings.v_while_paused === false);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Cursor sensitivity", { exact: true }).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByLabel("Cursor sensitivity", { exact: true }).inputValue(), "0.7");
  await page.getByText("Gesture actions & timing", { exact: true }).click();
  await page.getByLabel("V sign", { exact: true }).selectOption("scroll_down");
  await page.getByLabel("Bent L hand", { exact: true }).selectOption("voice");
  await page.getByRole("switch", { name: "Use Bent L hand while paused", exact: true }).check();
  await page.getByRole("button", { name: "Apply changes", exact: true }).click();
  await page.getByText("Saved and applied. Hold a fist to enable the pointer.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.camera.settings.pointer_gain), 0.7);
  await page.getByRole("tab", { name: "Your gestures", exact: true }).click();
  assert.match(await page.locator("aside li").filter({ hasText: "V sign" }).innerText(), /Scroll down/);
  assert.match(await page.locator("aside li").filter({ hasText: "Bent L" }).innerText(), /Hold to talk/);
  assert.equal(await page.getByRole("switch", { name: "Use Bent L while paused", exact: true }).isChecked(), true);
  await page.reload();
  await page.getByRole("button", { name: "Stop camera", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.equal(await page.getByLabel("Cursor sensitivity", { exact: true }).inputValue(), "0.7");
  await page.getByRole("button", { name: "Reset defaults", exact: true }).click();
  await page.evaluate(() => { window.rejectSettings = true; });
  await page.getByRole("button", { name: "Apply changes", exact: true }).click();
  await page.locator("form").getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.camera.settings.pointer_gain), 0.7);
  await page.evaluate(() => { window.rejectSettings = false; });
  await page.getByRole("button", { name: "Apply changes", exact: true }).click();
  await page.getByText("Saved and applied. Hold a fist to enable the pointer.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.camera.settings.pointer_gain), 1);
  assert.equal(await page.evaluate(() => window.camera.settings.bent_while_paused), false);
  await page.screenshot({ path: path.join(artifacts, "settings-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, "settings-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.goto(`${origin}?no-desktop`);
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /Breadboard desktop/);
  assert.equal(await page.getByRole("button", { name: "Retry camera" }).isDisabled(), true);
  assert.deepEqual(errors, []);
});
