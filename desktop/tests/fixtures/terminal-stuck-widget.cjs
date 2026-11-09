// A Terminal whose startup marker never reaches "ready" (one widget read hangs)
// must still come forward after REVEAL_MAX_WAIT_MS instead of retrying forever.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {app} = require('electron');
const {WindowManager} = require('../../dist/main/window-manager.js');
const {REVEAL_MAX_WAIT_MS} = require('../../dist/main/tab-manager.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/new-tab'
      ? '<!doctype html><html data-breadboard-startup="loading"><title>Terminal</title><body>Terminal'
      : '<!doctype html><title>Plan</title><body>Plan');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, 'scene.html'); fs.writeFileSync(scene, '<!doctype html>');
  const manager = new WindowManager({
    allowed: {origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href])},
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene, minimumStartupVisibleMs: 0,
    browserHistoryConfigDir: dir,
  });
  manager.tabs.setEnabled(true);
  const window = manager.createMainWindow(); window.setOpacity(0); window.showInactive();
  const base = manager.page(window), host = manager.tabs.hosts.get(window.id);
  await base.loadURL(origin + '/plan');
  manager.tabs.setNewTabUrl(origin + '/new-tab');
  const started = Date.now();
  if (!manager.tabs.handleCommand(base, {type: 'new'})) throw new Error('new tab refused');
  const terminal = host.tabs.find(t => t.contents !== base);
  for (const end = started + REVEAL_MAX_WAIT_MS + 8000; Date.now() < end;) {
    if (host.pending === null && host.presentedId === terminal.id) {
      console.log(`stuck-widget Terminal came forward after ${Date.now() - started} ms`);
      fs.writeFileSync(path.join(dir, 'passed.json'), '{"passed":true}');
      return app.exit(0);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Terminal never came forward (pending=${host.pending?.id}, presented=${host.presentedId})`);
}).catch(error => { console.error(error.stack); app.exit(1); });
