const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, ipcMain } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
// OS display scaling must not be confused with the page's CSS zoom.
app.commandLine.appendSwitch('force-device-scale-factor', '1.25');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Timed out: ' + label);
};
app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><style>
      body{margin:0;background:transparent}
      #host{position:fixed;bottom:0;right:0;box-sizing:border-box;width:min(var(--card-width,352px),var(--viewport-width,100vw));height:min(var(--card-height,232px),var(--viewport-height,100vh));padding:16px}
      #card{height:100%;background:green;border-radius:18px;animation:materialize 240ms both}
      @keyframes materialize{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    </style><div id="host"><div id="card">A fully visible notification</div></div><script>
      window.reports=0;
      const viewport=state=>{if(!state.notificationViewport)return;const s=document.documentElement.style;s.setProperty('--viewport-width',state.notificationViewport.width+'px');s.setProperty('--viewport-height',state.notificationViewport.height+'px')};
      breadboardDesktop.onTabsState(viewport);breadboardDesktop.getTabsState().then(viewport);
      const report=()=>{const box=document.getElementById('host').getBoundingClientRect();reports++;breadboardDesktop.resizeNotificationOverlay({width:box.width,height:box.height})};
      new ResizeObserver(report).observe(document.getElementById('host'));
      addEventListener('resize',report);report();
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => '', recoveryHtmlPath: () => '', theme: () => 'light', openWindow: () => {},
  });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.handleCommand(event.sender, command));
  const window = new BrowserWindow({ show: false, width: 1000, height: 750 });
  let nativeBounds;
  if (process.platform === 'win32') {
    const executable = path.join(dir, 'native-renderer-bounds.exe');
    execFileSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      ['/nologo', '/target:exe', '/out:' + executable, path.join(__dirname, 'native-renderer-bounds.cs')], { windowsHide: true });
    const handle = window.getNativeWindowHandle().readBigUInt64LE().toString();
    nativeBounds = () => JSON.parse(execFileSync(executable, [handle], { encoding: 'utf8', windowsHide: true }));
  }
  // Exercise foreground layout without taking the user's actual foreground.
  window.isFocused = () => true;
  manager.attach(window, true);
  window.setOpacity(0);
  window.showInactive();
  // Model an already presented tab. A null presentedId accidentally makes a
  // window-owned renderer's null selfId look active and hides this regression.
  const host = manager.hosts.get(window.id);
  host.presentedId = host.activeId;
  manager.setNotificationsVisible(true);
  manager.setNotificationOverlayUrl(origin + '/notification-overlay');
  const overlay = manager.hosts.get(window.id).notificationOverlay;
  await until(() => overlay.ready, 'first size report');
  await until(async () => await overlay.contents.executeJavaScript(
    'getComputedStyle(document.getElementById("card")).opacity === "1"'),
    'a window-owned notification finishes appearing instead of freezing into an invisible input blocker');
  assert.equal(await overlay.contents.executeJavaScript('document.documentElement.dataset.desktopTabActive'), 'true',
    'the notification overlay has no tab identity and must not inherit background-tab animation suspension');
  for (const zoom of [1, 1.25, 0.8, 1.5]) {
    overlay.contents.setZoomFactor(zoom);
    await overlay.contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const box = await overlay.contents.executeJavaScript('document.getElementById("host").getBoundingClientRect().toJSON()');
    // Explicitly await the same IPC used by ResizeObserver before reading Views.
    await overlay.contents.executeJavaScript(`breadboardDesktop.resizeNotificationOverlay({width:${box.width},height:${box.height}})`);
    const clip = overlay.view.getBounds();
    const renderer = { x: 0, y: 0, width: clip.width, height: clip.height };
    const actualZoom = overlay.contents.getZoomFactor();
    const rendered = {
      left: renderer.x + box.left * actualZoom,
      top: renderer.y + box.top * actualZoom,
      right: renderer.x + box.right * actualZoom,
      bottom: renderer.y + box.bottom * actualZoom,
    };
    const evidence = JSON.stringify({ zoom, clip, renderer, rendered });
    assert.ok(rendered.left >= -1 && rendered.top >= -1, 'notification is not clipped at its top/left: ' + evidence);
    assert.ok(rendered.right <= clip.width + 1 && rendered.bottom <= clip.height + 1, evidence);
    assert.ok(Math.abs(clip.width - box.width * actualZoom) <= 1, 'clip width matches painted CSS pixels: ' + evidence);
    assert.ok(Math.abs(clip.height - box.height * actualZoom) <= 1, 'clip height matches painted CSS pixels: ' + evidence);
    if (nativeBounds) {
      const covers = nativeBounds().filter(rect => rect.x > 1 && rect.y < 32 && rect.y + rect.height > 0 && rect.width > 2);
      assert.deepEqual(covers, [], 'transparent notification HWND must not cover the rightmost tabs or New tab button');
    }
  }
  // A small first card must not become the next response's viewport limit.
  await overlay.contents.executeJavaScript("document.documentElement.style.setProperty('--card-width','500px');document.documentElement.style.setProperty('--card-height','480px')");
  await until(() => overlay.width >= 400 && overlay.height >= 400, 'a larger response grows beyond the previous toast');
  const grown = overlay.view.getBounds();
  assert.ok(grown.width > 500 && grown.height > 500, 'the native input surface grows with the response');
  manager.resizeNotificationOverlay(overlay.contents, { width: 0, height: 0 });
  if (nativeBounds) {
    const [width, height] = window.getContentSize();
    await until(() => nativeBounds().every(rect => !(rect.x > 1 && rect.x + 2 < width && rect.y + rect.height > 1 && rect.y < height)),
      'dismissing the cards removes their native input surface from the page');
  }
  manager.setNotificationOverlayUrl(null);
  window.destroy();
  server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
