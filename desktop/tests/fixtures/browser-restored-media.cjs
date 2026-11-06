const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, webContents } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { readTabSession } = require('../../dist/main/tab-session.js');
const [dir, phase] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const video = fs.readFileSync(path.join(dir, 'video.webm'));
  const server = http.createServer((req, res) => {
    if (req.url === '/video.webm') {
      res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': video.length });
      return res.end(video);
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/watch' });
      return res.end();
    }
    res.setHeader('Content-Type', 'text/html');
    if (!req.url.startsWith('/watch')) return res.end('<!doctype html><title>Product page</title>');
    res.end(`<!doctype html><title>Video page</title><body>
      <video id="audible" src="/video.webm" autoplay loop preload="auto"></video>
      <video id="muted" src="/video.webm" autoplay muted loop preload="auto"></video>
      <video id="scripted" src="/video.webm" muted loop preload="auto"></video>
      <button id="play">Play</button>
      <script>
        window.attempts = [];
        window.attempt = () => scripted.play().then(() => attempts.push('playing'), error => attempts.push(error.name));
        attempt();
        setTimeout(attempt, 150);
        play.onclick = () => scripted.play();
        addEventListener('keydown', event => { if (event.code === 'Space') scripted.play(); });
      </script>
    </body>`);
  });
  const portFile = path.join(dir, 'port.json');
  const port = phase === 'save' ? 0 : JSON.parse(fs.readFileSync(portFile, 'utf8'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  fs.writeFileSync(portFile, JSON.stringify(server.address().port));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const scene = path.join(dir, 'scene.html');
  fs.writeFileSync(scene, '<!doctype html>');
  const preload = path.resolve(__dirname, '../../dist/preload/preload.js');
  const manager = new TabManager({ allowed: { origins: new Set([origin]) }, preloadPath: preload,
    tabSessionConfigDir: dir, loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => 'light', openWindow: () => {} });
  manager.setBrowserUrl(origin + '/browser');
  manager.setNewTabUrl(origin + '/new-tab');
  const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  await window.loadURL(origin + '/new-tab');
  const state = () => manager.stateFor(window.webContents);
  const command = action => manager.handleCommand(window.webContents, action);
  await manager.restoreSession(window, origin + '/dashboard', () => { throw new Error('Unexpected second window'); });

  if (phase === 'save') await command({ type: 'browser', url: origin + '/watch' });
  const page = await until(() => webContents.getAllWebContents().find(c => c.getURL() === origin + '/watch' && !c.isLoading()), 'loaded video tab');
  page.setBackgroundThrottling(false);
  await until(() => page.executeJavaScript('attempts.length >= 2'), 'immediate and delayed play attempts');
  const tab = state().tabs.find(tab => tab.url === origin + '/watch');
  assert.ok(tab?.browser);

  if (phase === 'save') {
    assert.equal(await page.executeJavaScript('attempts.at(-1)'), 'playing', 'fresh browser tabs retain normal playback');
    manager.freezeSession();
    assert.ok(readTabSession(dir).windows[0].tabs.some(tab => tab.kind === 'browser' && tab.url === origin + '/watch'));
  } else {
    assert.notEqual(state().activeId, tab.id, 'the restored player loads in the background');
    const assertPaused = async label => {
      assert.deepEqual(await page.executeJavaScript('attempts'), ['NotAllowedError', 'NotAllowedError'], label);
      assert.equal(await page.executeJavaScript('navigator.userActivation.hasBeenActive'), false, 'restoration and selection do not grant activation');
      assert.equal(await page.executeJavaScript('Array.from(document.querySelectorAll("video")).every(video => video.paused)'), true, label);
      assert.deepEqual(await page.executeJavaScript('Array.from(document.querySelectorAll("video"), video => ({ id: video.id, time: video.currentTime }))'), [
        { id: 'audible', time: 0 }, { id: 'muted', time: 0 }, { id: 'scripted', time: 0 },
      ], 'restoration does not advance playback');
    };
    await assertPaused('restored muted, audible and scripted players stay paused');
    await command({ type: 'activate', id: tab.id });
    await page.executeJavaScript('new Promise(resolve => setTimeout(resolve, 250))');
    await assertPaused('selecting the tab does not start playback');
    assert.equal(await page.executeJavaScript(`(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      try { await scripted.play(); return 'playing'; } catch (error) { return error.name; }
    })()`), 'NotAllowedError', 'synthetic clicks cannot unlock restored media');
    await page.loadURL(origin + '/redirect');
    await until(() => page.executeJavaScript('attempts.length >= 2'), 'reload and redirect attempts');
    await assertPaused('reloads and redirects remain blocked before interaction');

    page.focus();
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    page.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await until(() => page.executeJavaScript('!scripted.paused && scripted.currentTime > 0'), 'manual playback after keyboard interaction');
    assert.equal(await page.executeJavaScript('navigator.userActivation.hasBeenActive'), true);
    await command({ type: 'new' });
    assert.equal(await page.executeJavaScript('scripted.paused'), false, 'user-started playback continues when switching tabs');
    await command({ type: 'activate', id: tab.id });
    await page.loadURL(origin + '/watch?next');
    await until(() => page.executeJavaScript('attempts.length >= 2'), 'normal navigation after interaction');
    assert.equal(await page.executeJavaScript('attempts.at(-1)'), 'playing', 'the restore guard ends after real interaction');
    manager.freezeSession();
  }
  window.destroy();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
