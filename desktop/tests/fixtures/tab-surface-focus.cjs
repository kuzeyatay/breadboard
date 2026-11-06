const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const execFile = require("node:util").promisify(require("node:child_process").execFile);
const { app, BrowserWindow, webContents } = require("electron");
const runtime = process.env.BREADBOARD_FOCUS_TEST_DIST || path.resolve(__dirname, "../../dist");
const { TabManager } = require(path.join(runtime, "main/tab-manager.js"));
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
require(path.join(runtime, "main/gpu-preferences.js")).configureGpuPreferences(app.commandLine, app.getPath("userData"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>Terminal</title>
      <style>input{position:absolute;left:100px;top:200px;width:400px;height:50px}</style>
      <input id="search" value="my search"><script>document.documentElement.dataset.breadboardStartup='ready'</script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Loading</body>");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    preloadPath: path.join(runtime, "preload/preload.js"),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => "dark", openWindow: () => assert.fail("Unexpected window"),
  });
  manager.scheduleNewTabPreparation = () => {};
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  window.setOpacity(0);
  window.showInactive();
  manager.attach(window, true);
  const host = manager.hosts.get(window.id);
  await host.base.contents.loadURL(origin + "/base");
  await until(() => host.shellEnabled && !host.pending, "persistent shell ready");
  const tab = manager.createView(host, origin + "/new-tab");
  host.tabs.push(tab);
  await until(() => tab.loaded, "Terminal document ready");
  manager.setNewTabUrl(origin + "/new-tab");
  tab.terminalReady = true;

  // A prepared document is already clickable while the final frame probe is
  // still pending. Use real native focus and mouse input, with no focus mocks.
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  manager.frameReady = () => ready;
  manager.activate(host, tab.id);
  assert.equal(host.pendingAtFront, true);
  await tab.contents.mainFrame.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  window.focus();
  tab.contents.focus();
  tab.contents.sendInputEvent({ type: "mouseDown", x: 150, y: 225, button: "left", clickCount: 1 });
  tab.contents.sendInputEvent({ type: "mouseUp", x: 150, y: 225, button: "left", clickCount: 1 });
  await until(() => tab.contents.executeJavaScript("document.activeElement.id === 'search' && document.hasFocus()"), "first click focuses Search");
  await tab.contents.executeJavaScript("document.querySelector('#search').setSelectionRange(3, 3)");
  release(true);
  await until(() => !host.pending, "late reveal finishes");
  assert.equal(tab.contents.isFocused(), true, "late reveal must preserve native keyboard focus after the first click");
  assert.deepEqual(await tab.contents.executeJavaScript(`({
    focused: document.hasFocus(), active: document.activeElement.id,
    value: document.querySelector('#search').value, caret: document.querySelector('#search').selectionStart
  })`), { focused: true, active: "search", value: "my search", caret: 3 });
  webContents.getFocusedWebContents().sendInputEvent({ type: "char", keyCode: "X" });
  await until(() => tab.contents.executeJavaScript("document.querySelector('#search').value === 'my Xsearch'"), "typing reaches Search without a second click");

  // Refreshing another surface must leave the toolbar's intentional focus alone.
  host.shell.contents.focus();
  manager.refreshTabSurface(host, tab);
  assert.equal(host.shell.contents.isFocused(), true, "toolbar focus survives a content refresh");
  tab.contents.focus();
  const nativeFocus = tab.contents.focus.bind(tab.contents);
  let focusRequests = 0;
  tab.contents.focus = () => { focusRequests++; nativeFocus(); };
  manager.refreshSelectedSurfaces(host);
  assert.equal(focusRequests, 0, "ordinary layout does not request focus");
  const order = window.contentView.children;
  const remove = window.contentView.removeChildView.bind(window.contentView);
  let reattachments = 0;
  window.contentView.removeChildView = view => {
    if (view === tab.view) reattachments++;
    return remove(view);
  };
  window.hide();
  await until(() => !window.isFocused(), "window inactive");
  manager.refreshTabSurface(host, tab);
  assert.equal(focusRequests, 0, "background refresh does not activate an unfocused window");
  assert.equal(window.isFocused(), false);
  window.showInactive();
  await until(() => reattachments > 0, "uncovering the inactive window reattaches the selected native view");
  assert.deepEqual(window.contentView.children, order, "the PDF, toolbar and overlays keep their stack order");
  assert.equal(host.activeId, tab.id);
  assert.equal(window.isFocused(), false);
  assert.equal(await tab.contents.executeJavaScript("document.querySelector('#search').value"), "my Xsearch");
  const afterShow = reattachments;
  manager.layout(host);
  assert.equal(reattachments, afterShow, "ordinary layout does not reattach a resident view");
  // A foreign window covers and uncovers the tab without a tab switch.
  // Check its native widget while covered, before any recovery could run.
  const probe = path.join(dir, "tab-occlusion-probe.exe");
  await execFile(path.join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
    ["/nologo", "/target:winexe", "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll",
      "/out:" + probe, path.join(__dirname, "tab-occlusion-probe.cs")], { windowsHide: true });
  window.setSize(420, 280);
  await tab.contents.executeJavaScript(`document.body.style.background = '#e6f0e6';
    const marker = document.createElement('div');
    marker.style.cssText = 'position:fixed;inset:0;background:#326faa';
    document.body.append(marker);`);
  window.setOpacity(1);
  await execFile(probe, [window.getNativeWindowHandle().readBigUInt64LE().toString()], { timeout: 8000 });
  assert.equal(reattachments, afterShow, "covering and uncovering never reattaches the selected tab");
  window.destroy();
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
