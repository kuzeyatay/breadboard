const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, session, webContents } = require("electron");
const { TabManager, BROWSER_SESSION_PARTITION } = require("../../dist/main/tab-manager.js");
const { installGlobalSecurity } = require("../../dist/main/security.js");
const { IPC_CHANNELS } = require("../../dist/shared/ipc-contract.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};
const listen = async server => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

app.whenReady().then(async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ url: req.url, method: req.method, body: Buffer.concat(chunks).toString() });
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><title>${req.url}</title><body>Popup fixture</body>`);
    });
  });
  const origin = await listen(server);
  const providerServer = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Identity provider</title><body>Sign in</body>");
  });
  const provider = await listen(providerServer);
  const allowed = { origins: new Set([origin]) };
  installGlobalSecurity(allowed);
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>fixture</body>");
  const manager = new TabManager({
    allowed, preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => "light", openWindow: () => assert.fail("unexpected native popup"),
  });
  manager.setEnabled(true);
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: {
    preload: path.resolve(__dirname, "../../dist/preload/preload.js"),
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.handleCommand(event.sender, command));
  await window.loadURL(origin + "/dashboard");
  const state = () => manager.stateFor(window.webContents);
  const command = command => manager.handleCommand(window.webContents, command);
  const pageAt = url => until(() => webContents.getAllWebContents().find(contents =>
    contents.getURL() === url && !contents.isLoading()), url);
  await command({ type: "browser", url: origin + "/login" });
  const opener = await pageAt(origin + "/login");
  const openerTabId = state().activeId;
  await opener.executeJavaScript("window.messages = []; addEventListener('message', e => messages.push({data:e.data, origin:e.origin}));");
  const result = await opener.executeJavaScript(`(() => {
    window.loginPopup = window.open(${JSON.stringify(provider + "/auth")}, 'identity-login', 'popup,width=500,height=600');
    const second = window.open(${JSON.stringify(provider + "/auth")}, 'identity-login', 'popup,width=500,height=600');
    return { blocked: loginPopup === null, reused: loginPopup !== null && second === loginPopup };
  })()`, true);
  const popup = await pageAt(provider + "/auth");
  console.log(JSON.stringify({ ...result, tabs: state().tabs.length, opener: await popup.executeJavaScript("window.opener !== null") }));
  assert.equal(result.blocked, false, "login must receive the popup Window reference");
  assert.equal(result.reused, true, "repeated login opens must reuse the named window");
  assert.equal(state().tabs.length, 3, "one dashboard, one login page, one provider tab");
  assert.equal(BrowserWindow.getAllWindows().length, 1, "no unmanaged native popup");
  assert.equal(popup.session, session.fromPartition(BROWSER_SESSION_PARTITION));
  assert.equal(await popup.executeJavaScript("typeof breadboardDesktop + ':' + typeof require"), "undefined:undefined");
  const prefs = popup.getLastWebPreferences();
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.preload, undefined);
  await popup.executeJavaScript(`window.opener.postMessage('signed-in', ${JSON.stringify(origin)}); true;`);
  await until(async () => (await opener.executeJavaScript("messages"))[0]?.data === "signed-in", "cross-origin login message");
  const popupTabId = state().activeId;
  await popup.executeJavaScript("setTimeout(() => window.close(), 0); true;");
  await until(() => state().tabs.length === 2 && popup.isDestroyed(), "provider self-close removes its tab and view");
  assert.equal(state().activeId, openerTabId);
  assert.equal(state().tabs.some(tab => tab.id === popupTabId), false);
  await until(() => opener.executeJavaScript("loginPopup.closed"), "opener sees closed popup");

  await opener.executeJavaScript(`window.loginPopup = window.open(${JSON.stringify(provider + "/manual")}, 'identity-login'); true;`, true);
  const manual = await pageAt(provider + "/manual");
  const manualId = state().activeId;
  await command({ type: "browser", url: provider + "/ordinary-tab" });
  const ordinary = await pageAt(provider + "/ordinary-tab");
  assert.notEqual(ordinary.id, manual.id, "a later tab must not adopt the popup renderer");
  assert.equal(manual.getURL(), provider + "/manual");
  assert.equal(opener.getURL(), origin + "/login");
  await command({ type: "close", id: state().activeId });
  await until(() => ordinary.isDestroyed(), "ordinary tab cleanup");
  await command({ type: "activate", id: manualId });
  await manual.executeJavaScript("onbeforeunload = e => { e.preventDefault(); e.returnValue = ''; }; true;", true);
  assert.equal(await command({ type: "close", id: state().activeId }), true);
  await until(() => manual.isDestroyed() && state().tabs.length === 2, "close button disposes login page even with beforeunload");

  const blankOpened = await opener.executeJavaScript("window.loginPopup = window.open('', 'blank-login'); loginPopup !== null;", true);
  assert.equal(blankOpened, true, "blank auth windows can open before their redirect is known");
  await opener.executeJavaScript(`loginPopup.location = ${JSON.stringify(provider + "/from-blank")}; true;`);
  const fromBlank = await pageAt(provider + "/from-blank");
  await command({ type: "close", id: state().activeId });
  await until(() => fromBlank.isDestroyed(), "blank popup cleanup");

  await opener.executeJavaScript(`(() => {
    const form = document.createElement('form'); form.method = 'POST'; form.action = '/post-login'; form.target = '_blank';
    const input = document.createElement('input'); input.name = 'token'; input.value = 'fixture'; form.append(input); document.body.append(form); form.submit();
  })()`, true);
  const posted = await pageAt(origin + "/post-login");
  assert.deepEqual(requests.filter(request => request.url === "/post-login"), [
    { url: "/post-login", method: "POST", body: "token=fixture" },
  ], "popup form sends its POST once without a duplicate GET");
  await command({ type: "close", id: state().activeId });
  await until(() => posted.isDestroyed(), "POST popup cleanup");
  const beforeUnsafe = state().tabs.length;
  assert.equal(await opener.executeJavaScript("window.open('file:///C:/Windows/win.ini') === null", true), true);
  assert.equal(state().tabs.length, beforeUnsafe, "unsafe URLs remain blocked");
  await opener.executeJavaScript(`(() => {
    const link = document.createElement('a'); link.href = ${JSON.stringify(provider + "/link")};
    link.target = '_blank'; link.rel = 'noopener'; document.body.append(link); link.click();
  })()`, true);
  const linked = await pageAt(provider + "/link");
  assert.equal(await linked.executeJavaScript("window.opener === null"), true, "noopener links stay isolated");
  const lastId = state().activeId;
  const lastChrome = webContents.getAllWebContents().find(contents =>
    contents.getURL() === origin + "/browser" && manager.stateFor(contents)?.selfId === lastId);
  assert.ok(lastChrome);
  for (const tab of state().tabs) {
    if (tab.id !== lastId) await command({ type: "close", id: tab.id });
  }
  await until(() => opener.isDestroyed(), "popup outlives its opener");
  assert.equal(linked.isDestroyed(), false);
  await linked.executeJavaScript("setTimeout(() => window.close(), 0); true;");
  await until(() => window.isDestroyed() && linked.isDestroyed(), "last popup closes its window");
  await until(() => lastChrome.isDestroyed(), "last popup also disposes its trusted shell");
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => providerServer.close(resolve));
  console.log("Popup lifecycle checks passed");
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
