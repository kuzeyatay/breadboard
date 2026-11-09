const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { app, BrowserWindow, ipcMain } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const { readTabSession } = require("../../dist/main/tab-session.js");
const [dir, phase] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  for (let end = Date.now() + 10000; Date.now() < end;) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>${req.url}</title><style>body{background:${req.url.includes("left") ? "#477663" : "#596987"};color:white;font:24px Arial;padding:32px}</style><h1>${req.url}</h1><button id="work" onclick="this.textContent='clicked'">Interact</button><input id="draft" value="unsaved">`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const preloadPath = path.resolve(__dirname, "../../dist/preload/preload.js");
  const blank = path.join(dir, "blank.html");
  fs.writeFileSync(blank, "<!doctype html><body>Loading</body>");
  let manager;
  const windows = [];
  const createWindow = () => {
    const window = new BrowserWindow({ show: false, width: 1100, height: 750, webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true } });
    manager.attach(window, true);
    window.setOpacity(0);
    window.showInactive();
    windows.push(window);
    manager.trackSessionWindow(window);
    window.fixtureReady = manager.baseContents(window).loadURL(origin + "/new-tab");
    return window;
  };
  manager = new TabManager({ allowed: { origins: new Set([origin]), localFiles: new Set() }, preloadPath,
    recoveryHtmlPath: () => blank, loadingHtmlPath: () => blank, theme: () => "dark", openWindow: createWindow, tabSessionConfigDir: dir });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  for (const name of ["getBrowserBookmarks", "getBrowserRecentSearches"]) ipcMain.handle(IPC_CHANNELS[name], () => []);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => ({ items: [], error: null }));
  ipcMain.handle(IPC_CHANNELS.getBrowserHistory, () => ({ items: [], error: null }));
  manager.setNewTabUrl(origin + "/new-tab");
  manager.setBrowserUrl(origin + "/browser");
  const window = createWindow();
  await window.fixtureReady;
  const base = manager.baseContents(window), host = manager.hosts.get(window.id);
  const command = value => manager.handleCommand(base, value);
  const state = () => manager.stateFor(base);
  await until(() => host.shellEnabled, "persistent shell");
  await manager.restoreSession(window, origin, createWindow);
  const checkPair = (left, right) => {
    assert.deepEqual([...state().visibleIds].sort((a,b)=>a-b), [left.id,right.id].sort((a,b)=>a-b), 'notification presence includes both presented panes');
    const l = left.browser?.view ?? left.view, r = right.browser?.view ?? right.view;
    assert.ok(window.contentView.children.includes(l) && window.contentView.children.includes(r), "both views are attached");
    const a = l.getBounds(), b = r.getBounds();
    const rail = left.browser ? 40 : 0;
    assert.equal(a.x, rail);
    assert.equal(a.x + a.width + 8 + (right.browser ? 40 : 0), b.x, "panes do not overlap");
    assert.equal(b.x + b.width, window.getContentSize()[0]);
    assert.equal(a.y, b.y);
    const children = window.contentView.children;
    assert.ok(children.indexOf(host.shell.view) > children.indexOf(l));
    assert.ok(children.indexOf(host.shell.view) > children.indexOf(r));
  };
  if (phase === "restore") {
    const group = host.groups.find(group => group.split);
    assert.ok(group, "split persisted");
    const members = host.tabs.filter(tab => tab.groupId === group.id);
    assert.equal(members.length, 2);
    command({ type: "activate", id: members[0].id });
    await until(() => !host.pending && members.every(tab => tab.painted && tab.attached && !tab.splitPreparation), "both restored panes prepare");
    checkPair(...members);
  } else {
    command({ type: "open", url: origin + "/left" });
    const left = host.tabs.find(tab => tab.id === host.activeId);
    await until(() => !host.pending, "left visible");
    command({ type: "open", url: origin + "/right" });
    const right = host.tabs.find(tab => tab.id === host.activeId);
    await until(() => !host.pending, "right visible");
    command({ type: "activate", id: left.id });
    await until(() => host.shell.contents.executeJavaScript(`!!document.querySelector('[data-tab-id="${right.id}"]')`), "right tab rendered");
    const start = await host.shell.contents.executeJavaScript(`(()=>{const r=document.querySelector('[data-tab-id="${right.id}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    const input = event => host.shell.contents.sendInputEvent(event);
    input({ type: "mouseDown", button: "left", clickCount: 1, ...start });
    await until(() => host.tabDragActive, "tab press retains pointer ownership");
    input({ type: "mouseMove", modifiers: ["leftButtonDown"], x: start.x, y: start.y + 8 });
    await until(() => host.tabDragPreview, "vertical drag expands native shell");
    assert.equal(host.shell.view.getBounds().height, window.getContentSize()[1]);
    input({ type: "mouseMove", modifiers: ["leftButtonDown"], x: 850, y: 350 });
    await until(() => host.shell.contents.executeJavaScript("!!document.querySelector('.bb-tab-split-preview[data-side=right]')"), "split preview over native pages");
    input({ type: "mouseUp", button: "left", clickCount: 1, x: 850, y: 350 });
    await until(() => host.groups.some(group => group.split) && !host.tabDragActive && !host.pending, "drop creates split group");
    await until(() => !left.splitPreparation && left.painted && right.painted, "both panes prepared");
    checkPair(left, right);
    assert.equal(left.groupId, right.groupId);
    assert.equal(await left.contents.executeJavaScript("document.querySelector('#draft').value"), "unsaved");
    for (const tab of [left, right]) {
      tab.contents.focus();
      const point = await tab.contents.executeJavaScript("(()=>{const r=document.querySelector('#work').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
      tab.contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      tab.contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
      await until(() => host.activeId === tab.id, "pane input selects tab");
      await until(() => tab.contents.executeJavaScript("document.querySelector('#work').textContent==='clicked'"), "pane accepts input");
      checkPair(left, right);
    }
    command({ type: "activate", id: host.base.id });
    await until(() => !host.pending, "unrelated tab selected");
    assert.equal(host.base.view.getBounds().width, window.getContentSize()[0]);
    manager.setMemoryPressure("critical");
    command({ type: "activate", id: right.id });
    await until(() => !host.pending && left.attached && !left.splitPreparation, "evicted pair restored");
    checkPair(left, right);
    window.setSize(930, 650);
    await until(() => right.view.getBounds().x + right.view.getBounds().width === window.getContentSize()[0], "split resizes");
    checkPair(left, right);
    command({ type: "group-update", groupId: left.groupId, split: false });
    assert.equal(right.view.getBounds().width, window.getContentSize()[0]);
    assert.equal(host.tabs.includes(left), true, "leaving split keeps both tabs");
    command({ type: "split-tabs", id: right.id, targetId: left.id, side: "right" });
    command({ type: "close", id: left.id });
    await until(() => !host.pending, "closing partner returns full width");
    assert.equal(right.view.getBounds().width, window.getContentSize()[0]);
    assert.equal(state().groups.some(group => group.split), false);
    command({ type: "browser", url: origin + "/web-left" });
    const a = host.tabs.find(tab => tab.id === host.activeId);
    await until(() => !host.pending && a.browser.ready, "browser left ready");
    command({ type: "browser", url: origin + "/web-right" });
    const b = host.tabs.find(tab => tab.id === host.activeId);
    await until(() => !host.pending && b.browser.ready, "browser right ready");
    command({ type: "split-tabs", id: b.id, targetId: a.id, side: "right" });
    await until(() => !host.pending && !a.splitPreparation && a.browser.attached, "web pair ready");
    checkPair(a, b);
    assert.equal(a.contents, b.contents, "browser home retains its shared renderer");
    for (const tab of [a, b]) {
      tab.browser.contents.focus();
      tab.browser.contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: 60, y: 60 });
      tab.browser.contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: 60, y: 60 });
      await until(() => host.activeId === tab.id, "web pane input selects its own navigation");
      checkPair(a, b);
    }
    command({ type: "group-action", groupId: a.groupId, action: "ungroup" });
    assert.equal(b.browser.view.getBounds().width, window.getContentSize()[0] - 40);
    command({ type: "split-tabs", id: right.id, targetId: a.id, side: "right" });
    await until(() => !host.pending && a.browser.attached && !a.splitPreparation && !right.splitPreparation && right.painted, "mixed pair ready");
    checkPair(a, right);
    assert.equal(host.activeId, right.id, "preparing the partner cannot steal selection");
    assert.equal(manager.shellState(host).selfId, a.id, "mixed pair keeps its browser toolbar while local pane is focused");
    assert.equal(await manager.shellCommand(host, {
      command: { type: "browser-navigate", input: origin + "/web-targeted", targetTabId: a.id, generation: a.generation, presentationRevision: host.presentationRevision },
      targetId: a.id, generation: a.generation, revision: host.presentationRevision,
    }), true);
    await until(() => a.url.endsWith("/web-targeted") && a.browser.ready, "toolbar navigates its browser pane");
    assert.ok(right.url.endsWith("/right"), "browser toolbar leaves the local pane intact");
    command({ type: "close", id: a.id });
    await until(() => !host.pending && host.activeId === right.id, "closing active pane selects its partner");
    assert.equal(right.view.getBounds().width, window.getContentSize()[0]);
    // Persist local panes, whose runtime URLs rebase during the restore phase.
    command({ type: "split-tabs", id: right.id, targetId: host.base.id, side: "right" });
    await until(() => !host.pending && !host.base.splitPreparation && host.base.attached, "saved pair ready");
    checkPair(host.base, right);
    manager.freezeSession();
    assert.ok(readTabSession(dir).windows.some(window => window.groups?.some(group => group.split)));
  }
  manager.freezeSession();
  for (const item of windows) if (!item.isDestroyed()) item.destroy();
  server.close();
  console.log("TAB_SPLIT_OK");
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
