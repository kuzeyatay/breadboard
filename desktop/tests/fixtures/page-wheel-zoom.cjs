const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>Zoom fixture</title><style>body{height:5000px;margin:0}</style>
      <h1>${req.url}</h1><script>window.wheelCount=0;addEventListener('wheel',()=>window.wheelCount++,{passive:true})</script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Loading</body>");
  const preloadPath = path.resolve(__dirname, "../../dist/preload/preload.js");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() }, preloadPath,
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => "light", openWindow: () => {},
  });
  manager.setBrowserUrl(origin + "/browser");
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) =>
    isTabsCommand(command) && manager.handleCommand(event.sender, command));
  for (const name of ["getBrowserBookmarks", "getBrowserRecentSearches"]) ipcMain.handle(IPC_CHANNELS[name], () => []);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => ({ items: [], error: null }));
  const window = new BrowserWindow({ show: false, width: 1000, height: 750,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true } });
  manager.attach(window, true);
  window.setOpacity(0);
  window.showInactive();
  window.focus();
  const base = manager.baseContents(window);
  await base.loadURL(origin + "/dashboard");
  const host = manager.hosts.get(window.id);
  await until(() => host.shellEnabled, "shared toolbar ready");
  const command = value => manager.handleCommand(base, value);
  const active = () => host.tabs.find(tab => tab.id === host.activeId);
  const wheel = (contents, deltaY, modifiers = ["control"]) => {
    contents.focus();
    contents.sendInputEvent({ type: "mouseMove", x: 120, y: 100 });
    contents.sendInputEvent({ type: "mouseWheel", x: 120, y: 100, deltaX: 0, deltaY,
      wheelTicksY: deltaY / 120, hasPreciseScrollingDeltas: false, modifiers });
  };
  const reset = async contents => {
    contents.sendInputEvent({ type: "keyDown", keyCode: "0", modifiers: ["control"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: "0", modifiers: ["control"] });
    await until(() => Math.abs(contents.getZoomFactor() - 1) < 0.001, "Ctrl+0 resets wheel zoom");
  };
  const checkPage = async contents => {
    await reset(contents);
    wheel(contents, 120);
    await until(() => contents.getZoomFactor() > 1, "Ctrl+wheel up zooms in");
    wheel(contents, -120);
    await until(() => Math.abs(contents.getZoomFactor() - 1) < 0.001, "Ctrl+wheel down reverses zoom");
    wheel(contents, -120);
    await until(() => contents.getZoomFactor() < 1, "Ctrl+wheel down zooms out");
    await reset(contents);
    const before = await contents.executeJavaScript("window.wheelCount");
    wheel(contents, -120, []);
    await until(async () => await contents.executeJavaScript("window.wheelCount") > before, "ordinary wheel reaches the page");
    await until(async () => await contents.executeJavaScript("window.scrollY") > 0, "ordinary wheel scrolls");
    assert.equal(contents.getZoomFactor(), 1, "ordinary scrolling does not zoom");
  };
  await checkPage(base);
  await base.loadURL(origin + "/settings");
  await checkPage(base);
  command({ type: "open", url: origin + "/terminal" });
  const local = active();
  await until(() => !host.pending && local.loaded, "new local tab ready");
  await checkPage(local.contents);
  // A wheel over shared controls changes the selected page, not the toolbar.
  host.shell.contents.emit("zoom-changed", {}, "in");
  assert.ok(local.contents.getZoomFactor() > 1);
  assert.equal(host.shell.contents.getZoomFactor(), 1);
  await reset(local.contents);
  command({ type: "browser", url: origin + "/website" });
  const browser = active();
  await until(() => !host.pending && browser.browser.ready, "browser page ready");
  const page = browser.browser.contents;
  await checkPage(page);
  wheel(page, 120);
  await until(() => page.getZoomFactor() > 1 &&
    manager.stateFor(base).tabs.find(tab => tab.id === browser.id).browser.zoomPercent === Math.round(page.getZoomFactor() * 100),
    "browser toolbar reports wheel zoom");
  assert.equal(host.shell.contents.getZoomFactor(), 1);
  assert.equal(browser.contents.getZoomFactor(), 1);
  await reset(page);
  browser.contents.emit("zoom-changed", {}, "in");
  assert.equal(page.getZoomFactor(), 1.1, "shared browser panel zoom targets its website");
  assert.equal(browser.contents.getZoomFactor(), 1);
  await reset(page);
  command({ type: "activate", id: local.id });
  await until(() => !host.pending, "local tab reactivated");
  await checkPage(local.contents);
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
