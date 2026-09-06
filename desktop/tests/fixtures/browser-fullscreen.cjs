const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, webContents } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const playerHtml = `<!doctype html><title>Fullscreen player</title>
  <style>body{margin:0;background:#ddd;font:16px Arial}#player{width:640px;height:360px;background:#162c22}#player:fullscreen{width:100%;height:100%}video{width:100%;height:calc(100% - 40px)}button{height:36px}</style>
  <div id="player"><video muted autoplay controls></video><button id="enlarge">Enlarge video</button><button id="exit">Exit fullscreen</button></div>
  <script>
    const canvas = document.createElement('canvas');canvas.width=640;canvas.height=320;
    const context = canvas.getContext('2d');context.fillStyle='#246347';context.fillRect(0,0,640,320);
    document.querySelector('video').srcObject=canvas.captureStream(1);
    document.getElementById('enlarge').onclick=()=>document.getElementById('player').requestFullscreen().catch(error=>window.fullscreenError=error.message);
    document.getElementById('exit').onclick=()=>document.exitFullscreen();
  </script>`;

app.whenReady().then(async () => {
  const videos = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(playerHtml); });
  const videoOrigin = await listen(videos);
  const pages = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/embed' || req.url === '/blocked-embed') return res.end(`<!doctype html><title>Embedded video</title><iframe src="${videoOrigin}/" ${req.url === '/embed' ? 'allowfullscreen' : ''} style="width:700px;height:450px"></iframe>`);
    res.end('<!doctype html><title>Browser shell</title>');
  });
  const origin = await listen(pages);
  const loading = path.join(dir, 'loading.html');
  fs.writeFileSync(loading, '<!doctype html>');
  const preload = path.resolve(__dirname, '../../dist/preload/preload.js');
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: preload, loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading,
    theme: () => 'light', openWindow: () => {}, log: console.log,
  });
  manager.setBrowserUrl(origin + '/browser');
  const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: { preload, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  await window.loadURL(origin + '/dashboard');
  window.showInactive();
  assert.equal(await manager.handleCommand(window.webContents, { type: 'browser', url: videoOrigin }), true);
  let page;
  await until(() => {
    page = webContents.getAllWebContents().find(contents => contents.getURL() === videoOrigin + '/');
    return page && !page.isLoading();
  }, 'video page');
  const pageView = () => window.contentView.children.find(view => view.webContents?.id === page.id);
  await until(pageView, 'video view attached');
  const originalBounds = window.getBounds();
  const normalPageBounds = pageView().getBounds();
  assert.ok(normalPageBounds.y > 0, 'toolbar has space before fullscreen');
  const enter = async (frame = page) => {
    await frame.executeJavaScript("document.getElementById('enlarge').click(); true", true);
    await until(() => window.isFullScreen(), 'enlarge enters native fullscreen');
    await until(() => {
      const rect = pageView()?.getBounds();
      const [width, height] = window.getContentSize();
      return rect?.x === 0 && rect.y === 0 && rect.width === width && rect.height === height;
    }, 'video covers toolbar and fills the display');
    await until(() => frame.executeJavaScript("document.fullscreenElement?.id === 'player'"), 'player enters HTML fullscreen');
  };
  const escape = async () => {
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    page.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await until(() => page.executeJavaScript('!document.fullscreenElement'), 'Escape exits HTML fullscreen');
  };
  const restored = async () => {
    await until(() => !window.isFullScreen() && pageView()?.getBounds().y === normalPageBounds.y, 'browser layout restored');
    assert.deepEqual(window.getBounds(), originalBounds);
  };
  await enter();
  await escape();
  await restored();
  await enter();
  await page.executeJavaScript("document.getElementById('exit').click(); true", true);
  await restored();
  window.setFullScreen(true);
  await until(() => window.isFullScreen(), 'F11 fullscreen before video');
  await enter();
  await escape();
  assert.equal(window.isFullScreen(), true, 'leaving video preserves existing window fullscreen');
  await until(() => pageView()?.getBounds().y === normalPageBounds.y, 'toolbar returns within F11 fullscreen');
  window.setFullScreen(false);
  await restored();
  await enter();
  page.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
  page.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
  await restored();
  await until(() => page.executeJavaScript('!document.fullscreenElement'), 'F11 also clears HTML fullscreen');

  // An embedded player uses the same API in a cross-origin iframe.
  await page.loadURL(origin + '/embed');
  await until(() => page.mainFrame.frames.some(frame => frame.url === videoOrigin + '/'), 'cross-origin player');
  const frame = page.mainFrame.frames.find(frame => frame.url === videoOrigin + '/');
  await enter(frame);
  await escape();
  await restored();

  await page.loadURL(origin + '/blocked-embed');
  await until(() => page.mainFrame.frames.some(frame => frame.url === videoOrigin + '/'), 'restricted embedded player');
  const blockedFrame = page.mainFrame.frames.find(frame => frame.url === videoOrigin + '/');
  await blockedFrame.executeJavaScript("document.getElementById('enlarge').click(); true", true);
  await until(() => blockedFrame.executeJavaScript('Boolean(window.fullscreenError)'), 'iframe policy still denies fullscreen without allowfullscreen');
  assert.equal(window.isFullScreen(), false);

  await page.loadURL(videoOrigin);
  await enter();
  const shell = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/browser');
  const activeId = manager.stateFor(shell).activeId;
  assert.equal(manager.handleCommand(shell, { type: 'activate', id: 1 }), true);
  await until(() => !window.isFullScreen(), 'switching tab exits video fullscreen');
  manager.handleCommand(window.webContents, { type: 'activate', id: activeId });
  await until(pageView, 'video tab restored');
  // Chromium applies fullscreen DOM changes at a rendering step; detached
  // WebContentsViews resume those steps when the tab is attached again.
  await until(() => page.executeJavaScript('!document.fullscreenElement'), 'returning video leaves HTML fullscreen');
  await enter();
  await page.loadURL(videoOrigin + '/another');
  await restored();

  // Fullscreen also covers the terminal drawer, then restores its exact space.
  manager.handleCommand(shell, { type: 'browser-terminal', open: true, width: 320 });
  const drawerBounds = pageView().getBounds();
  assert.ok(drawerBounds.x > 0);
  await enter();
  await escape();
  await restored();
  assert.deepEqual(pageView().getBounds(), drawerBounds);
  manager.handleCommand(shell, { type: 'browser-terminal', open: false });

  window.maximize();
  await until(() => window.isMaximized(), 'maximized window');
  await enter();
  await escape();
  await until(() => !window.isFullScreen() && window.isMaximized(), 'maximized state restored');
  await enter();
  manager.handleCommand(shell, { type: 'close', id: activeId });
  await until(() => !window.isFullScreen(), 'closing the fullscreen tab restores the window');
  console.log('Verified fullscreen, Escape, player exit, F11, embedded video and permissions, tab switching, navigation, terminal and maximized restoration, and close.');
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
