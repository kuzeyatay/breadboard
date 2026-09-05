const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, webContents } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { readTabSession } = require("../../dist/main/tab-session.js");
const [dir, phase] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out: " + label);
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><html><head><title>' + req.url + '</title></head><body>Session fixture</body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
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
  const state = (window) => {
    const contents = webContents.getAllWebContents().find(contents =>
      manager.tabs.windowFor(contents) === window && manager.tabs.stateFor(contents).selfId !== null);
    return manager.tabs.stateFor(contents ?? window.webContents);
  };
  const sender = (window) => {
    const id = state(window).activeId;
    return webContents.getAllWebContents().find(contents =>
      manager.tabs.stateFor(contents).selfId === id && manager.tabs.windowFor(contents) === window);
  };
  const command = (window, value) => manager.tabs.handleCommand(sender(window), value);
  // Exercise the normal startup -> hidden dashboard -> visible dashboard handoff.
  await manager.showStartupScreen();
  manager.markStartupContinued();
  await manager.showDashboard(origin + "/dashboard", origin + "/new-tab");
  const main = manager.window;

  if (phase === "save") {
    const baseId = state(main).activeId;
    assert.equal(await command(main, { type: "anchor", id: baseId }), true);
    assert.equal(await command(main, { type: "close", id: baseId }), false);
    assert.equal(await command(main, { type: "open", url: origin + "/garden?chat=hello#message", background: true }), true);
    assert.equal(await command(main, { type: "open", url: origin + "/garden?chat=hello#message", background: true }), true);
    assert.equal(await command(main, { type: "browser", url: origin + "/external" }), true);
    assert.equal(await command(main, { type: "browser" }), true);
    assert.equal(await command(main, { type: "new" }), true);
    const newId = state(main).activeId;
    await command(main, { type: "anchor", id: newId });
    await command(main, { type: "browser", url: origin + "/replacement", replaceCurrent: true });
    const replacementId = state(main).activeId;
    assert.equal(state(main).tabs.find(tab => tab.id === replacementId).anchored, true);
    await command(main, { type: "move", id: replacementId, index: 0 });
    // A shortcut reaches the same close guard as mouse/bridge commands.
    sender(main).emit("before-input-event", { preventDefault() {} }, {
      type: "keyDown", key: "w", control: true, meta: false, shift: false, alt: false, isAutoRepeat: false,
    });
    assert.equal(state(main).tabs.length, 6);
    const closed = manager.openPopupWindow(origin + "/closed-window");
    await until(() => state(closed).tabs[0]?.url.endsWith("/closed-window"), "closed popup navigation");
    await command(closed, { type: "anchor", id: state(closed).activeId });
    closed.close();
    const popup = manager.openPopupWindow(origin + "/popup");
    await until(() => state(popup).tabs[0]?.url.endsWith("/popup"), "popup navigation");
    fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify({ origin, main: state(main) }));
    // Native close must save all windows before the app tears any of them down.
    main.close();
    const saved = readTabSession(dir);
    assert.equal(saved.windows.length, 3);
    assert.equal(saved.windows[0].tabs.length, 6);
  } else if (phase === "restore") {
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
    assert.notEqual(origin, expected.origin);
    const actual = state(main);
    const expectedAnchors = expected.main.tabs.filter(tab => tab.anchored);
    assert.equal(actual.tabs.length, expectedAnchors.length + 1, "only anchors return beside one fresh New tab");
    assert.equal(actual.tabs.findIndex(tab => tab.id === actual.activeId), actual.tabs.length - 1);
    assert.equal(new URL(actual.tabs.at(-1).url).pathname, "/new-tab");
    assert.equal(actual.tabs.at(-1).anchored, false);
    for (const [index, previous] of expectedAnchors.entries()) {
      const restored = actual.tabs[index];
      assert.equal(restored.url, previous.browser ? previous.url : previous.url.replace(expected.origin, origin));
      assert.equal(restored.anchored, true);
      assert.equal(Boolean(restored.browser), Boolean(previous.browser));
    }
    assert.equal(BrowserWindow.getAllWindows().length, 2, "only a separate window with an anchor returns");
    const replacement = actual.tabs.find(tab => tab.url.endsWith("/replacement"));
    assert.ok(replacement?.browser);
    assert.equal(await command(main, { type: "activate", id: replacement.id }), true);
    await until(() => {
      const contents = sender(main);
      return contents && !contents.isLoading() && contents.getURL().endsWith("/browser");
    }, "restored browser shell loads");
    const replacementId = replacement.id;
    assert.equal(await command(main, { type: "close", id: replacementId }), false);
    assert.equal(await command(main, { type: "anchor", id: replacementId }), true);
    assert.equal(await command(main, { type: "close", id: replacementId }), true);
    // Unanchor another tab without closing it; the toggle itself is durable.
    const anchored = state(main).tabs.find(tab => tab.anchored);
    await command(main, { type: "anchor", id: anchored.id });
    manager.tabs.freezeSession();
    assert.equal(readTabSession(dir).windows[0].tabs.length, 2);
  } else {
    assert.equal(state(main).tabs.length, 1);
    assert.equal(new URL(state(main).tabs[0].url).pathname, "/new-tab");
    assert.equal(state(main).tabs.some(tab => tab.anchored), false);
    assert.equal(state(main).tabs.some(tab => tab.url.endsWith("/replacement")), false);
    // Explicitly closing the last tab must not resurrect it on the next launch.
    const otherWindows = BrowserWindow.getAllWindows().filter(window => window !== main);
    for (const popup of otherWindows) {
      for (const tab of [...state(popup).tabs]) {
        if (tab.anchored) await command(popup, { type: "anchor", id: tab.id });
        await command(popup, { type: "close", id: tab.id });
      }
    }
    for (const tab of [...state(main).tabs]) await command(main, { type: "close", id: tab.id });
    assert.deepEqual(readTabSession(dir).windows, []);
  }
  manager.tabs.freezeSession();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.close();
  app.exit(0);
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
