const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, webContents } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
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

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><title>Crash fixture</title><body>Ready ${req.url}</body>`);
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
  manager.tabs.setBrowserUrl(origin + "/browser");
  await manager.showDashboard(origin + "/dashboard");
  const main = manager.window;
  main.setBounds({ x: -12000, y: -12000, width: 900, height: 700 });
  const command = value => manager.tabs.handleCommand(manager.window.webContents, value);
  const pageAt = url => until(() => webContents.getAllWebContents().find(c => c.getURL() === url && !c.isLoading()), url);

  assert.equal(command({ type: "browser", url: origin + "/external" }), true);
  const browser = await pageAt(origin + "/external");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await crash(browser);
    await until(() => !browser.isDestroyed() && !browser.isCrashed() && !browser.isLoading(), "browser recovers");
    assert.equal(await browser.executeJavaScript("document.body.textContent"), "Ready /external");
    assert.equal(main.isDestroyed(), false);
  }

  assert.equal(command({ type: "open", url: origin + "/workspace", background: true }), true);
  const workspace = await pageAt(origin + "/workspace");
  await crash(workspace);
  await until(() => !workspace.isDestroyed() && !workspace.isCrashed() && !workspace.isLoading()
    && workspace.getURL() === origin + "/workspace", "workspace recovers");
  assert.equal(await workspace.executeJavaScript("document.body.textContent"), "Ready /workspace");

  // Local pages may share a renderer, so the workspace crash may also replace
  // the main window. Finish that recovery before testing another failure.
  await until(() => manager.window && !manager.window.webContents.isCrashed()
    && !manager.window.webContents.isLoading()
    && manager.window.webContents.getURL().startsWith(origin + "/dashboard"), "workspace host recovers");
  const beforeMainCrash = manager.window;
  await crash(beforeMainCrash.webContents);
  // Offscreen pages can use the production 15-second first-paint fallback.
  await until(() => manager.window && manager.window !== beforeMainCrash && beforeMainCrash.isDestroyed(), "main window replaced", 20_000);
  const recovered = manager.window;
  assert.match(await recovered.webContents.executeJavaScript("document.body.textContent"), /^Ready \/dashboard/);
  assert.equal(browser.isDestroyed(), false, "browser tab survives the main window swap");
  assert.equal(workspace.isDestroyed(), false, "workspace tab survives the main window swap");
  const tabs = manager.tabs.stateFor(recovered.webContents).tabs;
  assert.equal(tabs.length, 3);
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
