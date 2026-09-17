const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, session, webContents } = require('electron');
const { TabManager, BROWSER_SESSION_PARTITION } = require('../../dist/main/tab-manager.js');
const { restoreBrowserSession, flushBrowserSession } = require('../../dist/main/browser-session-persistence.js');
const { IPC_CHANNELS } = require('../../dist/shared/ipc-contract.js');
const [phase, dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  console.log('Checking:', label);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + label);
};
const listen = (server, port = 0) => new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

app.whenReady().then(async () => {
  await restoreBrowserSession(session.fromPartition(BROWSER_SESSION_PARTITION));
  const dashboard = path.resolve(__dirname, '../../../dashboard');
  const requireDashboard = createRequire(path.join(dashboard, 'package.json'));
  const jsx = `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import BrowserProfilePanel from './src/app/profile/browser-profile-panel';
    createRoot(document.getElementById('root')).render(<BrowserProfilePanel/>);
  `;
  const script = requireDashboard('esbuild').buildSync({
    stdin: { contents: jsx, resolveDir: dashboard, loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text;
  const panelSource = fs.readFileSync(path.join(dashboard, 'src/app/profile/browser-profile-panel.tsx'), 'utf8');
  const compiler = await requireDashboard('@tailwindcss/node').compile(fs.readFileSync(path.join(dashboard, 'src/app/globals.css'), 'utf8'), {
    base: path.join(dashboard, 'src/app'), onDependency() {},
  });
  const scanner = new (requireDashboard('@tailwindcss/oxide').Scanner)({});
  const css = compiler.build(scanner.scanFiles([{ content: panelSource, extension: 'tsx' }]));
  let legacyRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url.includes('/api/agent-browser/browser-profile')) legacyRequests++;
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(script); }
    if (req.url === '/app.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/app.css"><style>body{margin:0;font-family:Arial;padding:32px}#root{max-width:480px;margin:auto}:root{--font-schibsted:Arial;--font-source-sans:Arial}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  const external = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/login') res.setHeader('Set-Cookie', 'fixture-signin=fixture-value; HttpOnly; Path=/; SameSite=Lax');
    res.end(`<!doctype html><title>Sign-in fixture</title><body>${req.headers.cookie?.includes('fixture-signin=fixture-value') ? 'Signed in' : 'Sign-in page'}</body>`);
  });
  const savedPort = path.join(dir, 'site-port.txt');
  const origin = await listen(server);
  const web = await listen(external, phase === 'save' ? 0 : Number(fs.readFileSync(savedPort, 'utf8')));
  if (phase === 'save') fs.writeFileSync(savedPort, String(external.address().port));
  const loading = path.join(dir, 'loading.html');
  fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  let externalLaunches = 0;
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'),
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => 'light',
    openExternal: () => { externalLaunches++; }, onBrowserAgentPageReady: async () => true,
  });
  manager.setBrowserUrl(origin + '/browser');
  const window = new BrowserWindow({ show: false, width: 640, height: 800, webPreferences: {
    preload: path.resolve(__dirname, '../../dist/preload/preload.js'), contextIsolation: true, sandbox: true,
  } });
  manager.attach(window);
  const shell = window.webContents;
  shell.on('console-message', (_event, level, message) => { if (level >= 2) console.log('Renderer:', message); });
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => manager.handleCommand(event.sender, command));
  ipcMain.handle(IPC_CHANNELS.getBrowserSignIns, () => manager.browserSignIns());
  ipcMain.handle(IPC_CHANNELS.openBrowserSignIn, (event, url) => manager.openBrowserSignIn(event.sender, url));
  ipcMain.handle(IPC_CHANNELS.resetBrowserSignIns, () => manager.resetBrowserSignIns());
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  const privateSession = session.fromPartition('browser-sign-ins-private-fixture');
  await privateSession.cookies.set({ url: 'https://private.example.test', name: 'private', value: 'fixture' });
  await shell.session.cookies.set({ url: 'https://breadboard.example.test', name: 'account', value: 'fixture', expirationDate: Date.now() / 1000 + 86400 });
  await shell.session.cookies.flushStore();
  await window.loadURL(origin + '/profile');
  const button = label => `[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(label)})`;
  const click = label => shell.executeJavaScript(`${button(label)}.click()`);
  const read = () => shell.executeJavaScript('window.breadboardDesktop.getBrowserSignIns()');
  const refresh = () => shell.executeJavaScript("window.dispatchEvent(new Event('focus'))");
  await until(() => shell.executeJavaScript(`Boolean(${button('Open Breadboard browser')} && !${button('Open Breadboard browser')}.disabled)`), 'profile controls ready');
  assert.doesNotMatch(await shell.executeJavaScript('document.body.innerText'), /Microsoft Edge|agent-browser-profile|No Chrome/);

  if (phase === 'save') {
    assert.deepEqual(await read(), { sites: [], openPages: 0 });
    // A malformed URL must never reach either browser.
    await shell.executeJavaScript(`{ const input=document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'javascript:alert(1)'); input.dispatchEvent(new Event('input',{bubbles:true})); }`);
    await click('Open Breadboard browser');
    await until(() => shell.executeJavaScript("Boolean(document.querySelector('[role=alert]'))"), 'invalid URL error');
    assert.equal(manager.stateFor(shell).tabs.length, 1);
    await shell.executeJavaScript(`{ const input=document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(web + '/login')}); input.dispatchEvent(new Event('input',{bubbles:true})); }`);
    await click('Open Breadboard browser');
    let page;
    await until(() => {
      page = webContents.getAllWebContents().find(contents => contents.getURL() === web + '/login');
      return page && !page.isLoading();
    }, 'sign-in opens inside Breadboard');
    assert.equal(page.session, browserSession);
    assert.equal(await page.executeJavaScript('typeof window.breadboardDesktop'), 'undefined');
    await page.executeJavaScript("localStorage.setItem('fixture-token','fixture-value')");
    assert.deepEqual(await read(), { sites: ['127.0.0.1'], openPages: 1 });
    assert.equal(await shell.executeJavaScript('window.breadboardDesktop.resetBrowserSignIns()'), false);
    assert.equal(manager.openBrowserSignIn(page, web), false, 'untrusted page cannot open sign-ins');

    // An agent tab sees exactly the sign-in the Profile button just created.
    const runId = 'job_' + 'a'.repeat(64);
    assert.equal(await manager.handleCommand(shell, { type: 'browser-agent', runId }), true);
    const agentPage = webContents.getAllWebContents().find(contents => contents.getURL().includes('breadboard-browser-agent='));
    assert.ok(agentPage);
    assert.equal(agentPage.session, browserSession);
    await agentPage.loadURL(web + '/agent');
    assert.equal(await agentPage.executeJavaScript('document.body.innerText'), 'Signed in');
    assert.equal(await agentPage.executeJavaScript("localStorage.getItem('fixture-token')"), 'fixture-value');
    await flushBrowserSession(browserSession);
  } else {
    assert.deepEqual((await read()).sites, phase === 'restore' ? ['127.0.0.1'] : []);
    if (phase === 'restore') {
      assert.equal(manager.openBrowserSignIn(shell, web + '/restored'), true);
      let restoredPage;
      await until(() => {
        restoredPage = webContents.getAllWebContents().find(contents => contents.getURL() === web + '/restored');
        return restoredPage && !restoredPage.isLoading();
      }, 'persistent site data after restart');
      assert.equal(await restoredPage.executeJavaScript("localStorage.getItem('fixture-token')"), 'fixture-value');
      assert.equal(await restoredPage.executeJavaScript('document.body.innerText'), 'Signed in');
      await manager.handleCommand(shell, { type: 'close', id: manager.stateFor(shell).activeId });
      await refresh();
      await until(() => shell.executeJavaScript("document.body.innerText.includes('127.0.0.1')"), 'saved sites shown after restart');
      await until(() => shell.executeJavaScript(`!${button('Forget sign-ins')}.disabled`), 'reset available after closing browser');
      if (process.env.BREADBOARD_SIGN_INS_QA_DIR) {
        fs.mkdirSync(process.env.BREADBOARD_SIGN_INS_QA_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.BREADBOARD_SIGN_INS_QA_DIR, 'profile-sign-ins.png'), (await shell.capturePage()).toPNG());
      }
      await click('Forget sign-ins');
      await until(() => shell.executeJavaScript(`Boolean(${button('Delete every sign-in')})`), 'reset confirmation');
      assert.equal((await read()).sites.length, 1, 'confirmation alone must not delete anything');
      await click('Delete every sign-in');
      await until(async () => (await read()).sites.length === 0, 'built-in session reset');
      await refresh();
    }
    assert.equal((await shell.session.cookies.get({ name: 'account' })).length, 1, 'Breadboard account kept');
    assert.equal((await privateSession.cookies.get({ name: 'private' })).length, 1, 'private browser kept');
    if (phase === 'cleared') {
      assert.equal(manager.openBrowserSignIn(shell, web + '/after-reset'), true);
      let page;
      await until(() => {
        page = webContents.getAllWebContents().find(contents => contents.getURL() === web + '/after-reset');
        return page && !page.isLoading();
      }, 'browser after reset');
      assert.equal(await page.executeJavaScript("localStorage.getItem('fixture-token')"), null);
      assert.equal(await page.executeJavaScript('document.body.innerText'), 'Sign-in page');
    }
  }
  for (const tab of manager.stateFor(shell).tabs.filter(tab => tab.browser)) {
    await manager.handleCommand(shell, { type: 'close', id: tab.id });
  }
  manager.setEnabled(false);
  assert.equal(manager.openBrowserSignIn(shell, 'https://example.test'), false);
  await until(() => shell.executeJavaScript(`${button('Open Breadboard browser')}.disabled`), 'sign-in button disabled with browser navigation off');
  assert.equal(externalLaunches, 0, 'never falls back to Edge or another external browser');
  assert.equal(legacyRequests, 0, 'profile never reads or mutates the old external profile');
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
  console.log('Profile browser sign-in checks passed:', phase);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
