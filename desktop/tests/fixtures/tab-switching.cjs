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
      <header ${request.url.startsWith("/hydrating") ? 'class="desktop-title-bar"' : ''}><button>First tab</button></header><input id="draft" value="kept">`);
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

  await base.loadURL("about:blank");
  await until(async () => base.executeJavaScript(`
    getComputedStyle(document.documentElement).webkitAppRegion === 'no-drag' &&
    document.documentElement.getBoundingClientRect().height >= innerHeight
  `), "reloading the retired base keeps the tab strip clickable");

  // The parked native window can receive focus after a web view loses it.
  // Its removal from the tab/IPC map must not disable window shortcuts.
  const press = (contents, keyCode, modifiers) => {
    contents.focus();
    contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  press(base, "Tab", ["control"]);
  await until(() => state().activeId === secondId, "Ctrl+Tab from the retired base wraps to the first tab");
  press(second.webContents, "Tab", ["control", "shift"]);
  await until(() => state().activeId === thirdId, "Ctrl+Shift+Tab wraps to the last tab");
  press(third.webContents, "1", ["control"]);
  await until(() => state().activeId === secondId, "Ctrl+1 selects the first tab");
  press(second.webContents, "9", ["control"]);
  await until(() => state().activeId === thirdId, "Ctrl+9 selects the last tab");

  // Warm pages must reuse their frame even when the renderer stops delivering
  // animation frames. Native clicks are separately verified in the live app.
  for (const [id, view] of [[secondId, second], [thirdId, third], [secondId, second], [thirdId, third]]) {
    await view.webContents.executeJavaScript("requestAnimationFrame = () => 1; true");
    const boundsDuringSwitch = [];
    const setBounds = view.setBounds;
    view.setBounds = function (bounds) {
      boundsDuringSwitch.push(bounds);
      return setBounds.call(this, bounds);
    };
    const started = Date.now();
    command({ type: "activate", id });
    await until(() => views().length === 1 && views()[0] === view, "warm tab selected");
    view.setBounds = setBounds;
    const [width, height] = window.getContentSize();
    assert.ok(boundsDuringSwitch.every(bounds =>
      bounds.x === 0 && bounds.y === 0 && bounds.width === width && bounds.height === height),
    "a warm tab must keep its visible compositor bounds instead of taking an offscreen round trip: " +
      JSON.stringify(boundsDuringSwitch));
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

  // A complete server-rendered document is not enough: React can still be
  // loading the tab bar. Keep the previous live controls beyond the ordinary
  // compositor deadline, then reveal as soon as the new strip mounts.
  command({ type: "open", url: origin + "/hydrating" });
  const hydrating = await until(() => window.contentView.children.find(view =>
    view.webContents?.getURL() === origin + "/hydrating"), "hydrating document attached");
  await until(() => state().tabs.find(tab => tab.url.endsWith("/hydrating"))?.loading === false,
    "hydrating document finished loading");
  await sleep(2_800);
  assert.deepEqual(views(), [second], "a page with no tab strip must not cover the live tabs");
  await hydrating.webContents.executeJavaScript(`
    document.querySelector('header').insertAdjacentHTML('beforeend', '<div role="tablist"><button role="tab">Restored tabs</button></div>'); true
  `);
  await until(() => views().length === 1 && views()[0] === hydrating, "hydrated tabs revealed");

  // Cancelling a hydration wait must never commit that page later.
  command({ type: "open", url: origin + "/hydrating-cancelled" });
  const cancelled = await until(() => window.contentView.children.find(view =>
    view.webContents?.getURL() === origin + "/hydrating-cancelled"), "second hydration wait started");
  command({ type: "activate", id: secondId });
  await until(() => views().length === 1 && views()[0] === second, "hydration wait cancelled");
  await cancelled.webContents.executeJavaScript(`
    document.querySelector('header').insertAdjacentHTML('beforeend', '<div role="tablist"></div>'); true
  `);
  await sleep(1_300);
  assert.deepEqual(views(), [second]);

  // Browser chrome is transparent over its native page. That page must be in
  // the window before removing the outgoing tab, including on a warm switch.
  manager.tabs.setBrowserUrl(origin + "/browser");
  command({ type: "browser", url: origin + "/web-page" });
  const browserId = state().activeId;
  const browserPage = await until(() => window.contentView.children.find(view =>
    view.webContents?.getURL() === origin + "/web-page"), "native browser page attached");
  const browserChrome = await until(() => views().find(view =>
    view.webContents.getURL() === origin + "/browser"), "browser chrome revealed");
  await browserChrome.webContents.executeJavaScript("requestAnimationFrame = () => 1; true");
  command({ type: "activate", id: secondId });
  await until(() => views().length === 1 && views()[0] === second, "leaving browser tab");
  assert.equal(window.contentView.children.includes(browserPage), false);
  let pageCoveredHandoff = false;
  const removeChildView = window.contentView.removeChildView;
  window.contentView.removeChildView = function (view) {
    if (view === second) pageCoveredHandoff = this.children.includes(browserPage);
    return removeChildView.call(this, view);
  };
  command({ type: "activate", id: browserId });
  await until(() => views().length === 1 && views()[0] === browserChrome, "warm browser selected");
  window.contentView.removeChildView = removeChildView;
  assert.equal(pageCoveredHandoff, true, "the native browser page covers the transparent shell before the outgoing tab leaves");
  assert.equal(window.contentView.children.includes(browserPage), true);
  command({ type: "browser", url: origin + "/web-page-two" });
  const secondBrowserId = state().activeId;
  const secondBrowserPage = await until(() => window.contentView.children.find(view =>
    view.webContents?.getURL() === origin + "/web-page-two"), "second browser page attached");
  command({ type: "activate", id: browserId });
  await until(() => window.contentView.children.includes(browserPage), "first browser reselected");
  let browserCoveredHandoff = false;
  window.contentView.removeChildView = function (view) {
    if (view === browserPage) browserCoveredHandoff = this.children.includes(secondBrowserPage);
    return removeChildView.call(this, view);
  };
  command({ type: "activate", id: secondBrowserId });
  await until(() => !window.contentView.children.includes(browserPage), "second browser page revealed");
  window.contentView.removeChildView = removeChildView;
  assert.equal(browserCoveredHandoff, true, "switching browser tabs must attach the incoming native page before detaching the outgoing one");
  window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
