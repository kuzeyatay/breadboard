const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
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
      #host{position:fixed;bottom:0;right:0;box-sizing:border-box;width:min(352px,100vw);height:min(232px,100vh);padding:16px}
      #card{height:100%;background:green;border-radius:18px}
    </style><div id="host"><div id="card">A fully visible notification</div></div><script>
      window.reports=0;
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
  manager.attach(window, true);
  window.setOpacity(0);
  window.showInactive();
  manager.setNotificationsVisible(true);
  manager.setNotificationOverlayUrl(origin + '/notification-overlay');
  const overlay = manager.hosts.get(window.id).notificationOverlay;
  await until(() => overlay.ready, 'first size report');
  for (const zoom of [1, 1.25, 0.8, 1.5]) {
    overlay.contents.setZoomFactor(zoom);
    await overlay.contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const box = await overlay.contents.executeJavaScript('document.getElementById("host").getBoundingClientRect().toJSON()');
    // Explicitly await the same IPC used by ResizeObserver before reading Views.
    await overlay.contents.executeJavaScript(`breadboardDesktop.resizeNotificationOverlay({width:${box.width},height:${box.height}})`);
    const clip = overlay.view.getBounds();
    const renderer = overlay.rendererView.getBounds();
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
  }
  manager.setNotificationOverlayUrl(null);
  window.destroy();
  server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
