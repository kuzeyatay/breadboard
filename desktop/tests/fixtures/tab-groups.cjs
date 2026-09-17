const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { app, BrowserWindow, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { readTabSession } = require("../../dist/main/tab-session.js");
const [dir, phase] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async probe => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await probe()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error("Timed out waiting for the browser page");
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>${req.url}</title></head><body>Tab group fixture</body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const preloadPath = path.resolve(__dirname, "../../dist/preload/preload.js");
  const blank = path.join(dir, "blank.html");
  fs.writeFileSync(blank, "<!doctype html><body>Loading</body>");
  let manager;
  const windows = [];
  const createWindow = (url = origin + "/new-tab") => {
    const window = new BrowserWindow({ show: false, webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true } });
    manager.attach(window);
    windows.push(window);
    manager.trackSessionWindow(window);
    window.fixtureReady = window.loadURL(url);
    return window;
  };
  manager = new TabManager({ allowed: { origins: new Set([origin]), localFiles: new Set() }, preloadPath,
    recoveryHtmlPath: () => blank, loadingHtmlPath: () => blank, theme: () => "dark", openWindow: createWindow,
    tabSessionConfigDir: dir });
  manager.setNewTabUrl(origin + "/new-tab");
  manager.setBrowserUrl(origin + "/browser");
  const main = createWindow();
  await main.fixtureReady;
  const state = window => manager.stateFor(window.webContents);
  const command = (window, value) => manager.handleCommand(window.webContents, value);
  await manager.restoreSession(main, origin, createWindow);
  if (phase === "save") {
    await command(main, { type: "browser", url: origin + "/a" });
    const a = state(main).activeId;
    await command(main, { type: "browser", url: origin + "/b" });
    const b = state(main).activeId;
    await until(() => state(main).tabs.filter(tab => [a, b].includes(tab.id)).every(tab => tab.browser?.pageReady));
    assert.equal(await command(main, { type: "group-tabs", id: b, targetId: a }), true);
    const id = state(main).groups[0].id;
    const initialOrder = state(main).tabs.map(tab => tab.id);
    const activeBeforeMove = state(main).activeId;
    assert.equal(await command(main, { type: "group-move", groupId: id, index: 0 }), true);
    assert.deepEqual(state(main).tabs.slice(0, 2).map(tab => tab.id), [a, b]);
    assert.equal(state(main).activeId, activeBeforeMove, "reordering keeps the active tab");
    assert.equal(await command(main, { type: "group-move", groupId: id, index: 1 }), true);
    assert.deepEqual(state(main).tabs.map(tab => tab.id), initialOrder);
    await command(main, { type: "group-update", groupId: id, name: "Shopping", color: "purple", collapsed: true });
    assert.equal(state(main).groups[0].collapsed, true);
    assert.ok(!state(main).tabs.find(tab => tab.id === state(main).activeId).groupId, "collapse moves selection outside the group");
    await command(main, { type: "activate", id: b });
    assert.equal(state(main).groups[0].collapsed, false, "shortcut activation reveals hidden members");
    await command(main, { type: "group-action", groupId: id, action: "new-tab" });
    assert.equal(state(main).tabs.filter(tab => tab.groupId === id).length, 3);
    await command(main, { type: "anchor", id: a });
    assert.equal(await command(main, { type: "group-action", groupId: id, action: "delete" }), false);
    assert.equal(state(main).tabs.filter(tab => tab.groupId === id).length, 3, "anchor blocks the whole delete");
    await command(main, { type: "anchor", id: a });
    // The menu is a native view above a real website, and only that view can resize itself.
    await command(main, { type: "browser", url: origin + "/site" });
    const browserId = state(main).activeId;
    await until(() => state(main).tabs.find(tab => tab.id === browserId)?.browser?.pageReady);
    assert.equal(await command(main, { type: "group-menu", groupId: id, x: 15, y: 32 }), true);
    const menu = webContents.getAllWebContents().find(contents => contents.getURL().includes("/tab-group-popover"));
    assert.ok(menu);
    assert.equal(await command(main, { type: "group-menu-resize", height: 380 }), false);
    assert.equal(await manager.handleCommand(menu, { type: "group-menu-resize", height: 380 }), true);
    assert.equal(main.contentView.children.at(-1).webContents, menu);
    assert.equal(main.contentView.children.at(-1).getBounds().height, 380);
    assert.equal(await manager.handleCommand(menu, { type: "group-menu-close" }), true);
    await command(main, { type: "close", id: browserId });
    const liveIds = webContents.getAllWebContents().filter(contents => manager.windowFor(contents) === main && [a, b].includes(manager.stateFor(contents).selfId)).map(contents => contents.id);
    assert.equal(liveIds.length, 2);
    assert.equal(await command(main, { type: "group-action", groupId: id, action: "new-window" }), true);
    const popup = windows.at(-1);
    assert.notEqual(popup, main);
    assert.equal(state(popup).groups[0].name, "Shopping");
    for (const liveId of liveIds) assert.equal(manager.windowFor(webContents.fromId(liveId)), popup, "moving carries the existing renderer");
    assert.equal(await command(popup, { type: "group-action", groupId: id, action: "save-close" }), true);
    assert.equal(state(popup).groups.length, 0);
    assert.equal(state(popup).savedGroups[0].tabCount, 3);
    fs.writeFileSync(path.join(dir, "group-order.json"), JSON.stringify(readTabSession(dir).windows.find(window => window.savedGroups?.length).savedGroups[0].tabs.map(tab => tab.title)));
    // Persist one open collapsed group and one saved closed group across a new runtime port.
    await command(main, { type: "open", url: origin + "/c" });
    const c = state(main).activeId;
    await command(main, { type: "group-tabs", id: c, targetId: state(main).tabs[0].id });
    const openId = state(main).groups[0].id;
    await command(main, { type: "group-update", groupId: openId, name: "Research", color: "cyan", collapsed: true });
    assert.equal(state(main).tabs.length, 3, "collapsing the only group opens a fresh visible tab");
    // Only anchors and grouped tabs return at startup; keep the outside tab durable too.
    await command(main, { type: "anchor", id: state(main).activeId });
    const membersBeforeMove = state(main).tabs.filter(tab => tab.groupId === openId).map(tab => tab.id);
    assert.equal(await command(main, { type: "group-move", groupId: openId, index: 1 }), true);
    assert.deepEqual(state(main).tabs.slice(1).map(tab => tab.id), membersBeforeMove);
    assert.equal(state(main).groups[0].collapsed, true);
    // Leave the group open on exit; startup still folds it.
    await command(main, { type: "group-update", groupId: openId, collapsed: false });
    assert.equal(state(main).groups[0].collapsed, false);
    manager.freezeSession();
    const saved = readTabSession(dir);
    assert.equal(saved.windows[0].groups[0].name, "Research");
    assert.equal(saved.windows[0].groups[0].collapsed, false);
    assert.equal(saved.windows[1].savedGroups[0].tabs.length, 3);
  } else {
    assert.equal(state(main).groups[0].name, "Research");
    assert.equal(state(main).groups[0].color, "cyan");
    assert.equal(state(main).groups[0].collapsed, true, "groups open folded at startup regardless of how they were left");
    assert.equal(state(main).tabs.filter(tab => tab.groupId).length, 2);
    assert.equal(state(main).tabs[0].groupId, undefined, "the reordered group position survives restart");
    assert.ok(state(main).tabs.slice(1, 3).every(tab => tab.groupId === state(main).groups[0].id));
    assert.ok(state(main).tabs.every(tab => tab.url.startsWith(origin)), "internal URLs follow the new runtime port");
    const popup = windows.find(window => state(window).savedGroups.length);
    assert.ok(popup, "saved groups restore even without anchored tabs");
    const id = state(popup).savedGroups[0].id;
    assert.equal(await command(popup, { type: "group-action", groupId: id, action: "restore" }), true);
    assert.equal(state(popup).groups[0].name, "Shopping");
    assert.equal(state(popup).savedGroups.length, 0);
    assert.equal(state(popup).tabs.filter(tab => tab.groupId).length, 3);
    assert.deepEqual(state(popup).tabs.filter(tab => tab.groupId).map(tab => tab.title), JSON.parse(fs.readFileSync(path.join(dir, "group-order.json"), "utf8")), "saved browser tabs return in their original order");
    const restoredId = state(popup).groups[0].id;
    assert.equal(await command(popup, { type: "group-action", groupId: restoredId, action: "ungroup" }), true);
    assert.equal(state(popup).groups.length, 0);
    assert.equal(state(popup).tabs.length, 4, "ungroup keeps every tab open");
  }
  manager.freezeSession();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
