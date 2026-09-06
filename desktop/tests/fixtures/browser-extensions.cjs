const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session, webContents } = require('electron');
const { TabManager, BROWSER_SESSION_PARTITION } = require('../../dist/main/tab-manager.js');
const { browserWebStoreInstallBootstrapScript, readBrowserExtensionPaths } = require('../../dist/main/browser-extensions.js');
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const id = fs.readFileSync(path.join(dir, 'extension-id.txt'), 'utf8');
  const listing = `https://chromewebstore.google.com/detail/fixture/${id}`;
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  const html = `<!doctype html><meta charset="utf-8"><title>Store fixture</title>
    <style>body {font-family:Arial;margin:0} main {margin:94px auto;max-width:1072px}
    h1 {font-size:30px;margin-top:56px} .info {background:#d2e3fc;padding:20px;border-radius:8px}
    #chrome {position:absolute;top:208px;right:max(16px,calc((100vw - 1072px)/2));width:142px;height:40px;border-radius:20px}
    </style><main><div class="info">Uzantıları ve temaları yüklemek için Chrome'a geçiş yapın</div>
    <h1>Picture-in-Picture Extension (by Google)</h1><p>Google　 •　 Featured　 •　 4,000,000 users</p></main>
    <button id="chrome" disabled>Add to Chrome</button>
    <script>const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=attach.call(this,options);if(this.id==='breadboard-web-store-install')window.installRoot=root;return root;};</script>`;
  browserSession.protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }));
  let attempts = 0;
  let redirects = 0;
  session.defaultSession.protocol.handle('https', request => {
    if (new URL(request.url).hostname === 'clients2.google.com') {
      attempts += 1;
      if (attempts === 1) return new Response('unavailable', { status: 503 });
      return new Response(null, { status: 302, headers: { location: 'https://clients2.googleusercontent.com/fixture.crx' } });
    }
    redirects += 1;
    return new Response(fs.readFileSync(path.join(dir, 'package.crx')), { headers: { 'content-type': 'application/x-chrome-extension' } });
  });
  const shell = path.join(dir, 'shell.html');
  fs.writeFileSync(shell, '<!doctype html><title>Browser shell</title>');
  const shellUrl = pathToFileURL(shell).href;
  const manager = new TabManager({
    allowed: { origins: new Set(), localFiles: new Set([shellUrl]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => shell, recoveryHtmlPath: () => shell, theme: () => 'light',
    openWindow: () => {}, browserExtensionsConfigDir: dir, log: console.log,
  });
  manager.setBrowserUrl(shellUrl);
  const window = new BrowserWindow({ show: false, width: 1617, height: 808, webPreferences: { contextIsolation: true, sandbox: true } });
  manager.attach(window);
  await window.loadURL(shellUrl);
  assert.equal(await manager.handleCommand(window.webContents, { type: 'browser', url: listing }), true);
  let page;
  await until(() => {
    page = webContents.getAllWebContents().find(contents => contents.getURL() === listing);
    return page && !page.isLoading();
  }, 'store listing');
  page.debugger.attach('1.3');
  const viewport = width => page.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 808, deviceScaleFactor: 1, mobile: false });
  await viewport(1617);
  const buttonState = () => page.executeJavaScript(`(() => {
    const button = window.installRoot?.querySelector('button');
    if (!button) return null;
    const range = document.createRange(); range.selectNodeContents(button);
    const label = range.getBoundingClientRect(), rect = button.getBoundingClientRect();
    return { text:button.textContent, disabled:button.disabled, height:rect.height, width:rect.width,
      label:label.toJSON(), rect:rect.toJSON(),
      lines:range.getClientRects().length, fits:label.left >= rect.left && label.right <= rect.right && label.bottom <= rect.bottom,
      error:window.installRoot.querySelector('[role=alert]')?.textContent };
  })()`);
  await until(async () => (await buttonState())?.text === 'Add to Breadboard', 'available button');
  const click = () => page.executeJavaScript("window.installRoot.querySelector('button').click()", true);
  await click();
  await until(async () => (await buttonState())?.text === 'Try again', 'failed install');
  let state = await buttonState();
  assert.match(state.error, /HTTP 503/);
  assert.equal(state.disabled, false);
  assert.equal(state.lines, 1);
  assert.equal(state.fits, true, JSON.stringify(state));
  assert.ok(state.width >= 200);
  await click();
  await until(async () => (await buttonState())?.text === 'Added to Breadboard', 'successful retry');
  state = await buttonState();
  assert.equal(state.disabled, true);
  assert.equal(state.error, undefined);
  assert.equal(state.lines, 1);
  assert.equal(state.fits, true, JSON.stringify(state));
  assert.equal(attempts, 2);
  assert.equal(redirects, 1);
  assert.ok(browserSession.getExtension(id));
  const paths = readBrowserExtensionPaths(dir);
  assert.equal(paths.length, 1);
  browserSession.removeExtension(id);
  assert.equal((await browserSession.loadExtension(paths[0])).id, id);
  for (const width of [800, 375]) {
    await viewport(width);
    for (const installState of ['available', 'installing', 'installed', 'failed']) {
      await page.executeJavaScript(browserWebStoreInstallBootstrapScript(id, installState, 'A readable failure message.'), true);
      state = await buttonState();
      assert.equal(state.lines, 1, `${width}: ${installState}`);
      assert.equal(state.fits, true, `${width}: ${installState}`);
    }
  }
  console.log('Verified retry, HTTPS redirect, install, persistence, and single-line labels at desktop and narrow widths.');
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
