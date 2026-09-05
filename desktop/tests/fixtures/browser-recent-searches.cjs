const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { app, BrowserWindow, ipcMain } = require("electron");
const { IPC_CHANNELS } = require("../../dist/shared/ipc-contract.js");
const { readBrowserRecentSearches, writeBrowserRecentSearches } = require("../../dist/main/browser-recent-searches.js");
const [dir, phase] = process.argv.slice(2);
const owner = "restart-test@example.com";
const key = `breadboard:browser-searches:${owner}`;

// Only the config directory survives. Each process has a completely fresh
// Chromium profile, so passing cannot depend on old origin-local caches.
app.setPath("userData", path.join(dir, `profile-${phase}`));
app.on("window-all-closed", () => {});

const until = async (probe, label) => {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const dashboardRequire = createRequire(path.join(dashboard, "package.json"));
  // Exercise the production React hook, renderer store, and preload together.
  const bundle = dashboardRequire("esbuild").buildSync({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { useBrowserRecentSearches } from './src/app/browser/use-browser-recent-searches';
        function App() {
          const [address, setAddress] = useState('');
          const history = useBrowserRecentSearches(${JSON.stringify(owner)}, address);
          window.testHistory = history;
          window.testVisit = setAddress;
          return <div>{history.items.join(', ')}</div>;
        }
        createRoot(document.getElementById('root')).render(<App />);
      `,
      resolveDir: dashboard,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles[0].text;
  ipcMain.handle(IPC_CHANNELS.getTabsState, () => null);
  ipcMain.handle(IPC_CHANNELS.getBrowserRecentSearches, (_event, ownerKey) => readBrowserRecentSearches(dir, ownerKey));
  ipcMain.handle(IPC_CHANNELS.setBrowserRecentSearches, (_event, ownerKey, searches) => {
    writeBrowserRecentSearches(dir, ownerKey, searches);
    return true;
  });
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/app.js" ? bundle : '<!doctype html><div id="root"></div>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const windows = [];
  async function open() {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.resolve(__dirname, "../../dist/preload/preload.js"),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    });
    windows.push(window);
    await window.loadURL(origin);
    await window.webContents.executeJavaScript(`
      ${phase === "save" ? `localStorage.setItem('breadboard:browser-history:${owner}', JSON.stringify(['legacy search']));` : ""}
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/app.js'; script.onload = resolve; script.onerror = reject;
        document.head.append(script);
      });
    `);
    await until(() => window.webContents.executeJavaScript("window.testHistory?.ready === true"), "initial disk restore");
    return window.webContents;
  }

  const first = await open();
  if (phase === "save") {
    const second = await open();
    const results = await Promise.all([
      first.executeJavaScript("window.testHistory.remember('first tab')"),
      second.executeJavaScript("window.testHistory.remember('second tab')"),
    ]);
    assert.deepEqual(results, [true, true]);
    await first.executeJavaScript("window.testVisit('https://www.google.com/search?q=inside+results')");
    await until(() => readBrowserRecentSearches(dir, owner)?.[0] === "inside results", "search within results page saved");
    const expected = ["inside results", "first tab", "second tab", "legacy search"];
    assert.deepEqual(new Set(readBrowserRecentSearches(dir, owner)), new Set(expected));
    await until(async () => (await second.executeJavaScript("window.testHistory.items.length")) === 4, "history updates in the other tab");
    await first.executeJavaScript("window.testHistory.remove('legacy search')");
    assert.equal(readBrowserRecentSearches(dir, owner).includes("legacy search"), false);
  } else if (phase === "restore") {
    assert.deepEqual(new Set(await first.executeJavaScript("window.testHistory.items")), new Set(["inside results", "first tab", "second tab"]));
    await first.executeJavaScript("window.testHistory.clear()");
    assert.deepEqual(readBrowserRecentSearches(dir, owner), []);
  } else {
    // Stale caches must not resurrect searches the person explicitly cleared.
    await first.executeJavaScript(`localStorage.setItem(${JSON.stringify(key)}, '["stale search"]'); window.testHistory.retry()`);
    assert.deepEqual(await first.executeJavaScript("window.testHistory.items"), []);
    assert.deepEqual(readBrowserRecentSearches(dir, owner), []);
  }
  for (const window of windows) window.destroy();
  server.close();
  // No shutdown save/renderer cache flush: searches must already be on disk.
  app.exit(0);
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
