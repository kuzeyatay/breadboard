const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, session } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { readAccountTabSession, writeTabSession } = require("../../dist/main/tab-session.js");
const dir = process.argv[2];
const signedInStartup = process.argv[3] === "signed-in";
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const hits = new Map();
  const until = async (probe, label) => {
    const deadline = Date.now() + 5000;
    while (!probe()) {
      assert.ok(Date.now() < deadline, `Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  let sessionFailure = false;
  const server = http.createServer((req, res) => {
    const id = /next-auth\.session-token=([12])/.exec(req.headers.cookie || "")?.[1];
    const url = new URL(req.url, "http://fixture");
    hits.set(url.pathname, (hits.get(url.pathname) || 0) + 1);
    if (url.pathname === "/api/auth/session") {
      res.writeHead(sessionFailure ? 503 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(id ? { user: { id } } : {}));
      return;
    }
    if (!id && !url.pathname.startsWith("/auth/") && url.pathname !== "/external") {
      res.writeHead(302, { location: "/auth/login?callbackUrl=" + encodeURIComponent(req.url) });
      res.end();
      return;
    }
    const send = () => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><head><title>${url.pathname}</title></head><body>Account ${id || "signed out"}</body></html>`);
    };
    send();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const startup = path.join(dir, "startup.html");
  fs.writeFileSync(startup, "<!doctype html><html><body>Loading</body></html>");
  const savedTab = (url, title, extra = {}) => ({ kind: "dashboard", url, title, anchored: false, ...extra });
  writeTabSession(dir, { version: 1, windows: [{ activeIndex: 0, tabs: [
    savedTab("/gardens/first?chat=23#message", "First", { anchored: true }),
    savedTab("/auth/login?callbackUrl=%2Fmap%3Fview%3Dgraph", "Login"),
    { kind: "browser", url: origin + "/external", title: "External", anchored: false },
    { kind: "browser", url: "", title: "Browser", anchored: false },
  ], savedGroups: [{ id: "saved", name: "Saved", color: "blue", collapsed: true, tabs: [savedTab("/plan", "Plan")] }] },
  { activeIndex: 0, tabs: [savedTab("/profile", "Profile")] }] });
  const manager = new WindowManager({
    startupHtmlPath: startup, recoveryHtmlPath: startup, loadingHtmlPath: startup,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    minimumStartupVisibleMs: 0, tabSessionConfigDir: dir,
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(startup).href]) },
    log: line => { if (line.includes("synchronize login")) console.log(line); },
  });
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  manager.tabs.setBrowserUrl(origin + "/browser");
  manager.tabs.setAuthenticationUrl(origin);
  if (signedInStartup) await session.defaultSession.cookies.set({ url: origin, name: "next-auth.session-token", value: "1" });
  await manager.showDashboard(origin + "/dashboard", origin + "/new-tab");
  const main = manager.window;
  const state = () => manager.tabs.stateFor(manager.page(main));
  const authenticate = async value => {
    if (value) await session.defaultSession.cookies.set({ url: origin, name: "next-auth.session-token", value });
    else await session.defaultSession.cookies.remove(origin, "next-auth.session-token");
    assert.equal(await manager.tabs.synchronizeAuthentication(), true);
  };
  if (!signedInStartup) {
    assert.equal(state().enabled, false, "signed-out startup has no tab strip");
    assert.equal(state().tabs.length, 1);
    assert.equal(BrowserWindow.getAllWindows().length, 1, "saved windows stay hidden until login");
    assert.equal(hits.has("/gardens/first"), false);
    await authenticate("1");
  }
  assert.equal(state().enabled, true);
  assert.equal(state().tabs.length, 5);
  assert.equal(state().savedGroups.length, 1);
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  assert.equal(state().tabs.some(tab => tab.url.includes("/auth/")), false);
  assert.ok(state().tabs.some(tab => tab.url === origin + "/map?view=graph"), "old login placeholders recover their destinations");
  assert.equal(hits.has("/gardens/first"), true, "background dashboards load before restoration completes");
  assert.equal(hits.has("/external"), true, "background websites load before restoration completes");
  for (const window of BrowserWindow.getAllWindows()) {
    const restored = manager.tabs.stateFor(manager.page(window));
    assert.ok(restored.tabs.filter(tab => tab.id !== restored.activeId).every(tab => !tab.loading),
      "restored background tabs have finished loading, including browser tabs");
  }
  const stableIds = state().tabs.map(tab => tab.id);
  await authenticate("1-rotated");
  assert.deepEqual(state().tabs.map(tab => tab.id), stableIds, "JWT renewal preserves live tabs");
  sessionFailure = true;
  assert.equal(await manager.tabs.synchronizeAuthentication(), false);
  assert.deepEqual(state().tabs.map(tab => tab.id), stableIds, "a server outage does not sign out");
  sessionFailure = false;

  const anchored = state().tabs.find(tab => tab.anchored);
  const dashboardHits = hits.get("/gardens/first");
  assert.equal(await manager.tabs.handleCommand(manager.page(main), { type: "activate", id: anchored.id }), true);
  await until(() => !state().tabs.find(tab => tab.id === anchored.id).loading, "selected dashboard settles");
  assert.equal(hits.get("/gardens/first"), dashboardHits, "selecting a restored tab reuses its loaded page");
  const browser = state().tabs.find(tab => tab.url === origin + "/external");
  const browserHits = hits.get("/external");
  assert.equal(await manager.tabs.handleCommand(manager.page(main), { type: "activate", id: browser.id }), true);
  await until(() => !state().tabs.find(tab => tab.id === browser.id).loading, "selected browser settles");
  assert.equal(hits.get("/external"), browserHits, "selecting a restored website does not reload it");
  const home = state().tabs.find(tab => tab.browser && !tab.url);
  const shellHits = hits.get("/browser");
  assert.equal(await manager.tabs.handleCommand(manager.page(main), { type: "activate", id: home.id }), true);
  await until(() => !state().tabs.find(tab => tab.id === home.id).loading, "selected browser home settles");
  assert.equal(hits.get("/browser"), shellHits, "the browser home shell is already loaded");
  assert.equal(state().tabs.find(tab => tab.url.includes("/map?")).loading, false, "untouched restored tabs are ready too");
  // Expiry/logout in another renderer must work without a bridge command.
  await session.defaultSession.cookies.remove(origin, "next-auth.session-token");
  const logoutDeadline = Date.now() + 5000;
  while (state().enabled && Date.now() < logoutDeadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await manager.tabs.synchronizeAuthentication(), true);
  assert.equal(BrowserWindow.getAllWindows().length, 1, "logout closes all secondary workspace windows");
  assert.equal(state().enabled, false);
  assert.equal(state().tabs.length, 1);
  assert.equal(state().tabs[0].url, origin + "/auth/login");
  assert.deepEqual(state().savedGroups, []);
  assert.equal(await manager.tabs.handleCommand(manager.page(main), { type: "reopen" }), false);
  const saved = readAccountTabSession(dir, "1");
  assert.ok(saved.windows[0].tabs.some(tab => tab.url === "/gardens/first?chat=23#message"));
  assert.equal(saved.windows.flatMap(window => window.tabs).some(tab => tab.url.includes("/auth/")), false);

  await authenticate("2");
  assert.equal(state().tabs.length, 1, "a different account cannot inherit the saved workspace");
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.deepEqual(state().savedGroups, []);
  await authenticate(null);
  await authenticate("1");
  assert.equal(state().tabs.length, 5, "the original account gets its tabs back without duplicates");
  assert.equal(state().savedGroups.length, 1);
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  await authenticate(null);
  const beforeQuit = readAccountTabSession(dir, "1");
  manager.tabs.freezeSession();
  assert.deepEqual(readAccountTabSession(dir, "1"), beforeQuit, "quitting while signed out cannot overwrite the saved workspace");
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
