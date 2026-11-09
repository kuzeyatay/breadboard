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
      import DesktopTitleBar from './src/app/components/desktop-title-bar';
      import BrowserMenuControls from './src/app/browser/browser-menu-controls';
      function App() {
        const state = useDesktopTabs();
        const tab = state?.tabs.find(tab => tab.id === state.selfId);
        return <><DesktopTitleBar />{tab?.browser ? <div className="browser-toolbar">
          <div className="browser-address-form" style={{flex:1}}><div className="browser-address-bar">{tab?.browser?.address || 'Search or enter address'}</div></div>
          <BrowserMenuControls profileLabel="Fixture profile" onPanel={panel => { window.testPanel = panel; }} />
        </div> : <main style={{padding:24}}><h1>Dashboard search fixture</h1><p>A local needle.</p><p>Another local needle.</p><input aria-label="Fixture editor" /></main>}</>;
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
  const shortcut = (contents, keyCode, modifiers = []) => {
    contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  const findInput = 'input[aria-label="Find in page"]';
  const findSurface = () => webContents.getAllWebContents().find(contents => contents.getURL().includes("/find-in-page.html"));
  const findUI = {
    executeJavaScript: script => findSurface()?.executeJavaScript(script),
    insertText: text => findSurface().insertText(text),
    sendInputEvent: event => findSurface().sendInputEvent(event),
  };
  const captureFind = async name => {
    let capture;
    await until(async () => { capture = await findSurface().capturePage(); return !capture.isEmpty(); }, "find bar paints");
    if (!process.env.BREADBOARD_MENU_QA_DIR) return;
    fs.mkdirSync(process.env.BREADBOARD_MENU_QA_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.BREADBOARD_MENU_QA_DIR, name), capture.toPNG());
  };
  const local = window.webContents;
  const localFind = () => manager.stateFor(local).tabs.find(tab => tab.id === manager.stateFor(local).selfId)?.find;
  await until(() => local.executeJavaScript('Boolean(document.querySelector("[aria-label=\\"Fixture editor\\"]"))'), "dashboard renders");
  await local.executeJavaScript('document.querySelector("[aria-label=\\"Fixture editor\\"]").focus()');
  shortcut(local, "F", ["control"]);
  await until(() => findUI.executeJavaScript(`document.activeElement?.matches('${findInput}')`), "Ctrl+F focuses dashboard search");
  const trackSound = () => findUI.executeJavaScript(`
    window.findSoundNotes = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = create.call(this), start = oscillator.start.bind(oscillator);
      oscillator.start = (...args) => { window.findSoundNotes++; start(...args); };
      return oscillator;
    };
    void 0;
  `);
  const soundNotes = () => findUI.executeJavaScript("window.findSoundNotes");
  await trackSound();
  await findUI.insertText("needle");
  try {
    await until(() => localFind()?.matches === 2, "dashboard search finds its own two matches");
  } catch (error) {
    console.error("Local find diagnostics", JSON.stringify({ commands: findCommands, value: await findUI.executeJavaScript(`document.querySelector('${findInput}').value`), state: manager.stateFor(local) }));
    throw error;
  }
  await until(() => localFind()?.activeMatchOrdinal > 0, "dashboard selects an initial match");
  const firstLocalMatch = localFind().activeMatchOrdinal;
  shortcut(findUI, "Enter");
  await until(() => localFind()?.activeMatchOrdinal === firstLocalMatch % 2 + 1, "Enter advances dashboard match");
  shortcut(findUI, "Enter", ["shift"]);
  await until(() => localFind()?.activeMatchOrdinal === firstLocalMatch, "Shift+Enter goes to previous dashboard match");
  shortcut(findUI, "F", ["control"]);
  await until(() => findUI.executeJavaScript(`document.activeElement?.matches('${findInput}') && document.activeElement.selectionEnd === 6 && document.activeElement.selectionStart === 0`), "repeated Ctrl+F selects the existing query");
  await findUI.insertText("no-such-match");
  await until(() => localFind()?.matches === 0, "missing text reports zero matches");
  await until(async () => await soundNotes() === 2, "dashboard miss plays one buzz");
  const completedMiss = { ...localFind() };
  local.emit("found-in-page", {}, completedMiss);
  local.emit("found-in-page", {}, { ...completedMiss, requestId: completedMiss.requestId - 1 });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await soundNotes(), 2, "duplicate and stale result events stay silent");
  shortcut(findUI, "Enter");
  await until(async () => await soundNotes() === 4, "retrying a failed find buzzes again");
  await captureFind("find-dashboard.png");
  shortcut(findUI, "Escape");
  await until(async () => !findSurface() && await local.executeJavaScript(`document.activeElement?.getAttribute('aria-label') === 'Fixture editor'`), "Escape closes find and restores editor focus");
  assert.equal(localFind(), undefined, "dashboard highlights cleared");
  // Document viewers use the same native find bar, with their own full-document index.
  await local.executeJavaScript(`
    window.documentFindCalls = [];
    let match = 1;
    window[Symbol.for('breadboard:document-find')] = async request => {
      window.documentFindCalls.push(request);
      if (!request) return { matches: 0, activeMatchOrdinal: 0 };
      if (request.text === 'slow result') {
        await new Promise(resolve => setTimeout(resolve, 500));
        return { matches: 999, activeMatchOrdinal: 1 };
      }
      if (request.findNext) match = (match - 1 + (request.forward === false ? 2 : 1)) % 3 + 1;
      return { matches: 3, activeMatchOrdinal: match };
    };
    void 0;
  `);
  shortcut(local, "F", ["control"]);
  await until(() => findUI.executeJavaScript(`document.activeElement?.matches('${findInput}')`), "Ctrl+F opens document search");
  await findUI.insertText("unrendered PDF text");
  await until(() => localFind()?.matches === 3, "document provider supplies matches absent from the DOM");
  await until(() => findUI.executeJavaScript(`document.querySelector('#count').textContent === '1 / 3'`), "shared bar shows document count");
  shortcut(findUI, "Enter");
  await until(() => localFind()?.activeMatchOrdinal === 2, "shared bar advances document match");
  shortcut(findUI, "Enter", ["shift"]);
  await until(() => localFind()?.activeMatchOrdinal === 1, "shared bar reverses document match");
  manager.handleCommand(local, { type: "browser-find", text: "slow result" });
  await until(() => local.executeJavaScript(`window.documentFindCalls.some(request => request?.text === 'slow result')`), "slow document find started");
  shortcut(findUI, "Escape");
  await until(async () => !findSurface() && await local.executeJavaScript('window.documentFindCalls.at(-1) === null'), "closing shared bar clears PDF highlights");
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(localFind(), undefined, "late PDF results cannot restore a closed search");
  await local.executeJavaScript(`delete window[Symbol.for('breadboard:document-find')]`);
  // Keep a search open across reload, then switch to a different document.
  shortcut(local, "F", ["control"]);
  await until(() => findUI.executeJavaScript(`document.activeElement?.matches('${findInput}')`), "local find reopens");
  await findUI.insertText("needle");
  await until(() => localFind()?.matches === 2, "local query restored");
  const localFindSurface = findSurface();
  await local.loadURL(origin + "/dashboard?reloaded=1");
  await until(() => localFind()?.matches === 2, "local search follows full document navigation");
  assert.equal(findSurface(), localFindSurface, "navigation retains the native find controls");
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
  const pageView = () => window.contentView.children.find(view => view.webContents?.id === page.id);
  await until(pageView, 'external view attached after first paint');
  await until(() => {
    const state = manager.stateFor(chrome);
    return state.presentationStatus === "presented" && state.presentedId === state.selfId && state.activeId === state.selfId;
  }, "browser tab finishes presentation before accepting input");
  assert.ok(pageView(), 'external content is visible initially');
  const originalUrl = page.getURL();
  assert.equal(manager.handleCommand(page, { type: 'voice-overlay', open: true }), false, 'external pages cannot claim the overlay');
  const notifications = webContents.getAllWebContents().find(contents => contents.getURL().includes('/notification-overlay'));
  if (notifications) assert.equal(manager.handleCommand(notifications, { type: 'voice-overlay', open: true }), false, 'notification surface cannot claim voice');
  assert.equal(manager.handleCommand(chrome, { type: 'voice-overlay', open: true }), true);
  assert.equal(pageView(), undefined, 'voice removes native web content from the view tree');
  assert.equal(page.getURL(), originalUrl, 'voice does not navigate the existing tab');
  assert.equal(manager.handleCommand(chrome, { type: 'voice-overlay', open: false }), true);
  assert.ok(pageView(), 'closing voice restores the same native page');

  let menu;
  const nativePopup = Menu.prototype.popup;
  // Capture the real native menu while exercising actions without sending a
  // print job, opening developer tools, or exiting the test runner by accident.
  Menu.prototype.popup = function (options) { menu = this; options.callback?.(); };
  const openMenu = async () => {
    await until(() => chrome.executeJavaScript("document.querySelector('[aria-label=\"Browser menu\"]')?.getAttribute('aria-expanded') === 'false'"), "previous menu close reaches the renderer");
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
  page.focus();
  shortcut(page, "F", ["control"]);
  await until(() => findUI.executeJavaScript(`document.activeElement?.matches('${findInput}')`), "Ctrl+F from website focuses find bar");
  await trackSound();
  assert.equal(window.contentView.children.at(-1).webContents, findSurface(), "find bar remains above the native website view");
  await findUI.insertText("needle");
  try {
    await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.matches === 3, "Chromium finds three matches");
  } catch (error) {
    console.error("Find diagnostics", JSON.stringify({ commands: findCommands, value: await findUI.executeJavaScript("document.querySelector('input').value"), state: manager.stateFor(chrome) }));
    throw error;
  }
  await findUI.executeJavaScript("document.querySelector('[aria-label=\"Next match\"]').click()");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.activeMatchOrdinal === 2, "next match works");
  await findUI.executeJavaScript("document.querySelector('[aria-label=\"Previous match\"]').click()");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.activeMatchOrdinal === 1, "previous match works");
  assert.equal(await soundNotes(), 0, "successful website searches stay silent");
  shortcut(findUI, "F", ["control"]);
  await findUI.insertText("missing-on-website");
  await until(async () => await soundNotes() === 2, "external website miss plays the same buzz");
  shortcut(findUI, "F", ["control"]);
  await findUI.insertText("needle");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.matches === 3, "website query restored");
  assert.equal(localFind(), undefined, "changing tabs clears the previous page's search without mixing results");
  await page.loadURL(web + "/other");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.matches === 1, "find follows page navigation");
  await page.loadURL(web + "/");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find?.matches === 3, "find follows navigation back");
  await captureFind("find-toolbar.png");
  page.focus();
  shortcut(page, "Escape");
  await until(() => manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find === undefined, "find selection cleared");
  await until(() => !findSurface(), "Escape works with website focus");
  page.emit("found-in-page", {}, { requestId: 123, matches: 3, activeMatchOrdinal: 1 });
  assert.equal(manager.stateFor(chrome).tabs.find(tab => tab.browser)?.browser.find, undefined, "late results cannot reopen a closed search");
  await choose("find");
  await until(() => findUI.executeJavaScript(`document.activeElement?.matches('${findInput}')`), "menu still opens and focuses search");
  await findUI.executeJavaScript("document.querySelector('[aria-label=\"Close find in page\"]').click()");
  await until(() => !findSurface(), "close button dismisses search");

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
  // Its in-page toolbar navigates by turning this tab into a browser tab.
  let settingsPage;
  await until(() => (settingsPage = webContents.getAllWebContents().find(contents => contents.getURL() === origin + "/browser/settings")), "settings document loads");
  const settingsTabId = manager.stateFor(chrome).tabs.find(tab => tab.url === origin + "/browser/settings").id;
  assert.equal(await manager.handleCommand(settingsPage, { type: "browser-navigate", input: web }), true);
  await until(() => manager.stateFor(chrome).tabs.every(tab => tab.id !== settingsTabId), "settings tab is replaced by the website");

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
