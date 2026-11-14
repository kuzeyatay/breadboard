const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { createRequire } = require("node:module");
const { app, BrowserWindow, ipcMain, session, webContents } = require("electron");
const { TabManager, BROWSER_SESSION_PARTITION } = require("../../dist/main/tab-manager.js");
const { BrowserAdBlocker } = require("../../dist/main/browser-adblocker.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const { createFixtureTls } = require("../helpers/fixture-tls.cjs");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.commandLine.appendSwitch("host-resolver-rules", "MAP *.fixture.test 127.0.0.1, MAP securepubads.g.doubleclick.net 127.0.0.1, MAP www.google-analytics.com 127.0.0.1");
app.commandLine.appendSwitch("no-proxy-server");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  console.log("Checking:", label);
  const end = Date.now() + 12_000;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 35)); }
  throw new Error(`Timed out: ${label}`);
};
let ads, tracker, article, webPort;
const respond = request => {
  const url = new URL(request.url);
  const headers = { "content-type": "text/javascript", "cache-control": "no-store", "access-control-allow-origin": "*" };
  if (request.url === ads) return new Response("window.adsLoaded = true", { headers });
  if (request.url === tracker) return new Response("window.trackerLoaded = true", { headers });
  if (url.pathname === "/app.js") return new Response("window.contentLoaded = true", { headers });
  return new Response(`<!doctype html><title>Ad blocker fixture</title><meta name="referrer" content="no-referrer"><h1>Article</h1>
    <script src="${ads}"></script><script src="${tracker}"></script><script src="https://cdn.fixture.test:${webPort}/app.js"></script>`,
    { headers: { "content-type": "text/html", "cache-control": "no-store" } });
};

app.whenReady().then(async () => {
  // Use real HTTPS sockets: protocol.handle bypasses Electron's webRequest hooks.
  const tls = await createFixtureTls();
  const web = https.createServer(tls.options, async (req, res) => {
    const response = respond({ url: `https://${req.headers.host}${req.url}` });
    for (const [key, value] of response.headers) res.setHeader(key, value);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => web.listen(0, "127.0.0.1", resolve));
  webPort = web.address().port;
  ads = `https://securepubads.g.doubleclick.net:${webPort}/tag/js/gpt.js`;
  tracker = `https://www.google-analytics.com:${webPort}/analytics.js`;
  article = `https://news.fixture.test:${webPort}/article`;
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const requireDashboard = createRequire(path.join(dashboard, "package.json"));
  const bundle = requireDashboard("esbuild").buildSync({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import BrowserExtensionsPopover from './src/app/browser/browser-extensions-popover';
      if(location.pathname.endsWith('/extensions-popover')) createRoot(document.getElementById('root')).render(<BrowserExtensionsPopover/>);
      else document.getElementById('root').textContent = 'Browser controls fixture';`,
      resolveDir: dashboard, loader: "tsx" },
    bundle: true, write: false, outdir: "out", format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles;
  requireDashboard("esbuild").stop();
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js" || req.url === "/app.css") {
      const ext = req.url.endsWith("css") ? ".css" : ".js";
      res.setHeader("Content-Type", ext === ".css" ? "text/css" : "text/javascript");
      return res.end(bundle.find(file => file.path.endsWith(ext)).text);
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><body style="margin:0"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  tls.trust(browserSession);
  tls.trust(session.defaultSession);
  let headerCalls = 0;
  browserSession.webRequest.onHeadersReceived((details, callback) => { headerCalls++; callback({ responseHeaders: details.responseHeaders }); });
  const loading = path.join(dir, "loading.html"); fs.writeFileSync(loading, "<!doctype html>");
  const preload = path.resolve(__dirname, "../../dist/preload/preload.js");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]) }, preloadPath: preload,
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => "dark",
    openWindow: () => {}, browserExtensionsConfigDir: dir, log: console.log,
  });
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: { preload, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  await window.loadURL(origin + "/dashboard");
  window.showInactive();
  assert.equal(await manager.handleCommand(window.webContents, { type: "browser", url: article }), true);
  const page = await until(() => webContents.getAllWebContents().find(c => c.getURL() === article && !c.isLoading()), "browser page");
  const chrome = await until(() => webContents.getAllWebContents().find(c => c.getURL() === origin + "/browser" && !c.isLoading()), "browser controls");
  const result = contents => contents.executeJavaScript("({ads:!!window.adsLoaded, tracker:!!window.trackerLoaded, content:!!window.contentLoaded})");
  assert.deepEqual(await result(page), { ads: false, tracker: false, content: true });
  assert.ok(headerCalls > 0, "existing headers hook stays installed");
  const state = () => manager.stateFor(chrome).tabs.find(tab => tab.id === manager.stateFor(chrome).activeId).browser.adBlock;
  assert.equal(state().available, true);
  assert.equal(state().blocked, 2);
  assert.equal(manager.handleCommand(page, { type: "browser-adblock-enabled", enabled: false }), false, "web content cannot change protection");
  assert.equal(manager.handleCommand(chrome, { type: "browser-adblock-site-enabled", site: "stale.fixture.test", enabled: false }), false);
  await until(() => !manager.stateFor(chrome).navigationPending, "browser presentation settled").catch(async error => {
    console.log("PRESENTATION", JSON.stringify(manager.stateFor(chrome)));
    for (const host of manager.hosts.values()) console.log("HOST", { pending: host.pending?.id, tabs: host.tabs.map(t => ({ id:t.id, loaded:t.loaded, painted:t.painted, attached:t.attached, browserReady:t.browser?.ready, committed:t.browser?.documentCommitted, loading:t.contents.isLoading(), contents:t.contents.id })) });
    console.log("VIEWS", window.contentView.children.map(v => ({ id:v.webContents?.id, bounds:v.getBounds() })));
    throw error;
  });
  assert.equal(await manager.handleCommand(chrome, { type: "browser-extensions-popover", x: 600, y: 75 }), true);
  const popup = await until(() => webContents.getAllWebContents().find(c => c.getURL().includes("/browser/extensions-popover") && !c.isLoading()), "Extensions popover");
  const toggle = '[role="switch"][aria-label="Ad Blocker"]';
  await until(() => popup.executeJavaScript(`document.querySelector('${toggle}')?.getAttribute('aria-checked') === 'true'`), "built-in enabled switch");
  await popup.executeJavaScript("document.querySelector('[aria-label=\"Ad Blocker options\"]').click()");
  await until(() => popup.executeJavaScript("!!document.querySelector('[aria-label=\"Block ads on news.fixture.test\"]')"), "site control");
  await until(() => popup.executeJavaScript("document.querySelector('main').scrollHeight <= innerHeight + 1"), "expanded card fits");
  assert.equal(await popup.executeJavaScript("document.documentElement.scrollWidth <= innerWidth"), true);
  if (process.env.BB_ADBLOCK_SCREENSHOT) fs.writeFileSync(process.env.BB_ADBLOCK_SCREENSHOT, (await popup.capturePage()).toPNG());
  await popup.executeJavaScript("document.querySelector('[aria-label=\"Block ads on news.fixture.test\"]').click()");
  await until(() => !state().siteEnabled, "site pause via UI");
  await page.loadURL(article);
  assert.deepEqual(await result(page), { ads: true, tracker: true, content: true });
  assert.equal(state().blocked, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "browser-adblocker.json"))).allowedSites, ["news.fixture.test"]);
  assert.equal(new BrowserAdBlocker(dir, () => {}).snapshot(undefined, article).siteEnabled, false, "site pause survives restart");
  manager.handleCommand(chrome, { type: "browser-adblock-site-enabled", site: "news.fixture.test", enabled: true });
  await page.loadURL(article);
  assert.deepEqual(await result(page), { ads: false, tracker: false, content: true });
  // Global control has the same native path as the site control.
  manager.handleCommand(chrome, { type: "browser-extensions-close" });
  await new Promise(resolve => setTimeout(resolve, 250));
  await until(() => !manager.stateFor(chrome).navigationPending, "reloaded presentation settled");
  await manager.handleCommand(chrome, { type: "browser-extensions-popover", x: 600, y: 75 });
  const togglePopup = await until(() => webContents.getAllWebContents().find(c => c.getURL().includes("/browser/extensions-popover") && !c.isLoading()), "reopen popover");
  await until(() => togglePopup.executeJavaScript(`!!document.querySelector('${toggle}')`), "global switch");
  await togglePopup.executeJavaScript(`document.querySelector('${toggle}').click()`);
  await until(() => !state().enabled, "global disable via UI");
  await page.loadURL(article);
  assert.deepEqual(await result(page), { ads: true, tracker: true, content: true });
  manager.handleCommand(chrome, { type: "browser-adblock-enabled", enabled: true });
  await page.loadURL(`https://other.fixture.test:${webPort}/article`);
  assert.deepEqual(await result(page), { ads: false, tracker: false, content: true });
  assert.equal(state().blocked, 2, "navigation resets the document counter");
  await page.loadURL(ads);
  assert.equal(page.getURL(), ads, "top-level navigations are allowed");

  // A fresh private session filters immediately and never writes exceptions.
  const privateSession = session.fromPartition("adblock-private-fixture", { cache: false });
  tls.trust(privateSession);
  const privateWindow = new BrowserWindow({ show: false, webPreferences: { session: privateSession, sandbox: true } });
  const blocker = new BrowserAdBlocker(dir, () => {});
  blocker.attachPage(privateWindow.webContents, true);
  const before = fs.readFileSync(path.join(dir, "browser-adblocker.json"), "utf8");
  await privateWindow.loadURL(article);
  assert.deepEqual(await result(privateWindow.webContents), { ads: false, tracker: false, content: true });
  blocker.setSiteEnabled(article, false, privateSession);
  await privateWindow.loadURL(article);
  assert.deepEqual(await result(privateWindow.webContents), { ads: true, tracker: true, content: true });
  assert.equal(fs.readFileSync(path.join(dir, "browser-adblocker.json"), "utf8"), before);
  privateWindow.destroy();
  // The trusted app session is outside the blocker's scope.
  const appWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await appWindow.loadURL(article);
  assert.deepEqual(await result(appWindow.webContents), { ads: true, tracker: true, content: true });
  appWindow.destroy();
  window.destroy(); server.close(); web.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
