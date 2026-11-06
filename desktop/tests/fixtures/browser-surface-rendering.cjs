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
  for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
    if (await probe()) return;
    await sleep(20);
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/held-image') return;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Rendered website</title>
      <style>body{margin:0;background:#43885a;min-height:2000px}canvas{display:block}</style>
      <input id="draft" value="unsaved"><canvas width="900" height="500"></canvas>
      <script>window.framesDrawn=0;const canvas=document.querySelector('canvas');
      function draw(){const ctx=canvas.getContext('2d');ctx.fillStyle='#a4cbb5';ctx.fillRect(0,0,900,500);
      window.framesDrawn++;requestAnimationFrame(draw)}requestAnimationFrame(draw);</script>
      ${req.url === '/slow' ? '<img src="/held-image">' : ''}`);
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

  // Exercise Chromium's hidden -> selected transition before the foreground
  // lease disables throttling. Electron 33 can otherwise report "visible"
  // while never delivering a frame to this newly attached native surface.
  const ensure = manager.tabs.ensureBrowserPage.bind(manager.tabs);
  manager.tabs.ensureBrowserPage = (...args) => {
    const existing = args[1].browser.contents;
    const page = ensure(...args);
    if (page && !existing) {
      page.view.setVisible(false);
      // A replacement render widget can become hidden after the view's first
      // selection. Reproduce that state before the document-ready handler.
      page.contents.prependListener('dom-ready', () => {
        const throttled = page.contents.getBackgroundThrottling();
        page.contents.setBackgroundThrottling(true);
        page.view.setVisible(false);
        page.contents.setBackgroundThrottling(throttled);
      });
    }
    return page;
  };
  const assertRendered = async (tab, label) => {
    const page = tab.browser.contents;
    await until(() => tab.browser.ready && !host.pending, label + ' presented');
    await until(() => page.mainFrame.executeJavaScript('window.framesDrawn >= 2'), label + ' animates');
    assert.equal(page.getBackgroundThrottling(), false, 'selected website keeps its frame lease');
    const pixels = await page.capturePage({x:40,y:100,width:1,height:1}, {stayHidden:true});
    assert.deepEqual([...pixels.toBitmap().subarray(0,3)], [181,203,164], label + ' has real canvas pixels');
    return page;
  };

  command({type:'browser',url:origin + '/slow'});
  const cold = host.tabs.find(tab => tab.id === host.activeId);
  const page = await assertRendered(cold, 'cold website with a stalled image');
  assert.equal(cold.loading, true, 'rendering does not wait for all network resources');
  await page.mainFrame.executeJavaScript("document.querySelector('#draft').value='kept draft';scrollTo(0,120)");
  command({type:'activate',id:host.base.id});
  await until(() => !host.pending, 'base selected');
  manager.tabs.setMemoryPressure('critical');
  command({type:'activate',id:cold.id});
  await assertRendered(cold, 'reattached website');
  assert.equal(await page.mainFrame.executeJavaScript("document.querySelector('#draft').value"), 'kept draft');
  assert.equal(await page.mainFrame.executeJavaScript('scrollY'), 120);

  assert.equal(manager.tabs.handleCommand(cold.contents, {type:'browser-navigate',input:origin + '/next-document'}), true);
  await assertRendered(cold, 'replacement document in the same native view');
  assert.equal(cold.browser.contents, page, 'document replacement retains the browser view');

  command({type:'browser'});
  const home = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending, 'browser home');
  assert.equal(manager.tabs.handleCommand(home.contents, {type:'browser-navigate',input:origin + '/from-home'}), true);
  await assertRendered(home, 'first navigation from browser home');

  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({passed:true}));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
