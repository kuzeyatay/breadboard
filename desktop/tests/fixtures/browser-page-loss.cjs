const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Page loss fixture</title><body>Ready</body>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Loading</body>");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => "light", openWindow: () => assert.fail("unexpected popup window"),
  });
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  manager.attach(window);
  await window.loadURL(origin + "/dashboard");
  const base = window.webContents;
  const baseId = manager.stateFor(base).activeId;
  assert.equal(manager.handleCommand(base, { type: "browser", url: origin + "/page" }), true);
  const chrome = await until(() => webContents.getAllWebContents().find(page => page.getURL() === origin + "/browser"), "trusted browser chrome");
  const state = () => manager.stateFor(chrome);
  const tabId = state().activeId;
  await until(() => !chrome.isLoading() && !state().tabs.find(tab => tab.id === tabId).loading, "trusted chrome loaded");
  const findPage = () => webContents.getAllWebContents().find(page => page.getURL() === origin + "/page");
  let page = await until(findPage, "browser page");
  await until(() => !page.isLoading(), "page loaded");
  assert.equal(manager.handleCommand(chrome, { type: "close", id: baseId }), true);
  assert.equal(state().tabs.length, 1, "the browser is the last tab");

  // Native disposal is distinct from the user closing a tab. Previously its
  // destroyed handler dropped this last tab and closed the entire window.
  page.close();
  await until(() => page.isDestroyed(), "native page disposed");
  assert.equal(window.isDestroyed(), false, "losing a browser page must not close Breadboard");
  assert.equal(chrome.isDestroyed(), false, "trusted chrome survives");
  assert.equal(state().activeId, tabId);
  assert.equal(state().tabs.length, 1);
  assert.equal(state().tabs[0].browser.address, origin + "/page");
  assert.equal(state().tabs[0].loading, false);
  assert.equal(manager.handleCommand(chrome, { type: "reload" }), true);
  page = await until(findPage, "reload recreates the native page");
  await until(() => !page.isLoading(), "recreated page loaded");

  // An actual renderer crash must recover in place without removing its tab.
  const crashed = new Promise(resolve => page.once("render-process-gone", resolve));
  page.forcefullyCrashRenderer();
  await crashed;
  await until(() => !page.isCrashed() && !page.isLoading() && state().tabs[0].browser.pageReady, "crashed renderer recovers");
  assert.equal(window.isDestroyed(), false);
  assert.equal(state().activeId, tabId);
  assert.equal(await page.executeJavaScript("document.body.textContent"), "Ready");

  page.close();
  await until(() => page.isDestroyed(), "second native page disposed");
  manager.reloadActive(window);
  page = await until(findPage, "application menu reload recreates the native page");
  await until(() => !page.isLoading(), "menu replacement loaded");

  // Auth popups can still message their opener and close their own tab.
  assert.equal(await page.executeJavaScript(`window.open(${JSON.stringify(origin + "/popup")}) !== null`, true), true);
  const popup = await until(() => webContents.getAllWebContents().find(candidate => candidate.getURL() === origin + "/popup"), "popup page");
  await until(() => !popup.isLoading(), "popup loaded");
  await popup.executeJavaScript("opener.postMessage('signed-in', '*'); window.close()").catch(() => {});
  await until(() => popup.isDestroyed() && state().tabs.length === 1, "popup retires its own tab");
  assert.equal(window.isDestroyed(), false);

  assert.equal(manager.handleCommand(chrome, { type: "close", id: tabId }), true);
  await until(() => window.isDestroyed(), "explicit last-tab close still closes the window");
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
