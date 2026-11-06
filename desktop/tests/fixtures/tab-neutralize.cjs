const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { app, BrowserWindow } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { readTabSession } = require("../../dist/main/tab-session.js");
const dir = process.argv[2];
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const until = async (probe, message) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${message}`);
};

app.whenReady().then(async () => {
  const requests = new Map();
  let releaseSlow;
  const server = http.createServer((req, res) => {
    requests.set(req.url, (requests.get(req.url) || 0) + 1);
    const respond = () => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><head><title>${req.url}</title></head><body>${req.url}</body></html>`);
    };
    if (req.url === "/slow") releaseSlow = respond;
    else respond();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const blank = path.join(dir, "blank.html");
  fs.writeFileSync(blank, "<!doctype html><body>Fixture</body>");
  const preloadPath = path.resolve(__dirname, "../../dist/preload/preload.js");
  const windows = [];
  let manager;
  const createWindow = (url = origin + "/new-tab", persistent = true) => {
    const window = new BrowserWindow({ show: false, webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true } });
    manager.attach(window, persistent);
    window.setOpacity(0);
    window.showInactive();
    windows.push(window);
    manager.trackSessionWindow(window);
    window.fixtureReady = manager.baseContents(window).loadURL(url);
    return window;
  };
  manager = new TabManager({ allowed: { origins: new Set([origin]), localFiles: new Set() }, preloadPath,
    recoveryHtmlPath: () => blank, loadingHtmlPath: () => blank, theme: () => "dark", openWindow: createWindow,
    tabSessionConfigDir: dir });
  manager.setMemoryPressure("critical"); // No spare new-tab renderer in these assertions.
  manager.setNewTabUrl(origin + "/new-tab");
  manager.setBrowserUrl(origin + "/browser");
  const main = createWindow(origin + "/garden?document=example#page=4");
  await main.fixtureReady;
  await manager.restoreSession(main, origin, createWindow);
  const host = manager.hosts.get(main.id);
  const state = () => manager.stateFor(manager.baseContents(main));
  const command = value => manager.handleCommand(manager.baseContents(main), value);
  const tab = id => host.tabs.find(tab => tab.id === id);
  const ready = id => until(() => {
    const entry = tab(id);
    return entry?.loaded && (!entry.browser || entry.browser.documentCommitted) && !host.pending;
  }, `tab ${id} loaded`);
  const base = state().activeId;
  await command({ type: "browser", url: origin + "/site-a" });
  const a = state().activeId;
  await ready(a);
  await command({ type: "browser", url: origin + "/site-b?item=2#detail" });
  const b = state().activeId;
  await ready(b);
  await command({ type: "group-tabs", id: a, targetId: base });
  await command({ type: "group-tabs", id: b, targetId: base });
  const group = state().groups.find(group => group.id !== "breadboard-ai").id;
  await command({ type: "group-update", groupId: group, name: "Research", color: "purple" });
  await command({ type: "anchor", id: a });
  const before = state().tabs.map(({ id, title, url, groupId, anchored }) => ({ id, title, url, groupId, anchored }));
  const oldBase = tab(base).contents;
  const oldA = tab(a).browser.contents;
  const oldB = tab(b).browser.contents;
  const chrome = host.browserChrome.contents;
  const closedBefore = host.closedTabs.length;
  const counts = new Map(requests);
  await command({ type: "group-menu", groupId: group, x: 80, y: 35 });
  await until(() => host.groupPopover && host.groupPopover.view.getBounds().y >= 0, "menu ready");
  const menu = host.groupPopover.contents;
  await until(() => menu.executeJavaScript(`Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Neutralize tab group')`), "neutralize action exists");
  await menu.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Neutralize tab group').click(); true`);
  await until(() => oldBase.isDestroyed() && oldA.isDestroyed() && oldB.isDestroyed(), "all owned documents destroyed");
  assert.equal(chrome.isDestroyed(), false, "window's shared browser UI survives");
  assert.equal(host.closedTabs.length, closedBefore, "unloading never closes logical tabs");
  assert.equal(state().tabs.length, 4, "neutralizing the only group creates a visible new tab");
  assert.equal(state().groups.find(group => group.id !== "breadboard-ai").collapsed, true);
  assert.deepEqual(state().tabs.filter(entry => entry.groupId === group).map(({ id, title, url, groupId, anchored }) => ({ id, title, url, groupId, anchored })), before);
  assert.ok(state().tabs.filter(entry => entry.groupId === group).every(entry => !entry.loading));
  assert.ok(tab(base).deferredUrl);
  assert.equal(tab(a).browser.contents, null);
  assert.equal(tab(b).browser.contents, null);
  for (const url of ["/site-a", "/site-b?item=2", "/garden?document=example"]) assert.equal(requests.get(url), counts.get(url), `${url} stays unloaded`);
  const unloadedBase = tab(base).contents;
  await command({ type: "group-action", groupId: group, action: "neutralize" });
  assert.equal(tab(base).contents, unloadedBase, "repeated neutralization is idempotent");

  await command({ type: "activate", id: a });
  await ready(a);
  assert.notEqual(tab(a).browser.contents, oldA);
  assert.equal(tab(a).browser.contents.getURL(), origin + "/site-a");
  assert.equal(tab(b).browser.contents, null, "selecting one member does not load its siblings");
  assert.ok(tab(base).deferredUrl);
  await command({ type: "activate", id: base });
  await ready(base);
  assert.equal(tab(base).contents.getURL(), origin + "/garden?document=example#page=4");
  assert.equal(tab(base).deferredUrl, undefined);
  await command({ type: "activate", id: b });
  await ready(b);
  assert.equal(tab(b).browser.contents.getURL(), origin + "/site-b?item=2#detail");

  // A split reopens both visible documents using the existing deferred path.
  await command({ type: "group-action", groupId: group, action: "ungroup" });
  await command({ type: "group-tabs", id: b, targetId: a });
  const splitGroup = tab(a).groupId;
  await command({ type: "group-update", groupId: splitGroup, split: true });
  const splitContents = [tab(a).browser.contents, tab(b).browser.contents];
  await command({ type: "group-action", groupId: splitGroup, action: "neutralize" });
  await until(() => splitContents.every(contents => contents.isDestroyed()), "split documents released");
  await command({ type: "activate", id: b });
  await ready(a);
  await ready(b);
  assert.equal(state().groups.find(entry => entry.id === splitGroup).split, true);

  // Keep private cookies until the tab really closes, even if every document unloads.
  const partition = manager.privateBrowserPartition();
  const privateA = manager.openBrowserTab(host, origin + "/private-a", false, undefined, undefined, undefined, partition);
  const privateB = manager.openBrowserTab(host, origin + "/private-b", false, undefined, undefined, undefined, partition);
  await ready(privateA.id);
  await ready(privateB.id);
  const profile = privateA.browser.contents.session;
  await profile.cookies.set({ url: origin, name: "neutralize-session", value: "retained" });
  await command({ type: "group-tabs", id: privateB.id, targetId: privateA.id });
  const privateGroup = tab(privateA.id).groupId;
  const privateContents = [privateA.browser.contents, privateB.browser.contents];
  await command({ type: "group-action", groupId: privateGroup, action: "neutralize" });
  await until(() => privateContents.every(contents => contents.isDestroyed()), "private documents released");
  assert.equal((await profile.cookies.get({ name: "neutralize-session" }))[0]?.value, "retained");
  await command({ type: "activate", id: privateA.id });
  await ready(privateA.id);
  assert.equal(tab(privateA.id).browser.contents.session, profile);
  assert.equal((await profile.cookies.get({ name: "neutralize-session" }))[0]?.value, "retained");

  // Saving unloaded members preserves their real URLs and never saves blank placeholders.
  await command({ type: "group-action", groupId: splitGroup, action: "neutralize" });
  await until(() => !tab(a).browser.contents && !tab(b).browser.contents, "background group unloaded");
  manager.freezeSession();
  const saved = readTabSession(dir).windows.flatMap(window => window.tabs);
  assert.ok(saved.some(entry => entry.url === origin + "/site-a" && entry.groupId === splitGroup));
  assert.ok(saved.some(entry => entry.url === origin + "/site-b?item=2#detail" && entry.groupId === splitGroup));
  assert.ok(!saved.some(entry => entry.url === "about:blank"));

  // Legacy windows keep their window-owned backing page alive on about:blank.
  const legacy = createWindow(origin + "/legacy", false);
  await legacy.fixtureReady;
  const legacyHost = manager.hosts.get(legacy.id);
  const legacyCommand = value => manager.handleCommand(manager.baseContents(legacy), value);
  const legacyBase = legacyHost.base;
  await legacyCommand({ type: "open", url: origin + "/legacy-other" });
  const legacyOther = legacyHost.tabs.find(entry => entry.id === legacyHost.activeId);
  await until(() => legacyOther.loaded && !legacyHost.pending, "legacy page ready");
  await legacyCommand({ type: "group-tabs", id: legacyOther.id, targetId: legacyBase.id });
  const legacyGroup = legacyHost.groups.find(group => group.id !== "breadboard-ai").id;
  await legacyCommand({ type: "group-action", groupId: legacyGroup, action: "neutralize" });
  await until(() => legacyOther.contents.isDestroyed() && legacyBase.contents.getURL() === "about:blank", "legacy pages unloaded");
  assert.equal(legacy.isDestroyed(), false);
  await legacyCommand({ type: "activate", id: legacyBase.id });
  await until(() => legacyHost.base.loaded && !legacyHost.pending, "legacy base reloaded");
  assert.equal(legacyHost.base.contents.getURL(), origin + "/legacy");

  // Reselecting during a slow legacy reveal cancels queued unloading.
  const slow = manager.openTab(legacyHost, origin + "/slow", { background: true, origin: "blank" });
  await until(() => Boolean(releaseSlow), "slow page requested");
  const outside = legacyHost.tabs.filter(entry => entry.groupId !== legacyGroup && entry !== slow);
  for (const entry of outside) await legacyCommand({ type: "close", id: entry.id });
  const reselectedContents = legacyHost.base.contents;
  await legacyCommand({ type: "group-action", groupId: legacyGroup, action: "neutralize" });
  assert.equal(legacyHost.activeId, slow.id);
  assert.ok(legacyHost.pending, "unloading waits for the replacement page");
  await legacyCommand({ type: "activate", id: legacyBase.id });
  releaseSlow();
  await until(() => !legacyHost.pending && slow.loaded, "reselection settles");
  assert.equal(legacyHost.base.contents, reselectedContents);
  assert.equal(reselectedContents.isDestroyed(), false, "newly selected page is never unloaded by a stale callback");
  console.log("Neutralize: native documents destroyed; menu, lazy reload, base page, split, private cookies, saved URLs and rapid reselection verified.");
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
