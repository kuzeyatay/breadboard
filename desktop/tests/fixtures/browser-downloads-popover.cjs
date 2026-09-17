const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { app, BrowserWindow, dialog, ipcMain, session, webContents } = require("electron");
const { TabManager, BROWSER_SESSION_PARTITION } = require("../../dist/main/tab-manager.js");
const { BrowserDownloads } = require("../../dist/main/browser-downloads.js");
const { IPC_CHANNELS, isTabsCommand, isBrowserDownloadCommand } = require("../../dist/shared/ipc-contract.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  console.log("Checking:", label);
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  console.log("Remaining views:", webContents.getAllWebContents().map(contents => ({ id: contents.id, url: contents.getURL() })));
  throw new Error(`Timed out: ${label}`);
};
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const requireDashboard = createRequire(path.join(dashboard, "package.json"));
  const bundle = requireDashboard("esbuild").buildSync({
    stdin: { contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { useDesktopTabs } from './src/app/components/use-desktop-tabs';
      import { sendDesktopTabsCommand } from './src/lib/desktop-browser-tabs';
      import BrowserDownloadsButton from './src/app/browser/browser-downloads-button';
      import BrowserDownloadsPopover from './src/app/browser/browser-downloads-popover';
      import BrowserDownloadsPanel from './src/app/browser/browser-downloads';
      import BrowserMenuControls from './src/app/browser/browser-menu-controls';
      import BrowserExtensionsButton from './src/app/browser/browser-extensions-button';
      import BrowserExtensionsPopover from './src/app/browser/browser-extensions-popover';
      function Chrome() {
        const state = useDesktopTabs();
        const tab = state?.tabs.find(tab => tab.id === state.selfId);
        const [panel, setPanel] = useState('');
        return <><div className="browser-toolbar" style={{marginTop:32}}>
          <div className="browser-address-form" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            {tab?.browser?.address || 'Search or enter address'}
            <BrowserExtensionsButton open={tab?.browser?.extensionsOpen ?? false} count={state?.extensions.length ?? 0}/>
          </div>
          <BrowserDownloadsButton active={Boolean(tab?.browser && tab.id === state?.activeId)} open={tab?.browser?.downloadsOpen ?? false}/>
          <BrowserMenuControls profileLabel="Fixture" address={tab?.browser?.address || ''} onPanel={panel => {
            setPanel(panel); window.testPanel = panel; void sendDesktopTabsCommand({type:'browser-terminal',open:true});
          }}/>
        </div><div style={{width:600}}><BrowserDownloadsPanel active={panel === 'downloads'} closeButton={<button>Close</button>}/></div></>;
      }
      createRoot(document.getElementById('root')).render(location.pathname === '/browser/downloads-popover' ? <BrowserDownloadsPopover/>
        : location.pathname === '/browser/extensions-popover' ? <BrowserExtensionsPopover/> : <Chrome/>);
    `, resolveDir: dashboard, loader: "tsx" },
    bundle: true, write: false, outdir: "out", format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles;
  const css = fs.readFileSync(path.join(dashboard, "src/app/globals.css"), "utf8");
  const server = http.createServer((req, res) => {
    if (req.url === "/global.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    if (req.url === "/app.js" || req.url === "/app.css") {
      const ext = req.url.endsWith("css") ? ".css" : ".js";
      res.setHeader("Content-Type", ext === ".css" ? "text/css" : "text/javascript");
      return res.end(bundle.find(file => file.path.endsWith(ext)).text);
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>
      body {margin:0;font-family:Arial} *,::before,::after {box-sizing:border-box;border:0 solid} button,input {font:inherit;color:inherit;background:transparent}
      :root {--font-source-sans:Arial;--font-schibsted:Arial;--ink-heading:#27372c;--ink-muted:#68766a;--botanical:#537958;--paper-surface:#fafbf8;--paper-raised:#fff;--line-strong:#c3d2c1}
      [data-theme="dark"] {--ink-heading:#ededed;--ink-muted:#a5a5a5;--botanical:#9bb999;--paper-surface:#20211f;--paper-raised:#20211f;--line-strong:#454642}
      .sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  const external = http.createServer((req, res) => {
    if (req.url === "/complete") {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", 'attachment; filename="Sunset photograph.jpeg"');
      return res.end("download fixture\n");
    }
    if (req.url === "/slow" || req.url === "/unknown") {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${req.url === "/slow" ? "Reference library.zip" : "Unknown size.zip"}"`);
      if (req.url === "/slow") res.setHeader("Content-Length", 10_000_000);
      res.write(Buffer.alloc(4096));
      const timer = setInterval(() => res.write(Buffer.alloc(4096)), 40);
      res.on("close", () => clearInterval(timer));
      return;
    }
    res.end('<!doctype html><title>Download test page</title><body style="margin:0;background:#dbcbd4;font:18px Arial;padding:40px"><h1>Downloads</h1><p>Your page stays in place while a file downloads.</p></body>');
  });
  const origin = await listen(server), web = await listen(external);
  const opened = [], shown = [];
  const downloads = new BrowserDownloads(dir, { openPath: async file => { opened.push(file); return ""; }, showItemInFolder: file => shown.push(file) });
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  browserSession.on("will-download", (_event, item) => item.setSavePath(path.join(dir, item.getFilename())));
  downloads.attach(browserSession);
  const loading = path.join(dir, "loading.html");
  fs.writeFileSync(loading, "<!doctype html><body>Loading</body>");
  const preload = path.resolve(__dirname, "../../dist/preload/preload.js");
  const manager = new TabManager({
    log: line => console.log(line),
    allowed: { origins: new Set([origin]) }, preloadPath: preload,
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => "light",
    openWindow: () => assert.fail("Unexpected window"),
  });
  manager.setEnabled(true);
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: { preload, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  const reads = new Map();
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, event => {
    reads.set(event.sender.id, (reads.get(event.sender.id) || 0) + 1);
    return downloads.snapshot();
  });
  ipcMain.handle(IPC_CHANNELS.browserDownloadCommand, (_event, command) => isBrowserDownloadCommand(command) && downloads.command(command));
  await window.loadURL(origin + "/dashboard");
  window.showInactive();
  await manager.handleCommand(window.webContents, { type: "browser", url: web });
  const chrome = await until(() => webContents.getAllWebContents().find(c => c.getURL() === origin + "/browser" && !c.isLoading()), "toolbar");
  const page = await until(() => webContents.getAllWebContents().find(c => c.getURL() === web + "/" && !c.isLoading()), "website");
  const pageView = await until(() => window.contentView.children.find(view => view.webContents?.id === page.id), "website visible");
  const pageBounds = pageView.getBounds();
  await until(() => !manager.stateFor(chrome).navigationPending && page.isFocused(), "browser reveal complete");
  await until(() => (reads.get(chrome.id) || 0) >= 2, "download baseline");
  chrome.debugger.attach("1.3");
  await chrome.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const toolbar = () => chrome.executeJavaScript("document.querySelector('[aria-label^=Downloads]')?.outerHTML || ''");
  assert.match(await toolbar(), /aria-expanded="false"/);
  assert.equal(manager.handleCommand(page, { type: "browser-downloads-popover", x: 900, y: 80 }), false);
  assert.equal(isTabsCommand({ type: "browser-downloads-resize", height: Infinity }), false);
  assert.equal(isTabsCommand({ type: "browser-downloads-popover", x: -1, y: 10 }), false);
  page.downloadURL(web + "/slow");
  await until(async () => (await toolbar()).includes('data-downloading="true"'), "active toolbar indicator");
  assert.equal(await chrome.executeJavaScript("getComputedStyle(document.querySelector('[data-downloading=true] span')).animationName"), "none", "reduced motion keeps a static activity ring");
  await chrome.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  assert.notEqual(await chrome.executeJavaScript("getComputedStyle(document.querySelector('[data-downloading=true] span')).animationName"), "none");
  const popupContents = () => webContents.getAllWebContents().find(c => c.getURL() === origin + "/browser/downloads-popover" && !c.isDestroyed());
  let popup = await until(popupContents, "automatically open popup");
  const body = () => popup.executeJavaScript("document.body.innerText");
  await until(async () => (await body()).includes("Reference library.zip"), "progress row");
  await until(() => window.contentView.children.find(view => view.webContents?.id === popup.id)?.getBounds().y > 0, "popup measured and revealed");
  assert.deepEqual(pageView.getBounds(), pageBounds, "popover does not resize the website");
  assert.equal(window.contentView.children.at(-1).webContents.id, popup.id, "popover is above the website");
  assert.equal(await popup.executeJavaScript("document.querySelector('progress').hasAttribute('value')"), true);
  assert.equal(manager.handleCommand(chrome, { type: "browser-downloads-resize", height: 200 }), false, "only popup can resize itself");
  const capture = async name => {
    const out = process.env.BREADBOARD_DOWNLOADS_POPOVER_QA_DIR;
    if (!out) return;
    await chrome.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await popup.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, name + ".png"), (await chrome.capturePage({ x: 0, y: 0, width: 1000, height: 120 })).toPNG());
    fs.writeFileSync(path.join(out, name + "-popover.png"), (await popup.capturePage()).toPNG());
  };
  await capture("active-light");
  await popup.executeJavaScript("document.documentElement.dataset.theme='dark'");
  await chrome.executeJavaScript("document.documentElement.dataset.theme='dark'");
  await capture("active-dark");
  page.downloadURL(web + "/complete");
  await until(async () => (await body()).includes("Completed"), "completed file in popover");
  await popup.executeJavaScript("document.querySelector('[aria-label=\"Open Sunset photograph.jpeg\"]').click()");
  await until(() => opened.length === 1, "open file");
  await until(() => popup.executeJavaScript("!document.querySelector('[aria-label=\"Show Sunset photograph.jpeg in folder\"]').disabled"), "folder action ready");
  await popup.executeJavaScript("document.querySelector('[aria-label=\"Show Sunset photograph.jpeg in folder\"]').click()");
  await until(() => shown.length === 1, "show in folder");
  assert.deepEqual(opened, shown);
  page.downloadURL(web + "/unknown");
  await until(async () => (await body()).includes("Unknown size.zip"), "unknown-size transfer");
  await until(async () => (await toolbar()).includes("2 downloading"), "multiple transfers share the activity indicator");
  assert.equal(await popup.executeJavaScript("Array.from(document.querySelectorAll('article')).find(row=>row.innerText.includes('Unknown size.zip')).querySelector('progress').hasAttribute('value')"), false);
  for (const item of downloads.snapshot().items.filter(item => item.active)) await downloads.command({ type: "cancel", id: item.id });
  await until(async () => (await toolbar()).includes('data-downloading="false"'), "spinner stops when transfers stop");
  await until(async () => (await body()).includes("Cancelled"), "cancellation status");
  await capture("completed-dark");
  await popup.executeJavaScript("setTimeout(() => Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Show all downloads').click(), 40); true");
  await until(() => chrome.executeJavaScript("window.testPanel === 'downloads'"), "show all opens the full list");
  await until(() => !popupContents(), "popup destroyed");
  assert.equal(fs.existsSync(opened[0]), true);
  // Reopen after the click-dismiss guard expires, then dismiss using Escape.
  await new Promise(resolve => setTimeout(resolve, 250));
  await chrome.executeJavaScript("document.querySelector('[aria-label^=Downloads]').click()");
  popup = await until(() => { const contents = popupContents(); return contents && !contents.isLoading() ? contents : null; }, "reopened renderer");
  await until(async () => (await body()).includes("Completed"), "reopened history");
  popup.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  await until(() => !popupContents(), "Escape closes popup");
  await new Promise(resolve => setTimeout(resolve, 250));
  await chrome.executeJavaScript("document.querySelector('[aria-label^=Downloads]').click()");
  popup = await until(() => { const contents = popupContents(); return contents && !contents.isLoading() ? contents : null; }, "popup for outside dismissal");
  await until(async () => (await body()).includes("Completed"), "outside dismissal content");
  page.focus();
  await until(() => !popupContents(), "focusing the website dismisses the popover");
  // The extensions card must cross the same native surface boundary.
  await manager.handleCommand(chrome, { type: "browser-terminal", open: false });
  await page.executeJavaScript("document.body.style.height='2000px'; scrollTo(0,120); window.pageMarker='preserved'");
  const originalBounds = pageView.getBounds();
  const extensionContents = () => webContents.getAllWebContents().find(c =>
    !c.isDestroyed() && c.getURL().startsWith(origin + "/browser/extensions-popover"));
  const extensionToolbar = () => chrome.executeJavaScript("document.querySelector('[aria-label=Extensions]').getAttribute('aria-expanded')");
  const openExtensions = async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
    await chrome.executeJavaScript("document.querySelector('[aria-label=Extensions]').click()");
    popup = await until(() => { const found = extensionContents(); return found && !found.isLoading() ? found : null; }, "extensions renderer");
    await until(() => window.contentView.children.find(view => view.webContents?.id === popup.id)?.getBounds().y > 0, "extensions measured and visible");
    await until(async () => await extensionToolbar() === "true", "extensions button reflects native state");
    return window.contentView.children.find(view => view.webContents?.id === popup.id);
  };
  let extensionView = await openExtensions();
  assert.match(await body(), /No extensions loaded yet/);
  assert.match(await body(), /Picture in Picture/);
  assert.match(await body(), /Load unpacked/);
  assert.equal(window.contentView.children.at(-1).webContents.id, popup.id, "extensions are above website");
  assert.ok(extensionView.getBounds().y + extensionView.getBounds().height > originalBounds.y + 150, "card extends well into website area");
  assert.deepEqual(pageView.getBounds(), originalBounds, "opening extensions leaves website viewport alone");
  await manager.handleCommand(chrome, { type: "browser-address-suggestions", open: false });
  const stacked = window.contentView.children.map(view => view.webContents?.id);
  assert.ok(stacked.indexOf(popup.id) > stacked.indexOf(page.id) && stacked.indexOf(popup.id) > stacked.indexOf(chrome.id), "relayout keeps extensions above website and toolbar");
  assert.equal(manager.handleCommand(page, { type: "browser-extensions-popover", x: 900, y: 80 }), false);
  assert.equal(manager.handleCommand(chrome, { type: "browser-extensions-resize", height: 200 }), false);
  assert.equal(isTabsCommand({ type: "browser-extensions-resize", height: Infinity }), false);
  assert.equal(isTabsCommand({ type: "browser-extensions-popover", x: -1, y: 80 }), false);
  await popup.executeJavaScript("document.documentElement.dataset.theme='dark'");
  await capture("extensions-empty-dark");

  const extensionPath = path.join(dir, "extension");
  fs.mkdirSync(extensionPath);
  fs.writeFileSync(path.join(extensionPath, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Fixture extension", version: "1.0" }));
  let selectionPath = extensionPath, selections = 0;
  dialog.showOpenDialog = async () => {
    selections++;
    // A native folder chooser temporarily takes focus away from the card.
    window.emit("blur"); chrome.focus();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(popup.isDestroyed(), false, "folder dialog cannot destroy its own result/error surface");
    return { canceled: false, filePaths: [selectionPath] };
  };
  const clickPopup = async selector => {
    await until(() => popup.executeJavaScript('!document.querySelector(' + JSON.stringify(selector) + ')?.disabled'), "extension action enabled");
    const point = await popup.executeJavaScript('(() => { const button = document.querySelector(' + JSON.stringify(selector) + '); button.scrollIntoView({block:"nearest"}); const r = button.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()');
    popup.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    popup.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
  };
  await clickPopup(".browser-extension-load");
  await until(async () => (await body()).includes("Fixture extension"), "load action below website boundary works");
  await until(async () => (await body()).includes("1 active"), "installed count updates in popup");
  await until(() => chrome.executeJavaScript("document.querySelector('.browser-extensions-count')?.textContent === '1'"), "toolbar installed count updates");
  await capture("extensions-installed-dark");
  selectionPath = path.join(dir, "missing-extension");
  await clickPopup(".browser-extension-load");
  await until(async () => (await body()).includes("That folder could not be loaded"), "invalid folder shows inline error");
  selectionPath = extensionPath;
  await clickPopup(".browser-extension-load");
  await until(() => popup.executeJavaScript("!document.querySelector('[role=alert]') && !document.querySelector('.browser-extension-load').disabled"), "retry clears load error");
  assert.equal(selections, 3);
  await clickPopup('[aria-label="Reload Fixture extension"]');
  await until(() => popup.executeJavaScript(`!!document.querySelector('[aria-label="Reload Fixture extension"]') && !document.querySelector('[aria-label="Reload Fixture extension"]').disabled`), "reload finishes in the same card");
  await clickPopup('[aria-label="Remove Fixture extension"]');
  await until(async () => (await body()).includes("No extensions loaded yet"), "remove refreshes the card");
  assert.deepEqual(await page.executeJavaScript("[window.pageMarker,scrollY]"), ["preserved", 120], "actions preserve website state and scroll");
  assert.deepEqual(pageView.getBounds(), originalBounds);
  await page.executeJavaScript(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const paint = () => { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#537958'; ctx.fillRect(0,0,320,180); };
    paint(); window.videoTimer = setInterval(paint, 40);
    const video = document.createElement('video'); video.muted = true; video.style.cssText = 'position:fixed;top:20px;left:20px;width:320px;height:180px';
    document.body.append(video); video.srcObject = canvas.captureStream(25); window.fixtureVideo = video; await video.play();
  })()`);
  await clickPopup("main button");
  await until(() => !extensionContents(), "built-in PiP action closes the card");
  await until(() => page.executeJavaScript("document.pictureInPictureElement === window.fixtureVideo"), "built-in PiP starts from the extensions card");
  await page.executeJavaScript("document.exitPictureInPicture()");
  await openExtensions();
  popup.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  await until(() => !extensionContents(), "Escape closes extensions");
  await until(async () => await extensionToolbar() === "false", "Escape resets toolbar state");
  assert.equal(chrome.isFocused(), true, "Escape returns focus to toolbar");
  await openExtensions();
  page.focus();
  await until(() => !extensionContents(), "clicking page dismisses extensions");
  await openExtensions();
  chrome.focus();
  await until(() => !extensionContents(), "toolbar focus dismisses extensions");
  await chrome.executeJavaScript("document.querySelector('[aria-label=Extensions]').click()");
  assert.equal(extensionContents(), undefined, "same toolbar click does not reopen dismissed card");

  await openExtensions();
  window.setSize(500, 280);
  await until(() => !extensionContents(), "resize dismisses stale anchored card");
  extensionView = await openExtensions();
  const shortBounds = extensionView.getBounds();
  assert.ok(shortBounds.x >= 0 && shortBounds.x + shortBounds.width <= window.getContentSize()[0]);
  assert.ok(shortBounds.y + shortBounds.height <= window.getContentSize()[1]);
  assert.equal(await popup.executeJavaScript("document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight"), true, "short window scrolls the entire card");
  await clickPopup(".browser-extension-load");
  await until(() => selections === 4, "bottom action remains reachable in short window");
  await until(() => popup.executeJavaScript("!document.querySelector('.browser-extension-load').disabled"), "folder action completes in short window");
  await capture("extensions-short-window");
  const browserTabId = manager.stateFor(chrome).selfId;
  const otherTab = manager.stateFor(chrome).tabs.find(tab => tab.id !== browserTabId);
  await manager.handleCommand(chrome, { type: "activate", id: otherTab.id });
  await until(() => !extensionContents(), "switching tabs dismisses extensions");
  console.log("Extensions stacking, real load/reload/remove, inline retry, viewport preservation, small windows and dismissal passed.");
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  console.log("Download toolbar, progress, native layering, file actions, full list and Escape passed.");
  chrome.debugger.detach();
  downloads.prepareForQuit();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
