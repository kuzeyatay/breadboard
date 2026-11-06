const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, ipcMain, webContents, screen } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
if (!process.env.BB_TEST_NATIVE_OCCLUSION) app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
if (process.env.BB_TEST_SCALE) app.commandLine.appendSwitch("force-device-scale-factor", process.env.BB_TEST_SCALE);
app.on("window-all-closed", () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  for (let end = Date.now() + 10000; Date.now() < end;) {
    if (await probe()) return;
    await sleep(15);
  }
  throw new Error(`Timed out: ${label}`);
};
app.whenReady().then(async () => {
  let stream, localStream;
  const requests = new Map();
  const server = http.createServer((req, res) => {
    requests.set(req.url, (requests.get(req.url) ?? 0) + 1);
    if (req.url.startsWith('/blocked-')) return;
    if (req.url === "/never") return;
    if (req.url === "/image") return;
    res.writeHead(200, { "content-type": "text/html" });
    const html = `<!doctype html><title>${req.url}</title><style>body{background:#43885a}</style><body><button id="work" onclick="this.textContent='clicked'">Working page</button><input id="draft" value="unsaved">`;
    if (req.url === "/stream") { res.write(html + " ".repeat(4096)); stream = res; return; }
    if (req.url === "/stream-local") { res.write(html + " ".repeat(4096)); localStream = res; return; }
    res.end(html + (req.url === "/slow-image" ? '<img src="/image">' : ""));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Startup</body>");
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href]) },
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"), minimumStartupVisibleMs: 0,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.tabs.handleCommand(event.sender, command));
  for (const name of ["getBrowserBookmarks", "getBrowserRecentSearches"]) ipcMain.handle(IPC_CHANNELS[name], () => []);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => ({ items: [], error: null }));
  ipcMain.handle(IPC_CHANNELS.getBrowserHistory, () => ({ items: [], error: null }));
  ipcMain.handle(IPC_CHANNELS.setBrowserRecentSearches, () => true);
  const window = manager.createMainWindow();
  if (process.env.BB_TEST_NATIVE_OCCLUSION) { window.setAlwaysOnTop(true); window.show(); }
  else { window.setOpacity(0); window.showInactive(); }
  const host = manager.tabs.hosts.get(window.id);
  host.shell.contents.on("console-message", (_event, level, message) => { if (level >= 2) console.log("SHELL", message); });
  const base = manager.page(window);
  await base.loadURL(origin + "/dashboard");
  const command = value => manager.tabs.handleCommand(host.tabs.find(t => t.id === host.activeId).contents, value);
  const clickTab = async id => {
    const point = await host.shell.contents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-tab-id="${id}"]');
      button.scrollIntoView({inline:'nearest'});
      const box = button.getBoundingClientRect();
      return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
    })()`);
    host.shell.contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    await until(() => host.activeId === id, 'selection starts on mouse-down');
    assert.equal(host.shell.view.getBounds().height, host.tabs.find(tab => tab.id === id)?.browser ? 135 : 32,
      'holding an ordinary press cannot create a window-sized input cover');
    host.shell.contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  };
  await until(() => host.shellEnabled, "persistent shell enabled");
  await until(() => host.shell.contents.executeJavaScript("!!document.querySelector('[role=tablist]')"), "bundled strip rendered");
  manager.tabs.setMemoryPressure("normal");
  command({ type: "open", url: origin + "/local" });
  const local = host.tabs.find(tab => tab.id === host.activeId);
  // These two documents hold the drafts used later to check surface eviction
  // and window transfer. Exercise the user's Keep loaded policy for both.
  local.keepLoaded = host.base.keepLoaded = true;
  await until(() => !host.pending, "local page visible");
  // Restored tabs start their own request on press, even while another tab is
  // still waiting for headers. Neither input nor display waits for that request.
  const deferred = ['one', 'two', 'three'].map(name => manager.tabs.openTab(host, origin + '/blocked-' + name,
    {background:true, origin:'link', deferred:true}));
  assert.ok(deferred.every(Boolean));
  assert.equal(requests.has('/blocked-one'), false);
  for (const tab of [...deferred, deferred[0], local]) {
    await clickTab(tab.id);
    await until(() => host.activeId === tab.id, 'mouse press selects while another response is blocked');
    assert.equal(tab.view.getBounds().x, 0, 'selected content is in the viewport immediately');
    assert.equal(tab.view.getBounds().y, 32);
    assert.equal(host.shell.view.getBounds().height, 32, 'ordinary clicks do not enlarge the shell');
    if (tab !== local) await until(() => requests.has(new URL(tab.url).pathname), 'clicked deferred request started');
  }
  for (const tab of deferred) {
    assert.equal(requests.get(new URL(tab.url).pathname), 1, 'selecting again does not restart navigation');
    command({type:'close',id:tab.id});
    command({type:'close',id:tab.id});
  }
  await until(() => !host.pending && host.presentedId === local.id, 'working tab remains available while slow tabs close');
  command({type:'open',url:origin+'/stream-local'});
  const streamingLocal = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => localStream && host.presentedId === streamingLocal.id && !host.pending, 'local document appears before its response ends');
  assert.equal(streamingLocal.loaded, false, 'no DOMContentLoaded or network completion required');
  const workPoint = await streamingLocal.contents.mainFrame.executeJavaScript("(()=>{const r=document.querySelector('#work').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  streamingLocal.contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...workPoint});
  streamingLocal.contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...workPoint});
  await until(() => streamingLocal.contents.mainFrame.executeJavaScript("document.querySelector('#work').textContent==='clicked'"), 'streaming local page accepts real input');
  command({type:'close',id:streamingLocal.id});
  localStream.end();
  await until(() => !host.pending && host.presentedId === local.id, 'local restored after streaming page closes');
  const progress = { type: "page-loading", id: local.id, documentGeneration: local.generation, pending: true };
  assert.equal(manager.tabs.handleCommand(base, progress), false, "a page cannot control another tab's progress");
  assert.equal(manager.tabs.handleCommand(local.contents, { ...progress, documentGeneration: local.generation - 1 }), false);
  assert.equal(manager.tabs.handleCommand(local.contents, progress), true);
  await until(() => host.shell.contents.executeJavaScript("!!document.querySelector('.bb-nav-progress[aria-busy=\"true\"]')"), "page work reaches the top shell bar");
  assert.deepEqual(await host.shell.contents.executeJavaScript("(()=>{const r=document.querySelector('.bb-nav-progress').getBoundingClientRect();return {y:r.y,height:r.height}})()"), {y:0,height:4});
  assert.equal(manager.tabs.handleCommand(local.contents, { ...progress, pending: false }), true);
  command({ type: "activate", id: host.base.id });
  await until(() => !host.pending, "base resident");
  let probes = 0;
  const frameReady = manager.tabs.frameReady;
  manager.tabs.frameReady = (...args) => { probes++; return frameReady.apply(manager.tabs, args); };
  command({ type: "activate", id: local.id });
  assert.equal(host.pending, null);
  assert.equal(host.presentedId, local.id);
  assert.equal(probes, 0, "resident selection has no JS frame probes");
  assert.equal(await local.contents.executeJavaScript("document.querySelector('#draft').value"), "unsaved");
  // A resident renderer can have a stale native surface even though its DOM
  // and rAF are healthy. Foregrounding must renew that surface, once, without
  // navigating away from the user's draft or changing the final viewport.
  const localBounds = local.view.getBounds();
  const localRequests = requests.get('/local');
  const nativeVisible = local.view.setVisible.bind(local.view);
  const surfaceVisibility = [];
  const throttlingDuringVisibility = [];
  const expectedSurfaceReset = process.platform === 'win32' ? [false, true] : [];
  local.view.setVisible = visible => {
    surfaceVisibility.push(visible);
    throttlingDuringVisibility.push(local.contents.getBackgroundThrottling());
    nativeVisible(visible);
  };
  command({ type: 'activate', id: host.base.id });
  command({ type: 'activate', id: local.id });
  assert.deepEqual(surfaceVisibility, expectedSurfaceReset,
    'a resident surface must be shown again after Windows occlusion');
  manager.tabs.layout(host);
  manager.tabs.layout(host);
  assert.equal(surfaceVisibility.length, expectedSurfaceReset.length, 'ordinary layout must not repeatedly hide the selected surface');
  window.emit('blur');
  // Switching apps leaves the selected native view attached and visible,
  // including if a resize or ready notification runs while it is covered.
  manager.tabs.layout(host);
  assert.equal(surfaceVisibility.length, expectedSurfaceReset.length, 'background layout leaves the current surface alone');
  window.emit('focus');
  manager.tabs.layout(host);
  assert.equal(surfaceVisibility.length, expectedSurfaceReset.length, 'app focus changes do not hide and reshow the tab');
  assert.ok(throttlingDuringVisibility.every(Boolean),
    'native hide/show must run with Electron hidden-state suppression disabled');
  assert.equal(local.contents.getBackgroundThrottling(), false,
    'the visible renderer retains its foreground frame lease after recovery');
  assert.deepEqual(local.view.getBounds(), localBounds);
  assert.equal(requests.get('/local'), localRequests, 'surface renewal must not reload the page');
  assert.equal(await local.contents.executeJavaScript("document.querySelector('#draft').value"), 'unsaved');
  const visiblePixels = await local.contents.capturePage({x:16,y:80,width:1,height:1});
  assert.equal(visiblePixels.isEmpty(), false, 'the selected surface remains capturable');
  local.view.setVisible = nativeVisible;
  // An evicted document must reacquire a frame with normal Windows occlusion.
  // Before the fix its parking pixel was covered by the persistent shell, so
  // every frame probe timed out forever, even though this document was loaded.
  if (process.env.BB_TEST_NATIVE_OCCLUSION) {
    manager.tabs.setMemoryPressure("critical");
    for (const id of [host.base.id, local.id, host.base.id, local.id]) {
      const started = performance.now();
      await clickTab(id);
      await until(() => !host.pending && host.presentedId === id, "evicted document visibly switches with native occlusion");
      assert.ok(performance.now() - started < 750, "no repeated 1.5-second paint timeouts");
    }
    manager.tabs.setMemoryPressure("normal");
  }

  // A rejected first frame must retry autonomously.
  let rejected = false;
  manager.tabs.frameReady = (...args) => {
    if (!rejected) { rejected = true; return Promise.reject(new Error('fixture: rejected paint probe')); }
    return frameReady.apply(manager.tabs, args);
  };
  command({ type: "open", url: origin + "/reject-once" });
  await until(() => rejected && !host.pending, "rejected frame recovered without another selection");
  manager.tabs.frameReady = frameReady;
  for (const id of [local.id, host.base.id, local.id]) {
    await clickTab(id);
    await until(() => host.presentedId === id && !host.pending, "real shell mouse selects the content view");
  }
  manager.tabs.setBrowserUrl(origin + "/browser");
  command({ type: "browser", url: origin + "/slow-image" });
  const browser = host.tabs.find(tab => tab.id === host.activeId);
  const selectedBounds = browser.browser.view.getBounds();
  const browserMoves = [];
  const setBrowserBounds = browser.browser.view.setBounds.bind(browser.browser.view);
  browser.browser.view.setBounds = bounds => { browserMoves.push(bounds); setBrowserBounds(bounds); };
  await until(() => browser.browser.ready && !host.pending, "browser presented before slow image completed");
  assert.ok(browserMoves.every(bounds => bounds.x === selectedBounds.x && bounds.y === selectedBounds.y),
    "first-frame preparation must never move the selected website offscreen and expose terminal home");
  browser.browser.view.setBounds = setBrowserBounds;
  assert.equal(browser.loading, true);
  command({ type: "browser", url: origin + "/stream" });
  const streaming = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => stream && streaming.browser.ready && !host.pending, "streaming document presented before EOF");
  assert.equal(streaming.contents, browser.contents, "one browser UI renderer per window");
  assert.notEqual(streaming.browser.contents, browser.browser.contents, "websites keep isolated documents");
  const stale = { command: { type: "browser-navigate", input: origin + "/wrong" }, targetId: streaming.id, generation: streaming.generation, revision: host.presentationRevision };
  command({ type: "activate", id: browser.id });
  assert.ok(window.contentView.children.indexOf(host.shell.view) > window.contentView.children.indexOf(browser.view), "shared navigation stays above content on resident switches");
  assert.ok(window.contentView.children.indexOf(host.shell.view) > window.contentView.children.indexOf(browser.browser.view));
  assert.equal(manager.tabs.shellCommand(host, stale), false, "delayed commands cannot target the new selection");
  command({ type: "activate", id: local.id });
  manager.tabs.setMemoryPressure("critical");
  assert.equal(host.surfaces.budget, 0);
  assert.equal(local.contents.isDestroyed(), false);
  assert.equal(browser.browser.contents.isDestroyed(), false);
  command({ type: "close", id: streaming.id });
  command({ type: "close", id: browser.id });
  assert.equal(host.browserChrome.contents.isDestroyed(), false, "closing browser tabs cannot destroy shared controls");
  manager.tabs.setMemoryPressure("normal");
  command({ type: "activate", id: local.id });
  await until(() => !host.pending, "local page before churn");
  // A cold selection owns its native surface at once. Its opaque website
  // covers shared browser home while the server has not answered yet.
  command({ type: "browser", url: origin + "/never" });
  const waitingBrowser = host.tabs.find(tab => tab.id === host.activeId);
  assert.equal(host.presentedId, local.id);
  assert.equal(waitingBrowser.view.getBounds().x, 0);
  assert.equal(waitingBrowser.browser.attached, true);
  assert.equal(waitingBrowser.browser.view.getBounds().y, 135);
  assert.ok(window.contentView.children.indexOf(waitingBrowser.browser.view) > window.contentView.children.indexOf(waitingBrowser.view),
    "the selected website covers shared browser home even before the response");
  command({ type: "close", id: waitingBrowser.id });
  await until(() => !host.pending && host.presentedId === host.activeId && host.activeId !== waitingBrowser.id,
    "closing the waiting browser presents the neighboring tab");
  command({ type: "activate", id: local.id });
  await until(() => !host.pending && host.presentedId === local.id, "local page restored before churn");
  const documentsBefore = webContents.getAllWebContents().length;
  for (let cycle = 0; cycle < 40; cycle++) {
    command({ type: "browser", url: origin + "/churn-" + cycle });
    const opened = host.tabs.find(tab => tab.id === host.activeId);
    const contents = opened.browser.contents;
    if (cycle % 2 === 0) await until(() => !host.pending, "churn page presented");
    command({ type: "close", id: opened.id });
    command({ type: "close", id: opened.id });
    await until(() => !host.pending && contents.isDestroyed(), "repeated close settles and destroys its website");
  }
  assert.ok(webContents.getAllWebContents().length <= documentsBefore, "opening/closing does not accumulate documents");
  assert.equal(host.retainedTabControls.size, 0);
  assert.equal(host.afterReveal.length, 0);
  for (const size of [[900,680], [1440,900], [1100,740]]) {
    window.setContentSize(...size);
    await sleep(40);
    const [width,height] = window.getContentSize();
    assert.deepEqual(local.view.getBounds(), {x:0,y:32,width,height:height-32});
    assert.equal(host.shell.view.getBounds().height, 32);
    const retainedBytes = [...host.surfaces.entries].reduce((sum,[id,bytes]) => sum + (id === host.activeId || id === host.presentedId ? 0 : bytes), 0);
    assert.ok(retainedBytes <= host.surfaces.budget, "resizing keeps inactive reservations bounded");
  }
  // A busy website renderer cannot hold the separate tab strip hostage.
  command({type:"browser",url:origin+"/busy"});
  const busy = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending, "busy page ready");
  const evaluation = busy.browser.contents.executeJavaScript("window.fixtureBusy=true; const end=performance.now()+1800; while(performance.now()<end){}; true").catch(() => false);
  await sleep(50);
  const started = performance.now();
  await clickTab(local.id);
  await until(() => host.presentedId === local.id && !host.pending, "controls switch away from a stalled renderer");
  assert.ok(performance.now()-started < 500, "selection does not wait for the stalled renderer");
  command({type:"close",id:busy.id});
  // Electron may abandon an executeJavaScript promise when its renderer is
  // destroyed; the test must be bounded for the same reason as production probes.
  await Promise.race([evaluation, sleep(2200)]);
  // The dashboard is an ordinary movable content view, including its draft.
  manager.tabs.setMemoryPressure("critical");
  manager.tabs.setNewTabUrl(origin + "/new-tab");
  const originalBase = host.base;
  await originalBase.contents.executeJavaScript("document.querySelector('#draft').value='moved unsaved draft'");
  assert.equal(command({type:"group-tabs",id:originalBase.id,targetId:local.id}), true);
  const groupId = local.groupId;
  assert.equal(command({type:"group-action",groupId,action:"new-window"}), true);
  const destination = [...manager.tabs.hosts.values()].find(candidate => candidate !== host && candidate.tabs.includes(originalBase));
  assert.ok(destination);
  manager.tabs.setMemoryPressure("normal");
  assert.ok([...manager.tabs.hosts.values()].reduce((bytes, owner) => bytes + owner.surfaces.budget, 0) <= 128 * 1024 * 1024,
    "additional windows share the application's surface budget");
  assert.notEqual(host.base, originalBase, "the old window receives a neutral primary view");
  assert.equal(manager.tabs.windowFor(originalBase.contents), destination.window);
  assert.equal(await originalBase.contents.executeJavaScript("document.querySelector('#draft').value"), "moved unsaved draft");
  const scale = screen.getDisplayMatching(window.getBounds()).scaleFactor;
  window.destroy();
  assert.equal(originalBase.contents.isDestroyed(), false, "closing the source window preserves the moved dashboard document");
  assert.equal(manager.tabs.windowFor(originalBase.contents), destination.window);
  stream.end(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true, electron: process.versions.electron, scale, churnCycles:40 }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
