const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { app, ipcMain, session } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { IPC_CHANNELS } = require("../../dist/shared/ipc-contract.js");
const dir = process.argv[2];
app.setPath("userData", path.join(dir, "user-data"));
app.on("window-all-closed", () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    const result = await probe();
    if (result) return result;
    await sleep(20);
  }
  throw new Error("Timed out: " + label);
};
app.whenReady().then(async () => {
  let newTabRequests = 0;
  let hold = false;
  let refreshSession = false;
  const held = [];
  const server = http.createServer((req, res) => {
    const send = () => {
      res.writeHead(200, {
        "content-type": "text/html",
        ...(refreshSession && req.url.startsWith("/new-tab")
          ? { "set-cookie": `next-auth.session-token=refresh-${newTabRequests}; Path=/; HttpOnly` }
          : {}),
      });
      res.end(`<!doctype html><title>New tab</title><body><div class="desktop-title-bar"><div role="tablist"></div></div><input id="search"><script>window.ready=true</script>`);
    };
    if (req.url.startsWith("/new-tab")) {
      newTabRequests++;
      if (hold) { held.push(send); return; }
    }
    send();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const loading = path.join(dir, "loading.html");
  fs.writeFileSync(loading, "<!doctype html><body>Loading</body>");
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).toString()]) },
    startupHtmlPath: loading, recoveryHtmlPath: loading, loadingHtmlPath: loading,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"), minimumStartupVisibleMs: 0,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  await window.loadURL(origin + "/dashboard");
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  const host = manager.tabs.hosts.get(window.id);
  const prepared = () => until(() => host.preparedNewTab?.painted && host.preparedNewTab, "prepared launcher");
  const first = await prepared();
  assert.equal(manager.tabs.stateFor(window.webContents).tabs.length, 1, "prepared pages stay out of the tab strip");
  assert.equal(first.attached, false, "ready pages detach to stop background painting");
  await sleep(700);
  assert.equal(newTabRequests, 1, "only one page is prepared");

  // With all new responses blocked, opening must still work in this same turn.
  hold = true;
  const started = performance.now();
  assert.equal(manager.tabs.handleCommand(window.webContents, { type: "new" }), true);
  assert.equal(host.activeId, first.id);
  assert.equal(host.pending, null, "prepared pages bypass cold reveal and all network waits");
  assert.equal(first.attached, true);
  assert.equal(first.view.getBounds().x, 0);
  assert.equal(newTabRequests, 1);
  console.log("Prepared new-tab activation: " + (performance.now() - started).toFixed(1) + " ms");

  // An early second click claims the in-flight preparation rather than loading twice.
  await until(() => host.preparedNewTab && newTabRequests === 2, "replacement loading");
  const second = host.preparedNewTab;
  // Reproduce Windows focusing the offscreen view without moving OS focus
  // away from the person running the tests.
  const isFocused = window.isFocused;
  const focus = first.contents.focus;
  let returnedFocus = 0;
  window.isFocused = () => true;
  first.contents.focus = () => { returnedFocus++; };
  try {
    second.contents.emit("focus");
    assert.equal(returnedFocus, 1, "the hidden spare returns keyboard focus to the active chat");
    window.isFocused = () => false;
    second.contents.emit("focus");
    assert.equal(returnedFocus, 1, "background preparation cannot activate an unfocused window");
  } finally {
    window.isFocused = isFocused;
    first.contents.focus = focus;
  }
  manager.tabs.handleCommand(first.contents, { type: "new" });
  assert.equal(host.activeId, second.id);
  assert.equal(host.pending, second);
  hold = false;
  held.splice(0).forEach(send => send());
  await until(() => host.pending === null, "early second click revealed");
  const spare = await prepared();

  // Account changes retire the old authenticated document before another open.
  await session.defaultSession.cookies.set({ url: origin, name: "next-auth.session-token", value: "fixture" });
  await until(() => spare.contents.isDestroyed(), "account change invalidates prepared document");
  const afterAccount = await prepared();
  manager.tabs.setNewTabUrl(origin + "/new-tab?runtime=2");
  await until(() => afterAccount.contents.isDestroyed(), "runtime URL change disposes spare");
  const afterRuntime = await prepared();
  assert.equal(afterRuntime.contents.getURL(), origin + "/new-tab?runtime=2");

  // NextAuth refreshes the session on a page request. Preparing a page must
  // not recursively load, rotate the cookie, dispose itself and load again.
  refreshSession = true;
  const beforeRefresh = newTabRequests;
  manager.tabs.setNewTabUrl(origin + "/new-tab?refresh=1");
  await until(() => host.newTabPreparationFailed && !host.preparedNewTab, "session refresh stops preparation");
  await sleep(1_200);
  assert.equal(newTabRequests, beforeRefresh + 1, "session refresh cannot create a background reload loop");
  await session.defaultSession.cookies.set({ url: origin, name: "next-auth.session-token", value: "another-refresh", httpOnly: true });
  await sleep(700);
  assert.equal(newTabRequests, beforeRefresh + 1, "later cookie events retain the preparation backoff");

  // A deliberate open remains usable after automatic preparation backs off.
  refreshSession = false;
  manager.tabs.handleCommand(second.contents, { type: "new" });
  await until(() => host.pending === null, "new tab opens after session refresh");
  const afterRefresh = await prepared();
  manager.tabs.setPrivateWindow(window);
  await until(() => afterRefresh.contents.isDestroyed(), "private window disposes spare");
  await sleep(700);
  assert.equal(host.preparedNewTab, undefined);
  window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
