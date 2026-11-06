const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { app, ipcMain } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const dir = process.argv[2];
app.setPath("userData", path.join(dir, "user-data"));
// Invisible test windows must still produce the frames required for a handoff.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await sleep(20);
  }
  throw new Error("Timed out: " + label);
};

app.whenReady().then(async () => {
  let releaseCold;
  const server = http.createServer((request, response) => {
    const send = () => response.end(`<!doctype html><title>${request.url}</title>
      <style>html{min-height:100vh}header{height:32px;-webkit-app-region:drag}
      button{-webkit-app-region:no-drag}</style>
      <header ${request.url.startsWith("/hydrating") ? 'class="desktop-title-bar"' : ''}><button>First tab</button></header><input id="draft" value="kept">`);
    response.setHeader("content-type", "text/html");
    if (request.url === "/cold") releaseCold = send;
    else send();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const loading = path.join(dir, "loading.html");
  fs.writeFileSync(loading, "<!doctype html><body>Loading</body>");
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).toString()]) },
    startupHtmlPath: loading, recoveryHtmlPath: loading, loadingHtmlPath: loading,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"), minimumStartupVisibleMs: 0,
  });
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  const host = manager.tabs.hosts.get(window.id);
  const base = manager.page(window);
  for (const name of ["bookmarks", "recent-searches"]) ipcMain.handle("breadboard:get-browser-" + name, () => []);
  ipcMain.handle("breadboard:get-browser-downloads", () => ({items:[],error:null}));
  ipcMain.handle("breadboard:get-browser-history", () => ({items:[],error:null}));
  await base.loadURL(origin + "/base");
  const command = value => manager.tabs.handleCommand(second?.webContents ?? base, value);
  let second;
  const state = () => manager.tabs.stateFor(second?.webContents ?? base);
  const selected = async id => until(() => host.presentedId === id && !host.pending, "selected content presented");
  const activeView = () => host.tabs.find(tab => tab.id === host.activeId).view;
  await until(() => host.shellEnabled, "independent controls enabled");
  manager.tabs.setMemoryPressure("normal");
  command({ type: "open", url: origin + "/second" });
  const secondId = state().activeId;
  await selected(secondId);
  second = activeView();
  command({ type: "open", url: origin + "/third" });
  const thirdId = state().activeId;
  await selected(thirdId);
  const third = activeView();

  // Retiring the original page used to leave its header's native drag region
  // over the newer tab controls, even though about:blank contains no header.
  command({ type: "close", id: state().tabs[0].id });
  await until(() => base.getURL() === "about:blank", "base retired");
  await until(async () => base.executeJavaScript(`
    getComputedStyle(document.documentElement).webkitAppRegion === 'no-drag' &&
    document.documentElement.getBoundingClientRect().height >= innerHeight
  `), "retired base publishes a full-window non-draggable region");

  await base.loadURL("about:blank");
  await until(async () => base.executeJavaScript(`
    getComputedStyle(document.documentElement).webkitAppRegion === 'no-drag' &&
    document.documentElement.getBoundingClientRect().height >= innerHeight
  `), "reloading the retired base keeps the tab strip clickable");

  // The parked native window can receive focus after a web view loses it.
  // Its removal from the tab/IPC map must not disable window shortcuts.
  const press = (contents, keyCode, modifiers) => {
    contents.focus();
    contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  press(base, "Tab", ["control"]);
  await until(() => state().activeId === secondId, "Ctrl+Tab from the retired base wraps to the first tab");
  press(second.webContents, "Tab", ["control", "shift"]);
  await until(() => state().activeId === thirdId, "Ctrl+Shift+Tab wraps to the last tab");
  press(third.webContents, "1", ["control"]);
  await until(() => state().activeId === secondId, "Ctrl+1 selects the first tab");
  press(second.webContents, "9", ["control"]);
  await until(() => state().activeId === thirdId, "Ctrl+9 selects the last tab");

  // Resident switches preserve their document and viewport without JS probes.
  const frameReady = manager.tabs.frameReady;
  let probes = 0;
  manager.tabs.frameReady = (...args) => { probes++; return frameReady.apply(manager.tabs, args); };
  for (let iteration = 0; iteration < 20; iteration++) {
    const [id, view] = iteration % 2 ? [thirdId, third] : [secondId, second];
    const mutations = [];
    const setBounds = view.setBounds;
    view.setBounds = function (bounds) { mutations.push(bounds); return setBounds.call(this, bounds); };
    command({ type: "activate", id });
    assert.equal(host.presentedId, id);
    assert.equal(host.pending, null);
    view.setBounds = setBounds;
    assert.equal(mutations.length, 0, "resident viewport does not change during selection");
    assert.equal(state().navigationPending, false);
    assert.equal(await view.webContents.executeJavaScript("document.querySelector('#draft').value"), "kept");
  }
  assert.equal(probes, 0, "resident selection never asks a renderer to become ready again");
  manager.tabs.frameReady = frameReady;

  // A slow request must not hold selection or later steal it back.
  command({ type: "open", url: origin + "/cold" });
  await until(() => releaseCold, "cold request held");
  command({ type: "activate", id: secondId });
  await selected(secondId);
  releaseCold();
  await until(() => state().tabs.find(tab => tab.url.endsWith("/cold"))?.loading === false, "cancelled tab loaded");
  await sleep(100);
  assert.equal(host.activeId, secondId);
  assert.equal(host.presentedId, secondId);

  // Content need not hydrate a duplicate strip before the user can see it.
  command({ type: "open", url: origin + "/hydrating" });
  const hydratingId = host.activeId;
  await selected(hydratingId);
  const hydrating = activeView();
  assert.equal(await hydrating.webContents.executeJavaScript("document.querySelector('[role=tablist]') === null"), true);
  assert.ok(window.contentView.children.indexOf(host.shell.view) > window.contentView.children.indexOf(hydrating));

  manager.tabs.setBrowserUrl(origin + "/browser");
  command({ type: "browser", url: origin + "/web-page" });
  const firstBrowser = host.tabs.find(tab => tab.id === host.activeId);
  await selected(firstBrowser.id);
  command({ type: "browser", url: origin + "/web-page-two" });
  const secondBrowser = host.tabs.find(tab => tab.id === host.activeId);
  await selected(secondBrowser.id);
  assert.equal(firstBrowser.contents, secondBrowser.contents, "one browser panel renderer serves both tabs");
  for (const browserTab of [firstBrowser, secondBrowser, firstBrowser]) {
    command({ type: "activate", id: browserTab.id });
    await selected(browserTab.id);
    const views = window.contentView.children;
    assert.ok(views.indexOf(browserTab.browser.view) > views.indexOf(browserTab.view), "native website covers the shared panel");
    assert.ok(views.indexOf(host.shell.view) > views.indexOf(browserTab.browser.view), "controls remain above the website");
  }
  window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
