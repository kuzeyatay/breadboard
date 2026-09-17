const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { ANCHORED_TAB_NAVIGATION_MESSAGE } = require('../../dist/main/tab-navigation-policy.js');
app.setPath('userData', path.join(process.argv[2], 'profile'));
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (probe()) return; await sleep(20); }
  throw Error('Navigation did not settle');
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/garden/redirect') { res.writeHead(302, { location: '/gardens/demo' }); res.end(); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Test</title><body>Current screen</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const loading = path.resolve(__dirname, '../../dist/startup/loading.html');
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).toString()]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading,
    theme: () => 'light', openWindow: () => assert.fail('Unexpected new window'),
  });
  const notices = [];
  manager.publishNotificationToast = (_sender, notice) => { notices.push(notice); return true; };
  manager.setBrowserUrl(origin + '/browser');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  manager.attach(window);
  const page = window.webContents;
  const state = () => manager.stateFor(page);
  const command = value => manager.handleCommand(page, value);
  await page.loadURL(origin + '/gardens/demo');
  await page.loadURL(origin + '/garden/demo');
  const id = state().activeId;
  command({ type: 'anchor', id });
  assert.equal(command({ type: 'navigation-check', url: origin + '/gardens/demo' }), false);
  assert.equal(notices.at(-1).message, ANCHORED_TAB_NAVIGATION_MESSAGE);
  assert.equal(command({ type: 'navigation-check', url: origin + '/garden/demo?note=two' }), true);
  const historyIndex = page.navigationHistory.getActiveIndex();
  command({ type: 'back' });
  assert.equal(page.navigationHistory.getActiveIndex(), historyIndex);
  assert.equal(page.getURL(), origin + '/garden/demo');
  assert.equal(command({ type: 'browser', replaceCurrent: true }), false);
  assert.equal(state().tabs.length, 1);
  assert.equal(state().activeId, id);

  const blocked = notices.length;
  await page.executeJavaScript(`location.assign('/gardens/demo')`);
  await until(() => notices.length > blocked);
  assert.equal(page.getURL(), origin + '/garden/demo');
  const redirected = notices.length;
  await page.executeJavaScript(`location.assign('/garden/redirect')`);
  await until(() => notices.length > redirected);
  assert.equal(page.getURL(), origin + '/garden/demo');

  await page.executeJavaScript(`history.pushState({}, '', '/garden/demo?note=two')`);
  command({ type: 'back' });
  await until(() => page.getURL() === origin + '/garden/demo');
  command({ type: 'forward' });
  await until(() => page.getURL() === origin + '/garden/demo?note=two');

  command({ type: 'anchor', id });
  await page.loadURL(origin + '/gardens/demo');
  command({ type: 'back' });
  await until(() => page.getURL() === origin + '/garden/demo?note=two');
  command({ type: 'anchor', id });
  command({ type: 'forward' });
  assert.equal(page.getURL(), origin + '/garden/demo?note=two');
  assert.equal(notices.at(-1).message, ANCHORED_TAB_NAVIGATION_MESSAGE);
  assert.equal(command({ type: 'open', url: origin + '/gardens/demo', background: true }), true);
  assert.equal(state().tabs.length, 2);
  const other = state().tabs.find(tab => tab.id !== id);
  command({ type: 'activate', id: other.id });
  assert.equal(state().activeId, other.id);
  command({ type: 'activate', id });
  assert.equal(state().activeId, id);
  command({ type: 'anchor', id });
  assert.equal(command({ type: 'navigation-check', url: origin + '/gardens/demo' }), true);
  window.destroy();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
