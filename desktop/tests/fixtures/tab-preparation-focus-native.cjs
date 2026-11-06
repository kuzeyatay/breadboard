const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, webContents } = require("electron");
const runtime = process.env.BREADBOARD_FOCUS_TEST_DIST || path.resolve(__dirname, "../../dist");
const { TabManager } = require(path.join(runtime, "main/tab-manager.js"));
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  let releaseResponse;
  const server = http.createServer((_req, res) => {
    if (_req.url === "/new-tab") { releaseResponse = () => { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>Prepared Terminal</title><body>Ready</body>"); }; return; }
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
  manager.setNewTabUrl(origin + "/new-tab");
  host.shell.contents.focus();
  const preparing = manager.prepareNewTab(host);
  const spare = host.preparedNewTab;
  assert.ok(spare);
  await until(() => releaseResponse, "spare request pending");
  // Reproduce the real Windows handoff: Search is clicked after prewarming
  // begins, before the hidden document commits. Never stub native focus.
  window.focus();
  host.base.contents.focus();
  host.base.contents.sendInputEvent({ type: "mouseDown", x: 150, y: 225, button: "left", clickCount: 1 });
  host.base.contents.sendInputEvent({ type: "mouseUp", x: 150, y: 225, button: "left", clickCount: 1 });
  await until(() => host.base.contents.executeJavaScript("document.activeElement.id === 'search' && document.hasFocus()"), "first click focuses Search");
  await host.base.contents.executeJavaScript("document.querySelector('#search').setSelectionRange(3, 3)");
  releaseResponse();
  await preparing;
  assert.equal(host.base.contents.isFocused(), true, "a hidden Terminal's document commit must preserve Search keyboard focus");
  assert.equal(webContents.getFocusedWebContents(), host.base.contents);
  assert.equal(spare.painted, true, "the spare still completes preparation");
  assert.equal(spare.attached, false, "the completed spare is parked");
  assert.deepEqual(await host.base.contents.executeJavaScript(`({
    focused: document.hasFocus(), active: document.activeElement.id,
    value: document.querySelector('#search').value, caret: document.querySelector('#search').selectionStart
  })`), { focused: true, active: "search", value: "my search", caret: 3 });
  webContents.getFocusedWebContents().sendInputEvent({ type: "char", keyCode: "X" });
  await until(() => host.base.contents.executeJavaScript("document.querySelector('#search').value === 'my Xsearch'"), "typing works without another click");
  window.destroy();
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });


