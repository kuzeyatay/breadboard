const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const dir = process.argv.at(-1);
const kind = process.env.BB_TEST_SURFACE_KIND;
app.setPath('userData', path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  for (const deadline = Date.now() + 7000; Date.now() < deadline;) {
    if (await probe()) return;
    await sleep(20);
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const requests = new Map();
  const server = http.createServer((req, res) => {
    requests.set(req.url, (requests.get(req.url) ?? 0) + 1);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Document canvas</title>
      <style>body{margin:0;background:#43885a;min-height:2000px}canvas{display:block}</style>
      <input id="draft" value="unsaved"><canvas width="900" height="600"></canvas>
      <script>
        window.framesDrawn = 0;
        const canvas = document.querySelector('canvas');
        function draw() {
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#a4cbb5'; ctx.fillRect(0, 0, 900, 600);
          window.framesDrawn++; requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
      </script>`);
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
  ipcMain.handle('breadboard:get-browser-downloads', () => ({items:[],error:null}));
  const window = manager.createMainWindow();
  window.setOpacity(0); window.showInactive();
  const host = manager.tabs.hosts.get(window.id);
  const base = manager.page(window);
  await base.loadURL(origin + '/dashboard');
  await until(() => host.shellEnabled && !host.pending, 'persistent shell');
  manager.tabs.setBrowserUrl(origin + '/browser');
  const command = value => manager.tabs.handleCommand(base, value);

  command(kind === 'browser' ? {type:'browser', url:origin + '/website'}
    : {type:'open', url:origin + '/gardens/test/pdf/document'});
  const tab = host.tabs.find(tab => tab.id === host.activeId);
  const page = kind === 'browser' ? tab.browser.contents : tab.contents;
  const view = kind === 'browser' ? tab.browser.view : tab.view;
  const setVisible = view.setVisible.bind(view);
  let nativeVisible = true;
  view.setVisible = visible => { nativeVisible = visible; setVisible(visible); };
  let hiddenCount = 0;
  const hideSurface = () => {
    page.setBackgroundThrottling(true);
    view.setVisible(false);
    page.setBackgroundThrottling(false);
  };
  // Run AFTER the manager's DOM-ready visibility refresh. Native widget
  // visibility can change later than DOM readiness; a retry must actually
  // wake that widget, rather than probing the same hidden renderer forever.
  const hideAfterDomReady = () => page.once('dom-ready', () => { hideSurface(); hiddenCount++; });
  hideAfterDomReady();
  const assertRecovered = async label => {
    await until(() => !host.pending && (kind !== 'browser' || tab.browser.ready) && nativeVisible, label);
    await until(() => page.mainFrame.executeJavaScript('window.framesDrawn >= 2'), 'canvas animates after recovery');
    assert.equal(host.activeId, tab.id, 'recovery never selects a different tab');
    assert.equal(await page.mainFrame.executeJavaScript("document.querySelector('#draft').value"), 'kept draft');
    assert.equal(await page.mainFrame.executeJavaScript('scrollY'), 120);
    assert.equal(requests.get(new URL(tab.url).pathname), 1, 'recovery does not reload the document');
    assert.equal(page.getBackgroundThrottling(), false, 'selected page retains its frame lease');
    const pixels = await page.capturePage({x:40,y:100,width:1,height:1}, {stayHidden:true});
    assert.deepEqual([...pixels.toBitmap().subarray(0,3)], [181,203,164], 'the recovered document canvas has pixels');
  };
  await until(() => hiddenCount === 1, 'late hidden widget');
  await page.mainFrame.executeJavaScript("document.querySelector('#draft').value='kept draft';scrollTo(0,120)");
  await assertRecovered('automatic native surface recovery');

  // A navigation in the already selected tab has no selection change to
  // repair its new widget. It needs the same completion path as a cold tab.
  hideAfterDomReady();
  await page.loadURL(origin + '/replacement-document');
  await until(() => hiddenCount === 2, 'replacement widget hidden');
  await page.mainFrame.executeJavaScript("document.querySelector('#draft').value='kept draft';scrollTo(0,120)");
  await assertRecovered('replacement document recovers without reselecting');

  // A failed probe must renew native visibility before its next attempt,
  // without navigating or repeatedly refreshing a healthy selected view.
  command({type:'activate', id:host.base.id});
  await until(() => !host.pending, 'base selected');
  manager.tabs.setMemoryPressure('critical');
  const firstPaint = require('../../dist/main/first-paint.js');
  const waitForRevealFrame = firstPaint.waitForRevealFrame;
  let rejected = false;
  firstPaint.waitForRevealFrame = (contents, ...args) => {
    if (contents === page && !rejected) { rejected = true; hideSurface(); return Promise.resolve(false); }
    if (contents === page) assert.equal(nativeVisible, true, 'failed probe wakes native view before retry');
    return waitForRevealFrame(contents, ...args);
  };
  command({type:'activate', id:tab.id});
  await until(() => rejected, 'first frame misses its deadline');
  await assertRecovered('failed frame recovers without another click');
  firstPaint.waitForRevealFrame = waitForRevealFrame;

  let refreshes = 0;
  view.setVisible = visible => { refreshes++; nativeVisible = visible; setVisible(visible); };
  manager.tabs.layout(host);
  manager.tabs.layout(host);
  await sleep(400);
  assert.equal(refreshes, 0, 'healthy selected tabs do not continuously reset native visibility');

  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({passed:true}));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
