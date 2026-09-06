const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, WebContentsView, webContents } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { writeTabSession } = require("../../dist/main/tab-session.js");
const dir = process.argv[2];
// Electron 33 exposes setVisible without a getter. Record calls while still
// applying them to the real native views, including their initial attachment.
const visibilityCalls = new WeakMap();
const setVisible = WebContentsView.prototype.setVisible;
WebContentsView.prototype.setVisible = function (visible) {
  visibilityCalls.set(this, [...(visibilityCalls.get(this) ?? []), visible]);
  return setVisible.call(this, visible);
};
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out: " + label);
};

app.whenReady().then(async () => {
  const held = new Map();
  const released = new Set();
  const requests = new Set();
  const reply = (res, html) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body>${html}</body></html>`);
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture");
    requests.add(url.pathname);
    if (url.pathname.startsWith("/resource/")) {
      if (released.has(url.pathname)) return res.end("done");
      held.set(url.pathname, [...(held.get(url.pathname) ?? []), res]);
      return;
    }
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: "/slow" });
      return res.end();
    }
    const resource = { "/slow": "local", "/browser": "shell", "/external": "external", "/popup": "popup" }[url.pathname];
    reply(res, `${url.pathname}${resource ? `<img src="/resource/${resource}">` : ""}`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const saved = (kind, url, anchored = true) => ({ kind, url, anchored, title: url });
  writeTabSession(dir, { version: 1, windows: [
    { activeIndex: 0, tabs: [saved("dashboard", "/redirect"), saved("browser", origin + "/external"), saved("browser", ""), saved("dashboard", "/not-restored", false)] },
    { activeIndex: 0, tabs: [saved("dashboard", "/popup")] },
  ] });
  const startup = path.join(dir, "startup.html");
  fs.writeFileSync(startup, "<!doctype html><html><body>Loading</body></html>");
  const manager = new WindowManager({
    startupHtmlPath: startup, recoveryHtmlPath: startup, loadingHtmlPath: startup,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    minimumStartupVisibleMs: 0, tabSessionConfigDir: dir,
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(startup).toString()]) },
  });
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  manager.tabs.setBrowserUrl(origin + "/browser");
  await manager.showStartupScreen();
  const loadingWindow = manager.window;
  let shown = false;
  let ready = false;
  const showing = manager.showDashboard(origin + "/dashboard", origin + "/new-tab").then(() => { shown = true; });
  const readiness = manager.waitForDashboardPaint().then(() => { ready = true; });
  // Even an early click (or the welcome's own failsafe) cannot bypass loading.
  if (process.argv[3] !== "welcome") manager.markStartupContinued();
  await until(() => ["local", "shell", "external", "popup"].every(name => held.has("/resource/" + name)), "all background tabs start loading");
  const overlays = () => BrowserWindow.getAllWindows().flatMap(window =>
    window.contentView.children.filter(view => view.webContents?.getURL() === origin + "/notification-overlay"),
  );
  await until(() => overlays().length === 3, "startup and restored windows have notification overlays");
  const assertNotificationsHidden = () => {
    for (const view of overlays()) {
      // A poll returning a real card must not make its native view visible.
      assert.equal(manager.tabs.resizeNotificationOverlay(view.webContents, { width: 400, height: 220 }), true);
      const calls = visibilityCalls.get(view);
      assert.equal(calls?.at(-1), false, "notifications stay hidden until the app replaces welcome");
      if (!shown) assert.equal(calls.includes(true), false, "no notification flashes during creation or relayout");
    }
  };
  assertNotificationsHidden();
  const assertStillLoading = async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(ready, false, "the welcome must wait for all tab resources");
    assert.equal(shown, false, "the app must wait for all tab resources");
    assert.equal(manager.window, loadingWindow);
    assertNotificationsHidden();
    for (const window of BrowserWindow.getAllWindows()) {
      if (window !== loadingWindow) assert.equal(window.getOpacity(), 0, "restored windows stay hidden");
    }
  };
  await assertStillLoading();
  if (process.argv[3] === "close") {
    loadingWindow.close();
    await Promise.all([showing, readiness]);
    assert.equal(BrowserWindow.getAllWindows().length, 0, "closing startup must dispose every hidden window");
    server.closeAllConnections();
    server.close();
    app.exit(0);
    return;
  }
  for (const name of ["local", "shell", "external"]) {
    const url = "/resource/" + name;
    released.add(url);
    for (const response of held.get(url)) response.end("done");
    await assertStillLoading();
  }
  released.add("/resource/popup");
  for (const response of held.get("/resource/popup")) response.end("done");
  if (process.argv[3] === "welcome") {
    await readiness;
    assert.equal(ready, true);
    assert.equal(shown, false, "a painted dashboard still waits for welcome dismissal");
    assert.equal(manager.window, loadingWindow);
    assertNotificationsHidden();
    manager.markStartupContinued();
  }
  await until(() => ready && shown, "all tabs complete and the app opens");
  await Promise.all([showing, readiness]);
  assert.equal(loadingWindow.isDestroyed(), true);
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  assert.equal(requests.has("/not-restored"), false);
  assert.equal(manager.tabs.stateFor(manager.window.webContents).tabs.length, 4);
  for (const contents of webContents.getAllWebContents()) {
    if (contents.getURL().startsWith(origin) && manager.tabs.windowFor(contents)) {
      assert.equal(contents.isLoading(), false, contents.getURL() + " still loading at reveal");
    }
  }
  for (const window of BrowserWindow.getAllWindows()) {
    assert.equal(window.getOpacity(), 1);
  }
  assert.equal(overlays().length, 2);
  for (const view of overlays()) {
    assert.equal(visibilityCalls.get(view)?.at(-1), true, "pending notifications appear in every window after welcome");
    assert.equal(view.getBounds().width, 400, "the pending card retains its measured size");
  }
  await manager.showStartupScreen();
  assertNotificationsHidden();
  manager.tabs.freezeSession();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.close();
  app.exit(0);
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
