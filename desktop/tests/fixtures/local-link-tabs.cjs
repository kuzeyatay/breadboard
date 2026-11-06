const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, ipcMain, webContents } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const { installGlobalSecurity } = require("../../dist/main/security.js");
const { IPC_CHANNELS } = require("../../dist/shared/ipc-contract.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  let releaseLecture;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    const send = () => response.end(`<!doctype html><title>${request.url}</title>
      <style>body{margin:0;min-height:100vh}a{display:block;padding:12px}</style>
      <a id="lecture" href="/gardens/em1/pdf/lecture#page=3" target="_blank" rel="noopener">Lecture</a>
      <a id="next" href="/garden/em1?note=next" target="_blank">Next note</a>
      <a id="background" href="/garden/em1?note=background" target="_blank">Background note</a>
      <input id="draft" value="reader state kept">
      ${request.url === "/garden/em1" ? '<iframe id="reader" src="/quartz/em1/lesson"></iframe>' : ''}`);
    if (request.url === "/gardens/em1/pdf/lecture") releaseLecture = send;
    else send();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Loading fixture</body>");
  const allowed = { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href]) };
  installGlobalSecurity(allowed);
  const manager = new WindowManager({
    allowed, preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
    minimumStartupVisibleMs: 0,
  });
  manager.tabs.setEnabled(true);
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  const base = manager.page(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.tabs.handleCommand(event.sender, command));
  await base.loadURL(origin + "/garden/em1");
  const state = () => manager.tabs.stateFor(base);
  const baseId = state().activeId;
  const visible = contents => window.contentView.children.some(view =>
    view.webContents === contents && view.getBounds().x === 0 && view.getBounds().y === 32 && state().presentedId === state().activeId);
  const loadedTab = async url => {
    const tab = await until(() => state().tabs.find(candidate => candidate.url === url && !candidate.loading), `loaded tab ${url}`);
    const contents = await until(() => webContents.getAllWebContents().find(candidate =>
      candidate.getURL() === url && manager.tabs.stateFor(candidate)?.selfId === tab.id), `contents ${url}`);
    return { tab, contents };
  };

  // The Quartz reader is an iframe in the trusted page. A plain blue link must
  // keep that reader available while its destination has not answered yet.
  await base.executeJavaScript("document.querySelector('#reader').contentDocument.querySelector('#lecture').click(); true", true);
  await until(() => releaseLecture, "lecture request");
  assert.equal(BrowserWindow.getAllWindows().length, 1, "reader link must not create a native window");
  assert.equal(state().tabs.length, 2);
  assert.notEqual(state().activeId, baseId, "plain click selects the new tab");
  assert.equal(state().navigationPending, true, "the reader keeps its navigation progress while waiting");
  assert.equal(base.getURL(), origin + "/garden/em1", "reader document remains intact");
  assert.equal(await base.executeJavaScript("document.querySelector('#draft').value"), "reader state kept");
  assert.equal(window.contentView.children.some(view => view.webContents?.getURL() === pathToFileURL(scene).href), false,
    "the separate loading scene must not cover the reader");
  releaseLecture();
  const lecture = await loadedTab(origin + "/gardens/em1/pdf/lecture#page=3");
  await until(() => visible(lecture.contents) && !state().navigationPending, "lecture tab revealed");
  assert.equal(state().activeId, lecture.tab.id);

  // Repeat from a WebContentsView tab, whose handlers are wired separately
  // from the original BrowserWindow page.
  await lecture.contents.executeJavaScript("document.querySelector('#next').click(); true", true);
  const next = await loadedTab(origin + "/garden/em1?note=next");
  await until(() => visible(next.contents) && !state().navigationPending, "next note revealed");
  assert.equal(state().activeId, next.tab.id);
  assert.equal(BrowserWindow.getAllWindows().length, 1);

  // Chromium, rather than a synthetic DOM event, decides the middle-click
  // disposition. Its tab must load without taking the selected page away.
  const point = await next.contents.executeJavaScript(`(() => {
    const rect = document.querySelector('#background').getBoundingClientRect();
    return { x: Math.round(rect.x + 20), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  next.contents.sendInputEvent({ type: "mouseDown", ...point, button: "middle", clickCount: 1 });
  next.contents.sendInputEvent({ type: "mouseUp", ...point, button: "middle", clickCount: 1 });
  await loadedTab(origin + "/garden/em1?note=background");
  assert.equal(state().activeId, next.tab.id, "middle-click leaves the current tab selected");
  assert.equal(visible(next.contents), true);
  assert.equal(BrowserWindow.getAllWindows().length, 1);

  await next.contents.executeJavaScript(`window.open('/garden/em1?note=script', '_blank'); true`, true);
  const scripted = await loadedTab(origin + "/garden/em1?note=script");
  await until(() => visible(scripted.contents) && !state().navigationPending, "script-opened link revealed");
  assert.equal(state().activeId, scripted.tab.id);
  assert.equal(BrowserWindow.getAllWindows().length, 1);

  // The same native link menu works on a chat reply and inside its reader
  // iframe. Choosing a background tab must leave the chat and its draft intact.
  let menu;
  const nativePopup = Menu.prototype.popup;
  Menu.prototype.popup = function(options) { menu = this; options.callback?.(); };
  const rightClick = async (contents, selector, iframe = false) => {
    menu = undefined;
    const point = await contents.executeJavaScript(`(() => {
      const frame = ${iframe ? "document.querySelector('#reader')" : "null"};
      const doc = frame ? frame.contentDocument : document;
      const r = doc.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      const offset = frame ? frame.getBoundingClientRect() : {x:0,y:0};
      return {x:Math.round(offset.x+r.x+20),y:Math.round(offset.y+r.y+r.height/2)};
    })()`);
    contents.sendInputEvent({ type: "mouseDown", ...point, button: "right", clickCount: 1 });
    contents.sendInputEvent({ type: "mouseUp", ...point, button: "right", clickCount: 1 });
    return until(() => menu, "native link menu");
  };
  const linkMenu = await rightClick(scripted.contents, "#next");
  assert.equal(linkMenu.getMenuItemById("open-link-tab").label, "Open Link in New Tab");
  assert.equal(linkMenu.getMenuItemById("open-link-window").label, "Open Link in New Window");
  const count = state().tabs.length;
  linkMenu.getMenuItemById("open-link-tab").click();
  await until(() => state().tabs.length === count + 1, "context tab opened");
  assert.equal(state().activeId, scripted.tab.id);
  const contextTab = state().tabs.find(t => t.url === origin + "/garden/em1?note=next" && t.id !== next.tab.id);
  await until(() => !state().tabs.find(t => t.id === contextTab.id).loading, "context tab loaded");
  await manager.tabs.handleCommand(scripted.contents, { type: "activate", id: contextTab.id });
  await until(() => !state().navigationPending, "context tab selected");
  await manager.tabs.handleCommand(scripted.contents, { type: "close", id: contextTab.id });
  assert.ok(state().tabs.some(t => t.id === baseId), "closing the linked tab preserves the original reader");

  await manager.tabs.handleCommand(base, { type: "activate", id: baseId });
  await until(() => state().activeId === baseId && !state().navigationPending, "return to reader");
  const frameMenu = await rightClick(base, "#next", true);
  frameMenu.getMenuItemById("open-link-window").click();
  const popup = await until(() => BrowserWindow.getAllWindows().find(candidate => candidate !== window), "new native window");
  await until(() => manager.page(popup).getURL() === origin + "/garden/em1?note=next" && !manager.page(popup).isLoading(), "window destination loaded");
  assert.equal(state().tabs.length, count, "new window must not create another tab in the source window");
  assert.equal(await base.executeJavaScript("document.querySelector('#draft').value"), "reader state kept");
  popup.destroy();

  // The React context menu explicitly requests a popup rather than a tab.
  await base.executeJavaScript(`window.open('/gardens/circuits?chat=42', '_blank', 'popup,noopener,noreferrer'); true`, true);
  const chatWindow = await until(() => BrowserWindow.getAllWindows().find(candidate => candidate !== window), "explicit chat window");
  await until(() => manager.page(chatWindow).getURL() === origin + "/gardens/circuits?chat=42" && !manager.page(chatWindow).isLoading(), "chat window destination loaded");
  assert.equal(state().tabs.length, count, "explicit window leaves source tabs intact");
  assert.equal(state().activeId, baseId, "explicit window leaves the source chat selected");
  chatWindow.destroy();
  Menu.prototype.popup = nativePopup;
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
  console.log("Reader link tab routing, loading, and background gesture checks passed");
}).catch(error => { console.error(error.stack); app.exit(1); });
