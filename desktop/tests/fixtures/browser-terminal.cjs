const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, webContents, nativeImage } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async probe => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await probe()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Browser fixture did not become ready.');
};
app.whenReady().then(async () => {
  // Exercise the actual dashboard transport and prompt builder against Electron.
  const { readBrowserTerminal, browserTerminalPrompt } = require(path.join(dir, 'transport.cjs'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(req.url.startsWith('/page')
      ? `<!doctype html><title>${req.url}</title><body style="background:#abcdef"><h1>${req.url} live content</h1><p id="selection">Chosen words</p><div style="height:3000px">Scrollable page</div></body>`
      : '<!doctype html><title>Trusted shell</title><body>Terminal shell</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html>');
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => 'light', openWindow: () => {},
  });
  manager.setBrowserUrl(origin + '/browser');
  manager.setNewTabUrl(origin + '/new-tab');
  ipcMain.handle(IPC_CHANNELS.getBrowserTerminalAccess, event => event.senderFrame === event.sender.mainFrame ? manager.browserTerminalAccess(event.sender) : null);
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { preload: path.resolve(__dirname, '../../dist/preload/preload.js'), contextIsolation: true, sandbox: true } });
  manager.attach(window);
  await window.loadURL(origin + '/dashboard');
  assert.equal(await manager.browserTerminalAccess(window.webContents), null);
  await manager.handleCommand(window.webContents, { type: 'browser', url: origin + '/page-one' });
  let chrome, page;
  await until(() => {
    chrome = webContents.getAllWebContents().find(wc => wc.getURL() === origin + '/browser');
    page = webContents.getAllWebContents().find(wc => wc.getURL() === origin + '/page-one');
    return chrome && page && !chrome.isLoading() && !page.isLoading();
  });
  window.showInactive();
  await manager.handleCommand(chrome, { type: 'browser-terminal', open: true });
  await until(async () => !(await page.capturePage()).isEmpty());
  const access = await chrome.executeJavaScript('window.breadboardDesktop.getBrowserTerminalAccess()');
  assert.ok(access.token);
  assert.equal(await page.executeJavaScript('typeof window.breadboardDesktop'), 'undefined');
  assert.equal(await manager.browserTerminalAccess(page), null);
  await page.executeJavaScript("const range = document.createRange(); range.selectNodeContents(document.querySelector('#selection')); getSelection().removeAllRanges(); getSelection().addRange(range)");
  const read = await readBrowserTerminal(access);
  assert.match(read.text, /page-one live content/);
  assert.equal(read.selection, 'Chosen words');
  const capture = await readBrowserTerminal(access, 'screenshot');
  const image = nativeImage.createFromDataURL(capture.screenshot.dataUrl);
  assert.equal(image.isEmpty(), false);
  assert.ok(capture.screenshot.width > 100 && capture.screenshot.height > 100);
  const bitmap = image.toBitmap();
  const center = (Math.floor(image.getSize().height / 2) * image.getSize().width + Math.floor(image.getSize().width / 2)) * 4;
  // BGRA pixels must be the external page's blue background, not the shell.
  for (const [channel, expected] of [239, 205, 171].entries()) assert.ok(Math.abs(bitmap[center + channel] - expected) < 8);
  assert.match(await browserTerminalPrompt(access), /page-one live content/);
  const scrolled = await readBrowserTerminal(access, 'scroll', 'down');
  assert.ok(scrolled.scrollY > 0);
  await page.loadURL(origin + '/page-two');
  assert.match((await readBrowserTerminal(access)).text, /page-two live content/);
  // Other pages never become the connection's target, even after activation.
  page.backgroundThrottling = true;
  await manager.handleCommand(chrome, { type: 'browser', url: origin + '/page-other' });
  assert.match((await readBrowserTerminal(access)).text, /page-two live content/);
  // The grant keeps targeting the original view after it has been detached.
  // Capturing it must not temporarily reveal it or steal focus from this tab.
  await until(async () => await page.executeJavaScript('document.visibilityState') === 'hidden');
  await page.executeJavaScript(`window.captureVisibilityChanges = [];
    document.addEventListener('visibilitychange', () => captureVisibilityChanges.push(document.visibilityState));`);
  const visibilityBefore = await page.executeJavaScript('document.visibilityState');
  let captureFocusEvents = 0;
  const focusedDuringCapture = () => { captureFocusEvents++; };
  page.on('focus', focusedDuringCapture);
  try {
    const background = await readBrowserTerminal(access, 'screenshot');
    assert.match(background.url, /page-two$/);
  } catch (error) {
    // A detached view is allowed to have no pixels; it must stay detached.
    assert.match(error.message, /screenshot is empty|surface not available/);
  }
  page.removeListener('focus', focusedDuringCapture);
  assert.equal(captureFocusEvents, 0);
  assert.equal(await page.executeJavaScript('document.visibilityState'), visibilityBefore);
  assert.deepEqual(await page.executeJavaScript('captureVisibilityChanges'), []);
  const forbidden = await fetch(`http://127.0.0.1:${access.port}/browser-terminal`, { method: 'POST', headers: { Authorization: `Bearer ${access.token}`, Origin: origin }, body: '{"action":"read"}' });
  assert.equal(forbidden.status, 403);
  await assert.rejects(readBrowserTerminal({ ...access, token: '0'.repeat(64) }), /expired/);
  await manager.handleCommand(chrome, { type: 'browser-terminal', open: false });
  await assert.rejects(readBrowserTerminal(access), /no longer open/);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await new Promise(resolve => server.close(resolve));
  console.log('Browser Terminal: live read, selection, JPEG, scroll, navigation, isolation and revocation passed.');
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
