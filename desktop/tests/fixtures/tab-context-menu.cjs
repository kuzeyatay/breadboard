const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { app, BrowserWindow, Menu, clipboard } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const dir = process.argv[2];
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async probe => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await probe()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error("Timed out waiting for tab content");
};

app.whenReady().then(async () => {
  const hits = new Map();
  const server = http.createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>${req.url}</title><body>Tab menu fixture</body>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const preloadPath = path.resolve(__dirname, "../../dist/preload/preload.js");
  const blank = path.join(dir, "blank.html");
  fs.writeFileSync(blank, "<!doctype html><body>Loading</body>");
  const manager = new TabManager({ allowed: { origins: new Set([origin]), localFiles: new Set() }, preloadPath,
    recoveryHtmlPath: () => blank, loadingHtmlPath: () => blank, theme: () => "dark", openWindow: () => {},
    browserPreferencesConfigDir: dir });
  manager.setNewTabUrl(origin + "/new-tab");
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 1000, height: 700,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  await window.loadURL(origin + "/dashboard");
  const host = manager.hosts.get(window.id);
  const sender = () => host.tabs.find(tab => tab.id === host.activeId).contents;
  const state = () => manager.stateFor(sender());
  const command = value => manager.handleCommand(sender(), value);
  const tab = id => host.tabs.find(tab => tab.id === id);
  const ready = id => until(() => tab(id)?.loaded && (!tab(id).browser || tab(id).browser.showingHome || tab(id).browser.ready));

  // Keep windows hidden while exercising real native menu items and live tab views.
  const originalPopup = Menu.prototype.popup;
  const originalWrite = clipboard.writeText;
  let menu, popup, copied;
  Menu.prototype.popup = function(options) { menu = this; popup = options; };
  clipboard.writeText = text => { copied = text; };
  const openMenu = id => {
    assert.equal(command({ type: "tab-menu", id, x: 20_000, y: 20_000 }), true);
    assert.equal(popup.window, window);
    assert.ok(popup.x < window.getContentSize()[0] && popup.y < window.getContentSize()[1]);
    return menu;
  };
  const select = async (id, action) => {
    const current = openMenu(id);
    const item = current.getMenuItemById(action);
    assert.ok(item?.enabled, action);
    popup.callback();
    item.click();
    await tick();
  };
  try {
    const first = state().activeId;
    await command({ type: "open", url: origin + "/document?view=notes#details" });
    const source = state().activeId;
    await command({ type: "open", url: origin + "/other" });
    const other = state().activeId;
    await ready(source); await ready(other);
    openMenu(source);
    assert.equal(state().activeId, other, "opening a background tab menu does not activate it");
    await select(source, "duplicate");
    const duplicate = state().activeId;
    assert.notEqual(duplicate, source);
    assert.equal(tab(duplicate).url, origin + "/document?view=notes#details");
    assert.deepEqual(state().tabs.map(tab => tab.id), [first, source, duplicate, other]);
    assert.notEqual(tab(duplicate).contents, tab(source).contents);
    await ready(duplicate);
    await command({ type: "group-tabs", id: duplicate, targetId: source });
    const group = tab(source).groupId;
    await command({ type: "activate", id: other });
    await select(source, "duplicate");
    const grouped = state().activeId;
    assert.equal(tab(grouped).groupId, group);
    assert.deepEqual(state().tabs.map(tab => tab.id), [first, source, grouped, duplicate, other]);
    await select(source, "new-right");
    const fresh = state().activeId;
    assert.equal(tab(fresh).url, origin + "/new-tab");
    assert.equal(tab(fresh).groupId, group);
    assert.equal(state().tabs.findIndex(tab => tab.id === fresh), state().tabs.findIndex(tab => tab.id === source) + 1);
    await select(source, "copy-link");
    assert.equal(copied, origin + "/document?view=notes#details");
    const beforeReload = hits.get("/document?view=notes");
    await select(source, "reload");
    await until(() => hits.get("/document?view=notes") > beforeReload);
    assert.equal(state().activeId, fresh, "background reload keeps selection");
    await select(other, "anchor");
    assert.equal(openMenu(other).getMenuItemById("close").enabled, false);
    await select(source, "close-right");
    assert.deepEqual(state().tabs.map(tab => tab.id), [first, source, other], "bulk close preserves anchors");
    await select(source, "reopen");
    const reopened = state().activeId;
    assert.equal(tab(reopened).url, origin + "/new-tab");
    await select(source, "close-others");
    assert.deepEqual(state().tabs.map(tab => tab.id), [source, other]);
    await select(other, "anchor");
    await select(other, "close");
    assert.deepEqual(state().tabs.map(tab => tab.id), [source]);
    assert.equal(openMenu(source).getMenuItemById("close-right").enabled, false);

    await command({ type: "browser", url: origin + "/site?a=1#section" });
    const site = state().activeId;
    await ready(site);
    const browserHits = hits.get("/site?a=1");
    await command({ type: "activate", id: source });
    await select(site, "reload");
    await until(() => hits.get("/site?a=1") > browserHits);
    assert.equal(state().activeId, source);
    await select(site, "duplicate");
    const siteCopy = state().activeId;
    await ready(siteCopy);
    assert.equal(tab(siteCopy).browser.contents.getURL(), origin + "/site?a=1#section");
    assert.equal(tab(siteCopy).browser.contents.session, tab(site).browser.contents.session);
    assert.notEqual(tab(siteCopy).browser.contents, tab(site).browser.contents);
    await select(site, "new-right");
    const home = state().activeId;
    assert.equal(tab(home).browser.showingHome, true);
    assert.equal(openMenu(home).getMenuItemById("copy-link").enabled, false);
    await select(home, "duplicate");
    assert.equal(tab(state().activeId).browser.contents, null, "duplicating browser home stays home");

    const privateTab = manager.openBrowserTab(host, origin + "/private", false, undefined, undefined, undefined, manager.privateBrowserPartition());
    await ready(privateTab.id);
    await command({ type: "activate", id: site });
    await select(privateTab.id, "duplicate");
    const privateCopy = tab(state().activeId);
    await ready(privateCopy.id);
    assert.equal(privateCopy.browser.privatePartition, privateTab.browser.privatePartition);
    assert.equal(privateCopy.browser.contents.session, privateTab.browser.contents.session);
    assert.equal(openMenu(privateCopy.id).getMenuItemById("anchor").enabled, false);
    assert.equal(openMenu(privateCopy.id).getMenuItemById("reopen").enabled, false);
    await select(site, "duplicate");
    assert.equal(tab(state().activeId).browser.privatePartition, undefined, "normal duplicate stays normal when active tab is private");
    const staleMenu = openMenu(privateCopy.id);
    await command({ type: "close", id: privateCopy.id });
    const count = state().tabs.length;
    staleMenu.getMenuItemById("duplicate").click();
    await tick();
    assert.equal(state().tabs.length, count, "closed targets cannot trigger stale actions");
    assert.equal(command({ type: "tab-menu", id: 999_999, x: 0, y: 0 }), false);
    assert.equal(manager.handleCommand(tab(site).browser.contents, { type: "tab-menu", id: site, x: 0, y: 0 }), false);
    console.log("Tab context menu integration passed");
  } finally {
    Menu.prototype.popup = originalPopup;
    clipboard.writeText = originalWrite;
    window.destroy();
    server.close();
  }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
