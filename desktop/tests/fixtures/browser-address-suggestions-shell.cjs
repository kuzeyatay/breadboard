const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const { app, BrowserWindow, ipcMain } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { mainWindowOptions } = require("../../dist/main/window-options.js");
const { IPC_CHANNELS, isTabsCommand } = require("../../dist/shared/ipc-contract.js");
const dir = process.argv.at(-1);
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
  let embeddedResponse;
  const server = http.createServer((req, res) => {
    if (req.url === "/embedded") { embeddedResponse = res; return; }
    if (req.url.startsWith("/api/browser/suggestions?")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ suggestions: Array.from({ length: 8 }, (_, index) => `field example ${index + 1}`) }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url === "/draggable-page") {
      res.end(`<!doctype html><title>Website with a desktop titlebar</title>
        <style>body{margin:0;background:#43885a}header{position:fixed;inset:0 0 auto;height:52px;
          pointer-events:none;-webkit-app-region:drag}</style>
        <header></header><input id="draft" value="preserved background draft" style="margin-top:80px">`);
      return;
    }
    res.end(`<!doctype html><title>Address focus regression</title>
      <style>body{margin:0;background:#43885a;min-height:3000px}</style>
      <input id="draft" value="unsaved"><button onclick="window.clicked=true">Working page</button>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const preloadPath = path.resolve(__dirname, "../../dist/preload/preload.js");
  const blank = path.join(dir, "blank.html");
  fs.writeFileSync(blank, "<!doctype html>");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() }, preloadPath,
    recoveryHtmlPath: () => blank, loadingHtmlPath: () => blank,
    theme: () => "light", openWindow: () => {},
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  ipcMain.handle(IPC_CHANNELS.getBrowserBookmarks, () => []);
  ipcMain.handle(IPC_CHANNELS.getBrowserRecentSearches, () => ["capacitance", "filters"]);
  ipcMain.handle(IPC_CHANNELS.setBrowserRecentSearches, () => true);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => ({ items: [], error: null }));
  ipcMain.handle(IPC_CHANNELS.getBrowserHistory, () => ({ items: [], error: null }));
  const window = new BrowserWindow({ ...mainWindowOptions(preloadPath), width: 1100, height: 750, minHeight: 300 });
  let nativeHitTest;
  if (process.platform === 'win32') {
    const executable = path.join(dir, 'native-hit-test.exe');
    execFileSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      ['/nologo', '/target:exe', '/out:' + executable, path.join(__dirname, 'native-hit-test.cs')], {windowsHide:true});
    const handle = window.getNativeWindowHandle().readBigUInt64LE().toString();
    nativeHitTest = async (x, y) => Number((await promisify(execFile)(executable, [handle, String(x), String(y)], {windowsHide:true})).stdout.trim());
  }
  manager.attach(window, true);
  window.setOpacity(0);
  window.showInactive();
  const host = manager.hosts.get(window.id);
  host.shell.contents.on("console-message", (_event, level, message) => { if (level >= 2) console.log("SHELL", message); });
  const base = manager.baseContents(window);
  await base.loadURL(origin + "/dashboard");
  manager.setBrowserUrl(origin + "/browser");
  const command = value => manager.handleCommand(base, value);
  command({ type: "browser", url: origin + "/page" });
  const first = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => host.shellEnabled && !host.pending && first.browser.ready, "website presented with persistent controls");
  const page = first.browser.contents;
  await page.executeJavaScript("window.scrollTo(0,180);window.resizeCount=0;window.addEventListener('resize',()=>window.resizeCount++)");
  await until(() => page.executeJavaScript("scrollY===180"), "page scrolled");
  const metrics = () => page.executeJavaScript("({width:innerWidth,height:innerHeight,scrollY,resizeCount,draft:document.querySelector('#draft').value})");
  const initialMetrics = await metrics();
  const initialBounds = first.browser.view.getBounds();
  await page.executeJavaScript(`(() => {
    const button = document.createElement('button');
    button.id = 'upper-page-control';
    button.textContent = 'Upper page control';
    button.style.cssText = 'position:fixed;top:8px;left:100px;width:180px;height:32px;z-index:100';
    button.onclick = () => { window.upperPageClicks = (window.upperPageClicks || 0) + 1; };
    document.body.append(button);
  })()`);
  const clickUpperPage = async () => {
    const x = initialBounds.x + 150, y = initialBounds.y + 20;
    if (nativeHitTest) assert.equal(await nativeHitTest(x, y), 1,
      'Windows must route the website header as client input, not a window drag region');
    const receiver = [...window.contentView.children].reverse().find(view => {
      const bounds = view.getBounds();
      return view.webContents && x >= bounds.x && x < bounds.x + bounds.width &&
        y >= bounds.y && y < bounds.y + bounds.height;
    });
    assert.equal(receiver, first.browser.view, "the website owns clicks just below the bookmarks bar");
    const previous = await page.executeJavaScript('window.upperPageClicks || 0');
    page.sendInputEvent({type:'mouseDown', x:150, y:20, button:'left', clickCount:1});
    page.sendInputEvent({type:'mouseUp', x:150, y:20, button:'left', clickCount:1});
    await until(() => page.executeJavaScript(`window.upperPageClicks === ${previous + 1}`),
      "one click reaches the upper website button after dropdown dismissal");
  };
  const dropdownMetrics = () => host.shell.contents.executeJavaScript(`(() => {
    const list = document.querySelector('#browser-address-suggestions');
    if (!list) return null;
    const bounds = list.getBoundingClientRect();
    return { height: bounds.height, bottom: bounds.bottom, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight,
      rows: list.querySelectorAll('.browser-suggestion-row').length };
  })()`);
  const assertVisible = tabs => {
    const children = window.contentView.children;
    for (const tab of tabs) {
      assert.ok(children.indexOf(tab.browser.view) > children.indexOf(tab.view),
        "focusing the address bar must keep websites above opaque browser home");
      assert.ok(children.indexOf(host.shell.view) > children.indexOf(tab.browser.view),
        "suggestions remain above websites in the persistent toolbar");
      assert.ok(tab.browser.attached && children.includes(tab.browser.view));
    }
  };
  const assertDropdownPainted = async () => {
    const rows = await host.shell.contents.executeJavaScript(`Array.from(
      document.querySelectorAll('#browser-address-suggestions .browser-suggestion-row')
    ).map(row => {
      const bounds = row.getBoundingClientRect();
      const x = Math.round(bounds.left + 3), y = Math.round(bounds.top + bounds.height / 2);
      return { x, y, hit: row.contains(document.elementFromPoint(x, y)) };
    })`);
    assert.ok(rows.length >= 2);
    assert.ok(rows.every(row => row.hit),
      "every history row must receive input below the bookmarks bar, without body clipping");
    const capture = await host.shell.contents.capturePage();
    const size = capture.getSize();
    const bounds = host.shell.view.getBounds();
    const bitmap = capture.toBitmap();
    for (const row of rows) {
      const x = Math.floor(row.x * size.width / bounds.width);
      const y = Math.floor(row.y * size.height / bounds.height);
      const offset = (y * size.width + x) * 4;
      assert.ok(bitmap[offset + 3] > 0 && bitmap[offset + 2] > 150,
        `the light history card must paint at row y=${row.y}, not expose the website`);
    }
  };
  const openSuggestions = async tab => {
    await until(() => host.shell.contents.executeJavaScript("!!document.querySelector('.browser-address-input')"), "address input rendered");
    host.shell.contents.focus();
    await host.shell.contents.executeJavaScript("document.querySelector('.browser-address-input').focus()");
    try {
      await until(() => tab.browser.addressSuggestionsOpen, "focusing the real address input opens suggestions");
    } catch (error) {
      console.error(await host.shell.contents.executeJavaScript("({active:document.activeElement.outerHTML,dropdown:document.querySelector('#browser-address-suggestions')?.outerHTML})"));
      throw error;
    }
    assert.equal(await host.shell.contents.executeJavaScript("document.activeElement.classList.contains('browser-address-input')"), true);
    const dropdown = await dropdownMetrics();
    assert.ok(dropdown.height >= 96, `both suggestion rows must be visible, not collapsed into a strip: ${JSON.stringify(dropdown)}`);
    assert.ok(dropdown.scrollHeight <= dropdown.clientHeight, "two suggestions fit without scrolling");
    assert.ok(host.shell.view.getBounds().height >= Math.floor(dropdown.bottom) - 2,
      "the native toolbar must extend below the suggestion rows");
    await host.shell.contents.executeJavaScript(`Promise.all(
      document.querySelector('#browser-address-suggestions').getAnimations().map(animation => animation.finished)
    )`);
    await until(async () => host.shell.view.getBounds().height >= Math.ceil((await dropdownMetrics()).bottom),
      "the native toolbar includes the full dropdown after its entrance animation");
    await assertDropdownPainted();
  };
  const closeSuggestions = async tab => {
    host.shell.contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    host.shell.contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await until(() => !tab.browser.addressSuggestionsOpen, "Escape closes suggestions");
    await host.shell.contents.executeJavaScript("document.activeElement.blur()");
  };
  // ChatGPT and other sites declare native draggable headers. A cached page
  // covered by another WebContentsView still contributes that region on
  // Electron 33/Windows, swallowing real clicks in the next site's header.
  command({ type: "browser", url: origin + "/draggable-page" });
  const draggable = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending && draggable.browser.ready, "draggable website ready");
  if (nativeHitTest) await until(async () =>
    await nativeHitTest(initialBounds.x + 450, initialBounds.y + 20) === 2,
    "the website's CSS registers a real Windows caption region");
  for (let cycle = 0; cycle < 3; cycle++) {
    command({ type: "activate", id: first.id });
    await until(() => !host.pending && host.presentedId === first.id, "original website restored");
    await clickUpperPage();
    assert.ok(!window.contentView.children.includes(draggable.browser.view),
      "inactive websites must release their native drag-region provider");
    assert.deepEqual(await metrics(), initialMetrics, "switching preserves viewport, scroll and unsaved input");
    if (cycle < 2) {
      command({ type: "activate", id: draggable.id });
      await until(() => !host.pending && host.presentedId === draggable.id, "draggable website restored");
      assert.equal(await draggable.browser.contents.executeJavaScript("document.querySelector('#draft').value"),
        "preserved background draft", "detaching a native surface must retain the document");
    }
  }
  for (let cycle = 0; cycle < 3; cycle++) {
    await openSuggestions(first);
    assertVisible([first]);
    assert.deepEqual(first.browser.view.getBounds(), initialBounds);
    assert.deepEqual(await metrics(), initialMetrics, "focus preserves page size, scroll and unsaved input");
    manager.layout(host);
    manager.syncBrowser(host);
    assertVisible([first]);
    await closeSuggestions(first);
    assertVisible([first]);
    await clickUpperPage();
  }
  await openSuggestions(first);
  // The visible toolbar can dismiss the list using a snapshot from just
  // before a page navigation. That dismissal must still release page input.
  const staleTarget = { targetTabId: first.id, generation: first.generation,
    presentationRevision: host.presentationRevision };
  first.generation++;
  host.presentationRevision++;
  // Also cover an already-running desktop whose old command handler still
  // rejects stale cleanup. The renderer must refresh and retry dismissal.
  const shellCommand = manager.shellCommand.bind(manager);
  manager.shellCommand = (owner, request) => {
    if (request.command?.type === 'browser-address-suggestions' && !request.command.open &&
        request.revision !== owner.presentationRevision) return false;
    return shellCommand(owner, request);
  };
  await host.shell.contents.executeJavaScript("document.querySelector('.browser-address-input').blur()");
  await until(() => host.shell.contents.executeJavaScript("!document.querySelector('#browser-address-suggestions')"),
    "blur removes the visible dropdown");
  await until(() => host.shell.view.getBounds().height === initialBounds.y,
    "the renderer retries stale dismissal and releases the native input area");
  await clickUpperPage();
  manager.shellCommand = shellCommand;
  assert.equal(await host.shell.contents.executeJavaScript(
    `window.breadboardDesktop.tabs(${JSON.stringify({type:"browser-address-suggestions",open:false,...staleTarget})})`
  ), true, "a stale page generation must not prevent the toolbar from releasing its native input area");
  assert.equal(host.shell.view.getBounds().height, initialBounds.y,
    "no invisible toolbar remains over the top of the website after dismissal");
  manager.broadcast(host);
  await openSuggestions(first);
  // Websites can start loading an iframe while the user edits the address.
  // That must not collapse the native toolbar behind the still-open list.
  await new Promise(resolve => setTimeout(resolve, 200));
  const embeddedLoad = new Promise(resolve => page.once("did-start-loading", resolve));
  await page.executeJavaScript(`(() => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;bottom:0;right:0;border:0';
    frame.src = ${JSON.stringify(origin + "/embedded")};
    document.body.append(frame);
  })()`);
  await embeddedLoad;
  await until(() => embeddedResponse, "embedded page request started");
  assert.equal(first.browser.addressSuggestionsOpen, true,
    "background website loading must not close the focused address dropdown");
  assertVisible([first]);
  const afterEmbeddedLoad = await dropdownMetrics();
  assert.ok(host.shell.view.getBounds().height >= Math.floor(afterEmbeddedLoad.bottom) - 2,
    "the full dropdown stays above the website after an iframe starts loading");
  assert.deepEqual(first.browser.view.getBounds(), initialBounds);
  assert.deepEqual(await metrics(), initialMetrics, "background loading preserves the page viewport and draft");
  embeddedResponse.end("<!doctype html><title>Embedded page</title>");
  await host.shell.contents.executeJavaScript("document.querySelector('.browser-address-input').select()");
  await host.shell.contents.insertText("field");
  await until(async () => (await dropdownMetrics())?.rows === 8, "typed query expands to eight suggestions");
  await until(async () => (await dropdownMetrics()).height >= 359, "long suggestion list expands above the page");
  assertVisible([first]);
  assert.deepEqual(first.browser.view.getBounds(), initialBounds);
  assert.deepEqual(await metrics(), initialMetrics, "typing suggestions preserves the website viewport");
  const originalSize = window.getContentSize();
  window.setContentSize(900, 360);
  await until(async () => {
    const list = await dropdownMetrics();
    return list?.height > 170 && list.height <= 180;
  }, "short windows constrain suggestions using the full window height");
  const compact = await dropdownMetrics();
  assert.ok(compact.scrollHeight > compact.clientHeight, "long lists scroll inside short windows");
  assert.ok(compact.bottom < window.getContentSize()[1], "suggestions fit inside the real window");
  await until(() => host.shell.view.getBounds().height >= Math.floor(compact.bottom) - 2,
    "the native toolbar includes the compact dropdown");
  window.setContentSize(...originalSize);
  await until(async () => (await dropdownMetrics()).height >= 359, "resizing larger restores the full dropdown");
  await closeSuggestions(first);
  await until(() => host.shell.view.getBounds().height === initialBounds.y, "Escape restores toolbar height and page input");
  // A failure also needs native space below the bookmarks bar. Opening or
  // closing address suggestions must not overwrite that independent extent.
  const beforeErrorBounds = first.browser.view.getBounds();
  const openPopover = manager.openToolbarPopover;
  manager.openToolbarPopover = () => Promise.resolve(false);
  await host.shell.contents.executeJavaScript("document.querySelector('[aria-label^=Downloads]').click()");
  await until(() => host.shell.contents.executeJavaScript("!!document.querySelector('[aria-label=\"Dismiss downloads error\"]')"), "download error rendered");
  const errorMetrics = () => host.shell.contents.executeJavaScript(`(() => {
    const card = document.querySelector('[role="alert"]');
    const bounds = card.getBoundingClientRect();
    const dismiss = card.querySelector('[aria-label="Dismiss downloads error"]');
    const action = dismiss.getBoundingClientRect();
    return { bottom: bounds.bottom, left: bounds.left, right: bounds.right,
      clickable: dismiss.contains(document.elementFromPoint(action.x + action.width / 2, action.y + action.height / 2)) };
  })()`);
  await until(async () => host.shell.view.getBounds().height >= Math.ceil((await errorMetrics()).bottom), "download error crosses the native toolbar boundary");
  assert.equal((await errorMetrics()).clickable, true, "the error's bottom action is visible and clickable");
  assert.ok((await errorMetrics()).left >= 0 && (await errorMetrics()).right <= window.getContentSize()[0]);
  assert.deepEqual(first.browser.view.getBounds(), beforeErrorBounds, "an error must not resize the website");
  if (process.env.BREADBOARD_DOWNLOADS_POPOVER_QA_DIR) {
    fs.mkdirSync(process.env.BREADBOARD_DOWNLOADS_POPOVER_QA_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.BREADBOARD_DOWNLOADS_POPOVER_QA_DIR, "toolbar-error.png"), (await host.shell.contents.capturePage()).toPNG());
  }
  await host.shell.contents.executeJavaScript("document.querySelector('.browser-address-input').focus()");
  await until(() => first.browser.addressSuggestionsOpen, "suggestions and the error coexist");
  await closeSuggestions(first);
  assert.ok(host.shell.view.getBounds().height >= Math.ceil((await errorMetrics()).bottom), "closing suggestions must not clip an existing error");
  await host.shell.contents.executeJavaScript("document.querySelector('[aria-label=\"Dismiss downloads error\"]').click()");
  await until(() => host.shell.view.getBounds().height === initialBounds.y, "dismissing the error restores website input");
  manager.openToolbarPopover = openPopover;
  await clickUpperPage();
  command({ type: "browser", url: origin + "/other" });
  const second = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending && second.browser.ready, "second website ready");
  command({ type: "split-tabs", id: second.id, targetId: first.id, side: "right" });
  await until(() => !host.pending && !first.splitPreparation && first.browser.attached, "both split websites ready");
  const splitBounds = [first, second].map(tab => tab.browser.view.getBounds());
  await openSuggestions(second);
  assertVisible([first, second]);
  assert.deepEqual([first, second].map(tab => tab.browser.view.getBounds()), splitBounds,
    "opening suggestions leaves both split panes in place");
  await closeSuggestions(second);
  assertVisible([first, second]);
  // Local pages in a split share the website's address bar. Focusing that
  // toolbar opens its dropdown without changing which pane is active.
  command({ type: "open", url: origin + "/local" });
  const local = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending && local.loaded, "local page ready");
  command({ type: "split-tabs", id: local.id, targetId: second.id, side: "right" });
  await until(() => !host.pending && !second.splitPreparation && second.browser.attached,
    "local and website split ready");
  assert.equal(host.activeId, local.id);
  const mixedBounds = [local.view.getBounds(), second.browser.view.getBounds()];
  await openSuggestions(second);
  assert.equal(host.activeId, local.id, "opening history keeps the selected pane");
  assertVisible([second]);
  assert.deepEqual([local.view.getBounds(), second.browser.view.getBounds()], mixedBounds);
  await closeSuggestions(second);
  await until(() => host.shell.view.getBounds().height === initialBounds.y,
    "closing history restores the toolbar beside the active local pane");
  window.destroy();
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
