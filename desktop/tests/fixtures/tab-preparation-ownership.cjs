const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
// Invisible fixtures still need actual compositor frames for tab handoffs.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>${req.url}</title><body>
      <input id="draft" value="kept">${req.url}
      <script>document.documentElement.dataset.breadboardStartup = 'loading';</script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Loading</body>");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href]) },
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => "dark", openWindow: () => assert.fail("Unexpected window"),
    startupPageLoadMaxWaitMs: 500,
  });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  window.setOpacity(0);
  window.showInactive();
  manager.attach(window);
  await window.loadURL(origin + "/new-tab");
  manager.setBrowserUrl(origin + "/browser");
  const host = manager.hosts.get(window.id);
  const command = value => manager.handleCommand(window.webContents, value);

  for (const browser of [false, true]) {
    command(browser
      ? { type: "browser", url: origin + "/external", background: true }
      : { type: "open", url: origin + "/gardens/telecom-1", background: true });
    const tab = host.tabs.find(tab => browser ? tab.browser : tab.url.endsWith("/gardens/telecom-1"));
    assert.ok(tab);
    await until(() => tab.loaded && (!browser || tab.browser.documentCommitted), "documents loaded");
    const preparing = manager.prepareStartupTab(host, tab, true);
    command({ type: "activate", id: tab.id });
    await until(() => host.pending === null, "selected tab revealed while its widgets are pending");
    assert.equal(host.activeId, tab.id);
    assert.ok(window.contentView.children.includes(tab.view));
    if (browser) assert.ok(window.contentView.children.includes(tab.browser.view));
    // Background readiness finishes only after the person has started using
    // the restored tab. Cleanup must not uncover the base New tab document.
    await tab.contents.executeJavaScript("document.documentElement.dataset.breadboardStartup = 'ready'");
    if (browser) await tab.browser.contents.executeJavaScript("document.documentElement.dataset.breadboardStartup = 'ready'");
    await preparing;
    assert.equal(host.activeId, tab.id, "selection never changes");
    assert.ok(window.contentView.children.includes(tab.view), "late preparation must retain the selected tab's native view");
    assert.equal(tab.view.getBounds().y, 0);
    if (browser) assert.ok(window.contentView.children.includes(tab.browser.view), "late preparation must retain the selected website");
    assert.equal(await tab.contents.executeJavaScript("document.querySelector('#draft').value"), "kept");
    await manager.prepareStartupTab(host, tab, true);
    assert.ok(window.contentView.children.includes(tab.view), "preparing an already selected tab cannot detach it either");
    if (browser) assert.ok(window.contentView.children.includes(tab.browser.view));
    // A native detachment must also be repairable by selecting the same tab;
    // it must not require visiting another tab just to clear an attached flag.
    window.contentView.removeChildView(tab.view);
    if (browser) window.contentView.removeChildView(tab.browser.view);
    command({ type: "activate", id: tab.id });
    await until(() => host.pending === null, "same-tab selection repairs native detachment");
    assert.ok(window.contentView.children.includes(tab.view));
    if (browser) assert.ok(window.contentView.children.includes(tab.browser.view));
    assert.equal(await tab.contents.executeJavaScript("document.querySelector('#draft').value"), "kept");
    command({ type: "activate", id: host.base.id });
    await until(() => !host.pending, "base selected");
    manager.setMemoryPressure("critical");
    assert.equal(window.contentView.children.includes(tab.view), false, "memory pressure detaches inactive surfaces");
    manager.setMemoryPressure("normal");
  }
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
