const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, webContents } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/frame')) {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Embedded content</title>');
    }
    if (req.url === '/video.webm') {
      const video = fs.readFileSync(path.join(dir, 'video.webm'));
      res.setHeader('Content-Type', 'video/webm');
      res.setHeader('Accept-Ranges', 'bytes');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : video.length - 1;
      if (range) {
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${video.length}`);
      }
      res.setHeader('Content-Length', end - start + 1);
      return res.end(video.subarray(start, end + 1));
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>Video A</title><body>
      <video id="player" src="/video.webm" muted preload="auto"></video>
      <script>
        window.automaticPopupBlocked = window.open('/automatic-popup') === null;
        let currentVideo = 'A';
        const positions = new Map();
        const changeVideo = id => {
          positions.set(currentVideo, player.currentTime);
          currentVideo = id;
          player.currentTime = positions.get(id) || 0;
        };
        window.go = (id, titleFirst = false) => {
          changeVideo(id);
          if (titleFirst) document.title = 'Video ' + id;
          history.pushState({video: id}, '', '/watch?v=' + id);
          if (!titleFirst) document.title = 'Video ' + id;
        };
        addEventListener('popstate', () => {
          const id = new URL(location.href).searchParams.get('v');
          changeVideo(id);
          document.title = 'Video ' + id;
        });
      </script></body>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const scene = path.join(dir, 'scene.html');
  fs.writeFileSync(scene, '<!doctype html>');
  const preload = path.resolve(__dirname, '../../dist/preload/preload.js');
  const manager = new TabManager({ allowed: { origins: new Set([origin]) }, preloadPath: preload,
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene, theme: () => 'light', openWindow: () => {} });
  manager.setBrowserUrl(origin + '/browser');
  manager.setNewTabUrl(origin + '/new-tab');
  const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  await window.loadURL(origin + '/dashboard');
  const state = () => manager.stateFor(window.webContents);
  const command = action => manager.handleCommand(window.webContents, action);
  await command({type: 'browser', url: origin + '/watch?v=A'});
  const page = await until(() => webContents.getAllWebContents().find(c => c.getURL() === origin + '/watch?v=A' && !c.isLoading()), 'video page');
  await until(() => page.executeJavaScript("Boolean(document.getElementById('breadboard-selection-action'))"), 'page setup');
  const activation = await page.executeJavaScript('({active: navigator.userActivation.isActive, ever: navigator.userActivation.hasBeenActive})');
  const automaticPopupBlocked = await page.executeJavaScript('automaticPopupBlocked');
  const videoTabId = state().activeId;
  await until(() => page.executeJavaScript('player.readyState >= 2'), 'video loaded');
  await page.executeJavaScript('player.currentTime = 1.25');
  await until(() => page.executeJavaScript('!player.seeking && player.currentTime > 1.2'), 'video seek');
  await command({type: 'new'});
  await command({type: 'activate', id: videoTabId});
  assert.equal(page.isDestroyed(), false, 'switching tabs retains the video renderer');
  assert.ok(Math.abs(await page.executeJavaScript('player.currentTime') - 1.25) < .1, 'tab switching retains the paused video position');
  await command({type: 'close', id: state().tabs.find(t => t.url === origin + '/new-tab').id});
  await page.executeJavaScript("go('B', true)");
  await until(() => state().tabs.some(t => t.url === origin + '/watch?v=B'), 'SPA B');
  await page.executeJavaScript("go('C')");
  await until(() => state().tabs.some(t => t.url === origin + '/watch?v=C'), 'SPA C');
  await command({type: 'back'});
  await until(() => page.getURL() === origin + '/watch?v=B', 'back to B');
  await command({type: 'back'});
  await until(() => page.getURL() === origin + '/watch?v=A', 'back to A');
  await until(() => page.executeJavaScript('!player.seeking && player.currentTime > 1.2'), 'Back restores video A position');
  console.log(JSON.stringify({activation, history: manager.browserHistory.snapshot(), tabs: state().tabs.length}));
  assert.deepEqual(activation, {active: false, ever: false}, 'passive browser setup must not fabricate a user gesture');
  assert.equal(automaticPopupBlocked, true, 'on-load scripts cannot open an unsolicited tab');
  assert.equal(await page.executeJavaScript("window.open('/timer-popup') === null"), true, 'SPA setup must not authorize a later script popup');
  await page.executeJavaScript(`(() => {
    const frame = document.createElement('iframe'); frame.name = '_video-info'; frame.src = '/frame'; document.body.append(frame);
  })()`);
  await until(() => page.mainFrame.frames.some(frame => frame.url === origin + '/frame'), 'named iframe');
  assert.equal(await page.executeJavaScript("window.open('/frame-updated', '_video-info') !== null"), true, 'existing named frames remain navigable without creating a tab');
  await until(() => page.mainFrame.frames.some(frame => frame.url === origin + '/frame-updated'), 'named iframe navigation');
  for (const entry of manager.browserHistory.snapshot().items) {
    assert.equal(entry.title, 'Video ' + new URL(entry.url).searchParams.get('v'), 'video titles stay paired with their URLs');
  }
  assert.equal(state().tabs.length, 2, 'same-tab video navigation does not create tabs');
  window.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
