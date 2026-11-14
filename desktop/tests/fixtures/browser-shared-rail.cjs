const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
    if (await probe()) return;
    await sleep(20);
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Page</title><script>window.framesDrawn=0;
      function draw(){window.framesDrawn++;requestAnimationFrame(draw)}requestAnimationFrame(draw);</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, 'scene.html');
  fs.writeFileSync(scene, '<!doctype html><body>Startup</body>');
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), minimumStartupVisibleMs: 0,
  });
  for (const name of ['bookmarks', 'recent-searches']) ipcMain.handle('breadboard:get-browser-' + name, () => []);
  ipcMain.handle('breadboard:get-browser-downloads', () => ({ items: [], error: null }));
  const window = manager.createMainWindow();
  window.setOpacity(0); window.showInactive();
  const host = manager.tabs.hosts.get(window.id);
  const base = manager.page(window);
  await base.loadURL(origin + '/dashboard');
  await until(() => host.shellEnabled && !host.pending, 'persistent shell');
  manager.tabs.setBrowserUrl(origin + '/browser');
  const command = value => manager.tabs.handleCommand(base, value);
  const inWindow = tab => window.contentView.children.includes(tab.view);
  // A detached view keeps reporting "visible" under its frame lease, but gets
  // no animation frames. That is the blank rail beside a live website.
  const animates = async tab => {
    const before = await tab.contents.mainFrame.executeJavaScript('window.framesDrawn');
    await until(() => tab.contents.mainFrame.executeJavaScript(`window.framesDrawn > ${before} + 2`).catch(() => false), 'rail frames');
  };

  // A browser home tab first in the strip, then back to the dashboard: every
  // browser tab from here on shares that tab's rail/panels view.
  command({ type: 'browser' });
  const home = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending && home.loaded, 'browser home');
  command({ type: 'activate', id: host.base.id });
  await until(() => !host.pending && host.presentedId === host.base.id, 'dashboard selected');

  // A capture of the shared view starts for the background home tab; the
  // person opens a website before it finishes.
  const release = await manager.tabs.prepareBreadboardUseInput(home.contents);
  command({ type: 'browser', url: origin + '/site' });
  const site = host.tabs.find(tab => tab.id === host.activeId);
  assert.equal(site.view, home.view, 'browser tabs share one rail view');
  await until(() => site.browser.ready && !host.pending, 'website presented');
  release();
  assert.equal(inWindow(site), true, 'finishing a background capture keeps the selected tab\'s rail');
  await animates(site);

  // Whatever else takes the shared view out, the tab in front gets it back on
  // the next layout instead of staying blank until another tab is selected.
  window.contentView.removeChildView(site.view);
  site.attached = false;
  manager.tabs.layout(host);
  assert.equal(inWindow(site) && site.attached, true, 'the selected browser tab reclaims its rail');
  await animates(site);

  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
