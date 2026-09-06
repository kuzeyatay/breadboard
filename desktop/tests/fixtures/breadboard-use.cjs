const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session, nativeImage } = require('electron');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { BreadboardUseBridge } = require('../../dist/main/breadboard-use.js');
const { createClickyLauncher } = require('../../dist/main/clicky-launcher.js');
const { ClickyCompanion } = require('../../dist/main/clicky-companion.js');
const [dir] = process.argv.slice(2);
process.env.BREADBOARD_DATA_DIR = dir;
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async probe => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const result = await probe(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Breadboard use fixture did not become ready.');
};
const pageHtml = title => `<!doctype html><title>${title}</title><body style="background:#abcdef"><h1>${title}</h1>
  <label>Search<input aria-label="Search" oninput="document.querySelector('output').textContent=this.value" onkeydown="if(event.key==='Enter')document.querySelector('output').textContent='Submitted '+this.value"></label><output></output>
  <button onclick="this.textContent='Clicked'">Test button</button><button disabled>Unavailable</button>
  <button aria-label="Close voice mode" onclick="this.remove()">Close voice mode</button>
  <input type="password" aria-label="Password" value="never-expose-me"><div style="height:3000px">Scrollable page</div></body>`;

app.whenReady().then(async () => {
  const { useBreadboard } = require(path.join(dir, 'transport.cjs'));
  const server = http.createServer((req, res) => {
    if (req.url === '/api/auth/session') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ user: { id: '7' } })); return;
    }
    res.setHeader('Content-Type', 'text/html'); res.end(pageHtml(req.url));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html>');
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => 'light', openWindow: () => {},
  });
  manager.setBrowserUrl(origin + '/browser'); manager.setNewTabUrl(origin + '/new-tab');
  // Keep the search deterministic and offline while exercising real Chromium
  // navigation to the search URL in the actual embedded browser partition.
  session.fromPartition('persist:breadboard-browser').protocol.handle('https', request => new Response(pageHtml(request.url), { headers: { 'Content-Type': 'text/html' } }));
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { preload: path.resolve(__dirname, '../../dist/preload/preload.js'), contextIsolation: true, sandbox: true } });
  manager.attach(window); await window.loadURL(origin + '/dashboard'); window.showInactive();
  const companion = new ClickyCompanion({ dashboardUrl: () => origin,
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    clickAt: async () => assert.fail('Launching Clicky must not click the screen'),
    typeText: async () => assert.fail('Launching Clicky must not type'),
  });
  let launchCalls = 0;
  let launchFailure = false;
  const launcher = createClickyLauncher({ platform: 'win32', appRoot: dir, resourcesRoot: dir, homeDirectory: dir,
    openPath: async () => assert.fail('Use the native companion'),
    launchWindowsCompanion: async () => {
      launchCalls++;
      if (launchFailure) throw new Error('fixture launch unavailable');
      await companion.launch();
    },
  });
  const bridge = new BreadboardUseBridge({ tabs: manager, dataRoot: dir, dashboardUrl: () => origin, clicky: () => launcher });
  await bridge.start();
  const call = async args => {
    console.log('action', args.action, args.targetId || '', args.surface || '');
    const result = await useBreadboard(args, 'conversation-a', 7);
    console.log('done', args.action);
    return result;
  };
  const state = await call({ action: 'state' });
  const dashboard = state.targets.find(t => t.url.endsWith('/dashboard'));
  assert.ok(dashboard);
  assert.equal(state.clicky.available, true);
  await assert.rejects(useBreadboard({ action: 'launch_clicky' }, 'conversation-b', 8), /different account/);
  assert.equal(launchCalls, 0);
  await assert.rejects(useBreadboard({ action: 'state' }, 'conversation-b', 8), /different account/);
  const access = JSON.parse(fs.readFileSync(path.join(dir, 'breadboard-use.json'), 'utf8'));
  for (const headers of [{ Authorization: 'Bearer wrong' }, { Authorization: `Bearer ${access.token}`, Origin: origin }]) {
    const response = await fetch(`http://127.0.0.1:${access.port}/breadboard-use`, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 403);
  }
  const openedClicky = await call({ action: 'launch_clicky' });
  assert.equal(openedClicky.performed, true);
  assert.equal(openedClicky.launch.ok, true);
  const clickyWindow = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === origin + '/clicky');
  assert.ok(clickyWindow?.isVisible(), 'Hermes transport must open the native companion');
  await call({ action: 'launch_clicky' });
  assert.equal(BrowserWindow.getAllWindows().filter(w => w.webContents.getURL() === origin + '/clicky').length, 1);
  launchFailure = true;
  const failedClicky = await call({ action: 'launch_clicky' });
  assert.equal(failedClicky.performed, false);
  assert.equal(failedClicky.launch.ok, false);
  assert.equal(failedClicky.launch.code, 'launch_failed');
  assert.match(failedClicky.launch.message, /fixture launch unavailable/);
  clickyWindow.hide();
  await call({ action: 'open', surface: 'browser', query: 'bread & butter' });
  const browser = await until(async () => (await call({ action: 'state' })).targets.find(t => t.kind === 'browser' && t.active && !t.loading));
  assert.equal(browser.url, 'https://www.google.com/search?q=bread%20%26%20butter');
  const snap = await call({ action: 'snapshot', targetId: browser.targetId });
  assert.ok(!JSON.stringify(snap).includes('never-expose-me'));
  // A browser task may start beside a tab that has since moved into the
  // background. Capture must activate the observed target in the same request.
  await call({ action: 'activate', targetId: dashboard.targetId });
  await assert.rejects(call({ action: 'click', targetId: browser.targetId, snapshotId: snap.snapshotId,
    ref: snap.elements.find(e => e.name === 'Test button').ref }), /Activate/);
  const reactivated = await call({ action: 'snapshot', targetId: browser.targetId });
  assert.ok((await call({ action: 'state' })).targets.some(t => t.targetId === browser.targetId && t.active));
  assert.ok(reactivated.elements.some(e => e.name === 'Test button'));
  await assert.rejects(call({ action: 'click', targetId: browser.targetId, snapshotId: snap.snapshotId,
    ref: snap.elements.find(e => e.name === 'Test button').ref }), /expired/);
  const ready = await call({ action: 'snapshot', targetId: browser.targetId });
  const input = ready.elements.find(e => e.name === 'Search' && e.tag === 'input');
  await call({ action: 'fill', targetId: browser.targetId, snapshotId: ready.snapshotId, ref: input.ref, text: 'hello " world' });
  await assert.rejects(call({ action: 'fill', targetId: browser.targetId, snapshotId: ready.snapshotId, ref: input.ref, text: 'stale' }), /expired/);
  let filled = await call({ action: 'snapshot', targetId: browser.targetId });
  assert.match(filled.text, /hello " world/);
  assert.equal(filled.elements.find(e => e.name === 'Search' && e.tag === 'input').value, 'hello " world');
  await call({ action: 'press', targetId: browser.targetId, snapshotId: filled.snapshotId, ref: filled.elements.find(e => e.name === 'Search' && e.tag === 'input').ref, key: 'Enter' });
  filled = await call({ action: 'snapshot', targetId: browser.targetId });
  assert.match(filled.text, /Submitted hello/);
  await assert.rejects(useBreadboard({ action: 'click', targetId: browser.targetId, snapshotId: filled.snapshotId, ref: filled.elements.find(e => e.name === 'Test button').ref }, 'conversation-b', 7), /expired/);
  await call({ action: 'click', targetId: browser.targetId, snapshotId: filled.snapshotId, ref: filled.elements.find(e => e.name === 'Test button').ref });
  const clicked = await call({ action: 'snapshot', targetId: browser.targetId });
  assert.ok(clicked.elements.some(e => e.name === 'Clicked'));
  await assert.rejects(call({ action: 'click', targetId: browser.targetId, snapshotId: clicked.snapshotId, ref: clicked.elements.find(e => e.name === 'Unavailable').ref }), /disabled/);
  await call({ action: 'scroll', targetId: browser.targetId, snapshotId: clicked.snapshotId, direction: 'down' });
  const screenshot = await call({ action: 'screenshot', targetId: browser.targetId });
  assert.equal(nativeImage.createFromDataURL(screenshot.screenshot.dataUrl).isEmpty(), false);
  const stale = await call({ action: 'snapshot', targetId: browser.targetId });
  await call({ action: 'navigate', targetId: browser.targetId, url: origin + '/next-page' });
  await until(async () => (await call({ action: 'state' })).targets.some(t => t.targetId === browser.targetId && !t.loading && t.url.endsWith('/next-page')));
  await assert.rejects(call({ action: 'click', targetId: browser.targetId, snapshotId: stale.snapshotId, ref: 'e1' }), /expired/);
  await assert.rejects(call({ action: 'navigate', targetId: browser.targetId, url: 'javascript:alert(1)' }), /http/);
  await call({ action: 'open', surface: 'garden' });
  const garden = await until(async () => (await call({ action: 'state' })).targets.find(t => t.active && !t.loading && t.url === origin + '/garden'));
  assert.ok(garden);
  const closed = await call({ action: 'close_voice' }); assert.equal(closed.closed, true);
  assert.equal((await call({ action: 'close_voice' })).closed, false);
  await call({ action: 'activate', targetId: browser.targetId });
  const afterClose = await call({ action: 'close', targetId: browser.targetId });
  assert.ok(!afterClose.targets.some(t => t.targetId === browser.targetId));
  void bridge.close();
  assert.equal(fs.existsSync(path.join(dir, 'breadboard-use.json')), false);
  console.log('Breadboard use: search, Garden, refs, fill, click, scroll, screenshot, navigate, voice close, tab close, account/auth checks passed.');
  // The shared fixture owner terminates Chromium after this assertion receipt;
  // native Electron shutdown is covered by the separate lifecycle suites.
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => {
  console.error(error);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});
