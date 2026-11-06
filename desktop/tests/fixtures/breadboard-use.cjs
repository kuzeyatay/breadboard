const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session, nativeImage, webContents, ipcMain } = require('electron');
const { IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const { AI_TAB_GROUP_ID } = require('../../dist/shared/tab-groups.js');
const { TabManager } = require('../../dist/main/tab-manager.js');
const { BreadboardUseBridge } = require('../../dist/main/breadboard-use.js');
const signedInBrowser = require('./signed-in-browser.cjs');
const [dir] = process.argv.slice(2);
const captureDir = process.env.BB_SCREENSHOT_EVIDENCE_DIR || dir;
fs.mkdirSync(captureDir, { recursive: true });
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
  <button onclick="this.textContent='Background clicked'">Background test</button>
  <button aria-label="Close voice mode" onclick="this.remove()">Close voice mode</button>
  <input type="password" aria-label="Password" value="never-expose-me"><div style="height:3000px">Scrollable page</div></body>`;

app.whenReady().then(async () => {
  const { useBreadboard } = require(path.join(dir, 'transport.cjs'));
  let preferences = { readAloudNotifications: false, alwaysOnVoiceAssistant: false };
  let preferenceWrites = 0;
  let rejectPreferenceSave = false;
  let cleanupStatusAvailable = true;
  const finishedOwners = new Set();
  const server = http.createServer((req, res) => {
    if (req.url === '/api/browser/automation-tabs') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (!cleanupStatusAvailable) { res.statusCode = 503; res.end('{}'); return; }
        res.end(JSON.stringify({ finishedOwners: JSON.parse(body).owners.filter(owner => finishedOwners.has(owner)) }));
      });
      return;
    }
    if (req.url === '/social-login') {
      res.writeHead(302, { 'Set-Cookie': 'social_session=fixture-login-secret; HttpOnly; SameSite=Lax; Path=/', Location: '/social' });
      res.end(); return;
    }
    if (req.url === '/social') {
      res.setHeader('Content-Type', 'text/html');
      res.end(req.headers.cookie?.includes('social_session=fixture-login-secret') ? signedInBrowser.html : '<h1>Sign in required</h1>');
      return;
    }
    if (req.url === '/api/auth/session') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ user: { id: '7' } })); return;
    }
    if (req.url === '/api/profile/voice-assistant') {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'PUT') {
        let body = ''; req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          if (rejectPreferenceSave) { res.statusCode = 503; res.end(JSON.stringify({ error: 'Voice settings could not save.' })); return; }
          preferences = JSON.parse(body); preferenceWrites++; res.end(JSON.stringify({ preferences }));
        });
      } else res.end(JSON.stringify({ preferences }));
      return;
    }
    if (req.url === '/profile-controls.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(dir, 'profile-controls.js'))); return;
    }
    if (req.url === '/settings' || req.url === '/profile') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Profile</title><div id="profile-controls"></div><script src="/profile-controls.js"></script>'); return;
    }
    res.setHeader('Content-Type', 'text/html'); res.end(pageHtml(req.url));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html>');
  const openedWindows = [];
  const openedExternal = [];
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => 'light',
    openWindow: url => { openedWindows.push(url); }, openExternal: url => { openedExternal.push(url); },
    onBrowserAgentPageReady: async () => true,
  });
  manager.setBrowserUrl(origin + '/browser'); manager.setNewTabUrl(origin + '/new-tab');
  for (const name of ['getBrowserBookmarks', 'getBrowserRecentSearches']) ipcMain.handle(IPC_CHANNELS[name], () => []);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => ({ items: [], error: null }));
  // Keep the search deterministic and offline while exercising real Chromium
  // navigation to the search URL in the actual embedded browser partition.
  session.fromPartition('persist:breadboard-browser').protocol.handle('https', request => new Response(pageHtml(request.url), { headers: { 'Content-Type': 'text/html' } }));
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { preload: path.resolve(__dirname, '../../dist/preload/preload.js'), contextIsolation: true, sandbox: true } });
  manager.attach(window, process.env.BB_USE_PERSISTENT_SHELL === '1'); const appContents = manager.baseContents(window); await appContents.loadURL(origin + '/dashboard');
  window.setOpacity(0); window.setAlwaysOnTop(true); window.showInactive();
  const bridge = new BreadboardUseBridge({ tabs: manager, dataRoot: dir, dashboardUrl: () => origin });
  await bridge.start();
  const call = async args => {
    console.log('action', args.action, args.targetId || '', args.surface || '');
    const result = await useBreadboard(args, 'conversation-a', 7);
    console.log('done', args.action);
    return result;
  };
  if (process.env.BB_USE_MODEL_ONLY === '1') {
    const config = JSON.parse(fs.readFileSync(path.join(dir, 'model-config.json'), 'utf8'));
    const before = manager.stateFor(appContents).activeId;
    const report = await require(path.join(dir, 'model-evaluation.cjs')).runModelScenario({ call, origin, config,
      inspect: async () => {
        const target = manager.breadboardUseTargets().find(t => t.kind === 'browser' && t.contents.getURL() === origin + '/agent-form');
        assert.ok(target, 'model opened the requested page');
        assert.equal(manager.stateFor(appContents).activeId, before, 'model kept the user tab selected');
        return target.contents.executeJavaScript('document.querySelector("output").textContent');
      },
    });
    await useBreadboard({ action: 'release_run' }, 'conversation-a', 7);
    await bridge.close();
    fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify(report, null, 2));
    return;
  }
  const state = await call({ action: 'state' });
  const dashboard = state.targets.find(t => t.url.endsWith('/dashboard'));
  assert.ok(dashboard);
  assert.equal('clicky' in state, false);
  await assert.rejects(call({ action: 'launch_clicky' }), /Unsupported Breadboard action/);
  await assert.rejects(useBreadboard({ action: 'state' }, 'conversation-b', 8), /different account/);
  const access = JSON.parse(fs.readFileSync(path.join(dir, 'breadboard-use.json'), 'utf8'));
  for (const headers of [{ Authorization: 'Bearer wrong' }, { Authorization: `Bearer ${access.token}`, Origin: origin }]) {
    const response = await fetch(`http://127.0.0.1:${access.port}/breadboard-use`, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 403);
  }
  const initialGroups = manager.stateFor(appContents).groups;
  assert.deepEqual(initialGroups, [{ id: AI_TAB_GROUP_ID, name: 'AI', color: 'black', collapsed: false }]);
  const assertAiGroup = tabId => assert.equal(manager.stateFor(appContents).tabs.find(t => t.id === tabId)?.groupId, AI_TAB_GROUP_ID);
  if (process.env.BB_USE_PERSISTENT_SHELL === '1') {
    const shell = manager.hosts.get(window.id).shell.contents;
    await until(() => shell.executeJavaScript(`Boolean(document.querySelector('[data-ai-group="true"][data-empty="true"] circle'))`));
  }
  assert.equal(await manager.handleCommand(appContents, { type: 'group-action', groupId: AI_TAB_GROUP_ID, action: 'new-tab' }), true);
  const manualAiTab = manager.stateFor(appContents).tabs.find(t => t.groupId === AI_TAB_GROUP_ID);
  assert.ok(manualAiTab, 'an empty default group supports its new-tab action');
  await manager.handleCommand(appContents, { type: 'close', id: manualAiTab.id });
  assert.equal(manager.stateFor(appContents).groups.some(g => g.id === AI_TAB_GROUP_ID), true, 'the last tab closing retains the group');
  assert.equal(await manager.handleCommand(appContents, { type: 'group-update', groupId: AI_TAB_GROUP_ID, color: 'blue' }), false);
  assert.equal(await manager.handleCommand(appContents, { type: 'group-action', groupId: AI_TAB_GROUP_ID, action: 'ungroup' }), false);
  await manager.handleCommand(appContents, { type: 'group-update', groupId: AI_TAB_GROUP_ID, collapsed: true });
  await call({ action: 'open', surface: 'browser', query: 'bread & butter' });
  const browser = await until(async () => (await call({ action: 'state' })).targets.find(t => t.kind === 'browser' && !t.loading));
  assert.equal(browser.active, false);
  assert.equal(browser.aiOpened, true);
  assertAiGroup(browser.tabId);
  assert.equal(manager.stateFor(appContents).groups.find(g => g.id === AI_TAB_GROUP_ID).collapsed, true, 'background opens respect a collapsed AI group');
  await manager.handleCommand(appContents, { type: 'group-update', groupId: AI_TAB_GROUP_ID, collapsed: false });
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId);
  assert.equal(manager.stateFor(appContents).tabs.find(t => t.id === browser.tabId).browser.aiOpened, true);
  if (process.env.BB_USE_PERSISTENT_SHELL === '1') {
    const shell = manager.hosts.get(window.id).shell.contents;
    await until(() => shell.executeJavaScript(`Boolean(document.querySelector('[data-tab-id="${browser.tabId}"][data-ai-opened="true"] .bb-tab-ai-badge'))`));
    const label = await shell.executeJavaScript(`document.querySelector('[data-tab-id="${browser.tabId}"]').getAttribute('aria-label')`);
    assert.match(label, /AI task; closes when finished/);
    if (process.env.BB_AI_TAB_SCREENSHOT) fs.writeFileSync(process.env.BB_AI_TAB_SCREENSHOT, (await shell.capturePage()).toPNG());
  }
  assert.equal(browser.url, 'https://www.google.com/search?q=bread%20%26%20butter');
  const snap = await call({ action: 'snapshot', targetId: browser.targetId });
  assert.ok(!JSON.stringify(snap).includes('never-expose-me'));
  // Once the user leaves a tab, repeated agent inspections must leave their
  // selected page in front. Only an explicit activation may switch it back.
  await call({ action: 'activate', targetId: dashboard.targetId });
  await call({ action: 'fill', targetId: browser.targetId, snapshotId: snap.snapshotId,
    ref: snap.elements.find(e => e.name === 'Search' && e.tag === 'input').ref, text: 'background edit' });
  const backgroundEdit = await call({ action: 'snapshot', targetId: browser.targetId });
  const nativeFocusBefore = webContents.getFocusedWebContents()?.id;
  assert.equal(backgroundEdit.elements.find(e => e.name === 'Search' && e.tag === 'input').value, 'background edit');
  await call({ action: 'press', targetId: browser.targetId, snapshotId: backgroundEdit.snapshotId,
    ref: backgroundEdit.elements.find(e => e.name === 'Search' && e.tag === 'input').ref, key: 'Enter' });
  const backgroundSubmitted = await call({ action: 'snapshot', targetId: browser.targetId });
  assert.match(backgroundSubmitted.text, /Submitted background edit/);
  const cursorTarget = manager.breadboardUseTargets().find(t => t.contents.id === browser.targetId).contents;
  const cursorPoint = await cursorTarget.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Background test');
    button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = button.getBoundingClientRect();
    return { x: Math.round((Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2),
      y: Math.round((Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2) };
  })()`);
  await call({ action: 'click', targetId: browser.targetId, snapshotId: backgroundSubmitted.snapshotId,
    ref: backgroundSubmitted.elements.find(e => e.name === 'Background test').ref });
  const cursorState = await cursorTarget.executeJavaScript(`(() => {
    const cursor = document.querySelector('[data-breadboard-agent-cursor]');
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Background clicked');
    const rect = button.getBoundingClientRect();
    const position = cursor?.getAttribute('style');
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 3, bubbles: true }));
    return {
      exists: !!cursor, passive: cursor?.inert && getComputedStyle(cursor).pointerEvents === 'none',
      unchanged: cursor?.getAttribute('style') === position,
      x: parseInt(cursor?.style.left), y: parseInt(cursor?.style.top),
      hit: document.elementFromPoint(parseInt(cursor?.style.left) + 4, parseInt(cursor?.style.top) + 4) === button,
    };
  })()`);
  assert.ok(cursorState.exists && cursorState.passive && cursorState.unchanged && cursorState.hit, JSON.stringify(cursorState));
  assert.equal(cursorState.x, cursorPoint.x);
  assert.equal(cursorState.y, cursorPoint.y);
  assert.equal(await appContents.executeJavaScript("!!document.querySelector('[data-breadboard-agent-cursor]')"), false,
    'An agent cursor in a background tab must not appear in the user tab');
  const backgroundClicked = await call({ action: 'snapshot', targetId: browser.targetId });
  assert.ok(backgroundClicked.elements.some(e => e.name === 'Background clicked'));
  assert.doesNotMatch(backgroundClicked.text, /Bread/);
  assert.equal(webContents.getFocusedWebContents()?.id, nativeFocusBefore, 'Background input preserves native keyboard focus');
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId);
  for (const action of ['snapshot', 'screenshot', 'snapshot']) {
    const inspected = await call({ action, targetId: browser.targetId });
    assert.ok(inspected.elements.some(e => e.name === 'Test button'));
    assert.equal(inspected.active, false);
    if (action === 'screenshot') {
      const image = nativeImage.createFromDataURL(inspected.screenshot.dataUrl);
      assert.equal(image.isEmpty(), false);
      assert.ok(image.getSize().width > 500 && image.getSize().height > 300);
      assert.ok(image.getSize().width / image.getSize().height > 1.2, 'capture is a legible viewport, not the entire 3000px-tall page');
      const pixel = image.resize({ width: 1, height: 1 }).toBitmap();
      assert.ok(pixel[0] > 160 && pixel[1] > 140 && pixel[2] > 110, 'capture contains the blue page, not an empty surface');
      fs.writeFileSync(path.join(captureDir, 'background-browser.jpg'), image.toJPEG(80));
    }
    assert.equal(webContents.getFocusedWebContents()?.id, nativeFocusBefore, 'Screenshot preserves native keyboard focus');
    assert.ok((await call({ action: 'state' })).targets.some(t => t.targetId === dashboard.targetId && t.active),
      `${action} of a previous tab must preserve the user's selection`);
  }
  await call({ action: 'activate', targetId: browser.targetId });
  assert.ok((await call({ action: 'state' })).targets.some(t => t.targetId === browser.targetId && t.active));
  const backgroundApp = await call({ action: 'screenshot', targetId: dashboard.targetId });
  assert.equal(backgroundApp.active, false);
  assert.equal(nativeImage.createFromDataURL(backgroundApp.screenshot.dataUrl).isEmpty(), false);
  fs.writeFileSync(path.join(captureDir, 'background-app.jpg'), nativeImage.createFromDataURL(backgroundApp.screenshot.dataUrl).toJPEG(80));
  const controls = (await call({ action: 'state' })).targets.find(t => t.kind === 'chrome' && t.tabId === browser.tabId);
  assert.ok(controls);
  assert.equal(nativeImage.createFromDataURL((await call({ action: 'screenshot', targetId: controls.targetId })).screenshot.dataUrl).isEmpty(), false);
  assert.ok((await call({ action: 'state' })).targets.some(t => t.targetId === browser.targetId && t.active));

  // A snapshot already in flight must also tolerate the user leaving its tab.
  const browserContents = manager.breadboardUseTargets().find(t => t.contents.id === browser.targetId).contents;
  const execute = browserContents.executeJavaScript;
  let releaseSnapshot;
  browserContents.executeJavaScript = async function (...args) {
    const result = await execute.apply(this, args);
    if (args[0].includes('"action":"snapshot"')) {
      assert.equal(args[1], false, 'Passive inspection must not grant page user activation');
      await new Promise(resolve => { releaseSnapshot = resolve; });
    }
    return result;
  };
  const pendingSnapshot = call({ action: 'screenshot', targetId: browser.targetId });
  await until(() => releaseSnapshot);
  browserContents.executeJavaScript = execute;
  manager.handleCommand(appContents, { type: 'activate', id: dashboard.tabId });
  releaseSnapshot();
  const switchedCapture = await pendingSnapshot;
  assert.equal(switchedCapture.active, false);
  assert.equal(nativeImage.createFromDataURL(switchedCapture.screenshot.dataUrl).isEmpty(), false);
  assert.ok((await call({ action: 'state' })).targets.some(t => t.targetId === dashboard.targetId && t.active));
  await call({ action: 'activate', targetId: browser.targetId });
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
  const captureCommand = browserContents.debugger.sendCommand;
  let hiddenDuringCapture = false;
  browserContents.debugger.sendCommand = async function (...args) {
    if (args[0] === 'Page.captureScreenshot') hiddenDuringCapture = await browserContents.executeJavaScript("getComputedStyle(document.querySelector('[data-breadboard-agent-cursor]')).visibility === 'hidden'");
    return captureCommand.apply(this, args);
  };
  const screenshot = await call({ action: 'screenshot', targetId: browser.targetId });
  browserContents.debugger.sendCommand = captureCommand;
  assert.equal(hiddenDuringCapture, true, 'Agent screenshots exclude the cursor');
  assert.equal(await browserContents.executeJavaScript("document.querySelector('[data-breadboard-agent-cursor]')?.style.visibility"), 'visible');
  assert.equal(nativeImage.createFromDataURL(screenshot.screenshot.dataUrl).isEmpty(), false);
  await until(async () => !(await browserContents.executeJavaScript("!!document.querySelector('[data-breadboard-agent-cursor]')")));
  const stale = await call({ action: 'snapshot', targetId: browser.targetId });
  await call({ action: 'navigate', targetId: browser.targetId, url: origin + '/next-page' });
  await until(async () => (await call({ action: 'state' })).targets.some(t => t.targetId === browser.targetId && !t.loading && t.url.endsWith('/next-page')));
  await assert.rejects(call({ action: 'click', targetId: browser.targetId, snapshotId: stale.snapshotId, ref: 'e1' }), /expired/);
  await assert.rejects(call({ action: 'navigate', targetId: browser.targetId, url: 'javascript:alert(1)' }), /http/);
  await call({ action: 'activate', targetId: dashboard.targetId });
  await signedInBrowser.exerciseSignedInBrowser({ call, useBreadboard, browserContents, browser, origin, until });
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId);
  await call({ action: 'open', surface: 'garden' });
  const garden = await until(async () => (await call({ action: 'state' })).targets.find(t => t.aiOpened && !t.loading && t.url === origin + '/garden'));
  assert.ok(garden);
  assertAiGroup(garden.tabId);
  assert.equal(garden.active, false);
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId);
  assert.equal(appContents.getURL(), origin + '/dashboard');
  assert.equal(manager.stateFor(appContents).tabs.find(t => t.id === garden.tabId).aiOpened, true);
  if (process.env.BB_USE_PERSISTENT_SHELL === '1') {
    const shell = manager.hosts.get(window.id).shell.contents;
    await until(() => shell.executeJavaScript(`Boolean(document.querySelector('[data-tab-id="${garden.tabId}"][data-ai-opened="true"] .bb-tab-ai-badge'))`));
  }
  const appFocusBefore = webContents.getFocusedWebContents()?.id;
  let appSnapshot = await call({ action: 'screenshot', targetId: garden.targetId });
  assert.equal(nativeImage.createFromDataURL(appSnapshot.screenshot.dataUrl).isEmpty(), false);
  assert.equal(appSnapshot.active, false);
  fs.writeFileSync(path.join(captureDir, 'background-garden.jpg'), nativeImage.createFromDataURL(appSnapshot.screenshot.dataUrl).toJPEG(80));
  await call({ action: 'fill', targetId: garden.targetId, snapshotId: appSnapshot.snapshotId,
    ref: appSnapshot.elements.find(e => e.name === 'Search' && e.tag === 'input').ref, text: 'AI garden input' });
  appSnapshot = await call({ action: 'snapshot', targetId: garden.targetId });
  await call({ action: 'press', targetId: garden.targetId, snapshotId: appSnapshot.snapshotId,
    ref: appSnapshot.elements.find(e => e.name === 'Search' && e.tag === 'input').ref, key: 'Enter' });
  appSnapshot = await call({ action: 'snapshot', targetId: garden.targetId });
  assert.match(appSnapshot.text, /Submitted AI garden input/);
  await call({ action: 'click', targetId: garden.targetId, snapshotId: appSnapshot.snapshotId,
    ref: appSnapshot.elements.find(e => e.name === 'Background test').ref });
  appSnapshot = await call({ action: 'snapshot', targetId: garden.targetId });
  assert.ok(appSnapshot.elements.some(e => e.name === 'Background clicked'));
  await call({ action: 'scroll', targetId: garden.targetId, snapshotId: appSnapshot.snapshotId, direction: 'down' });
  assert.equal(webContents.getFocusedWebContents()?.id, appFocusBefore, 'AI app input preserves native keyboard focus');
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId);
  await call({ action: 'open', surface: 'dashboard' });
  const aiDashboard = await until(async () => (await call({ action: 'state' })).targets.find(t => t.aiOpened && !t.loading && t.url === origin + '/dashboard'));
  assert.notEqual(aiDashboard.targetId, dashboard.targetId, 'An existing user page must not be reused');
  assert.equal(aiDashboard.active, false);
  const closed = await call({ action: 'close_voice' }); assert.equal(closed.closed, true);
  assert.equal((await call({ action: 'close_voice' })).closed, false);
  await call({ action: 'activate', targetId: browser.targetId });
  const afterClose = await call({ action: 'close', targetId: browser.targetId });
  assert.ok(!afterClose.targets.some(t => t.targetId === browser.targetId));

  // Task completion closes only its own pages, including popups, and leaves
  // the user's selected tab and concurrent runs intact. Releasing twice is safe.
  await call({ action: 'activate', targetId: dashboard.targetId });
  const userOpened = await manager.handleCommand(appContents, { type: 'browser', url: origin + '/user-page' });
  assert.equal(userOpened, true);
  assert.equal(manager.stateFor(appContents).tabs.find(t => t.id === manager.stateFor(appContents).activeId).groupId, undefined);
  const userTab = await until(() => manager.breadboardUseTargets().find(t => t.kind === 'browser' && t.contents.getURL().endsWith('/user-page')));
  await call({ action: 'activate', targetId: dashboard.targetId });
  await useBreadboard({ action: 'open', surface: 'browser', url: origin + '/task-a' }, 'conversation-a', 7, 'task-a');
  await useBreadboard({ action: 'open', surface: 'browser', url: origin + '/task-b' }, 'conversation-a', 7, 'task-b');
  await useBreadboard({ action: 'open', surface: 'garden' }, 'conversation-a', 7, 'task-a');
  await useBreadboard({ action: 'open', surface: 'profile' }, 'conversation-a', 7, 'task-b');
  await useBreadboard({ action: 'open', surface: 'browser', url: origin + '/artifacts/art_fixture/pdf' }, 'conversation-a', 7, 'task-a');
  const appA = await until(() => manager.breadboardUseTargets().find(t => t.kind === 'app' && t.contents.id !== garden.targetId && t.contents.getURL().endsWith('/garden') && !t.contents.isLoading()));
  const appB = await until(() => manager.breadboardUseTargets().find(t => t.kind === 'app' && t.contents.getURL().endsWith('/settings') && !t.contents.isLoading()));
  const artifact = await until(() => manager.breadboardUseTargets().find(t => t.kind === 'app' && t.contents.getURL().endsWith('/artifacts/art_fixture/pdf') && !t.contents.isLoading()));
  assert.equal(artifact.contents.session, appContents.session, 'Artifact viewers keep the app login');
  assert.equal(artifact.aiOpened, true);
  const artifactCapture = await useBreadboard({ action: 'screenshot', targetId: artifact.contents.id }, 'conversation-a', 7, 'task-a');
  assert.equal(nativeImage.createFromDataURL(artifactCapture.screenshot.dataUrl).isEmpty(), false);
  assert.equal(artifactCapture.active, false);
  assertAiGroup(artifact.tabId);
  for (const [url, features] of [[origin + '/app-child', ''], [origin + '/app-popup', 'popup=yes'], ['https://example.test/app-external', '']]) {
    await appA.contents.executeJavaScript(`void window.open(${JSON.stringify(url)}, '_blank', ${JSON.stringify(features)})`, true);
    const child = await until(() => manager.breadboardUseTargets().find(t => t.contents.getURL() === url));
    assert.equal(child.aiOpened, true);
    assertAiGroup(child.tabId);
    assert.equal(child.active, false);
  }
  const taskA = await until(() => manager.breadboardUseTargets().find(t => t.kind === 'browser' && t.contents.getURL().endsWith('/task-a') && !t.contents.isLoading()));
  const taskB = await until(() => manager.breadboardUseTargets().find(t => t.kind === 'browser' && t.contents.getURL().endsWith('/task-b') && !t.contents.isLoading()));
  await taskA.contents.executeJavaScript(`void window.open(${JSON.stringify(origin + '/ai-popup')})`, true);
  const popup = await until(() => manager.breadboardUseTargets().find(t => t.kind === 'browser' && t.contents.getURL().endsWith('/ai-popup')));
  assert.equal(popup.aiOpened, true);
  assertAiGroup(popup.tabId);
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId);
  await useBreadboard({ action: 'navigate', targetId: taskA.contents.id, url: origin + '/task-a-next' }, 'conversation-a', 7, 'task-a');
  await until(() => taskA.contents.getURL().endsWith('/task-a-next'));
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId);
  for (let i = 0; i < 2; i++) await useBreadboard({ action: 'release_run' }, 'conversation-a', 7, 'task-a');
  const remaining = manager.breadboardUseTargets();
  assert.ok(!remaining.some(t => t.contents === taskA.contents || t.contents === popup.contents));
  assert.ok(!remaining.some(t => t.contents === appA.contents || t.contents === artifact.contents || /app-child|app-popup|app-external/.test(t.contents.getURL())));
  assert.ok(remaining.some(t => t.contents === appB.contents));
  assert.ok(remaining.some(t => t.contents === taskB.contents));
  assert.ok(remaining.some(t => t.contents === userTab.contents));
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId);
  await assert.rejects(useBreadboard({ action: 'open', url: origin + '/too-late' }, 'conversation-a', 7, 'task-a'), /finished/);
  await manager.handleCommand(appContents, { type: 'anchor', id: taskB.tabId });
  await manager.handleCommand(appContents, { type: 'anchor', id: appB.tabId });
  await useBreadboard({ action: 'release_run' }, 'conversation-a', 7, 'task-b');
  assert.equal(manager.stateFor(appContents).tabs.find(t => t.id === taskB.tabId).browser.aiOpened, false);
  assert.equal(manager.stateFor(appContents).tabs.find(t => t.id === appB.tabId).aiOpened, false);

  const jobId = `job_${'a'.repeat(64)}`;
  const beforeJob = manager.stateFor(appContents);
  for (let i = 0; i < 2; i++) assert.equal(await manager.handleCommand(appContents, { type: 'browser-agent', runId: jobId }), true);
  const duringJob = manager.stateFor(appContents);
  assert.equal(duringJob.activeId, beforeJob.activeId);
  assert.equal(duringJob.tabs.length, beforeJob.tabs.length + 1);
  assert.equal(duringJob.tabs.find(t => t.url.includes(jobId)).browser.aiOpened, true);
  assertAiGroup(duringJob.tabs.find(t => t.url.includes(jobId)).id);
  assert.equal(await manager.handleCommand(appContents, { type: 'browser-agent-close', runId: jobId }), true);
  assert.equal(manager.stateFor(appContents).tabs.length, beforeJob.tabs.length);
  assert.equal(manager.stateFor(appContents).activeId, beforeJob.activeId);

  await call({ action: 'open', surface: 'profile' });
  const profile = await until(async () => (await call({ action: 'state' })).targets.find(t => t.aiOpened && !t.loading && t.url === origin + '/settings'));
  assert.equal(profile.active, false);
  const profileSnapshot = async () => {
    const first = await call({ action: 'snapshot', targetId: profile.targetId });
    if (first.nextOffset === null) return first;
    return call({ action: 'snapshot', targetId: profile.targetId, offset: first.nextOffset });
  };
  let profileState = await until(async () => {
    const snapshot = await profileSnapshot();
    return snapshot.elements.some(e => e.name === 'Read notifications aloud' && !e.disabled) && snapshot;
  });
  assert.ok(profileState.totalElements > 300);
  const setting = name => profileState.elements.find(e => e.name === name);
  assert.equal(setting('Read notifications aloud').checked, false);
  assert.equal(setting('Listen for “Hey Bread”').checked, false);
  assert.equal(setting('Read notifications aloud').section, 'Voice assistant');
  assert.match(setting('Read notifications aloud').description, /Read new notifications/);
  const setSwitch = async (name, checked) => {
    assert.ok(setting(name), `Missing ${name}: ${JSON.stringify(profileState.elements.map(e => e.name))}`);
    const result = await call({ action: 'set_checked', targetId: profile.targetId, snapshotId: profileState.snapshotId, ref: setting(name).ref, checked });
    profileState = await until(async () => {
      const snapshot = await profileSnapshot();
      return snapshot.elements.some(e => e.name === name && e.checked === checked && !e.disabled) && snapshot;
    });
    return result;
  };
  assert.equal((await setSwitch('Read notifications aloud', true)).changed, true);
  assert.equal(preferences.readAloudNotifications, true);
  const writesAfterEnable = preferenceWrites;
  assert.equal((await setSwitch('Read notifications aloud', true)).changed, false);
  assert.equal(preferenceWrites, writesAfterEnable, 'An already enabled setting must not be clicked/saved again');
  await setSwitch('Read notifications aloud', false);
  assert.equal(preferences.readAloudNotifications, false);
  await setSwitch('Listen for “Hey Bread”', true);
  assert.equal(preferences.alwaysOnVoiceAssistant, true);
  const profileContents = manager.breadboardUseTargets().find(t => t.contents.id === profile.targetId).contents;
  await profileContents.loadURL(origin + '/profile');
  profileState = await until(async () => {
    const snapshot = await profileSnapshot();
    return snapshot.elements.some(e => e.name === 'Listen for “Hey Bread”' && e.checked && !e.disabled) && snapshot;
  });
  await setSwitch('Listen for “Hey Bread”', false);
  rejectPreferenceSave = true;
  await call({ action: 'set_checked', targetId: profile.targetId, snapshotId: profileState.snapshotId, ref: setting('Read notifications aloud').ref, checked: true });
  profileState = await until(async () => {
    const snapshot = await profileSnapshot();
    return snapshot.text.includes('Voice settings could not save.') && snapshot;
  });
  assert.equal(setting('Read notifications aloud').checked, false);
  assert.equal(preferences.readAloudNotifications, false, 'A failed save must not be reported as an enabled switch');
  rejectPreferenceSave = false;
  for (const name of ['Native checkbox', 'Custom switch']) {
    await setSwitch(name, true); await setSwitch(name, false);
  }
  for (const [name, error] of [['Blocked switch', /disabled/], ['Read-only switch', /read-only/]]) {
    await assert.rejects(call({ action: 'set_checked', targetId: profile.targetId, snapshotId: profileState.snapshotId, ref: setting(name).ref, checked: true }), error);
  }
  const range = setting('Questions per day');
  assert.deepEqual([range.min, range.max, range.step], ['1', '50', '1']);
  await call({ action: 'fill', targetId: profile.targetId, snapshotId: profileState.snapshotId, ref: range.ref, text: '12' });
  profileState = await profileSnapshot(); assert.match(profileState.text, /Daily limit: 12/);
  await assert.rejects(call({ action: 'fill', targetId: profile.targetId, snapshotId: profileState.snapshotId, ref: setting('Delivery channel').ref, text: 'whatsapp' }), /enabled/);
  await call({ action: 'fill', targetId: profile.targetId, snapshotId: profileState.snapshotId, ref: setting('Delivery channel').ref, text: 'telegram' });
  profileState = await profileSnapshot(); assert.match(profileState.text, /Channel: telegram/);
  // No chat card and no release_run delivery: the native lifecycle monitor
  // recovers completed app/browser jobs after the dashboard was unavailable.
  const cleanupOwner = JSON.stringify(['conversation-a', 'missed-completion']);
  const activeOwner = JSON.stringify(['conversation-a', 'still-working']);
  const cleanupJob = `job_${'c'.repeat(64)}`;
  assert.equal(manager.openBreadboardUseBrowser(appContents, origin + '/cleanup-browser', cleanupOwner), true);
  assert.equal(manager.openBreadboardUseApp(appContents, origin + '/cleanup-app', cleanupOwner), true);
  assert.equal(manager.openBreadboardUseApp(appContents, origin + '/cleanup-kept', cleanupOwner), true);
  assert.equal(manager.openBreadboardUseBrowser(appContents, origin + '/cleanup-active', activeOwner), true);
  assert.equal(await manager.handleCommand(appContents, { type: 'browser-agent', runId: cleanupJob }), true);
  const cleanupBrowser = await until(() => manager.breadboardUseTargets().find(t => t.kind === 'browser' && t.contents.getURL().endsWith('/cleanup-browser') && !t.contents.isLoading()));
  await cleanupBrowser.contents.executeJavaScript(`void window.open(${JSON.stringify(origin + '/cleanup-popup')})`, true);
  const cleanupPopup = await until(() => manager.breadboardUseTargets().find(t => t.contents.getURL().endsWith('/cleanup-popup')));
  const kept = await until(() => manager.breadboardUseTargets().find(t => t.contents.getURL().endsWith('/cleanup-kept')));
  await manager.handleCommand(appContents, { type: 'anchor', id: kept.tabId });
  const cleanupApp = await until(() => manager.breadboardUseTargets().find(t => t.contents.getURL().endsWith('/cleanup-app')));
  assert.equal(await manager.handleCommand(cleanupApp.contents, { type: 'browser', url: origin + '/cleanup-spawned' }), true);
  const spawned = manager.stateFor(appContents).tabs.find(t => t.url.endsWith('/cleanup-spawned'));
  assert.equal(spawned.browser.aiOpened, true, 'browser commands inherit the AI app page owner');
  assert.equal(manager.stateFor(appContents).activeId, dashboard.tabId, 'AI app browser commands stay in the background');
  await manager.handleCommand(appContents, { type: 'activate', id: cleanupApp.tabId });
  assert.equal(await manager.handleCommand(cleanupApp.contents, { type: 'browser', url: origin + '/cleanup-converted', replaceCurrent: true }), true);
  await manager.handleCommand(appContents, { type: 'activate', id: dashboard.tabId });
  const activeBeforeCleanup = manager.stateFor(appContents).activeId;
  cleanupStatusAvailable = false;
  finishedOwners.add(cleanupOwner); finishedOwners.add(cleanupJob);
  await assert.rejects(bridge.cleanup.reconcile());
  assert.ok(manager.automationTabOwners().includes(cleanupOwner), 'failed status reads retain tabs until completion is confirmed');
  cleanupStatusAvailable = true;
  await until(() => !manager.automationTabOwners().includes(cleanupOwner) && !manager.automationTabOwners().includes(cleanupJob));
  assert.ok(!manager.breadboardUseTargets().some(t => t.contents === cleanupBrowser.contents || t.contents === cleanupPopup.contents || /cleanup-(converted|spawned)$/.test(t.contents.getURL())));
  assert.ok(manager.breadboardUseTargets().some(t => t.contents === kept.contents && !t.aiOpened), 'anchoring keeps the page as a user tab');
  assert.ok(manager.automationTabOwners().includes(activeOwner), 'another task keeps its tabs');
  assert.equal(manager.stateFor(appContents).activeId, activeBeforeCleanup);
  assert.equal(manager.openBreadboardUseBrowser(appContents, origin + '/late-browser', cleanupOwner), false);
  assert.equal(manager.openBreadboardUseApp(appContents, origin + '/late-app', cleanupOwner), false);
  assert.equal(await manager.handleCommand(appContents, { type: 'browser-agent', runId: cleanupJob }), false, 'late UI events cannot reopen a finished job');
  manager.closeAutomationTabs(activeOwner);
  // Settings must remain reachable when the Profile tab-navigation switch is off.
  const aiBeforeDisable = manager.breadboardUseTargets().filter(t => t.aiOpened);
  const userWindows = manager.breadboardUseTargets().filter(t => !t.aiOpened && t.kind === 'app' && t.tabId !== dashboard.tabId).map(t => t.contents.getURL());
  const windowsBeforeDisable = openedWindows.length;
  manager.setEnabled(false);
  for (const target of aiBeforeDisable) {
    assert.ok(manager.breadboardUseTargets().some(t => t.contents === target.contents), 'Turning tabs off preserves temporary AI work');
  }
  assert.deepEqual(openedWindows.slice(windowsBeforeDisable).sort(), userWindows.sort(), 'Only user app pages may pop out into windows');
  const untabbedApp = manager.breadboardUseTargets().find(t => t.active && t.kind === 'app');
  await until(() => !untabbedApp.contents.isLoading());
  await untabbedApp.contents.loadURL(origin + '/dashboard');
  await call({ action: 'open', surface: 'settings' });
  const untabbedProfile = await until(async () => (await call({ action: 'state' })).targets.find(t => t.aiOpened && t.url === origin + '/settings' && !t.loading));
  assert.equal(untabbedProfile.active, false);
  assert.equal(untabbedApp.contents.getURL(), origin + '/dashboard');
  assert.equal(manager.isEnabled, false, 'Opening Profile must not turn navigation back on');
  await useBreadboard({ action: 'release_run' }, 'conversation-a', 7);
  assert.ok(!manager.breadboardUseTargets().some(t => t.aiOpened));
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
