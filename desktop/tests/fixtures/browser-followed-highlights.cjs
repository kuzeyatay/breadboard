const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, webContents, session } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { FOLLOWED_TONES, followedTone } = require('../../dist/main/browser-text-highlights.js');
const { IPC_CHANNELS, isTabsCommand } = require('../../dist/shared/ipc-contract.js');
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await probe()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  const ALICE = 'did:plc:alice'; const BOB = 'did:plc:bob';
  let pageUrls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/text-highlights') {
      let body = ''; for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type', 'application/json');
      // One highlight of your own, with a note.
      res.end(JSON.stringify({ entries: [{ id: 'mine', start: 0, end: 25, quote: 'A second passage to keep.', prefix: '', suffix: '', color: 'blue', note: 'Remember this for the essay' }], acknowledged: [] }));
      return;
    }
    if (url.pathname === '/api/crumbs' && url.searchParams.get('view') === 'page-follows') {
      assert.match(req.headers.cookie ?? '', /session=trusted/);
      pageUrls.push(url.searchParams.get('url'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ highlights: [
        { id: '["text","The selected words follow."]', target: { kind: 'text', url: url.searchParams.get('url'), quote: 'The selected words follow.', prefix: '', suffix: '' },
          people: [{ did: ALICE, handle: 'alice.bsky.social', name: 'Alice', comment: 'This is the key line.' }] },
        { id: '["text","A third line from Bob."]', target: { kind: 'text', url: url.searchParams.get('url'), quote: 'A third line from Bob.', prefix: '', suffix: '' },
          people: [{ did: BOB, handle: 'bob.test', name: 'Bob', comment: '' }] },
      ] }));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (req.url.startsWith('/page')) res.end(`<!doctype html><title>Followed</title><body style="margin:50px;background:#fffdf7;font:18px/1.7 system-ui">
      <p id="passage">The selected words follow.</p><p id="second">A second passage to keep.</p><p id="third">A third line from Bob.</p><p id="plain">Nothing here.</p></body>`);
    else if (req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end('{}'); }
    else res.end('<!doctype html><title>Trusted shell</title><body>Shell</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await session.defaultSession.cookies.set({ url: origin, name: 'session', value: 'trusted' });
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html>');
  const manager = new TabManager({ allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading,
    theme: () => 'light', openWindow: () => {}, log: console.log });
  manager.setBrowserUrl(origin + '/browser'); manager.setNewTabUrl(origin + '/new-tab');
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  const window = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { preload: path.resolve(__dirname, '../../dist/preload/preload.js'), contextIsolation: true, sandbox: true } });
  manager.attach(window); await window.loadURL(origin + '/dashboard');
  await manager.handleCommand(window.webContents, { type: 'browser', url: origin + '/page' });
  let chrome, page;
  await until(() => {
    chrome = webContents.getAllWebContents().find(w => w.getURL() === origin + '/browser');
    page = webContents.getAllWebContents().find(w => w.getURL() === origin + '/page');
    return chrome && page && !page.isLoading();
  }, 'web page');
  window.showInactive();
  const host = [...manager.hosts.values()][0];
  const marks = name => page.executeJavaScript(`CSS.highlights.get(${JSON.stringify(name)})?.size || 0`);

  // What people you follow left is painted in their color, and your own highlight in yours.
  const alice = followedTone(ALICE), bob = followedTone(BOB);
  await until(async () => await marks('breadboard-web-follow-' + alice) >= 1 && await marks('breadboard-web-blue') === 0 && await marks('breadboard-web-note') === 1, 'followed passages painted');
  assert.equal(pageUrls.at(-1), origin + '/page', 'the open page is asked about on this machine only');
  assert.equal(await marks('breadboard-web-follow-' + bob), alice === bob ? 2 : 1);
  const css = await page.executeJavaScript(`[...document.querySelectorAll('style[data-breadboard-selection]')].map(s => s.textContent).join('\\n')`);
  assert.ok(css.includes(`::highlight(breadboard-web-follow-${alice}) { background-color:${FOLLOWED_TONES[alice]}`), 'the page draws the tone the app picked');
  for (const own of ['#8fc3eb', '#8ed09e', '#e99abb', '#b79be9', '#f4e7ad']) assert.ok(!FOLLOWED_TONES.includes(own), 'no followed color is one you highlight with');
  // The website is told where to paint, never who wrote it or what your note says.
  const html = await page.executeJavaScript('document.documentElement.outerHTML + JSON.stringify(Object.keys(window))');
  for (const secret of ['Alice', 'alice.bsky', 'This is the key line', 'Remember this']) assert.ok(!html.includes(secret), secret);

  const tipText = async () => {
    const tip = host.hoverTip;
    if (!tip || !tip.shown) return null;
    return tip.view.webContents.executeJavaScript('document.getElementById("tip").innerText');
  };
  const hover = async selector => {
    const rect = await page.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).firstChild; const range = document.createRange(); range.selectNodeContents(r); const b = range.getClientRects()[0]; return { x: Math.round(b.left + 8), y: Math.round(b.top + b.height / 2) }; })()`);
    page.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
  };
  page.focus();
  await hover('#passage');
  await until(async () => (await tipText())?.includes('Alice @alice'), 'hovering a followed passage shows the username');
  assert.match(await tipText(), /This is the key line\./);
  assert.equal(await marks('breadboard-web-follow-hover-' + alice), 1, 'the hovered passage deepens');
  if (process.env.BREADBOARD_FOLLOWED_SCREENSHOT) {
    // The page and the card are separate native views; compose them as they appear.
    const shot = await page.capturePage(); const card = await host.hoverTip.view.webContents.capturePage();
    const pageAt = host.tabs.find(tab => tab.browser)?.browser.view.getBounds(); const cardAt = host.hoverTip.view.getBounds();
    fs.writeFileSync(process.env.BREADBOARD_FOLLOWED_SCREENSHOT, JSON.stringify({ page: shot.toDataURL(), card: card.toDataURL(), pageAt, cardAt }));
  }
  const bounds = host.hoverTip.view.getBounds();
  const pageBounds = host.tabs.find(tab => tab.browser)?.browser.view.getBounds();
  assert.ok(bounds.y < pageBounds.y + 50 + 30 * 1.7 && bounds.width <= 316, 'the card sits above the passage: ' + JSON.stringify(bounds));

  await hover('#second');
  await until(async () => (await tipText())?.includes('Remember this for the essay'), 'hovering your own noted highlight shows the note');
  await hover('#third');
  await until(async () => (await tipText())?.startsWith('Bob @bob.test'), 'each person is named');
  await hover('#plain');
  await until(async () => (await tipText()) === null, 'the card goes when the pointer leaves');

  // Clicking a followed passage opens Crumbs on it.
  await page.executeJavaScript(`(() => { getSelection().removeAllRanges(); const range = document.createRange(); range.selectNodeContents(document.querySelector('#passage').firstChild);
    const rect = range.getClientRects()[0]; document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: rect.left + 8, clientY: rect.top + rect.height / 2 })); })()`);
  await until(() => manager.stateFor(chrome).tabs.some(tab => tab.browser?.organizationOpen && tab.browser?.annotationTarget?.quote === 'The selected words follow.'), 'followed crumb opens in Crumbs');

  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
  console.log('Followed highlights, per-person tones, hover cards for names and notes, and opening Crumbs passed.');
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
