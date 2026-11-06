const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, webContents } = require("electron");
const runtime = process.env.BREADBOARD_FOCUS_TEST_DIST || path.resolve(__dirname, "../../dist");
const { TabManager } = require(path.join(runtime, "main/tab-manager.js"));
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (probe()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><title>Terminal</title><input id="search" value="my search">');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Loading</body>");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href]) },
    preloadPath: path.join(runtime, "preload/preload.js"),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => "dark", openWindow: () => assert.fail("Unexpected window"),
  });
  // Keep the timing deterministic: readiness waits until the focus sequence
  // below finishes. Native loading still runs in real Electron renderers.
  manager.scheduleNewTabPreparation = () => {};
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  manager.attach(window, true);
  const host = manager.hosts.get(window.id);
  const active = host.base;
  await active.contents.loadURL(origin + "/new-tab");
  await until(() => active.loaded, "Terminal loaded");
  manager.setNewTabUrl(origin + "/new-tab");

  // Reproduce Windows' delayed offscreen focus event without activating a
  // window or taking keyboard focus from the user's running application.
  let focused = host.shell.contents;
  let windowFocused = true;
  webContents.getFocusedWebContents = () => focused;
  window.isFocused = () => windowFocused;
  const modelFocus = contents => {
    contents.focus = () => { focused = contents; contents.emit("focus"); };
  };
  modelFocus(active.contents);
  modelFocus(host.shell.contents);
  const initialListeners = [active.contents, host.shell.contents].map(contents => contents.listenerCount("focus"));
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  manager.frameReady = () => ready;
  const preparing = manager.prepareNewTab(host);
  const spare = host.preparedNewTab;
  assert.ok(spare, "a spare Terminal is preparing");
  await until(() => spare.loaded, "spare document loaded");
  modelFocus(spare.contents);

  await active.contents.executeJavaScript(`
    document.querySelector('#search').focus();
    document.querySelector('#search').setSelectionRange(3, 3);
  `);
  active.contents.focus();
  spare.contents.focus();
  await new Promise(setImmediate);
  assert.equal(focused, active.contents, "late spare focus must return to Search, not the earlier tab-strip focus");
  const search = await active.contents.executeJavaScript(`({
    active: document.activeElement.id,
    value: document.querySelector('#search').value,
    caret: document.querySelector('#search').selectionStart
  })`);
  assert.deepEqual(search, { active: "search", value: "my search", caret: 3 });

  host.shell.contents.focus();
  spare.contents.focus();
  await new Promise(setImmediate);
  assert.equal(focused, host.shell.contents, "a deliberate later toolbar click remains authoritative");
  windowFocused = false;
  spare.contents.focus();
  await new Promise(setImmediate);
  assert.equal(focused, spare.contents, "an inactive application must not request foreground focus");
  windowFocused = true;

  // Changing selection while prewarming must use the newly selected page.
  const other = manager.createView(host, origin + "/other");
  host.tabs.push(other);
  modelFocus(other.contents);
  host.activeId = other.id;
  spare.contents.focus();
  await new Promise(setImmediate);
  assert.equal(focused, other.contents, "switching tabs supersedes the original focus target");
  host.activeId = active.id;

  const claimed = manager.takePreparedNewTab(host, origin + "/new-tab");
  assert.equal(claimed, spare);
  spare.contents.focus();
  await new Promise(setImmediate);
  assert.equal(focused, spare.contents, "a deliberately opened spare is allowed to receive focus");
  // A pending restoration must not undo a newer deliberate focus change.
  host.preparedNewTab = spare;
  spare.contents.focus();
  host.shell.contents.focus();
  await new Promise(setImmediate);
  assert.equal(focused, host.shell.contents);
  host.preparedNewTab = undefined;
  release(true);
  await preparing;
  assert.deepEqual([active.contents, host.shell.contents].map(contents => contents.listenerCount("focus")), initialListeners,
    "preparation removes its foreground focus listeners");
  assert.equal(spare.contents.listenerCount("focus"), 0, "preparation removes its spare focus guard");
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
