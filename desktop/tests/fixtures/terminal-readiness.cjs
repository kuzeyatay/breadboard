const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { app, ipcMain } = require('electron');
const { WindowManager } = require('../../dist-tests/src/main/window-manager.js');
const { IPC_CHANNELS } = require('../../dist-tests/src/shared/ipc-contract.js');
const directory = process.argv.at(-1);
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  for (let end = Date.now() + 8_000; Date.now() < end;) {
    if (await probe()) return;
    await sleep(25);
  }
  throw new Error('Timed out: ' + label);
};
app.whenReady().then(async () => {
  let imageResponse;
  let optionalIconRequested = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/optional-icon') { optionalIconRequested = true; return; }
    if (req.url === '/image') { imageResponse = res; return; }
    res.setHeader('content-type', 'text/html');
    res.end(req.url.startsWith('/new-tab')
      ? '<!doctype html><html data-breadboard-startup="loading"><title>Terminal</title><body><input id="search"><img src="/image"><img data-startup-optional src="/optional-icon"></body></html>'
      : '<!doctype html><title>Working page</title><body><input id="draft" value="unsaved"><button id="work">Working page</button></body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(directory, 'scene.html');
  fs.writeFileSync(scene, '<!doctype html><body>Fixture</body>');
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href]) },
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
    preloadPath: path.resolve(__dirname, '../../dist-tests/src/preload/preload.js'), minimumStartupVisibleMs: 0,
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.tabs.stateFor(event.sender));
  for (const name of ['getBrowserBookmarks', 'getBrowserRecentSearches']) ipcMain.handle(IPC_CHANNELS[name], () => []);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => ({ items: [], error: null }));
  ipcMain.handle(IPC_CHANNELS.getBrowserHistory, () => ({ items: [], error: null }));
  const window = manager.createMainWindow();
  window.setOpacity(0); window.setIgnoreMouseEvents(true); window.setSkipTaskbar(true); window.showInactive();
  const base = manager.page(window);
  await base.loadURL(origin + '/working');
  const host = manager.tabs.hosts.get(window.id);
  await until(() => host.shellEnabled, 'persistent shell');
  manager.tabs.setBrowserUrl(origin + '/browser');
  manager.tabs.handleCommand(base, { type: 'browser', url: origin + '/web-page' });
  const browser = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending && host.presentedId === browser.id, 'outgoing website');
  await until(() => host.shell.contents.executeJavaScript('!!document.querySelector(".browser-toolbar")'), 'browser toolbar');
  const browserBounds = browser.browser.view.getBounds();
  const toolbarHeight = host.shell.view.getBounds().height;
  manager.tabs.setNewTabUrl(origin + '/new-tab');
  manager.tabs.handleCommand(base, { type: 'new' });
  const terminal = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => terminal.loaded && imageResponse, 'Terminal DOM');
  await sleep(500);
  assert.equal(host.pending, terminal, 'DOM-ready is not widget readiness');
  assert.equal(host.pendingAtFront, false, 'placeholder page stays parked');
  assert.notEqual(host.presentedId, terminal.id);
  assert.equal(host.shell.view.getBounds().height, toolbarHeight, 'the outgoing toolbar must not collapse into a green gap');
  assert.equal(manager.tabs.stateFor(host.shell.contents).selfId, browser.id, 'toolbar still describes the visible website');
  assert.equal(manager.tabs.stateFor(browser.contents).visibleId, browser.id, 'the shared browser keeps its side rail visible');
  assert.deepEqual(browser.browser.view.getBounds(), browserBounds, 'the outgoing website keeps its viewport');
  assert.equal(await host.shell.contents.executeJavaScript('!!document.querySelector(".browser-toolbar")'), true);
  assert.equal(await base.mainFrame.executeJavaScript('document.querySelector("#draft").value'), 'unsaved');
  await terminal.contents.mainFrame.executeJavaScript('document.documentElement.dataset.breadboardStartup="ready"');
  await sleep(350);
  assert.equal(host.pendingAtFront, false, 'initial images also finish before reveal');
  imageResponse.writeHead(200, { 'content-type': 'image/png' });
  imageResponse.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  await until(() => !host.pending && host.presentedId === terminal.id, 'ready Terminal revealed');
  assert.equal(terminal.terminalReady, true);
  assert.equal(optionalIconRequested, true);
  assert.equal(await terminal.contents.mainFrame.executeJavaScript('document.querySelector("[data-startup-optional]").complete'), false, 'a hung remote icon must not hold the ready page hostage');
  assert.equal(terminal.view.getBounds().x, 0);
  assert.equal(host.shell.view.getBounds().height, 32, 'toolbar collapses only when Terminal covers the website');
  assert.equal(manager.tabs.stateFor(browser.contents).visibleId, terminal.id);
  await until(() => host.shell.contents.executeJavaScript('!document.querySelector(".browser-toolbar")'), 'outgoing toolbar removed after handoff');

  // A later refresh must not gate a resident page again.
  manager.tabs.handleCommand(terminal.contents, { type: 'activate', id: host.base.id });
  await terminal.contents.mainFrame.executeJavaScript('document.documentElement.dataset.breadboardStartup="loading"');
  manager.tabs.handleCommand(base, { type: 'activate', id: terminal.id });
  await until(() => !host.pending && host.presentedId === terminal.id, 'resident Terminal opens immediately');

  // Completion of an abandoned request cannot steal selection back.
  manager.tabs.handleCommand(terminal.contents, { type: 'new' });
  const abandoned = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => abandoned.loaded, 'second Terminal DOM');
  manager.tabs.handleCommand(terminal.contents, { type: 'activate', id: terminal.id });
  await abandoned.contents.mainFrame.executeJavaScript('document.documentElement.dataset.breadboardStartup="ready"');
  await sleep(600);
  assert.equal(host.activeId, terminal.id);
  assert.equal(host.presentedId, terminal.id);

  if (process.argv.includes('--startup-only')) {
    window.destroy(); server.closeAllConnections(); server.close();
    fs.writeFileSync(path.join(directory, 'passed.json'), JSON.stringify({ passed: true, checks: ['hydration', 'required image', 'hung optional icon', 'resident switch', 'cancelled selection'] }));
    return;
  }

  // Retained toolbar actions belong to the visible website. They can cancel a
  // pending Terminal, while an obsolete command cannot navigate a later tab.
  manager.tabs.handleCommand(terminal.contents, { type: 'activate', id: browser.id });
  await until(() => !host.pending && host.presentedId === browser.id, 'website restored');
  manager.tabs.handleCommand(base, { type: 'new' });
  const pendingTerminal = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => pendingTerminal.loaded, 'pending Terminal for toolbar interaction');
  const revision = host.presentationRevision;
  const navigation = {
    command: { type: 'browser-navigate', input: origin + '/toolbar-navigation' },
    targetId: browser.id, generation: browser.generation, revision,
  };
  assert.equal(await manager.tabs.shellCommand(host, { ...navigation, revision: revision - 1 }), false);
  assert.equal(host.activeId, pendingTerminal.id, 'obsolete toolbar actions do not cancel selection');
  assert.equal(await manager.tabs.shellCommand(host, {
    ...navigation, command: { type: 'browser-address-suggestions', open: false },
  }), false, 'retained toolbar cleanup does not target Terminal');
  assert.equal(host.activeId, pendingTerminal.id);
  assert.equal(await manager.tabs.shellCommand(host, navigation), true);
  assert.equal(host.activeId, browser.id, 'a deliberate toolbar action returns to its visible website');
  await until(() => browser.url === origin + '/toolbar-navigation' && !host.pending, 'toolbar navigation completed');
  await pendingTerminal.contents.mainFrame.executeJavaScript('document.documentElement.dataset.breadboardStartup="ready"');
  await sleep(350);
  assert.equal(host.activeId, browser.id, 'late Terminal readiness cannot reclaim selection');
  assert.equal(host.shell.view.getBounds().height, toolbarHeight);
  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(directory, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
