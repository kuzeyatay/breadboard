const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, webContents, ipcMain } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
process.on("uncaughtException", error => { console.error(error); app.exit(1); });

// Assert the dangerous ordering even on machines where the native race does
// not happen to crash Electron. These wrap real navigation methods on real pages.
let inRendererExit = false;
app.on("web-contents-created", (_event, contents) => {
  assert.equal(inRendererExit, false, "must not create renderers during teardown");
  contents.prependListener("render-process-gone", () => {
    inRendererExit = true;
    queueMicrotask(() => { inRendererExit = false; });
  });
  for (const method of ["loadURL", "loadFile", "reload"]) {
    const original = contents[method].bind(contents);
    contents[method] = (...args) => {
      assert.equal(inRendererExit, false, `${method} must wait until renderer teardown returns`);
      return original(...args);
    };
  }
});
const until = async (probe, label, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};
const crash = async contents => {
  const gone = new Promise(resolve => contents.once("render-process-gone", resolve));
  contents.forcefullyCrashRenderer();
  await gone;
};

const verifyTabStateDelivery = tabs => {
  // A WebContents can survive both its process and its main frame. Make those
  // short native teardown windows deterministic, then verify delivery resumes.
  let crashed = true;
  let frameDestroyed = true;
  let frameReads = 0;
  const sent = [];
  const frame = {
    isDestroyed: () => frameDestroyed,
    send: (channel, state) => sent.push({ channel, state }),
  };
  const contents = {
    isDestroyed: () => false,
    isCrashed: () => crashed,
    get mainFrame() { frameReads += 1; return frame; },
    send: (channel, state) => frame.send(channel, state),
  };
  tabs.send(contents, { revision: 1 });
  assert.equal(frameReads, 0, "crashed renderers must not be accessed during recovery");
  assert.equal(sent.length, 0, "crashed renderers must not receive tab state");
  crashed = false;
  tabs.send(contents, { revision: 2 });
  assert.equal(sent.length, 0, "disposed frames must not receive tab state even when their WebContents survives");
  frameDestroyed = false;
  tabs.send(contents, { revision: 3 });
  assert.deepEqual(sent, [{ channel: "breadboard:tabs-state", state: { revision: 3 } }],
    "the recovered frame receives the latest state without replaying stale updates");
};

app.whenReady().then(async () => {
  let browserUnavailable = false;
  let releaseWebsite;
  const server = http.createServer((req, res) => {
    if (browserUnavailable && req.url === "/browser") { res.writeHead(503); res.end(); return; }
    const respond = () => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><title>Crash fixture</title><script>
      window.tabStates = [];
      window.breadboardDesktop?.onTabsState(state => window.tabStates.push(state));
    </script><body>Ready ${req.url}</body>`);
    };
    if (req.url === "/external-three") releaseWebsite = respond;
    else respond();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "recovery.html");
  fs.writeFileSync(scene, "<!doctype html><body>Reconnecting</body>");
  const manager = new WindowManager({
    startupHtmlPath: scene, loadingHtmlPath: scene, recoveryHtmlPath: scene,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).toString()]) },
    minimumStartupVisibleMs: 0, tabSessionConfigDir: dir,
    log: line => console.log(line),
  });
  verifyTabStateDelivery(manager.tabs);
  const parkPage = manager.tabs.parkBrowserPage.bind(manager.tabs);
  manager.tabs.parkBrowserPage = (host, tab, signal) => {
    const result = parkPage(host, tab, signal);
    if (tab.browser?.ready && !tab.browser.showingHome && tab.browser.attached && tab.view) {
      const children = host.window.contentView.children;
      assert.ok(children.indexOf(tab.browser.view) < children.indexOf(tab.view),
        "preparing a website must leave the shared interface's last visible column uncovered");
    }
    return result;
  };
  for (const channel of ["breadboard:get-browser-bookmarks", "breadboard:get-browser-recent-searches"]) ipcMain.handle(channel, () => []);
  ipcMain.handle("breadboard:get-browser-downloads", () => ({items:[],error:null}));
  manager.tabs.setBrowserUrl(origin + "/browser");
  await manager.showDashboard(origin + "/dashboard");
  const main = manager.window;
  main.setOpacity(0);
  main.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  main.showInactive();
  const command = value => manager.tabs.handleCommand(manager.page(manager.window), value);
  const pageAt = url => until(() => webContents.getAllWebContents().find(c => c.getURL() === url && !c.isLoading()), url);

  assert.equal(command({ type: "browser", url: origin + "/external" }), true);
  const browser = await pageAt(origin + "/external");
  const browserHost = manager.tabs.hosts.get(main.id);
  const browserTab = browserHost.tabs.find(tab => tab.browser?.contents === browser);
  await until(() => !browserHost.pending && browserTab.browser.ready && browserTab.painted, "initial website presented").catch(error => {
    console.error('initial presentation', JSON.stringify({pending:browserHost.pending?.id,front:browserHost.pendingAtFront,
      shellEnabled:browserHost.shellEnabled, chrome:browserTab.contents.id, page:browser.id,
      loaded:browserTab.loaded, painted:browserTab.painted, generation:browserTab.generation,
      ready:browserTab.browser.ready,committed:browserTab.browser.documentCommitted,painting:!!browserTab.browser.paintController,
      views:main.contentView.children.map(view=>({id:view.webContents?.id,bounds:view.getBounds()}))}));
    throw error;
  });
  const controls = browserHost.shell;
  await crash(controls.contents);
  await until(() => controls.ready && !controls.contents.isCrashed(), "independent shell recovers after teardown");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const finished = new Promise(resolve => browser.once("did-finish-load", resolve));
    await crash(browser);
    await finished;
    await until(() => !browser.isDestroyed() && !browser.isCrashed() && !browser.isLoading(), "browser recovers");
    await until(() => !browserHost.pending && browserTab.browser.ready, "recovered website presented");
    assert.equal(await browser.executeJavaScript("document.body.textContent"), "Ready /external");
    assert.equal(main.isDestroyed(), false);
  }

  // Replacing the shared panel renderer invalidates every tab that uses it.
  // The website document remains owned by its tab throughout the recovery.
  const sharedHost = manager.tabs.hosts.get(manager.window.id);
  const sharedTab = sharedHost.tabs.find(tab => tab.browser);
  assert.equal(command({ type: "browser", url: origin + "/external-two" }), true);
  const secondBrowser = await pageAt(origin + "/external-two");
  const secondTab = sharedHost.tabs.find(tab => tab.browser?.contents === secondBrowser);
  await until(() => !sharedHost.pending && secondTab.browser.ready, "second website presented").catch(error => {
    console.error('second presentation', JSON.stringify({pending:sharedHost.pending?.id, front:sharedHost.pendingAtFront,
      active:sharedHost.activeId, presented:sharedHost.presentedId, chromePainted:sharedHost.browserChrome.painted,
      tabs:sharedHost.tabs.map(tab=>({id:tab.id,loaded:tab.loaded,painted:tab.painted,generation:tab.generation, attached:tab.attached,
        browser:tab.browser&&{ready:tab.browser.ready,committed:tab.browser.documentCommitted,attached:tab.browser.attached,
          bounds:tab.browser.view?.getBounds(),painting:!!tab.browser.paintController}})),
      visible:sharedHost.window.isVisible(), bounds:sharedHost.window.getBounds(),
      views:sharedHost.window.contentView.children.map(view=>({id:view.webContents?.id,bounds:view.getBounds()}))}));
    throw error;
  });
  assert.equal(command({ type: "activate", id: sharedTab.id }), true);
  const generation = sharedTab.generation;
  const chromeNavigations = [];
  sharedHost.browserChrome.contents.on("did-start-navigation", (_event, url, _inPlace, mainFrame) => {
    if (mainFrame) chromeNavigations.push(url);
  });
  await until(() => !sharedHost.pending && sharedTab.browser.ready, "website ready before control recovery").catch(error => {
    console.error('browser presentation', {active:sharedHost.activeId, pending:sharedHost.pending?.id, presented:sharedHost.presentedId,
      loaded:sharedTab.loaded, painted:sharedTab.painted, generation:sharedTab.generation, attached:sharedTab.attached,
      ready:sharedTab.browser.ready, committed:sharedTab.browser.documentCommitted, pageAttached:sharedTab.browser.attached,
      painting:!!sharedTab.browser.paintController, pageUrl:browser.getURL(), chromeUrl:sharedTab.contents.getURL()});
    throw error;
  });
  assert.equal(manager.tabs.handleCommand(sharedTab.contents, { type: "browser-address-suggestions", open: true, bottom: 440 }), true);
  browserUnavailable = true;
  await crash(sharedHost.browserChrome.contents);
  await until(() => sharedHost.browserChrome.recovering, "controls retry while local service is unavailable");
  for (const target of [secondTab, sharedTab]) {
    assert.equal(command({ type: "activate", id: target.id }), true);
    await until(() => !sharedHost.pending && sharedHost.presentedId === target.id, "website switches during control recovery");
    assert.equal(target.browser.attached, true);
    assert.ok(target.browser.view.getBounds().y >= 0);
  }
  assert.deepEqual(chromeNavigations, [], "an unavailable local service cannot replace websites with reconnect scenes");
  browserUnavailable = false;
  await until(() => sharedTab.generation > generation && sharedTab.loaded
    && sharedTab.painted && !sharedTab.contents.isCrashed(), "shared browser document and presentation recover");
  assert.equal(sharedTab.browser.contents, browser);
  assert.equal(sharedTab.browser.addressSuggestionsOpen, false, "a crashed dropdown cannot cover the website");
  assert.ok(chromeNavigations.length > 0);
  assert.ok(chromeNavigations.every(url => url === origin + "/browser"),
    "browser controls recover directly without navigating to a workspace reconnect scene");
  assert.equal(sharedTab.browser.attached, true);
  assert.ok(sharedTab.browser.view.getBounds().y >= 0, "the healthy website stays on screen");
  await until(() => manager.window && !manager.page(manager.window).isCrashed()
    && !manager.page(manager.window).isLoading(), "host after shared renderer recovery");

  const navigationsAfterRecovery = chromeNavigations.length;
  let websiteReloads = 0;
  for (const page of [browser, secondBrowser]) page.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) websiteReloads += 1;
  });
  const switchesStarted = Date.now();
  for (let index = 0; index < 8; index += 1) {
    const target = index % 2 ? secondTab : sharedTab;
    assert.equal(command({ type: "activate", id: target.id }), true);
    await until(() => !sharedHost.pending && sharedHost.presentedId === target.id, "cached website selected");
    assert.equal(target.browser.attached, true);
    assert.ok(target.browser.view.getBounds().y >= 0);
  }
  assert.equal(chromeNavigations.length, navigationsAfterRecovery, "switching tabs must not reload browser controls");
  assert.equal(websiteReloads, 0, "switching tabs must keep their existing website documents");
  console.log(`Eight recovered browser tab switches: ${Date.now() - switchesStarted}ms`);
  assert.equal(command({ type: "browser", url: origin + "/external-three" }), true);
  await until(() => releaseWebsite && sharedHost.pending, "website handoff waits for a response");
  const thirdTab = sharedHost.pending;
  browserUnavailable = true;
  await crash(sharedHost.browserChrome.contents);
  await until(() => sharedHost.browserChrome.recovering, "controls recover during a cold tab handoff");
  const children = main.contentView.children;
  assert.ok(children.indexOf(secondTab.browser.view) > children.indexOf(sharedHost.browserChrome.view),
    "the outgoing website remains above the failed renderer during a pending handoff");
  assert.equal(secondTab.browser.attached, true);
  browserUnavailable = false;
  releaseWebsite(); releaseWebsite = null;
  await until(() => !sharedHost.pending && sharedHost.presentedId === thirdTab.id && thirdTab.browser.ready,
    "the pending website appears after controls recover").catch(error => {
      console.error('recovered pending tab', JSON.stringify({pending:sharedHost.pending?.id,front:sharedHost.pendingAtFront,
        presented:sharedHost.presentedId,loaded:thirdTab.loaded,painted:thirdTab.painted,generation:thirdTab.generation,
        ready:thirdTab.browser.ready,committed:thirdTab.browser.documentCommitted,painting:!!thirdTab.browser.paintController,
        recovering:sharedHost.browserChrome.recovering,chromeUrl:sharedHost.browserChrome.contents.getURL(),
        views:main.contentView.children.map(view=>({id:view.webContents?.id,bounds:view.getBounds()}))}));
      throw error;
    });
  assert.equal(command({ type: "close", id: thirdTab.id }), true);
  await until(() => !sharedHost.pending && sharedHost.activeId === secondTab.id, "second website restored");
  assert.equal(command({ type: "close", id: secondTab.id }), true);
  await until(() => !sharedHost.pending && sharedHost.activeId === sharedTab.id, "original website restored");

  assert.equal(command({ type: "open", url: origin + "/workspace", background: true }), true);
  const workspace = await pageAt(origin + "/workspace");
  await crash(workspace);
  await until(() => !workspace.isDestroyed() && !workspace.isCrashed() && !workspace.isLoading()
    && workspace.getURL() === origin + "/workspace", "workspace recovers");
  assert.equal(await workspace.executeJavaScript("document.body.textContent"), "Ready /workspace");
  await until(() => workspace.executeJavaScript(
    "window.tabStates.some(state => state.tabs.some(tab => tab.id === state.selfId && tab.url.endsWith('/workspace')))"
  ), "recovered workspace receives tab state").catch(async error => {
    console.error("workspace recovery diagnostics", JSON.stringify({url:workspace.getURL(),state:manager.tabs.stateFor(workspace),events:await workspace.executeJavaScript("window.tabStates"),hosts:[...manager.tabs.hosts.values()].map(host=>({window:host.window.id,destroyed:host.window.isDestroyed(),tabs:host.tabs.map(tab=>({id:tab.id,contents:tab.contents.id,url:tab.url}))}))}));
    throw error;
  });

  // Local pages may share a renderer, so the workspace crash may also replace
  // the main window. Finish that recovery before testing another failure.
  await until(() => manager.window && !manager.page(manager.window).isCrashed()
    && !manager.page(manager.window).isLoading()
    && manager.page(manager.window).getURL().startsWith(origin + "/dashboard"), "workspace host recovers");
  const beforeMainCrash = manager.window;
  await crash(manager.page(beforeMainCrash));
  // Offscreen pages can use the production 15-second first-paint fallback.
  await until(() => manager.window && manager.window !== beforeMainCrash && beforeMainCrash.isDestroyed(), "main window replaced", 20_000);
  const recovered = manager.window;
  assert.match(await manager.page(recovered).executeJavaScript("document.body.textContent"), /^Ready \/dashboard/);
  assert.equal(browser.isDestroyed(), false, "browser tab survives the main window swap");
  assert.equal(workspace.isDestroyed(), false, "workspace tab survives the main window swap");
  const tabs = manager.tabs.stateFor(manager.page(recovered)).tabs;
  assert.equal(tabs.length, 3);
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
