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
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const until = async probe => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await probe()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error("Timed out waiting for the browser page");
};

app.whenReady().then(async () => {
  let groupRouteRequests = 0;
  const server = http.createServer((req, res) => {
    // Group controls must still open when the dashboard menu route is stalled.
    if (req.url.startsWith("/browser/tab-group-popover")) { groupRouteRequests++; return; }
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
    manager.attach(window, true);
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
  manager.setNewTabUrl(origin + "/new-tab");
  manager.setBrowserUrl(origin + "/browser");
  const main = createWindow();
  await main.fixtureReady;
  const state = window => manager.stateFor(manager.baseContents(window));
  const { AI_TAB_GROUP_ID } = require('../../dist/shared/tab-groups.js');
  const userGroups = window => state(window).groups.filter(group => group.id !== AI_TAB_GROUP_ID);
  const command = (window, value) => manager.handleCommand(manager.baseContents(window), value);
  await manager.restoreSession(main, origin, createWindow);
  const { isInTabGroup } = require('../../dist/shared/tab-groups.js');
  const inGroup = (window, id) => state(window).tabs.filter(tab => isInTabGroup(state(window).groups, tab.groupId, id));
  if (phase === "save") {
    await command(main, { type: "open", url: origin + "/a" });
    const a = state(main).activeId;
    await command(main, { type: "open", url: origin + "/b" });
    const b = state(main).activeId;
    await command(main, { type: "group-tabs", id: b, targetId: a });
    const root = userGroups(main)[0].id;
    await command(main, { type: "group-update", groupId: root, name: "Research" });
    // Exercise the real native menu and its restricted IPC bridge.
    const host = manager.hosts.get(main.id);
    await until(() => !host.pending && host.tabs.find(tab => tab.id === host.activeId)?.loaded);
    await command(main, { type: "group-menu", groupId: root, x: 20, y: 40 });
    await until(() => host.groupPopover?.contents.executeJavaScript(`Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'New subgroup')`));
    await host.groupPopover.contents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'New subgroup').click(); true`);
    await until(() => userGroups(main).some(group => group.parentId === root));
    const child = userGroups(main).find(group => group.parentId === root).id;
    await command(main, { type: "group-update", groupId: child, name: "Sources" });
    assert.equal(await command(main, { type: "group-action", groupId: child, action: "new-subgroup" }), true);
    const leaf = userGroups(main).find(group => group.parentId === child).id;
    await command(main, { type: "group-update", groupId: leaf, name: "Papers" });
    const leafTab = inGroup(main, leaf)[0].id;
    assert.equal(inGroup(main, root).length, 4);
    await until(() => host.shell.contents.executeJavaScript(`document.querySelectorAll('[data-group-marker]:not([data-ai-group])').length === 3`));
    await command(main, { type: "group-update", groupId: root, collapsed: true });
    await until(() => host.shell.contents.executeJavaScript(`document.querySelectorAll('[data-group-marker]:not([data-ai-group])').length === 1`));
    assert.equal(inGroup(main, root).some(tab => tab.id === state(main).activeId), false);
    await command(main, { type: "activate", id: leafTab });
    assert.ok(userGroups(main).every(group => !group.collapsed), "activation reveals all ancestors");
    const before = JSON.stringify(userGroups(main));
    assert.equal(await command(main, { type: "group-move", groupId: root, parentId: leaf, index: 0 }), false);
    assert.equal(JSON.stringify(userGroups(main)), before);
    await command(main, { type: "anchor", id: leafTab });
    assert.equal(await command(main, { type: "group-action", groupId: root, action: "delete" }), false);
    assert.equal(await command(main, { type: "group-action", groupId: root, action: "save-close" }), false);
    await command(main, { type: "anchor", id: leafTab });
    // A nested menu can move its group out, and then back into a parent.
    await until(() => !host.pending);
    await command(main, { type: "group-menu", groupId: child, x: 20, y: 40 });
    await until(() => host.groupPopover?.contents.executeJavaScript(`Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Move out of parent group')`));
    const menu = host.groupPopover.contents;
    assert.equal(await menu.executeJavaScript(`window.breadboardDesktop.tabs(${JSON.stringify({ type: "group-move", groupId: child, parentId: null, index: state(main).tabs.length - 2 })})`), true);
    assert.equal(userGroups(main).find(group => group.id === child).parentId, undefined);
    assert.equal(await command(main, { type: "group-move", groupId: child, parentId: root, index: 3 }), true);
    const ids = host.tabs.filter(tab => inGroup(main, root).some(member => member.id === tab.id)).map(tab => tab.contents.id);
    assert.equal(await command(main, { type: "group-action", groupId: root, action: "new-window" }), true);
    const popup = windows.at(-1);
    assert.equal(userGroups(popup).length, 3);
    for (const id of ids) assert.equal(manager.windowFor(webContents.fromId(id)), popup, "subtree window moves retain live documents");
    assert.equal(await command(popup, { type: "group-action", groupId: root, action: "save-close" }), true);
    assert.equal(userGroups(popup).length, 0);
    assert.equal(state(popup).savedGroups[0].tabCount, 4);
    // Leave a separate tree open to test session persistence of group-only parents.
    await command(main, { type: "open", url: origin + "/open" });
    await command(main, { type: "group-tabs", id: state(main).activeId, targetId: state(main).tabs[0].id });
    const openRoot = userGroups(main)[0].id;
    await command(main, { type: "group-update", groupId: openRoot, name: "Open root" });
    await command(main, { type: "group-action", groupId: openRoot, action: "new-subgroup" });
    const openChild = userGroups(main).find(group => group.parentId === openRoot).id;
    for (const tab of [...state(main).tabs.filter(tab => tab.groupId === openRoot)]) await command(main, { type: "move", id: tab.id, index: 0, groupId: openChild });
    assert.equal(state(main).tabs.some(tab => tab.groupId === openRoot), false);
    manager.freezeSession();
    const saved = readTabSession(dir);
    assert.equal(saved.windows.find(window => window.savedGroups?.length).savedGroups[0].groups.filter(group => group.id !== AI_TAB_GROUP_ID).length, 2);
    assert.equal(saved.windows.find(window => window.groups?.some(group => group.name === "Open root")).groups.filter(group => group.id !== AI_TAB_GROUP_ID).length, 2);
  } else {
    assert.equal(userGroups(main).length, 2, "open parent without direct tabs survives restart");
    const root = userGroups(main).find(group => group.name === "Open root");
    assert.ok(root);
    assert.equal(userGroups(main).find(group => group.id !== root.id).parentId, root.id);
    const popup = windows.find(window => state(window).savedGroups.length);
    assert.ok(popup);
    const saved = state(popup).savedGroups[0];
    assert.equal(await command(popup, { type: "group-action", groupId: saved.id, action: "restore" }), true);
    const research = userGroups(popup).find(group => group.name === "Research");
    const child = userGroups(popup).find(group => group.name === "Sources");
    const leaf = userGroups(popup).find(group => group.name === "Papers");
    assert.equal(child.parentId, research.id);
    assert.equal(leaf.parentId, child.id);
    assert.equal(inGroup(popup, research.id).length, 4);
    assert.equal(inGroup(popup, leaf.id).length, 1);
    const leafTab = inGroup(popup, leaf.id)[0].id;
    await command(popup, { type: "activate", id: leafTab });
    const host = manager.hosts.get(popup.id);
    await until(() => !host.pending && host.tabs.find(tab => tab.id === leafTab)?.loaded);
    const leafContents = host.tabs.find(tab => tab.id === leafTab).contents;
    assert.equal(await command(popup, { type: "group-action", groupId: research.id, action: "neutralize" }), true);
    await until(() => leafContents.isDestroyed());
    assert.equal(userGroups(popup).find(group => group.id === research.id).collapsed, true);
    assert.equal(inGroup(popup, research.id).length, 4);
    await command(popup, { type: "activate", id: leafTab });
    assert.ok(userGroups(popup).every(group => !group.collapsed));
    await until(() => !host.pending && host.tabs.find(tab => tab.id === leafTab)?.loaded);
    assert.equal(await command(popup, { type: "group-action", groupId: child.id, action: "ungroup" }), true);
    assert.equal(userGroups(popup).find(group => group.id === leaf.id).parentId, research.id, "ungroup promotes children without flattening them");
    assert.equal(inGroup(popup, research.id).length, 4);
    assert.equal(await command(popup, { type: "group-action", groupId: research.id, action: "delete" }), true);
    assert.equal(userGroups(popup).length, 0);
    assert.equal(state(popup).tabs.length, 1);
  }
  manager.freezeSession();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
