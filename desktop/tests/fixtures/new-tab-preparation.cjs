const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { app, ipcMain, session } = require("electron");
// Drive memory transitions explicitly so this fixture is independent of other
// applications on the developer machine. The production observer is unchanged.
require("../../dist-tests/src/main/tab-memory-pressure.js").observeTabMemoryPressure = () => () => {};
const { WindowManager } = require("../../dist-tests/src/main/window-manager.js");
const { IPC_CHANNELS } = require("../../dist-tests/src/shared/ipc-contract.js");
const dir = process.argv[2];
app.setPath("userData", path.join(dir, "user-data"));
// Keep this invisible fixture rendering; production reveal now requires frames.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
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
  let failPreparation = false;
  const held = [];
  const server = http.createServer((req, res) => {
    const send = () => {
      res.writeHead(200, {
        "content-type": "text/html",
        ...(refreshSession && req.url.startsWith("/new-tab")
          ? { "set-cookie": `next-auth.session-token=refresh-${newTabRequests}; Path=/; HttpOnly` }
          : {}),
      });
      // Like the real Terminal, widget reads begin only after the shell grants
      // preparation or selects the tab. The first read deliberately outlives
      // the 1.5s readiness probe that used to discard the entire spare.
      res.end(`<!doctype html><html data-breadboard-startup="loading"><title>Terminal</title><body><div class="desktop-title-bar"><div role="tablist"></div></div><input id="search"><script>
        window.ready=true;
        let started=false;
        const read=setInterval(async()=>{
          const state=await window.breadboardDesktop.getTabsState();
          if(started || !(state.preparingNewTab || state.selfId===state.activeId)) return;
          started=true;clearInterval(read);
          window.widgetPreparation=state.preparingNewTab===true;
          setTimeout(()=>{window.widgetsReady=true;document.documentElement.dataset.breadboardStartup='ready'}, ${newTabRequests === 1 ? 2200 : 50});
        },20);
      </script></html>`);
    };
    if (req.url.startsWith("/new-tab")) {
      newTabRequests++;
      if (failPreparation) { req.socket.destroy(); return; }
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
    preloadPath: path.resolve(__dirname, "../../dist-tests/src/preload/preload.js"), minimumStartupVisibleMs: 0,
    log: line => console.log(line),
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.setIgnoreMouseEvents(true);
  window.setSkipTaskbar(true);
  window.showInactive();
  await manager.page(window).loadURL(origin + "/dashboard");
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  const host = manager.tabs.hosts.get(window.id);
  const prepared = async () => {
    try { return await until(() => host.preparedNewTab?.painted && host.preparedNewTab, "prepared launcher"); }
    catch (error) {
      const tab = host.preparedNewTab;
      console.log(JSON.stringify({ pending: host.pending?.id, canPrewarm: host.surfaces.canPrewarm, failed: host.newTabPreparationFailed, prepared: tab && { loaded: tab.loaded, ready: tab.terminalReady, painted: tab.painted },
        document: tab && await tab.contents.mainFrame.executeJavaScript('({state:document.documentElement.dataset.breadboardStartup,widgets:window.widgetsReady,preparing:window.widgetPreparation})'),
      }));
      throw error;
    }
  };
  const first = await prepared();
  assert.equal(first.terminalReady, true, "the spare finishes widget preparation before selection");
  assert.equal(await first.contents.mainFrame.executeJavaScript('window.widgetsReady && window.widgetPreparation'), true);
  const spareState = manager.tabs.stateFor(first.contents);
  assert.equal(spareState.selfId, first.id, "the spare has its own identity");
  assert.equal(spareState.preparingNewTab, true);
  assert.notEqual(spareState.activeId, first.id, "preparation does not select the spare");
  assert.equal(manager.tabs.stateFor(manager.page(window)).tabs.length, 1, "prepared pages stay out of the tab strip");
  assert.equal(first.attached, false, "ready pages detach to stop background painting");
  await sleep(700);
  assert.equal(newTabRequests, 1, "only one page is prepared");

  // With all new responses blocked, opening must still work in this same turn.
  hold = true;
  const started = performance.now();
  assert.equal(manager.tabs.handleCommand(manager.page(window), { type: "new" }), true);
  assert.equal(host.activeId, first.id);
  // A detached view may have lost its frame, so it proves one offscreen first;
  // that is two animation frames, never a network wait: every request is held here.
  await until(() => host.pending === null, "prepared page revealed with the network held");
  assert.equal(first.attached, true);
  assert.equal(first.view.getBounds().x, 0);
  assert.equal(newTabRequests, 1);
  const activationMs = performance.now() - started;
  assert.ok(activationMs < 1000, "a prepared Terminal reveals in under a second, without waiting for a widget read");
  assert.equal(manager.tabs.stateFor(first.contents).preparingNewTab, false);
  console.log("Prepared new-tab activation: " + activationMs.toFixed(1) + " ms");

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
  try { await until(() => host.pending === null, "early second click revealed"); }
  catch (error) {
    console.log(JSON.stringify({ active: host.activeId, pending: host.pending?.id, loaded: second.loaded, ready: second.terminalReady, generation: second.generation,
      document: await second.contents.mainFrame.executeJavaScript('({state:document.documentElement.dataset.breadboardStartup,widgets:window.widgetsReady,preparing:window.widgetPreparation})'),
      state: manager.tabs.stateFor(second.contents),
    }));
    throw error;
  }
  const beforePressure = await prepared();
  manager.tabs.setMemoryPressure("constrained");
  await until(() => beforePressure.contents.isDestroyed(), "memory pressure releases the spare");
  assert.equal(host.preparedNewTab, undefined);
  manager.tabs.setMemoryPressure("normal");
  const spare = await prepared();
  assert.notEqual(spare.id, beforePressure.id, "preparation resumes without a click after memory recovers");

  // Account changes retire the old authenticated document before another open.
  await session.defaultSession.cookies.set({ url: origin, name: "next-auth.session-token", value: "fixture" });
  await until(() => spare.contents.isDestroyed(), "account change invalidates prepared document");
  const afterAccount = await prepared();
  manager.tabs.setNewTabUrl(origin + "/new-tab?runtime=2");
  await until(() => afterAccount.contents.isDestroyed(), "runtime URL change disposes spare");
  const afterRuntime = await prepared();
  assert.equal(afterRuntime.contents.getURL(), origin + "/new-tab?runtime=2");

  failPreparation = true;
  manager.tabs.setNewTabUrl(origin + "/new-tab?transient=1");
  await until(() => host.newTabPreparationFailed && !host.preparedNewTab, "temporary connection failure");
  const requestsAtFailure = newTabRequests;
  failPreparation = false;
  await sleep(800);
  assert.equal(newTabRequests, requestsAtFailure, "failure retries back off instead of looping");
  const recovered = await prepared();
  assert.equal(recovered.terminalReady, true, "temporary failure recovers without needing another cold tab");
  assert.equal(host.newTabPreparationFailed, false);

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
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true, activationMs }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
