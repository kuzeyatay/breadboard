const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, ipcMain, webContents, session } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const { BROWSER_SESSION_PARTITION } = require('../../dist/main/tab-manager.js');
const { IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const dir = process.argv[2];
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, '../../../dashboard');
  const requireDashboard = createRequire(path.join(dashboard, 'package.json'));
  const script = requireDashboard('esbuild').buildSync({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { useDesktopTabs } from './src/app/components/use-desktop-tabs';
      import { useBrowserRecentSearches } from './src/app/browser/use-browser-recent-searches';
      function App() {
        const state = useDesktopTabs();
        const browser = state?.tabs.find(tab => tab.id === state.selfId)?.browser;
        const searches = useBrowserRecentSearches('fixture', browser?.address, browser?.private === true);
        window.searches = searches;
        return <button onClick={() => searches.remember('private typed secret')}>Remember search</button>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    `, resolveDir: dashboard, loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/app.js' ? script : '<!doctype html><title>Browser</title><div id="root"></div><script src="/app.js"></script>');
  });
  const external = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Private fixture page</title><body>Browser isolation test</body>');
  });
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const origin = await listen(server), web = await listen(external);
  const loading = path.join(dir, 'loading.html');
  fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  const windows = new WindowManager({
    startupHtmlPath: loading, recoveryHtmlPath: loading, loadingHtmlPath: loading,
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    browserHistoryConfigDir: dir, browserVisitedLinksConfigDir: dir, tabSessionConfigDir: dir,
  });
  const manager = windows.tabs;
  manager.setBrowserUrl(origin + '/browser');
  manager.setNewTabUrl(origin + '/new-tab');
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.handleCommand(event.sender, command));
  let writes = 0;
  ipcMain.handle(IPC_CHANNELS.getBrowserRecentSearches, () => []);
  ipcMain.handle(IPC_CHANNELS.setBrowserRecentSearches, () => { writes++; return true; });
  const window = windows.openPopupWindow(origin + '/browser');
  await until(() => window.webContents.getURL() === origin + '/browser' && !window.webContents.isLoading(), 'normal shell');
  await manager.restoreSession(window, origin + '/dashboard', () => { throw new Error('No windows to restore'); });
  await manager.handleCommand(window.webContents, { type: 'browser', replaceCurrent: true, url: web + '/normal' });
  const active = sender => {
    const state = manager.stateFor(sender);
    return state.tabs.find(tab => tab.id === state.activeId);
  };
  const readyChrome = async owner => {
    let chrome;
    await until(() => {
      chrome = webContents.getAllWebContents().find(contents => manager.windowFor(contents) === owner &&
        manager.stateFor(contents).selfId === manager.stateFor(contents).activeId && contents.getURL() === origin + '/browser');
      return chrome && !chrome.isLoading();
    }, 'trusted browser chrome');
    return chrome;
  };
  const normalChrome = await readyChrome(window);
  await until(() => manager.browserHistory.snapshot().items.some(item => item.url === web + '/normal'), 'normal history saved');
  const normalSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  await normalSession.cookies.set({ url: web, name: 'normal', value: 'regular-profile' });
  let menu;
  Menu.prototype.popup = function(options) { menu = this; options.callback?.(); };
  const choose = async (chrome, id) => {
    menu = null;
    assert.equal(await manager.handleCommand(chrome, { type: 'browser-menu', x: 100, y: 60, profileLabel: 'Fixture' }), true);
    const item = menu.getMenuItemById(id);
    assert.ok(item?.enabled, id);
    item.click(item, manager.windowFor(chrome), {});
    await new Promise(resolve => setImmediate(resolve));
  };
  await choose(normalChrome, 'new-private-tab');
  let privateChrome = await readyChrome(window);
  assert.equal(active(privateChrome).browser.private, true);
  assert.equal(await manager.handleCommand(privateChrome, { type: 'anchor', id: active(privateChrome).id }), false);
  assert.equal(manager.isPrivateBrowser(privateChrome), true);
  await until(() => privateChrome.executeJavaScript('Boolean(window.searches?.ready)'), 'private search hook ready');
  await new Promise(resolve => setTimeout(resolve, 100));
  const beforeWrites = writes;
  await privateChrome.executeJavaScript("document.querySelector('button').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(writes, beforeWrites, 'private toolbar searches never write to desktop history');
  assert.ok(!(await privateChrome.executeJavaScript('JSON.stringify(localStorage)')).includes('private typed secret'));
  await manager.handleCommand(privateChrome, { type: 'browser-navigate', input: web + '/private-secret' });
  const findPage = async url => {
    let page;
    await until(() => {
      page = webContents.getAllWebContents().find(contents => contents.getURL() === url);
      return page && !page.isLoading();
    }, url).catch(error => { console.error(webContents.getAllWebContents().map(contents => ({id: contents.id, url: contents.getURL(), loading: contents.isLoading()}))); throw error; });
    return page;
  };
  const page = await findPage(web + '/private-secret');
  const privateSession = page.session;
  assert.equal(privateSession.isPersistent(), false);
  assert.notEqual(privateSession, normalSession);
  assert.equal((await privateSession.cookies.get({ url: web, name: 'normal' })).length, 0);
  await page.executeJavaScript("document.cookie = 'secret=private'; localStorage.setItem('secret', 'private')");
  assert.equal((await normalSession.cookies.get({ url: web, name: 'secret' })).length, 0);
  assert.equal(await page.executeJavaScript('typeof window.breadboardDesktop'), 'undefined');
  assert.equal(await page.executeJavaScript('Notification.permission'), 'denied');
  assert.equal(await page.executeJavaScript('Notification.requestPermission()'), 'denied');
  await page.executeJavaScript(`window.open(${JSON.stringify(web + '/private-popup')}, '_blank'); void 0`, true);
  const popup = await findPage(web + '/private-popup');
  assert.equal(popup.session, privateSession, 'popup inherits private storage');
  assert.equal(manager.isPrivateBrowser(popup), true);
  assert.equal(await popup.executeJavaScript("localStorage.getItem('secret')"), 'private');
  assert.ok(!manager.browserHistory.snapshot().items.some(item => item.url.includes('private-')));
  // Menu commands must come from the active trusted tab.
  await manager.handleCommand(privateChrome, { type: 'activate', id: manager.stateFor(privateChrome).selfId });
  await choose(privateChrome, 'new-private-window');
  const privateWindow = BrowserWindow.getAllWindows().find(candidate => candidate !== window);
  assert.ok(privateWindow, 'private window uses the real WindowManager');
  await until(() => privateWindow.webContents.getURL() === origin + '/browser' && !privateWindow.webContents.isLoading(), 'private window shell');
  // BrowserClient performs this same replacement on its first render.
  assert.equal(await manager.handleCommand(privateWindow.webContents, { type: 'browser', replaceCurrent: true }), true);
  const privateWindowChrome = await readyChrome(privateWindow);
  assert.equal(active(privateWindowChrome).browser.private, true);
  assert.equal(await manager.handleCommand(privateWindowChrome, { type: 'new' }), true);
  assert.equal(active(privateWindowChrome).browser.private, true, 'Ctrl+T remains private in a private window');
  manager.freezeSession();
  const saved = fs.readFileSync(path.join(dir, 'tab-session.json'), 'utf8');
  assert.ok(!saved.includes('private-secret') && !saved.includes('private-popup'), 'session restore excludes private URLs');
  assert.equal(JSON.parse(saved).windows.length, 1, 'private window is never saved');
  privateWindow.destroy();
  for (const tab of manager.stateFor(normalChrome).tabs.filter(tab => tab.browser?.private)) {
    await manager.handleCommand(normalChrome, { type: 'close', id: tab.id });
  }
  await until(async () => (await privateSession.cookies.get({ url: web })).length === 0, 'last private tab clears cookies');
  assert.equal(await manager.handleCommand(normalChrome, { type: 'reopen' }), false, 'private tabs cannot be reopened');
  await choose(normalChrome, 'new-private-tab');
  privateChrome = await readyChrome(window);
  await manager.handleCommand(privateChrome, { type: 'browser-navigate', input: web + '/new-session' });
  const fresh = await findPage(web + '/new-session');
  assert.notEqual(fresh.session, privateSession);
  assert.equal(await fresh.executeJavaScript("localStorage.getItem('secret')"), null);
  assert.equal((await normalSession.cookies.get({ url: web, name: 'normal' }))[0].value, 'regular-profile');
  for (const candidate of BrowserWindow.getAllWindows()) candidate.destroy();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
