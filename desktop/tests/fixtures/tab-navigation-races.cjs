const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, webContents } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const [dir, scenario] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await sleep(20);
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  let failing = true;
  let releaseProbe;
  let releaseCold;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    const send = () => res.end(`<!doctype html><title>${req.url}</title><body>${req.url}</body>`);
    if (req.url === '/failed' && failing) { req.socket.destroy(); return; }
    if (req.url === '/failed') { releaseProbe = send; return; }
    if (req.url === '/cold') { releaseCold = send; return; }
    send();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const scene = path.join(dir, 'recovery.html');
  fs.writeFileSync(scene, '<!doctype html><body>Reconnecting</body>');
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).toString()]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => 'light', openWindow: () => assert.fail('Unexpected window'),
  });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  manager.attach(window);
  const base = window.webContents;
  await base.loadURL(origin + '/base');
  manager.handleCommand(base, { type: 'open', url: origin + '/page' });
  const page = await until(() => webContents.getAllWebContents().find(c => c.getURL() === origin + '/page' && !c.isLoading()), 'page');
  const state = () => manager.stateFor(base);
  const pageId = state().activeId;

  if (scenario === 'recovery') {
    void page.loadURL(origin + '/failed').catch(() => {});
    await until(() => page.getURL().startsWith(pathToFileURL(scene).toString()), 'recovery scene');
    failing = false;
    await until(() => releaseProbe, 'recovery probe in flight');
    await page.loadURL(origin + '/newer');
    releaseProbe();
    await sleep(800);
    assert.equal(page.getURL(), origin + '/newer', 'an old recovery must not navigate over the new page');
    assert.equal(page.isLoading(), false, 'the obsolete URL must not even start loading');
    assert.equal(state().activeId, pageId);
    assert.equal(state().tabs.length, 2);
  } else if (scenario === 'subframe') {
    await page.executeJavaScript(`new Promise(resolve => {
      const frame = document.createElement('iframe'); frame.src = '/embedded'; frame.onload = resolve; document.body.append(frame);
    })`);
    const child = page.mainFrame.frames[0];
    await child.executeJavaScript("history.pushState({}, '', '/older-embedded-page')");
    await sleep(100);
    assert.equal(state().tabs.find(t => t.id === pageId).url, origin + '/page', 'iframe history is not the tab address');
  } else if (scenario === 'cold-timeout') {
    manager.handleCommand(page, { type: 'open', url: origin + '/cold' });
    await until(() => releaseCold, 'cold page request held');
    const host = manager.hosts.get(window.id);
    const cold = host.pending;
    assert.ok(cold, 'the destination is waiting behind the current page');
    await sleep(10_250);
    assert.equal(host.pending, cold, 'a paint timeout cannot reveal a document that has not arrived');
    assert.equal(cold.loaded, false);
    assert.ok(cold.view.getBounds().y < 0, 'the empty destination stays offscreen');
    assert.equal(page.isDestroyed(), false, 'the previous page and its controls remain available');
    releaseCold();
    await until(() => host.pending === null, 'the destination reveals after its document arrives');
    assert.equal(cold.contents.getURL(), origin + '/cold');
    assert.equal(cold.view.getBounds().x, 0);
  } else {
    manager.handleCommand(page, { type: 'open', url: origin + '/cold' });
    await until(() => releaseCold, 'new page still loading');
    manager.handleCommand(base, { type: 'close', id: pageId });
    assert.equal(page.isDestroyed(), false, 'closed outgoing page is retained until its replacement paints');
    const active = state().activeId;
    const count = state().tabs.length;
    assert.equal(manager.handleCommand(page, { type: 'open', url: origin + '/unwanted' }), true,
      'stale links are consumed so the renderer cannot fall back to a new window');
    manager.handleCommand(page, { type: 'activate', id: state().tabs[0].id });
    assert.equal(state().tabs.length, count, 'a closed page cannot open tabs from a late callback');
    assert.equal(state().activeId, active, 'a closed page cannot select a previous tab');
    releaseCold();
  }
  window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
