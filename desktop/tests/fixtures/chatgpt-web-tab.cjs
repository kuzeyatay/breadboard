// The ChatGPT tab the shell lends to ChatMock's "OpenAI (web)" provider,
// against a real Electron window with its DevTools port on.
//
// Proves the whole handshake: a Breadboard page asks through the preload
// bridge, the shell opens one built-in browser tab, the tab is listed on the
// CDP port under the id the shell answered with, a second request reuses the
// same tab, and ChatMock's Python page driver can attach to that id, inject
// its page script, navigate the tab, and hear the page's binding.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const { configureBrowserAgentDebugging } = require('../../dist/main/browser-agent-session.js');
const { IPC_CHANNELS, isChatgptWebTabRequest } = require('../../dist/shared/ipc-contract.js');

const dir = process.argv[2];
const resultFile = path.join(dir, 'result.json');
app.setPath('userData', path.join(dir, 'profile'));
const cdpPort = configureBrowserAgentDebugging(app.commandLine, app.getPath('userData'));
app.on('window-all-closed', () => {});
const until = async (probe, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out: ' + label);
};
const finish = (result) => {
  fs.writeFileSync(resultFile, JSON.stringify(result));
  app.exit(0);
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Fixture</title><body>Breadboard page</body>');
  });
  const external = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Somewhere</title><body><p>an ordinary web page</p></body>');
  });
  const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`)));
  const origin = await listen(server);
  const web = await listen(external);
  const loading = path.join(dir, 'loading.html');
  fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  const windows = new WindowManager({
    startupHtmlPath: loading, recoveryHtmlPath: loading, loadingHtmlPath: loading,
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    browserHistoryConfigDir: dir, browserVisitedLinksConfigDir: dir, tabSessionConfigDir: dir,
    log: line => fs.appendFileSync(path.join(dir, 'trace.log'), line + String.fromCharCode(10)),
  });
  const manager = windows.tabs;
  manager.setBrowserUrl(origin + '/browser');
  manager.setNewTabUrl(origin + '/new-tab');
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.handleCommand(event.sender, command));
  ipcMain.handle(IPC_CHANNELS.chatgptWebTab, (event, request) =>
    isChatgptWebTabRequest(request)
      ? manager.openChatgptWebTab({ foreground: request.foreground, reset: request.reset === true, lane: request.lane, cdpPort })
      : { ok: false, error: 'invalid request' });

  const window = windows.createMainWindow();
  await window.loadURL(origin + '/dashboard');
  window.show();
  const page = window.webContents;
  const ask = (foreground, reset = false, lane = undefined) =>
    page.executeJavaScript(`window.breadboardDesktop.chatgptWebTab(${JSON.stringify(lane ? { foreground, reset, lane } : { foreground, reset })})`);

  const result = { cdpPort };
  // Where the ChatGPT window is, and whether any display can show it. Parked,
  // it is deliberately still a "visible" window - the test is that it sits
  // where no monitor reaches and stays out of the taskbar/Alt-Tab.
  const chatgptWindow = () => BrowserWindow.getAllWindows().find(w => w !== window && w.getTitle() === 'Sign in to ChatGPT') || null;
  const whereIsIt = () => {
    const w = chatgptWindow();
    if (!w) return null;
    const bounds = w.getBounds();
    const onScreen = screen.getAllDisplays().some(display =>
      bounds.x < display.bounds.x + display.bounds.width && bounds.x + bounds.width > display.bounds.x &&
      bounds.y < display.bounds.y + display.bounds.height && bounds.y + bounds.height > display.bounds.y);
    return { bounds, onScreen, visible: w.isVisible(), opacity: w.getOpacity(), alwaysOnTop: w.isAlwaysOnTop() };
  };
  const step = (label) => fs.appendFileSync(path.join(dir, 'trace.log'), '[fixture] ' + label + String.fromCharCode(10));
  const traceTail = () => fs.existsSync(path.join(dir, 'trace.log')) ? fs.readFileSync(path.join(dir, 'trace.log'), 'utf8').slice(-3000) : '';
  try {
    step('asking first');
    const first = await ask(false);
    step('first ' + JSON.stringify(first));
    result.first = first;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.cdpPort, cdpPort);
    const before = manager.stateFor(page);
    result.tabsAfterFirst = before.tabs.map(tab => ({ title: tab.title, browser: !!tab.browser }));
    // Nothing for the person to see: no tab, and the window it does live in
    // sits off every display.
    assert.equal(before.tabs.some(tab => tab.browser), false);
    assert.equal(manager.chatgptWebPageVisible(), false);
    result.parkedFirst = whereIsIt();
    assert.ok(result.parkedFirst, 'the ChatGPT window should exist');
    // Parked: a running window that draws nothing.
    assert.equal(result.parkedFirst.opacity, 0, JSON.stringify(result.parkedFirst));
    assert.equal(result.parkedFirst.alwaysOnTop, true, JSON.stringify(result.parkedFirst));
    const evalIn = (label) => Promise.race([
      manager.chatgptWebPageContents().executeJavaScript('document.visibilityState + String.fromCharCode(58) + location.href').then(v => label + ' ' + v),
      new Promise(r => setTimeout(() => r(label + ' TIMEOUT'), 5000)),
    ]);
    result.evalHiddenFirst = await evalIn('hidden-first');
    step(result.evalHiddenFirst);
    if (process.argv[3] === '--hold-after-first') { fs.writeFileSync(resultFile, JSON.stringify(result)); return; }
    if (process.argv[3] === '--hold-shown') { await ask(true); result.shown = whereIsIt(); fs.writeFileSync(resultFile, JSON.stringify(result)); return; }

    const listed = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    result.listedTarget = listed.find(target => target.id === first.targetId) || null;
    assert.ok(result.listedTarget, 'the shell answered with a target id CDP does not list');

    step('asking second');
    const second = await ask(true);
    step('second ' + JSON.stringify(second));
    result.second = second;
    assert.deepEqual(second, first, 'a second request must reuse the same page');
    // Signing in is the one time it comes into view, and still not as a tab.
    assert.equal(manager.chatgptWebPageVisible(), true);
    result.shownForSignIn = whereIsIt();
    assert.equal(result.shownForSignIn.onScreen, true, JSON.stringify(result.shownForSignIn));
    assert.equal(result.shownForSignIn.opacity, 1, JSON.stringify(result.shownForSignIn));
    assert.equal(manager.stateFor(page).tabs.some(tab => tab.browser), false);

    // The person closing the sign-in window parks it again rather than ending
    // the session ChatMock is attached to.
    chatgptWindow().close();
    await until(() => !manager.chatgptWebPageVisible(), 'the closed window to park');
    result.parkedAfterClose = whereIsIt();
    assert.equal(result.parkedAfterClose.opacity, 0, JSON.stringify(result.parkedAfterClose));

    const third = await ask(false);
    assert.deepEqual(third, first);
    assert.equal(manager.chatgptWebPageVisible(), false);
    result.stillListed = !!(await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(target => target.id === first.targetId);
    assert.equal(result.stillListed, true, 'hiding the page must not destroy it');
    result.evalAfterHide = await evalIn('after-parked');
    step(result.evalAfterHide);
    try {
      const dbg = manager.chatgptWebPageContents().debugger;
      dbg.attach('1.3');
      const r = await Promise.race([dbg.sendCommand('Runtime.evaluate', { expression: 'location.href', returnByValue: true }), new Promise(res => setTimeout(() => res('TIMEOUT'), 5000))]);
      step('debugger after-hide ' + JSON.stringify(r));
      dbg.detach();
    } catch (error) { step('debugger error ' + error.message); }

    step('probing');
    const python = process.platform === 'win32' ? 'python' : 'python3';
    // Asynchronously: /json/list is answered on the main thread, so a blocking
    // spawnSync here would starve the very endpoint the probe is asking.
    const probe = await new Promise((resolve) => {
      const child = spawn(python, [path.join(__dirname, 'chatgpt-web-cdp-probe.py'), String(cdpPort), first.targetId, web + '/page'], { windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on('close', () => { clearTimeout(timer); resolve({ stdout, stderr }); });
    });
    result.probeStderr = (probe.stderr || '').slice(-2000);
    const line = (probe.stdout || '').trim().split('\n').pop();
    result.probe = line ? JSON.parse(line) : null;
    step('probe ' + line);

    // A request that names no lane is the interactive page, and says so;
    // the batch lane is a page of its own, so a Learn stage on one never
    // occupies the chat composer on the other.
    assert.equal(first.lane, 'interactive', JSON.stringify(first));
    step('asking for the batch lane');
    const batch = await ask(false, false, 'batch');
    step('batch ' + JSON.stringify(batch));
    result.batch = batch;
    assert.equal(batch.ok, true, JSON.stringify(batch));
    assert.equal(batch.lane, 'batch', JSON.stringify(batch));
    assert.notEqual(batch.targetId, first.targetId, 'the batch lane must be its own page');
    const listedWithBatch = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).map(target => target.id);
    assert.ok(listedWithBatch.includes(first.targetId) && listedWithBatch.includes(batch.targetId), 'both pages must be listed');
    assert.deepEqual(await ask(false, false, 'batch'), batch, 'the batch lane reuses its page');
    assert.deepEqual(await ask(false, false, 'interactive'), first, 'naming the interactive lane is the default page');
    assert.equal(manager.chatgptWebPageVisible('batch'), false);
    assert.ok(manager.chatgptWebPageContents('batch'), 'the batch page stays alive');

    // A page that stopped answering DevTools is recovered by replacing it:
    // ChatMock asks with `reset`, and gets a page of its own target id while
    // the old one leaves the listing. Only that lane's page is replaced.
    step('asking for a replacement');
    const fresh = await ask(false, true);
    step('reset ' + JSON.stringify(fresh));
    result.reset = fresh;
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.notEqual(fresh.targetId, first.targetId, 'a reset must build a new page');
    const listedNow = async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).map(target => target.id);
    result.oldTargetGone = await until(async () => !(await listedNow()).includes(first.targetId), 'the replaced page to go');
    assert.ok((await listedNow()).includes(fresh.targetId), 'the replacement must be listed');
    assert.ok((await listedNow()).includes(batch.targetId), 'resetting the interactive page must leave the batch page alone');
    assert.equal(manager.chatgptWebPageVisible(), false);

    // ChatMock drove the hidden page; the strip never knew.
    assert.equal(manager.stateFor(page).tabs.some(tab => tab.browser), false);
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = error && error.stack ? error.stack : String(error);
  }
  result.trace = traceTail();
  if (process.argv[3] === "--hold") { fs.writeFileSync(resultFile, JSON.stringify(result)); return; }
  finish(result);
});
