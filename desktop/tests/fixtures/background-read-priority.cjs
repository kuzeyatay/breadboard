const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  for (const end = Date.now() + 5000; Date.now() < end;) {
    if (await probe()) return;
    await sleep(20);
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  for (const fixed of [false, true]) {
    let polls = 0;
    let scriptReads = 0;
    const server = http.createServer((req, res) => {
      res.setHeader('cache-control', 'no-store');
      if (req.url.startsWith('/poll')) {
        polls++;
        setTimeout(() => res.end('refresh'), 120);
      } else if (req.url === '/bootstrap.js') {
        scriptReads++;
        res.setHeader('content-type', 'application/javascript');
        res.end('window.hydrated=true;document.body.textContent="PDF ready";');
      } else {
        res.setHeader('content-type', 'text/html');
        res.end(req.url === '/pdf'
          ? '<!doctype html><body>Opening PDF<script async src="/bootstrap.js"></script>'
          : '<!doctype html><body>Background workspace');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const prefs = { backgroundThrottling: false, partition: `priority-${fixed}` };
    const background = new BrowserWindow({ show: false, webPreferences: {
      ...prefs, ...(fixed ? { preload: path.resolve(__dirname, '../../dist/preload/preload.js') } : {}),
    } });
    const selected = new BrowserWindow({ show: false, webPreferences: prefs });
    await background.loadURL(origin + '/workspace');
    if (fixed) assert.equal(await background.webContents.executeJavaScript('window.__breadboardBackgroundReadPriority'), true,
      'the actual sandboxed preload installs the policy before UI polling');
    await background.webContents.executeJavaScript(`
      document.documentElement.dataset.desktopTabActive='false';
      window.polling=true;
      for(let i=0;i<12;i++) void (async()=>{while(window.polling){try{await(await fetch('/poll?lane='+i)).text()}catch{}}})();
    `);
    await until(() => polls >= 6, 'all HTTP/1 sockets occupied by polling');
    selected.webContents.debugger.attach('1.3');
    const hydrated = async () => (await selected.webContents.debugger.sendCommand('Runtime.evaluate', {
      expression: 'window.hydrated === true',
    })).result.value;
    void selected.loadURL(origin + '/pdf').catch(() => {});
    if (!fixed) {
      await sleep(1600);
      assert.equal(await hydrated(), false, 'normal-priority background fetches starve async bootstrap');
      assert.equal(scriptReads, 0, 'the pending script never reaches the server');
    } else {
      await until(hydrated, 'PDF hydrates while all background poll loops keep running');
      assert.equal(scriptReads, 1);
      assert.equal(await background.webContents.executeJavaScript('window.polling'), true);
    }
    await background.webContents.executeJavaScript('window.polling=false');
    background.destroy(); selected.destroy();
    server.closeAllConnections(); server.close();
  }
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
