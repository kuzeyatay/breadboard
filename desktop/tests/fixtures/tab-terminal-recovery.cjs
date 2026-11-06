const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const runtime = process.env.BREADBOARD_TEST_DIST || path.resolve(__dirname, '../../dist');
const { TabManager } = require(path.join(runtime, 'main/tab-manager.js'));
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const until = async (probe, label) => {
  for (const deadline = Date.now() + 12000; Date.now() < deadline;) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Timed out: ' + label);
};
app.whenReady().then(async () => {
  let hold = false, unavailable = false;
  const responses = [];
  const server = http.createServer((req, res) => {
    if (unavailable && req.url.includes('two')) { res.destroy(); return; }
    const send = () => {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><html data-breadboard-startup="${hold && req.url.includes('two') ? 'pending' : 'ready'}"><title>Terminal</title><body><input id="search" value="draft"><script>window.sessionMarker = Math.random()</script></body></html>`);
    };
    if (hold && req.url.includes('two')) responses.push(send);
    else send();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, 'recovery.html');
  fs.writeFileSync(scene, '<!doctype html><body>Reconnecting to your workspace</body>');
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    preloadPath: path.join(runtime, 'preload/preload.js'),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => 'dark', openWindow: () => assert.fail('Unexpected window'),
    log: line => console.log(line),
  });
  manager.scheduleNewTabPreparation = () => {};
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  window.setOpacity(0); window.showInactive();
  manager.attach(window, true);
  const host = manager.hosts.get(window.id);
  await host.base.contents.loadURL(origin + '/base');
  await until(() => host.shellEnabled && !host.pending, 'shell ready');
  manager.setNewTabUrl(origin + '/new-tab');
  const terminal = async suffix => {
    const tab = manager.createView(host, origin + '/new-tab?' + suffix);
    host.tabs.push(tab);
    manager.activate(host, tab.id);
    await until(() => host.presentedId === tab.id && !host.pending, 'Terminal ready');
    return tab;
  };
  const first = await terminal('one');
  const second = await terminal('two');
  const firstSession = await first.contents.executeJavaScript('window.sessionMarker');
  const navigations = [];
  second.contents.on('did-start-navigation', (_event, url, _inPlace, main) => { if (main) navigations.push(url); });
  manager.activate(host, first.id);
  await until(() => host.presentedId === first.id && !host.pending, 'first selected');
  hold = true;
  const gone = new Promise(resolve => second.contents.once('render-process-gone', resolve));
  second.contents.forcefullyCrashRenderer();
  await gone;
  await until(() => responses.length > 0, 'crashed Terminal restores directly');
  assert.equal(navigations.some(url => url.startsWith('file:')), false, 'a renderer crash is not a workspace disconnection');
  manager.activate(host, second.id);
  assert.equal(host.pending, second, 'selection waits for the recovering Terminal');
  assert.equal(host.pendingAtFront, false, 'unready recovery must not cover the healthy Terminal');
  assert.equal(host.presentedId, first.id);
  responses.splice(0).forEach(send => send());
  await until(() => second.loaded, 'replacement document arrived');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(host.presentedId, first.id, 'DOM-ready is not widget readiness');
  await second.contents.executeJavaScript("document.documentElement.dataset.breadboardStartup = 'ready'");
  await until(() => host.presentedId === second.id && !host.pending, 'recovered Terminal presented');
  assert.equal(await first.contents.executeJavaScript('window.sessionMarker'), firstSession, 'healthy Terminal was not reloaded');
  assert.equal(second.recovering, false);
  hold = false;
  for (let i = 0; i < 30; i++) {
    const tab = i % 2 ? second : first;
    manager.activate(host, tab.id);
    await until(() => host.presentedId === tab.id && !host.pending, 'warm switch');
    assert.equal(tab.contents.isCrashed(), false);
  }
  assert.equal(navigations.filter(url => url.includes('/new-tab?two')).length, 1, 'switches do not reload recovered Terminal');
  // Completing a background restore must not select that tab again.
  hold = true;
  manager.activate(host, first.id);
  let exited = new Promise(resolve => second.contents.once('render-process-gone', resolve));
  second.contents.forcefullyCrashRenderer(); await exited;
  await until(() => responses.length > 0, 'second recovery requested');
  manager.activate(host, second.id);
  manager.activate(host, first.id);
  hold = false;
  responses.splice(0).forEach(send => send());
  await until(() => second.loaded && !second.recovering, 'background restore finished');
  assert.equal(host.activeId, first.id);
  assert.equal(host.presentedId, first.id, 'late recovery cannot steal selection');
  assert.equal(navigations.some(url => url.startsWith('file:')), false);

  // Unlike renderer failure, an actual unavailable server retains reconnect.
  unavailable = true;
  exited = new Promise(resolve => second.contents.once('render-process-gone', resolve));
  second.contents.forcefullyCrashRenderer(); await exited;
  await until(() => second.contents.getURL().startsWith('file:'), 'real outage has recovery UI');
  unavailable = false;
  await until(() => second.loaded && !second.recovering && second.contents.getURL().includes('/new-tab'), 'server recovery');
  assert.equal(host.activeId, first.id);

  // Navigation supersedes an in-flight Terminal restore, even if it finishes late.
  hold = true;
  exited = new Promise(resolve => second.contents.once('render-process-gone', resolve));
  second.contents.forcefullyCrashRenderer(); await exited;
  await until(() => responses.length > 0, 'last restore pending');
  await second.contents.loadURL(origin + '/settings');
  hold = false;
  responses.splice(0).forEach(send => send());
  await until(() => !second.recovering, 'superseded restore retired');
  assert.equal(second.contents.getURL(), origin + '/settings');
  assert.equal(host.activeId, first.id);
  console.log('PASS: real renderer crashes; direct restore; readiness handoff; 30 warm switches; late recovery; server outage; superseding navigation');
  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
