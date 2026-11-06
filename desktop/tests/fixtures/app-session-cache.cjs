const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const { initializeAppSession } = require('../../dist/main/app-session.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const local = initializeAppSession();
  assert.equal(local, session.defaultSession, 'existing app storage keeps its session identity');
  const browser = session.fromPartition('persist:browser-cache-control');
  const hits = new Map();
  const held = new Map();
  const windows = [];
  const body = '/*' + 'x'.repeat(256 * 1024) + '*/window.hydrated=true;';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.endsWith('.js')) {
      const count = (hits.get(url.pathname) ?? 0) + 1;
      hits.set(url.pathname, count);
      res.writeHead(200, {
        'content-type': 'application/javascript',
        'cache-control': 'public,max-age=31536000,immutable',
        'content-length': Buffer.byteLength(body),
      });
      if (url.pathname.includes('stalled') && count === 1) {
        // An unfinished background download owns this shared HTTP cache entry.
        // The selected tab needs the same chunk to hydrate its PDF viewer.
        res.write(body.slice(0, 192 * 1024));
        held.set(url.pathname, res);
      } else res.end(body);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(`<!doctype html><script src="${url.searchParams.get('script')}" async></script><body>Opening PDF</body>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const until = async (probe, label, timeout = 4000) => {
    for (const end = Date.now() + timeout; Date.now() < end;) {
      if (await probe()) return;
      await sleep(25);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const create = (targetSession, script) => {
    const window = new BrowserWindow({ show: false, webPreferences: { session: targetSession, backgroundThrottling: false } });
    windows.push(window);
    window.webContents.debugger.attach('1.3');
    // executeJavaScript waits for load completion; CDP can inspect the actual
    // unhydrated document while its async script is blocked on the cache.
    const evaluate = async expression => {
      const value = await window.webContents.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true });
      return value.result.value;
    };
    const loaded = window.loadURL(`${origin}/page?script=${script}`).catch(() => {});
    return { window, evaluate, loaded };
  };

  // Control: reproduce the hang with normal caching. It is a cache wait, not
  // renderer visibility or PDF parsing: request #2 never reaches the server.
  create(browser, '/browser-stalled.js');
  await until(() => held.has('/browser-stalled.js'), 'cached writer starts');
  await sleep(250);
  const blocked = create(browser, '/browser-stalled.js');
  await until(() => blocked.evaluate('document.readyState === "interactive"'), 'cached reader has its HTML');
  await sleep(500);
  assert.equal(hits.get('/browser-stalled.js'), 1);
  assert.equal(await blocked.evaluate('window.hydrated === true'), false);

  // The real default app session must hydrate a second tab despite the same
  // held response, and keep doing so across document reloads/tab restores.
  create(local, '/local-stalled.js');
  await until(() => held.has('/local-stalled.js'), 'local writer starts');
  await sleep(250);
  const selected = create(local, '/local-stalled.js');
  await until(() => selected.evaluate('window.hydrated === true'), 'selected PDF hydrates');
  assert.equal(hits.get('/local-stalled.js'), 2);
  await selected.evaluate('localStorage.setItem("annotation-draft", "keep me")');
  await local.cookies.set({ url: origin, name: 'session-fixture', value: 'preserved' });
  for (let attempt = 0; attempt < 2; attempt++) {
    await selected.window.loadURL(`${origin}/restored-${attempt}?script=/local-stalled.js`);
    assert.equal(await selected.evaluate('window.hydrated === true'), true);
    assert.equal(await selected.evaluate('localStorage.getItem("annotation-draft")'), 'keep me');
  }
  // A renderer may reuse its already-complete in-memory script on navigation;
  // the network cache's unfinished writer must not delay any of these loads.
  assert.equal((await local.cookies.get({ url: origin, name: 'session-fixture' }))[0]?.value, 'preserved');

  // Website caching is unaffected by the local application's cache policy.
  const website = create(browser, '/website.js');
  await website.loaded;
  await website.window.loadURL(`${origin}/website-again?script=/website.js`);
  assert.equal(hits.get('/website.js'), 1, 'browser pages keep their HTTP cache');
  for (const window of windows) window.destroy();
  server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
