const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { app, ipcMain, webContents } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const { isTabsCommand, IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const dir = process.argv[2];
app.setPath('userData', path.join(dir, 'user-data'));
const until = async (probe, label) => {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  let releaseMissing;
  let missingRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(fs.readFileSync(path.join(dir, 'app.js')));
      return;
    }
    const send = () => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Chat fixture</title><input id="draft"><div id="root"></div><script src="/app.js"></script>');
    };
    if (req.url === '/dashboard?terminalChat=missing' && missingRequests++ === 0) releaseMissing = send;
    else send();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const loading = path.join(dir, 'loading.html');
  fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).toString()]) },
    startupHtmlPath: loading, recoveryHtmlPath: loading, loadingHtmlPath: loading,
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), minimumStartupVisibleMs: 0,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) =>
    isTabsCommand(command) && manager.tabs.handleCommand(event.sender, command));
  const window = manager.createMainWindow();
  window.setOpacity(0);
  window.showInactive();
  const base = window.webContents;
  await base.loadURL(origin + '/dashboard?terminalChat=stale');
  const state = () => manager.tabs.stateFor(base);
  const command = value => manager.tabs.handleCommand(base, value);
  const baseId = state().activeId;
  const hydrated = contents => until(() => contents.executeJavaScript('typeof window.showNotice === "function"'), 'hydrated');
  await hydrated(base);
  const live = { surface: 'dashboard_terminal', chatId: 'live' };
  await base.executeJavaScript(`window.setChat(${JSON.stringify(live)}); document.querySelector('#draft').value = 'keep my draft'; true`);
  // A round trip through the same bridge lets the selection report reach main.
  await base.executeJavaScript('window.breadboardDesktop.getTabsState()');
  command({ type: 'open', url: origin + '/unrelated' });
  const unrelated = await until(() => webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/unrelated'), 'unrelated tab');
  await hydrated(unrelated);
  const unrelatedId = state().tabs.find(tab => tab.url === origin + '/unrelated').id;
  manager.tabs.setNotificationOverlayUrl(origin + '/notification-overlay');
  const overlay = await until(() => webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/notification-overlay'), 'overlay');
  await hydrated(overlay);
  const announced = [];
  manager.tabs.onVoiceNotification = notice => announced.push(notice);
  await overlay.executeJavaScript('window.shellNotices=[]; window.breadboardDesktop.onNotificationToast(notice=>window.shellNotices.push(notice)); window.breadboardDesktop.resizeNotificationOverlay({width:0,height:0})');
  manager.tabs.publishNotificationToast(base, { type: 'success', message: 'Native notification without an id' });
  const delivered = await until(() => overlay.executeJavaScript('window.shellNotices[0]'), 'native notification delivery');
  assert.match(delivered.id, /^toast:/);
  assert.equal(announced[0].id, delivered.id, 'voice and the UI receive one shared notification identity');
  const open = async (target, sender = overlay) => {
    await sender.executeJavaScript(`window.showNotice(${JSON.stringify(target)})`);
    await until(() => sender.executeJavaScript('Boolean(document.querySelector("button[title^=Open]"))'), 'Open button');
    await sender.executeJavaScript('document.querySelector("button[title^=Open]").click()');
    await sender.executeJavaScript('window.breadboardDesktop.getTabsState()');
  };

  await open(live);
  assert.equal(state().activeId, baseId, 'find the live chat even with a stale URL');
  assert.equal(state().tabs.length, 2);
  assert.equal(await base.executeJavaScript('document.querySelector("#draft").value'), 'keep my draft');

  command({ type: 'activate', id: unrelatedId });
  await open(live, unrelated);
  assert.equal(state().activeId, baseId, 'page-local Open also selects the existing tab');
  assert.equal(state().tabs.length, 2);

  // Switching chats makes the old URL ineligible for reuse.
  command({ type: 'activate', id: unrelatedId });
  await open({ surface: 'dashboard_terminal', chatId: 'stale' });
  assert.equal(state().tabs.length, 3);
  assert.notEqual(state().activeId, baseId);
  assert.equal(state().tabs.find(tab => tab.id === state().activeId).url, origin + '/dashboard?terminalChat=stale');

  const garden = { surface: 'garden_chat', gardenSlug: 'signals', chatId: '42', conversationId: 'canonical' };
  await base.executeJavaScript(`window.setChat(${JSON.stringify(garden)}); true`);
  await base.executeJavaScript('window.breadboardDesktop.getTabsState()');
  await open({ surface: 'dashboard_terminal', chatId: 'canonical' });
  assert.equal(state().activeId, baseId, 'hub notification reuses its Garden conversation');
  assert.equal(state().tabs.length, 3);
  await base.executeJavaScript('window.setLearn("signals"); true');
  await base.executeJavaScript('window.breadboardDesktop.getTabsState()');
  command({ type: 'activate', id: unrelatedId });
  await open({ surface: 'garden_learn', gardenSlug: 'signals', chatId: 'job_1' });
  assert.equal(state().activeId, baseId, 'Learn notices reuse the open panel');

  const missing = { surface: 'dashboard_terminal', chatId: 'missing' };
  await open(missing);
  await until(() => releaseMissing, 'new chat request');
  const missingId = state().activeId;
  assert.equal(state().tabs.length, 4);
  assert.equal(state().tabs.find(tab => tab.id === missingId).url, origin + '/dashboard?terminalChat=missing');
  await open(missing);
  assert.equal(state().tabs.length, 4, 'repeat clicks reuse the tab while it loads');
  assert.equal(state().activeId, missingId);
  assert.equal(missingRequests, 1);
  releaseMissing();
  await until(() => !state().tabs.find(tab => tab.id === missingId).loading, 'missing chat loaded');
  command({ type: 'close', id: missingId });
  await open(missing);
  assert.equal(state().tabs.length, 4, 'a closed chat opens again in a new tab');
  assert.notEqual(state().activeId, missingId);

  assert.equal(command({ type: 'notification-open', urls: ['https://example.com/dashboard?terminalChat=live'] }), false);
  window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
