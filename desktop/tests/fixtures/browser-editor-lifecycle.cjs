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
  for (const deadline = Date.now() + 6000; Date.now() < deadline;) {
    if (await probe()) return;
    await sleep(20);
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  let releaseHighlights;
  const entry = { id: 'saved', start: 0, end: 13, quote: 'Saved passage', color: 'blue' };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/text-highlights') {
      for await (const _ of req) { /* Drain the request. */ }
      releaseHighlights = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ entries: [entry] })); };
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Editor fixture</title><body>
      <article id="passage">Saved passage in a long conversation.</article>
      <div id="editor" contenteditable="true" role="textbox"><p></p></div>
      <button id="other">Move focus</button><input id="field" value="unchanged">
      <script>window.indexScans=0;const walker=document.createTreeWalker.bind(document);
        document.createTreeWalker=(...args)=>{window.indexScans++;return walker(...args)};</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, 'scene.html'); fs.writeFileSync(scene, '<!doctype html>Startup');
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), minimumStartupVisibleMs: 0,
  });
  for (const name of ['bookmarks', 'recent-searches']) ipcMain.handle('breadboard:get-browser-' + name, () => []);
  ipcMain.handle('breadboard:get-browser-downloads', () => ({ items: [], error: null }));
  const window = manager.createMainWindow(); window.setOpacity(0); window.showInactive();
  const tabs = manager.tabs;
  const host = tabs.hosts.get(window.id);
  const base = manager.page(window);
  await base.loadURL(origin + '/dashboard');
  await until(() => host.shellEnabled && !host.pending, 'persistent shell');
  tabs.setBrowserUrl(origin + '/browser');
  const command = value => tabs.handleCommand(base, value);
  command({ type: 'browser', url: origin + '/editor' });
  const tab = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => tab.browser.ready && !host.pending && releaseHighlights, 'website and delayed highlight read');
  const page = tab.browser.contents;
  const evaluate = script => page.mainFrame.executeJavaScript(script);
  await evaluate(`(() => {
    const editor=document.querySelector('#editor');editor.firstChild.textContent='draft';editor.focus();
    getSelection().collapse(editor.firstChild.firstChild,5);
  })()`);
  releaseHighlights();
  await until(() => tab.browser.highlights.hydrated, 'highlight hydration');
  assert.deepEqual(await evaluate(`({count:getSelection().rangeCount,offset:getSelection().anchorOffset,
    editor:document.activeElement.id,highlight:CSS.highlights.get('breadboard-web-blue')?.size})`),
  { count: 1, offset: 5, editor: 'editor', highlight: 1 }, 'late setup preserves the editor caret');
  await page.insertText(' continues');
  assert.equal(await evaluate(`document.querySelector('#editor').textContent`), 'draft continues');

  await evaluate(`window.indexScans=0;document.querySelector('#editor p').firstChild.data+=' with more text'`);
  await sleep(450);
  assert.equal(await evaluate('window.indexScans'), 0, 'typing does not rescan the conversation for saved highlights');
  await evaluate(`document.querySelector('#passage').firstChild.data+=' Updated answer.'`);
  await until(() => evaluate('window.indexScans > 0'), 'answer changes still relocate highlights');
  await evaluate(`getSelection().setBaseAndExtent(document.querySelector('#editor p').firstChild,0,
    document.querySelector('#editor p').firstChild,5);window.__breadboardHighlights.update([])`);
  assert.equal(await evaluate('getSelection().toString()'), 'draft', 'editor selections survive passive updates too');

  await evaluate(`document.querySelector('#other').focus()`);
  assert.equal(await tabs.canUnloadIdleTab(tab), false, 'a blurred rich-text draft prevents idle unloading');
  command({ type: 'activate', id: host.base.id });
  await until(() => !host.pending, 'leave website');
  const getMemory = process.getSystemMemoryInfo;
  process.getSystemMemoryInfo = () => ({ total: 32 * 1024 * 1024, free: 256 * 1024, swapTotal: 64 * 1024 * 1024, swapFree: 3000 * 1024 });
  tabs.memoryPressure = 'critical';
  await evaluate(`document.querySelector('#editor').textContent=''`);
  await tabs.unloadIdleTabs();
  assert.equal(page.isDestroyed(), false, 'recently used pages have a grace period under commit pressure');
  command({ type: 'activate', id: tab.id });
  await until(() => !host.pending, 'return without reloading');
  assert.equal(tab.browser.contents, page);

  command({ type: 'activate', id: host.base.id });
  await until(() => !host.pending, 'leave again');
  tab.backgroundSince = Date.now() - 120_000;
  const canUnload = tabs.canUnloadIdleTab.bind(tabs);
  let finishProbe;
  tabs.canUnloadIdleTab = candidate => candidate === tab ? new Promise(resolve => { finishProbe = resolve; }) : canUnload(candidate);
  const sweep = tabs.unloadIdleTabs();
  await until(() => finishProbe, 'idle probe in flight');
  command({ type: 'activate', id: tab.id });
  await until(() => !host.pending, 'visit during probe');
  command({ type: 'activate', id: host.base.id });
  await until(() => !host.pending, 'leave during probe');
  finishProbe(true); await sweep;
  assert.equal(page.isDestroyed(), false, 'a stale idle probe cannot discard a newly visited page');
  tabs.canUnloadIdleTab = canUnload;
  tab.backgroundSince = Date.now() - 120_000;
  await tabs.unloadIdleTabs();
  await until(() => page.isDestroyed(), 'old empty pages still unload when commit is short');
  process.getSystemMemoryInfo = getMemory;
  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
