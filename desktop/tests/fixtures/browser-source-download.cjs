const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { BrowserTerminalBridge } = require('../../dist/main/browser-terminal.js');
const { browserSourceDestination, fetchBrowserSource } = require('../../dist/main/browser-source-download.js');
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const { readBrowserTerminal, downloadBrowserTerminalSource, browserTerminalPrompt } = require(path.join(dir, 'transport.cjs'));
  const pdf = Buffer.from('%PDF-1.4\noriginal authenticated lab bytes\n%%EOF');
  const largePdf = Buffer.alloc(2 * 1024 * 1024 + 137, 65);
  largePdf.write('%PDF-1.4\n');
  let slowStarted;
  let slowReady;
  const prepareSlow = () => { slowReady = new Promise(resolve => { slowStarted = resolve; }); };
  prepareSlow();
  const server = http.createServer((req, res) => {
    if (req.url === '/courses/42/files/7/download') {
      if (!req.headers.cookie?.includes('fixture_session=signed-in')) { res.writeHead(401); res.end(); return; }
      res.writeHead(302, { location: '/private-file' }); res.end(); return;
    }
    if (req.url === '/private-file') {
      if (!req.headers.cookie?.includes('fixture_session=signed-in')) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': "attachment; filename*=UTF-8''5ECE0_LAB.pdf" });
      res.end(pdf); return;
    }
    if (req.url === '/large') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': 64 * 1024 * 1024 + 1 }); res.end(); return;
    }
    if (req.url === '/complete-large.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(largePdf); return;
    }
    if (req.url === '/fake.pdf') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end('<!doctype html><html>Sign in</html>'); return;
    }
    if (req.url === '/wrong.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('This is not a PDF'); return;
    }
    if (req.url === '/empty.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(); return;
    }
    if (req.url === '/oversized-stream.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      const chunk = Buffer.alloc(1024 * 1024); chunk.write('%PDF-1.4'); let count = 0;
      const write = () => {
        while (!res.destroyed && count++ < 65) { if (!res.write(chunk)) { res.once('drain', write); return; } }
        if (!res.destroyed) res.end();
      };
      write(); return;
    }
    if (req.url === '/slow.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' }); res.write('%PDF-1.4\n');
      slowStarted(); return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'fixture_session=signed-in; HttpOnly; SameSite=Lax; Path=/' });
    res.end('<!doctype html><title>Course</title><body><a class="instructure_file_link" href="/courses/42/files/7?wrap=1">Reader</a></body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const window = new BrowserWindow({ show: false, webPreferences: { partition: 'browser-source-fixture', sandbox: true } });
  const page = window.webContents;
  const bridge = new BrowserTerminalBridge();
  await page.loadURL(origin + '/course');
  const access = await bridge.grant(() => page.isDestroyed() ? null : page);
  try {
    const snapshot = await readBrowserTerminal(access);
    const link = snapshot.links.find(link => link.text === 'Reader');
    assert.equal(link.downloadUrl, origin + '/courses/42/files/7/download');
    assert.match(await browserTerminalPrompt(access), /useBrowserSession=true/);
    assert.equal((await fetch(link.downloadUrl)).status, 401, 'ordinary fetch cannot see Chromium cookies');
    const file = await downloadBrowserTerminalSource(access, link.downloadUrl);
    assert.equal(file.name, '5ECE0_LAB.pdf');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
    const completeLarge = await downloadBrowserTerminalSource(access, origin + '/complete-large.pdf');
    assert.deepEqual(Buffer.from(await completeLarge.arrayBuffer()), largePdf);
    assert.ok(!JSON.stringify(snapshot).includes('fixture_session'));
    await assert.rejects(downloadBrowserTerminalSource(access, origin + '/course'), /page instead of a file/);
    await assert.rejects(downloadBrowserTerminalSource(access, origin + '/fake.pdf'), /login or preview/);
    await assert.rejects(downloadBrowserTerminalSource(access, origin + '/large'), /64 MiB/);
    await assert.rejects(downloadBrowserTerminalSource(access, origin + '/wrong.pdf'), /not a PDF/);
    await assert.rejects(downloadBrowserTerminalSource(access, origin + '/empty.pdf'), /empty|interrupted/);
    await assert.rejects(async () => {
      const oversized = await downloadBrowserTerminalSource(access, origin + '/oversized-stream.pdf');
      assert.fail(`Oversized file accepted: ${oversized.size} bytes`);
    }, /limit|interrupted/);
    await assert.rejects(downloadBrowserTerminalSource(access, 'https://example.com/other.pdf'), /linked browser page's site/);
    const forged = await fetch(`http://127.0.0.1:${access.port}/browser-terminal`, {
      method: 'POST', headers: { Authorization: `Bearer ${access.token}`, Origin: origin }, body: JSON.stringify({ action: 'download', url: link.downloadUrl }),
    });
    assert.equal(forged.status, 403);
    for (const unsafe of ['file:///tmp/file', 'https://127.0.0.1/file', 'https://[::1]/file', 'https://10.0.0.1/file', 'http://example.com/file']) {
      await assert.rejects(browserSourceDestination(unsafe, origin, true));
    }
    // CDN handoff carries a signed URL, never the source site's credentials.
    const requests = [];
    const response = await fetchBrowserSource(page.session, origin, link.downloadUrl, new AbortController().signal, () => {}, async (url, credentials) => {
      requests.push([url, credentials]);
      return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://203.0.113.9/file.pdf?signature=test' } })
        : new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
    });
    await response.response.body.cancel();
    assert.deepEqual(requests.map(request => request[1]), ['include', 'omit']);
    const interrupted = assert.rejects(downloadBrowserTerminalSource(access, origin + '/slow.pdf'), /interrupted|changed|abort/i);
    await slowReady;
    await page.loadURL(origin + '/elsewhere');
    await interrupted;
    prepareSlow();
    const revoked = assert.rejects(downloadBrowserTerminalSource(access, origin + '/slow.pdf'), /interrupted|abort/i);
    await slowReady;
    bridge.revoke(access);
    await revoked;
    await assert.rejects(downloadBrowserTerminalSource(access, link.downloadUrl), /expired/);
  } finally {
    window.destroy();
    await bridge.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
  console.log('Authenticated browser imports: original bytes, session cookies, Canvas links, redirects, limits, navigation and revocation passed.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
