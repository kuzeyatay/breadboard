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
      ? `<!doctype html><title>${req.url}</title><body style="background:#abcdef"><h1>${req.url} live content</h1><p id="selection">Chosen words</p><div style="height:3000px">Scrollable page</div><p>Below viewport</p></body>`
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
  window.show(); window.focus(); await until(() => window.isFocused());
  await manager.handleCommand(chrome, { type: 'browser-terminal', open: true });
  await page.loadURL(origin + '/page-two');
  const terminalAccess = await manager.browserTerminalAccess(chrome);
  await assert.rejects(readBrowserTerminal(terminalAccess, 'screenshot', undefined, 'app'), /only access its linked/);
  await manager.handleCommand(chrome, { type: 'browser', url: origin + '/page-other' });
  await until(() => webContents.getAllWebContents().some(wc => wc.getURL() === origin + '/page-other' && !wc.isLoading()));
  window.show();
  await until(() => manager.voiceContextTargets(window)?.page.getURL() === origin + '/page-other');
  // Exercise voice against the same real tab manager, preload, transport and
  // native image path. Voice follows the user's view instead of the old grant.
  const { VoiceCompanion } = require(path.resolve(__dirname, '../../dist/main/voice-companion.js'));
  const companion = new VoiceCompanion({ dashboardUrl: () => origin, allowed: { origins: new Set([origin]) },
    contextTargets: host => manager.voiceContextTargets(host) });
  await companion.start();
  const voice = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL() === origin + '/voice');
  assert.equal(await voice.webContents.executeJavaScript('voiceCompanion.getScreenContextAccess()'), null);
  window.show(); window.focus(); await until(() => window.isFocused());
  await companion.launch(); await until(() => voice.isFocused());
  const voiceAccess = await voice.webContents.executeJavaScript('voiceCompanion.getScreenContextAccess()');
  assert.ok(voiceAccess.token);
  assert.deepEqual(await voice.webContents.executeJavaScript('voiceCompanion.getScreenContextAccess()'), voiceAccess);
  const current = await readBrowserTerminal(voiceAccess);
  assert.equal(current.source, 'voice');
  assert.match(current.url, /page-other$/);
  assert.match(current.app.text, /Terminal shell/);
  assert.ok(!current.text.includes('Below viewport'), 'off-screen text is not described as the current view');
  assert.match(await browserTerminalPrompt(voiceAccess), /voice assistant/);
  const currentPage = webContents.getAllWebContents().find(wc => wc.getURL() === origin + '/page-other');
  await currentPage.executeJavaScript("const range = document.createRange(); range.selectNodeContents(document.querySelector('#selection')); getSelection().removeAllRanges(); getSelection().addRange(range)");
  assert.equal((await readBrowserTerminal(voiceAccess)).selection, 'Chosen words');
  const shot = await readBrowserTerminal(voiceAccess, 'screenshot');
  const pageImage = nativeImage.createFromDataURL(shot.screenshot.dataUrl);
  assert.equal(pageImage.isEmpty(), false);
  const bitmap = pageImage.toBitmap(), size = pageImage.getSize();
  const center = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4;
  for (const [channel, expected] of [239, 205, 171].entries()) assert.ok(Math.abs(bitmap[center + channel] - expected) < 8, 'voice receives the blue page pixels');
  assert.match(shot.text, /page-other live content/);
  const appShot = await readBrowserTerminal(voiceAccess, 'screenshot', undefined, 'app');
  assert.equal(nativeImage.createFromDataURL(appShot.screenshot.dataUrl).isEmpty(), false);
  assert.equal(appShot.surface, 'app');
  assert.match(appShot.text, /Terminal shell/);
  assert.equal(voice.isFocused(), true, 'screenshots do not steal voice focus');
  // Switch back to the first browser tab, then to a regular app page.
  const firstTab = manager.breadboardUseTargets().find(target => target.contents === chrome);
  await manager.handleCommand(chrome, { type: 'activate', id: firstTab.tabId });
  await until(() => manager.voiceContextTargets(window)?.page.getURL() === origin + '/page-two');
  assert.match((await readBrowserTerminal(voiceAccess)).url, /page-two$/);
  const dashboardTab = manager.breadboardUseTargets().find(target => target.contents.getURL() === origin + '/dashboard');
  await manager.handleCommand(chrome, { type: 'activate', id: dashboardTab.tabId });
  await until(() => manager.voiceContextTargets(window)?.page.getURL() === origin + '/dashboard');
  const dashboardContext = await readBrowserTerminal(voiceAccess, 'screenshot');
  assert.match(dashboardContext.url, /dashboard$/);
  assert.equal(dashboardContext.app, undefined);
  assert.equal(nativeImage.createFromDataURL(dashboardContext.screenshot.dataUrl).isEmpty(), false);
  const secondWindow = new BrowserWindow({ show: false, width: 900, height: 650,
    webPreferences: { preload: path.resolve(__dirname, '../../dist/preload/preload.js'), contextIsolation: true, sandbox: true } });
  manager.attach(secondWindow); await secondWindow.loadURL(origin + '/second-window');
  secondWindow.show(); secondWindow.focus(); await until(() => secondWindow.isFocused());
  assert.match((await readBrowserTerminal(voiceAccess)).url, /second-window$/);
  voice.focus(); await until(() => voice.isFocused());
  assert.match((await readBrowserTerminal(voiceAccess)).url, /second-window$/, 'focusing voice retains the last viewed app window');
  window.focus(); await until(() => window.isFocused());
  assert.match((await readBrowserTerminal(voiceAccess)).url, /dashboard$/);
  secondWindow.destroy();
  window.hide(); await assert.rejects(readBrowserTerminal(voiceAccess), /no longer open/); window.show();
  // An unrelated renderer with the same preload never gets a capture grant.
  const outsider = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true,
    preload: path.resolve(__dirname, '../../dist/preload/voice-preload.js') } });
  await outsider.loadURL(origin + '/voice');
  assert.equal(await outsider.webContents.executeJavaScript('voiceCompanion.getScreenContextAccess()'), null);
  await voice.webContents.executeJavaScript('voiceCompanion.close()');
  await assert.rejects(readBrowserTerminal(voiceAccess), /expired/);
  window.focus(); await until(() => window.isFocused());
  await companion.launch();
  const reopened = await voice.webContents.executeJavaScript('voiceCompanion.getScreenContextAccess()');
  assert.notEqual(reopened.token, voiceAccess.token);
  await assert.rejects(readBrowserTerminal(voiceAccess), /expired/);
  companion.stop();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await new Promise(resolve => server.close(resolve));
  console.log('Voice: live page and Terminal context, JPEG, tab switching, isolation and revocation passed.');
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
