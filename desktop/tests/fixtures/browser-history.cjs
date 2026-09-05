const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { app, BrowserWindow, ipcMain, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { BrowserHistory } = require("../../dist/main/browser-history.js");
const { IPC_CHANNELS } = require("../../dist/shared/ipc-contract.js");
const { readBrowserRecentSearches, writeBrowserRecentSearches } = require("../../dist/main/browser-recent-searches.js");
const [dir, phase] = process.argv.slice(2);
app.setPath("userData", path.join(dir, `profile-${phase}`));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};
const listen = async server => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const dashboardRequire = createRequire(path.join(dashboard, "package.json"));
  const output = dashboardRequire("esbuild").buildSync({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserHistoryPanel } from './src/app/browser/browser-history-panel';
      import { useBrowserRecentSearches } from './src/app/browser/use-browser-recent-searches';
      function App() {
        const searches = useBrowserRecentSearches('fixture');
        return <BrowserHistoryPanel active searches={searches} closeButton={<button aria-label="Close panel">×</button>}
          navigate={async input => { window.lastHistoryNavigation = input; }} />;
      }
      createRoot(document.getElementById('root')).render(<App />);
    `, resolveDir: dashboard, loader: "tsx" },
    bundle: true, write: false, outdir: path.join(dir, "bundle"), jsx: "automatic", platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles;
  const script = output.find(file => file.path.endsWith(".js")).text;
  const moduleCss = output.find(file => file.path.endsWith(".css")).text;
  const globalCss = fs.readFileSync(path.join(dashboard, "src/app/globals.css"), "utf8");
  const libraryCss = globalCss.slice(globalCss.indexOf(".browser-library-panel"), globalCss.indexOf(".browser-terminal-drawer .bb-terminal-drawer-surface"));
  const shellServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/app.js" ? script : `<!doctype html><style>
      :root { --ink-heading:#e4e8e2; --ink-muted:#969f92; --ink:#d4dccf; --font-source-sans:Arial; }
      body { margin:0; background:#191d18; color:#d4dccf; font-family:Arial; }
      button,input { font:inherit; color:inherit; } button { cursor:pointer; } a { color:inherit; text-decoration:none; }
      .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; }
      ${libraryCss} ${moduleCss}
      .browser-library-panel { position:static!important; width:100%; height:100vh; }
      .browser-library-list { overflow:auto; }
    </style><div id="root"></div><script defer src="/app.js"></script>`);
  });
  const origin = await listen(shellServer);
  const siteServer = http.createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { Location: "/redirected?from=shortcut#done" }); res.end(); return; }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><title>${req.url === "/shortcut" ? "ChatGPT" : "Visited page"}</title><body>
      <a id="inside" href="/conversation?model=test#message">Open conversation</a>
      ${req.url === "/shortcut" ? '<iframe src="/iframe"></iframe>' : ''}
    </body>`);
  });
  const site = await listen(siteServer);
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>fixture</body>");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]) }, preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene, theme: () => "dark", openWindow: () => {}, browserHistoryConfigDir: dir,
  });
  manager.setEnabled(true);
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 620, height: 850, webPreferences: {
    preload: path.resolve(__dirname, "../../dist/preload/preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.handleCommand(event.sender, command));
  ipcMain.handle(IPC_CHANNELS.getBrowserHistory, () => manager.browserHistory.snapshot());
  ipcMain.handle(IPC_CHANNELS.browserHistoryCommand, (_event, command) => manager.browserHistory.command(command));
  ipcMain.handle(IPC_CHANNELS.getBrowserRecentSearches, (_event, owner) => readBrowserRecentSearches(dir, owner));
  ipcMain.handle(IPC_CHANNELS.setBrowserRecentSearches, (_event, owner, searches) => { writeBrowserRecentSearches(dir, owner, searches); return true; });
  await window.loadURL(origin + "/dashboard");
  const observer = new BrowserWindow({ show: false, width: 620, height: 850, webPreferences: {
    preload: path.resolve(__dirname, "../../dist/preload/preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  manager.attach(observer);
  await observer.loadURL(origin + "/dashboard");
  const chrome = observer.webContents;
  const command = action => manager.handleCommand(window.webContents, action);
  const saved = () => new BrowserHistory(dir).snapshot().items;
  const pageAt = url => until(() => webContents.getAllWebContents().find(page => page.getURL() === url && !page.isLoading()), url);
  const uiUrls = () => chrome.executeJavaScript("[...document.querySelectorAll('.browser-library-link')].map(a => a.href)");
  const expectedFile = path.join(dir, "expected.json");
  if (phase === "save") {
    await command({ type: "browser", url: site + "/shortcut" });
    const page = await pageAt(site + "/shortcut");
    await until(() => saved()[0]?.title === "ChatGPT", "shortcut title persisted");
    assert.deepEqual(saved().map(entry => entry.url), [site + "/shortcut"], "iframe is excluded");
    await page.executeJavaScript("document.querySelector('#inside').click()");
    await pageAt(site + "/conversation?model=test#message");
    const longRoute = site + "/c/spa?query=" + "a".repeat(340) + "#full-link";
    await page.executeJavaScript(`history.pushState({}, '', ${JSON.stringify(longRoute)}); document.title = 'Conversation in progress';`);
    await until(() => saved()[0]?.url === longRoute && saved()[0]?.title === "Conversation in progress", "SPA URL and title persisted");
    page.navigationHistory.goBack();
    await pageAt(site + "/conversation?model=test#message");
    page.navigationHistory.goForward();
    await pageAt(longRoute);
    await command({ type: "browser", url: site + "/redirect", background: true });
    await pageAt(site + "/redirected?from=shortcut#done");
    await page.executeJavaScript(`window.open(${JSON.stringify(site + "/popup")}, '_blank'); true`, true);
    await pageAt(site + "/popup");
    assert.equal(saved().length, 5, "shortcut, link, SPA, redirected page and popup all persisted");
    const urls = saved().map(entry => entry.url);
    assert.ok(!urls.some(url => url.endsWith("/iframe") || url.endsWith("/redirect")));
    await until(async () => (await uiUrls()).length === 5, "background navigation synchronizes other history panels");
    console.log("All navigation paths saved and synchronized");
    const full = await chrome.executeJavaScript(`(() => {
      const link = [...document.querySelectorAll('.browser-library-link')].find(a => a.href === ${JSON.stringify(longRoute)});
      return { text: link.querySelector('small').textContent, whiteSpace: getComputedStyle(link.querySelector('small')).whiteSpace };
    })()`);
    assert.equal(full.text, longRoute);
    assert.equal(full.whiteSpace, "normal", "full URLs wrap rather than being truncated");
    await chrome.executeJavaScript(`(() => {
      const input = document.querySelector('input[type=search]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'conversation in progress');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await until(async () => (await uiUrls()).every(url => url === longRoute) && (await uiUrls()).length === 1, "filter by page title");
    await chrome.executeJavaScript("document.querySelector('.browser-library-link').click()");
    assert.equal(await chrome.executeJavaScript("window.lastHistoryNavigation"), longRoute);
    await chrome.executeJavaScript("document.querySelector('[aria-label=\"Clear history filter\"]').click()");
    await until(async () => (await uiUrls()).length === 5, "clear filter restores full history");
    console.log("History filtering and full URLs passed");
    if (process.env.BROWSER_HISTORY_SCREENSHOT) {
      fs.mkdirSync(path.dirname(process.env.BROWSER_HISTORY_SCREENSHOT), { recursive: true });
      observer.showInactive();
      await new Promise(resolve => setTimeout(resolve, 200));
      fs.writeFileSync(process.env.BROWSER_HISTORY_SCREENSHOT, (await chrome.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      observer.hide();
    }
    await chrome.executeJavaScript("document.querySelector('.browser-library-remove').click()");
    await until(() => saved().length === 4, "UI removal persists");
    fs.writeFileSync(expectedFile, JSON.stringify(saved()));
    console.log("History visits, UI filtering, reopening and removal passed");
  } else if (phase === "restore") {
    const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
    assert.deepEqual(saved(), expected);
    await until(async () => (await uiUrls()).length === expected.length, "UI restores disk history with fresh renderer storage");
    assert.deepEqual(await uiUrls(), expected.map(entry => entry.url));
    await chrome.executeJavaScript("document.querySelector('.browser-library-clear').click()");
    await until(() => saved().length === 0, "clear persists before shutdown");
  } else {
    assert.deepEqual(saved(), []);
    await until(() => chrome.executeJavaScript("document.body.textContent.includes('No browsing history yet')"), "cleared history stays empty after restart");
  }
  console.log(`History ${phase} completed`);
  shellServer.close();
  siteServer.close();
  // Deliberately skip tab teardown and renderer cache flushing: committed
  // visits and edits must already survive an immediate application exit.
  // Electron overrides process.exit with its graceful window teardown.
  process.reallyExit(0);
}).catch(error => { console.error(error.stack || error); process.reallyExit(1); });
