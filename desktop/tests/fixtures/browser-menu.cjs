const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, dialog, ipcMain, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const requireDashboard = createRequire(path.join(dashboard, "package.json"));
  const bundle = requireDashboard("esbuild").buildSync({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { useDesktopTabs } from './src/app/components/use-desktop-tabs';
      import BrowserMenuControls from './src/app/browser/browser-menu-controls';
      function App() {
        const state = useDesktopTabs();
        const tab = state?.tabs.find(tab => tab.id === state.selfId);
        return <div className="browser-toolbar" style={{marginTop:32}}>
          <div className="browser-address-form" style={{flex:1}}><div className="browser-address-bar">{tab?.browser?.address || 'Search or enter address'}</div></div>
          <BrowserMenuControls profileLabel="Fixture profile" address={tab?.browser?.address || ''} matches={tab?.browser?.find} onPanel={panel => { window.testPanel = panel; }} />
        </div>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    `, resolveDir: dashboard, loader: "tsx" },
    bundle: true, write: false, outdir: "out", format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles;
  const globalCss = fs.readFileSync(path.join(dashboard, "src/app/globals.css"), "utf8");
  const server = http.createServer((req, res) => {
    if (req.url === "/global.css") { res.setHeader("Content-Type", "text/css"); return res.end(globalCss); }
    if (req.url === "/app.js" || req.url === "/app.css") {
      const css = req.url.endsWith("css");
      res.setHeader("Content-Type", css ? "text/css" : "text/javascript");
      res.end(bundle.find(file => file.path.endsWith(css ? ".css" : ".js")).text);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>body {margin:0;font-family:Arial} *,::before,::after {box-sizing:border-box;border:0 solid} button,input {font:inherit;color:inherit;background:transparent} :root {--font-schibsted:Arial;--font-source-sans:Arial}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    }
  });
  const external = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/other") return res.end('<!doctype html><title>Another page</title><body>Just one needle</body>');
    res.end('<!doctype html><title>Menu test page</title><body style="background:#cfe0d0"><h1>Find this needle</h1><p>A second needle.</p><p>A third needle.</p></body>');
  });
  const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const origin = await listen(server), web = await listen(external);
  const loading = path.join(dir, "loading.html");
  fs.writeFileSync(loading, "<!doctype html><body>Loading</body>");
  const openedWindows = [];
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => "light",
    openWindow: url => openedWindows.push(url),
  });
  manager.setBrowserUrl(origin + "/browser");
  manager.setNewTabUrl(origin + "/new-tab");
  const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: {
    preload: path.resolve(__dirname, "../../dist/preload/preload.js"), contextIsolation: true, sandbox: true,
  } });
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  const findCommands = [];
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => {
    if (command.type.startsWith("browser-find")) findCommands.push(command);
    return isTabsCommand(command) && manager.handleCommand(event.sender, command);
  });
  await window.loadURL(origin + "/dashboard");
  window.showInactive();
  assert.equal(await manager.handleCommand(window.webContents, { type: "browser", url: web }), true);
  let chrome, page;
  await until(() => {
    const contents = webContents.getAllWebContents();
    chrome = contents.find(contents => contents.getURL() === origin + "/browser");
    page = contents.find(contents => contents.getURL() === web + "/");
    return chrome && page && !chrome.isLoading() && !page.isLoading();
  }, "browser chrome and page load");
  await until(() => chrome.executeJavaScript("Boolean(document.querySelector('[aria-label=\"Browser menu\"]'))"), "menu button renders");
  assert.equal(await page.executeJavaScript("typeof window.breadboardDesktop"), "undefined");

  let menu;
  const nativePopup = Menu.prototype.popup;
  // Capture the real native menu while exercising actions without sending a
  // print job, opening developer tools, or exiting the test runner by accident.
  Menu.prototype.popup = function (options) { menu = this; options.callback?.(); };
  const openMenu = async () => {
    menu = undefined;
    await chrome.executeJavaScript("document.querySelector('[aria-label=\"Browser menu\"]').click()");
    await until(() => menu, "native menu created");
    return menu;
  };
  const choose = async id => {
    const opened = await openMenu();
    const item = opened.getMenuItemById(id);
    assert.ok(item?.enabled, `${id} is enabled`);
    item.click(item, window, {});
    await new Promise(resolve => setImmediate(resolve));
  };
  const originalZoom = chrome.getZoomFactor();
  await choose("zoom-in");
  assert.equal(page.getZoomFactor(), 1.1);
  assert.equal(chrome.getZoomFactor(), originalZoom, "zoom changes only the web page");
  await choose("zoom-reset");
  assert.equal(page.getZoomFactor(), 1);
  for (const [id, panel] of [["history", "history"], ["bookmarks", "starred"], ["downloads", "downloads"]]) {
    await choose(id);
    await until(async () => await chrome.executeJavaScript("window.testPanel") === panel, `${id} panel requested`);
  }
  await choose("find");
  await until(() => chrome.executeJavaScript("Boolean(document.querySelector('input[aria-label=\"Find in page\"]'))"), "find bar opens");
  await chrome.executeJavaScript("document.querySelector('input').focus()");
  await chrome.insertText("needle");
  try {
    await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.matches === 3, "Chromium finds three matches");
  } catch (error) {
    console.error("Find diagnostics", JSON.stringify({ commands: findCommands, value: await chrome.executeJavaScript("document.querySelector('input').value"), state: manager.stateFor(chrome) }));
    throw error;
  }
  await chrome.executeJavaScript("document.querySelector('[aria-label=\"Next match\"]').click()");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.activeMatchOrdinal === 2, "next match works");
  await chrome.executeJavaScript("document.querySelector('[aria-label=\"Previous match\"]').click()");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.activeMatchOrdinal === 1, "previous match works");
  await page.loadURL(web + "/other");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.matches === 1, "find follows page navigation");
  await page.loadURL(web + "/");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.matches === 3, "find follows navigation back");
  if (process.env.BREADBOARD_MENU_QA_DIR) {
    fs.mkdirSync(process.env.BREADBOARD_MENU_QA_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.BREADBOARD_MENU_QA_DIR, "find-toolbar.png"), (await chrome.capturePage()).toPNG());
  }
  await chrome.executeJavaScript("document.querySelector('[aria-label=\"Close find in page\"]').click()");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find === undefined, "find selection cleared");
  page.emit("found-in-page", {}, { requestId: 123, matches: 3, activeMatchOrdinal: 1 });
  assert.equal(manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find, undefined, "late results cannot reopen a closed search");

  let printed = false;
  page.print = (options, callback) => { assert.equal(options.silent, false); printed = true; callback(true, ""); };
  await choose("print");
  await until(() => printed, "print targets external page");
  const saved = path.join(dir, "saved.html");
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
  await choose("save");
  await until(() => fs.existsSync(saved) && fs.readFileSync(saved, "utf8").includes("third needle"), "real page HTML saved");
  await choose("new-window");
  assert.deepEqual(openedWindows, [origin + "/browser"]);
  const key = (key, extra = {}) => ({ type: "keyDown", key, control: true, meta: false, shift: false, alt: false, isAutoRepeat: false, ...extra });
  await chrome.executeJavaScript("window.testPanel = ''");
  let prevented = false;
  page.emit("before-input-event", { preventDefault() { prevented = true; } }, key("j"));
  await until(async () => await chrome.executeJavaScript("window.testPanel") === "downloads", "Ctrl+J works from web page focus");
  assert.equal(prevented, true);
  await choose("settings");
  await until(() => manager.stateFor(chrome).tabs.some(tab => tab.url === origin + "/browser/settings"), "settings opens in a trusted local tab");

  // Exercise native positioning and dismissal above the actual web view too.
  Menu.prototype.popup = nativePopup;
  const menuWindow = Menu.buildFromTemplate([{ label: "Browser menu test", enabled: true }]);
  await new Promise(resolve => {
    menuWindow.popup({ window, x: 800, y: 60, callback: resolve });
    setTimeout(() => menuWindow.closePopup(window), 150);
  });
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
