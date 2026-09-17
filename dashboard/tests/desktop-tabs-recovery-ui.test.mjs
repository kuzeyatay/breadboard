import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright";

test("the rendered tab bar survives UI replacement and a failed shell read", { timeout: 30_000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import TitleBar from './src/app/components/desktop-title-bar';
      export { refreshDesktopTabsState as refresh } from './src/lib/desktop-browser-tabs';
      let root;
      export function mount() {
        root = createRoot(document.getElementById('root'));
        flushSync(() => root.render(<TitleBar />));
      }
      export function unmount() { root.unmount(); }
    ` },
    bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  });
  const server = http.createServer((request, response) => {
    const script = request.url.startsWith("/ui.js");
    response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
    response.end(script ? bundle.outputFiles[0].text : `<!doctype html>
      <html data-breadboard-desktop="true"><body><div id="root"></div></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const executablePath = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
  ].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const listeners = new Set();
    window.state = { enabled: true, selfId: 1, activeId: 1, extensions: [], tabs: [
      { id: 1, title: "Gardens", url: "/dashboard", loading: false },
      { id: 2, title: "Plan", url: "/plan", loading: false },
    ] };
    window.commands = [];
    window.readMode = "ready";
    window.reads = 0;
    window.breadboardDesktop = {
      getTabsState: () => {
        window.reads++;
        if (window.readMode === "pending") return new Promise(() => {});
        if (window.readMode === "error") return Promise.reject(new Error("Shell unavailable"));
        return Promise.resolve(window.state);
      },
      onTabsState: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      tabs: async command => { window.commands.push(command); return true; },
    };
    window.publish = () => { for (const listener of listeners) listener(window.state); };
    window.ui = await import("/ui.js?v=1");
    window.ui.mount();
  });
  await page.getByRole("tab", { name: "Gardens", exact: true }).waitFor();
  await page.evaluate(async () => {
    window.readMode = "pending";
    const replacement = await import("/ui.js?v=2");
    window.ui.unmount();
    window.ui = replacement;
    window.ui.mount();
  });
  assert.equal(await page.getByRole("tab").count(), 2, "the strip renders before the replacement read completes");
  assert.equal(await page.getByRole("tablist").isVisible(), true);
  assert.equal(await page.evaluate(() => window.reads), 2);

  assert.equal(await page.evaluate(async () => {
    window.readMode = "error";
    return window.ui.refresh();
  }), false);
  assert.equal(await page.getByRole("tab").count(), 2);
  await page.evaluate(() => {
    window.state = { ...window.state, tabs: [...window.state.tabs,
      { id: 3, title: "Recovered tab", url: "/new-tab", loading: false }] };
    window.readMode = "ready";
  });
  await page.getByRole("tab", { name: "Recovered tab", exact: true }).waitFor();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.commands), [{ type: "new" }]);

  await page.evaluate(() => { window.state = { ...window.state, enabled: false }; window.publish(); });
  await page.getByRole("tablist").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
});
