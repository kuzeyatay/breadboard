const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const dir = process.argv[2];
app.setPath("userData", path.join(dir, "user-data"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await sleep(20);
  }
  throw new Error("Timed out: " + label);
};

app.whenReady().then(async () => {
  let releaseCold;
  const server = http.createServer((request, response) => {
    const send = () => response.end(`<!doctype html><title>${request.url}</title>
      <style>html{min-height:100vh}header{height:32px;-webkit-app-region:drag}
      button{-webkit-app-region:no-drag}</style>
      <header><button>First tab</button></header><input id="draft" value="kept">`);
    response.setHeader("content-type", "text/html");
    if (request.url === "/cold") releaseCold = send;
    else send();
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
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  const base = window.webContents;
  await base.loadURL(origin + "/base");
  const command = value => manager.tabs.handleCommand(second?.webContents ?? base, value);
  let second;
  const state = () => manager.tabs.stateFor(second?.webContents ?? base);
  const views = () => window.contentView.children.filter(view =>
    view.webContents?.getURL().startsWith(origin) && view.getBounds().y === 0);
  command({ type: "open", url: origin + "/second" });
  second = await until(() => views().find(view => view.webContents.getURL().endsWith("/second")), "second tab revealed");
  const secondId = state().activeId;
  command({ type: "open", url: origin + "/third" });
  const third = await until(() => views().find(view => view.webContents.getURL().endsWith("/third")), "third tab revealed");
  const thirdId = state().activeId;

  // Retiring the original page used to leave its header's native drag region
  // over the newer tab controls, even though about:blank contains no header.
  command({ type: "close", id: state().tabs[0].id });
  await until(() => base.getURL() === "about:blank", "base retired");
  await until(async () => base.executeJavaScript(`
    getComputedStyle(document.documentElement).webkitAppRegion === 'no-drag' &&
    document.documentElement.getBoundingClientRect().height >= innerHeight
  `), "retired base publishes a full-window non-draggable region");

  // Warm pages must reuse their frame even when the renderer stops delivering
  // animation frames. Native clicks are separately verified in the live app.
  for (const [id, view] of [[secondId, second], [thirdId, third], [secondId, second], [thirdId, third]]) {
    await view.webContents.executeJavaScript("requestAnimationFrame = () => 1; true");
    const started = Date.now();
    command({ type: "activate", id });
    await until(() => views().length === 1 && views()[0] === view, "warm tab selected");
    assert.ok(Date.now() - started < 250, "warm selection must not wait for a renderer probe");
    assert.equal(state().navigationPending, false);
    assert.equal(await view.webContents.executeJavaScript("document.querySelector('#draft').value"), "kept");
  }

  // Switching away from a cold reveal must cancel its later commit.
  command({ type: "open", url: origin + "/cold" });
  await until(() => releaseCold, "cold request held");
  command({ type: "activate", id: secondId });
  await until(() => views().length === 1 && views()[0] === second, "warm tab cancels the cold reveal");
  assert.deepEqual(views(), [second]);
  releaseCold();
  await until(() => state().tabs.find(tab => tab.url.endsWith("/cold"))?.loading === false, "cancelled tab loaded");
  await sleep(100);
  assert.equal(state().activeId, secondId);
  assert.deepEqual(views(), [second]);
  window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
