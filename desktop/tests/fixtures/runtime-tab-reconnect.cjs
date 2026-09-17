const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { app, webContents } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const { readTabSession } = require('../../dist/main/tab-session.js');
const dir = process.argv[2];
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw Error('Timed out: ' + label);
};
const serve = async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><head><title>Chat fixture</title></head><body>Healthy chat storage</body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
};
app.whenReady().then(async () => {
  const old = await serve();
  const next = await serve();
  const external = await serve();
  const scene = path.join(dir, 'recovery.html');
  fs.writeFileSync(scene, '<!doctype html><html><body>Reconnect fixture</body></html>');
  const allowed = { origins: new Set([old.origin]), localFiles: new Set([pathToFileURL(scene).toString()]) };
  const manager = new WindowManager({
    startupHtmlPath: scene, loadingHtmlPath: scene, recoveryHtmlPath: scene,
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    allowed, minimumStartupVisibleMs: 0, tabSessionConfigDir: dir,
  });
  manager.tabs.setNewTabUrl(old.origin + '/new-tab');
  manager.tabs.setBrowserUrl(old.origin + '/browser');
  await manager.showDashboard(old.origin + '/dashboard');
  const main = manager.window;
  main.setBounds({ x: -12000, y: -12000, width: 900, height: 700 });
  const command = value => manager.tabs.handleCommand(main.webContents, value);
  const healthyUrl = old.origin + '/gardens/health?chat=831#message';
  const failedUrl = old.origin + '/gardens/health?chat=843';
  await command({ type: 'open', url: healthyUrl, background: true });
  await command({ type: 'open', url: failedUrl, background: true });
  await command({ type: 'browser', url: external.origin + '/external' });
  await until(() => [healthyUrl, failedUrl].every(url => webContents.getAllWebContents().some(c => c.getURL() === url)), 'health tabs');
  const healthy = webContents.getAllWebContents().find(c => c.getURL() === healthyUrl);
  const failed = webContents.getAllWebContents().find(c => c.getURL() === failedUrl);
  await until(() => webContents.getAllWebContents().some(c => c.getURL() === external.origin + '/external'), 'external browser');
  const browser = webContents.getAllWebContents().find(c => c.getURL() === external.origin + '/external');
  const browserId = browser.id;
  // One workspace still shows its old document; the other is already retrying.
  old.server.closeAllConnections();
  await new Promise(resolve => old.server.close(resolve));
  void failed.loadURL(failedUrl).catch(() => {});
  await until(() => failed.getURL().startsWith(pathToFileURL(scene).toString()), 'failed tab recovery');
  allowed.origins.delete(old.origin);
  allowed.origins.add(next.origin);
  manager.tabs.setNewTabUrl(next.origin + '/new-tab');
  manager.tabs.setBrowserUrl(next.origin + '/browser');
  await manager.showStartupScreen();
  manager.markStartupContinued();
  await manager.showDashboard(next.origin + '/dashboard');
  await until(() => healthy.getURL() === next.origin + '/gardens/health?chat=831#message', 'live tab rebinding');
  await until(() => failed.getURL() === next.origin + '/gardens/health?chat=843', 'retry loop rebinding');
  assert.equal(browser.isDestroyed(), false);
  assert.equal(browser.id, browserId);
  assert.equal(browser.getURL(), external.origin + '/external');
  await until(() => webContents.getAllWebContents().some(c => c.getURL() === next.origin + '/browser'), 'browser toolbar rebinding');
  assert.equal(await healthy.executeJavaScript("fetch('/api/chat-sessions').then(r => r.status)"), 200);
  await until(() => readTabSession(dir).windows.some(w => w.tabs.some(t => t.kind === 'dashboard' && t.url === '/gardens/health?chat=831#message')), 'durable relative chat path');
  console.log('Recovered live chat, retrying chat, browser toolbar, and saved tab paths across port change.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
