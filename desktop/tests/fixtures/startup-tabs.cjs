const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, View, webContents } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { writeTabSession } = require("../../dist/main/tab-session.js");
const dir = process.argv[2];
// Electron 33 exposes setVisible without a getter. Record calls while still
// applying them to the real native views, including their initial attachment.
const visibilityCalls = new WeakMap();
const setVisible = View.prototype.setVisible;
View.prototype.setVisible = function (visible) {
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
  const widgetHeld = new Map();
  const widgetsReleased = new Set();
  const released = new Set();
  const requests = new Set();
  const reply = (res, html) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body>${html}</body></html>`);
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture");
    requests.add(url.pathname);
    if (url.pathname.startsWith("/widget/")) {
      if (widgetsReleased.has(url.pathname)) return res.end("ready");
      widgetHeld.set(url.pathname, [...(widgetHeld.get(url.pathname) ?? []), res]);
      return;
    }
    if (url.pathname.startsWith("/resource/")) {
      if (released.has(url.pathname)) return res.end("done");
      held.set(url.pathname, [...(held.get(url.pathname) ?? []), res]);
      return;
    }
    // Anchored tabs permit redirects within their screen, not to a new path.
    if (url.pathname === "/slow" && url.searchParams.has("redirect")) {
      res.writeHead(302, { location: "/slow" });
      return res.end();
    }
    const resource = { "/slow": "local", "/browser": "shell", "/external": "external", "/popup": "popup" }[url.pathname];
    const widget = ["/new-tab", "/slow", "/browser", "/popup"].includes(url.pathname);
    reply(res, `${url.pathname}${resource ? `<img src="/resource/${resource}">` : ""}${widget ? `<script>
      document.documentElement.dataset.breadboardStartup = 'loading';
      window.addEventListener('load', () => {
        fetch('/widget${url.pathname}').then(response => response.text()).then(() => {
          document.body.dataset.widgetReady = 'true';
          document.documentElement.dataset.breadboardStartup = 'ready';
        });
      });
    </script>` : ""}`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const saved = (kind, url, anchored = true) => ({ kind, url, anchored, title: url });
  writeTabSession(dir, { version: 1, windows: [
    { activeIndex: 0, tabs: [saved("dashboard", "/slow?redirect=1"), saved("browser", origin + "/external"), saved("browser", ""), saved("dashboard", "/not-restored", false)] },
    { activeIndex: 0, tabs: [saved("dashboard", "/popup")] },
  ] });
  const savedSession = fs.readFileSync(path.join(dir, "tab-session.json"), "utf8");
  const startup = path.join(dir, "startup.html");
  fs.writeFileSync(startup, "<!doctype html><html><body>Loading</body></html>");
  const manager = new WindowManager({
    startupHtmlPath: startup, recoveryHtmlPath: startup, loadingHtmlPath: startup,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    minimumStartupVisibleMs: 0, tabSessionConfigDir: dir,
    startupPageLoadMaxWaitMs: process.argv[3] === "stalled" ? 500 : undefined,
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(startup).toString()]) },
  });
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  manager.tabs.setBrowserUrl(origin + "/browser");
  await manager.showStartupScreen();
  const loadingWindow = manager.window;
  let openedDuringRestore;
  let shown = false;
  let ready = false;
  const showing = manager.showDashboard(origin + "/dashboard", origin + "/new-tab").then(() => { shown = true; });
  const readiness = manager.waitForDashboardPaint().then(() => { ready = true; });
  // Even an early click (or the welcome's own failsafe) cannot bypass loading.
  if (process.argv[3] !== "welcome") manager.markStartupContinued();
  const overlayContents = view => view.children.find(child =>
    child.webContents?.getURL() === origin + "/notification-overlay")?.webContents;
  const overlays = () => BrowserWindow.getAllWindows().flatMap(window =>
    window.contentView.children.filter(view => overlayContents(view)),
  );
  const assertNotificationsHidden = () => {
    for (const view of overlays()) {
      // A poll returning a real card must not make its native view visible.
      assert.equal(manager.tabs.resizeNotificationOverlay(overlayContents(view), { width: 400, height: 220 }), true);
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
  const releaseWidget = async name => {
    const url = "/widget" + name;
    await until(() => widgetHeld.has(url), name + " widget starts without selecting its tab");
    widgetsReleased.add(url);
    for (const response of widgetHeld.get(url)) response.end("ready");
  };
  const releaseResource = async name => {
    const url = "/resource/" + name;
    await until(() => held.has(url), name + " resource starts without selecting its tab");
    released.add(url);
    for (const response of held.get(url)) response.end("done");
  };
  await until(() => widgetHeld.has("/widget/new-tab"), "new-tab widgets start first");
  if (process.argv[3] === "stalled") await new Promise(resolve => setTimeout(resolve, 1_500));
  await assertStillLoading();
  assert.equal(held.size, 0, "restored pages do not compete with the fresh new-tab widgets");
  await releaseWidget("/new-tab");
  await until(() => ["local", "shell", "external"].every(name => held.has("/resource/" + name)), "two queued tabs start loading");
  assert.equal(requests.has("/popup"), false, "remaining tabs wait for a loading slot");
  if (process.argv[3] === "concurrent") {
    const restoringWindow = BrowserWindow.getAllWindows().find(window =>
      window !== loadingWindow && window.webContents.getURL().startsWith(origin + "/new-tab"));
    assert.ok(restoringWindow);
    assert.equal(manager.tabs.handleCommand(restoringWindow.webContents, {
      type: "open", url: origin + "/opened-during-restore",
    }), true);
    await until(() => {
      openedDuringRestore = webContents.getAllWebContents().find(contents =>
        contents.getURL() === origin + "/opened-during-restore");
      return openedDuringRestore && manager.tabs.stateFor(openedDuringRestore).activeId ===
        manager.tabs.stateFor(openedDuringRestore).selfId;
    }, "the new tab becomes active while restoration is waiting");
  }
  if (process.argv[3] === "close") {
    loadingWindow.close();
    await Promise.all([showing, readiness]);
    assert.equal(BrowserWindow.getAllWindows().length, 0, "closing startup must dispose every hidden window");
    assert.equal(fs.readFileSync(path.join(dir, "tab-session.json"), "utf8"), savedSession,
      "closing during queued restoration preserves the complete previous session");
    server.closeAllConnections();
    server.close();
    app.exit(0);
    return;
  }
  for (const name of ["local", "shell", "external"]) {
    await releaseResource(name);
    await assertStillLoading();
  }
  await releaseWidget("/slow");
  await releaseWidget("/browser");
  await until(() => held.has("/resource/popup"), "secondary window restores after the first window is ready");
  await until(() => overlays().length === 3, "startup and restored windows have notification overlays");
  if (process.argv[3] === "stalled") await new Promise(resolve => setTimeout(resolve, 1_500));
  await assertStillLoading();
  await releaseResource("popup");
  await assertStillLoading();
  await releaseWidget("/popup");
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
  assert.equal(manager.tabs.stateFor(manager.window.webContents).tabs.length, openedDuringRestore ? 5 : 4);
  if (openedDuringRestore) {
    const state = manager.tabs.stateFor(openedDuringRestore);
    assert.notEqual(state.selfId, null, "the native view must retain its tab registration");
    assert.equal(state.activeId, state.selfId, "restoring saved tabs must not steal the live selection");
    const liveView = manager.window.contentView.children.find(view => view.webContents === openedDuringRestore);
    assert.ok(liveView, "the selected live tab remains attached");
    manager.window.setBounds({ x: 80, y: 80, width: 1100, height: 740 });
    await until(() => {
      const [width, height] = manager.window.getContentSize();
      const bounds = liveView.getBounds();
      return bounds.width === width && bounds.height === height;
    }, "the live tab resizes with the restored window");
    const baseId = manager.tabs.stateFor(manager.window.webContents).selfId;
    assert.equal(manager.tabs.handleCommand(openedDuringRestore, { type: "activate", id: baseId }), true);
    await until(() => !manager.window.contentView.children.includes(liveView),
      "switching to New tab removes the previous view instead of leaving an overlay");
  }
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    if (contents.getURL().startsWith(origin) && manager.tabs.windowFor(contents)) {
      assert.equal(contents.isLoading(), false, contents.getURL() + " has unexpected loading state at reveal");
      assert.notEqual(await contents.executeJavaScript("document.documentElement.dataset.breadboardStartup"), "loading",
        "tab widgets are ready before the app opens");
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
