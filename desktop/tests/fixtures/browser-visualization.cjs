const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  for (const deadline = Date.now() + 6000; Date.now() < deadline;) {
    if (await probe()) return;
    await sleep(20);
  }
  throw Error('Timed out: ' + label);
};

app.whenReady().then(async () => {
  let origin, redirectRequests = 0, scriptRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/visualizer.js') {
      redirectRequests++;
      res.writeHead(302, { location: '/visualizer-v1.js' }); res.end(); return;
    }
    if (req.url === '/visualizer-v1.js') {
      scriptRequests++;
      res.setHeader('content-type', 'text/javascript');
      res.end(`const slider=document.querySelector('#travel'), output=document.querySelector('output');
        slider.addEventListener('input',()=>output.textContent=slider.value);
        output.textContent=slider.value;top.postMessage({visualizationReady:true},'*');`);
      return;
    }
    if (req.url === '/api/text-highlights') { res.setHeader('content-type', 'application/json'); res.end('{"entries":[]}'); return; }
    res.setHeader('content-type', 'text/html');
    if (req.url === '/runner') {
      // ChatGPT's cross-origin sandbox writes a preview into an about:blank
      // child. Chromium 130 aborts this child's redirected scripts with
      // ERR_INVALID_ARGUMENT; an ordinary iframe/srcdoc would miss the bug.
      const preview = `<!doctype html><input id="travel" type="range" min="0" max="100" value="0"><output></output><script src="${origin}/visualizer.js"></script>`;
      res.end(`<!doctype html><script>
        const frame=document.createElement('iframe');frame.name='visualization-preview';
        frame.sandbox='allow-scripts allow-same-origin';document.documentElement.append(frame);
        frame.addEventListener('load',()=>setTimeout(()=>{
          frame.contentDocument.open();frame.contentDocument.write(${JSON.stringify(preview).replaceAll('</script>', '<\\/script>')});
          frame.contentDocument.close();
        },0),{once:true});frame.src='about:blank';
      </script>`);
    } else if (req.url === '/page') {
      res.end(`<!doctype html><title>Interactive visualization</title><script>
        window.visualizationReady=false;addEventListener('message',event=>{
          if(event.data?.visualizationReady)window.visualizationReady=true;
        });</script><iframe sandbox="allow-scripts allow-same-origin" src="http://localhost:${server.address().port}/runner"></iframe>`);
    } else res.end('<!doctype html><title>Browser fixture</title><body>Terminal</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, 'scene.html'); fs.writeFileSync(scene, '<!doctype html>Startup');
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set() },
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), minimumStartupVisibleMs: 0,
  });
  for (const name of ['bookmarks', 'recent-searches']) ipcMain.handle('breadboard:get-browser-' + name, () => []);
  ipcMain.handle('breadboard:get-browser-downloads', () => ({ items: [], error: null }));
  const window = manager.createMainWindow(); window.setOpacity(0); window.showInactive();
  const tabs = manager.tabs, host = tabs.hosts.get(window.id), base = manager.page(window);
  await base.loadURL(origin + '/dashboard');
  await until(() => host.shellEnabled && !host.pending, 'persistent shell');
  tabs.setBrowserUrl(origin + '/browser');
  const command = value => tabs.handleCommand(base, value);
  command({ type: 'browser', url: origin + '/page' });
  const tab = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => tab.browser.ready && !host.pending, 'website');
  const page = tab.browser.contents;
  await until(() => page.mainFrame.executeJavaScript('window.visualizationReady'), 'redirected visualization script');
  const frame = page.mainFrame.framesInSubtree.find(frame => frame.name === 'visualization-preview');
  assert.ok(frame);
  await frame.executeJavaScript(`(() => {const slider=document.querySelector('#travel');slider.value='42';slider.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await frame.executeJavaScript('document.querySelector("output").textContent'), '42');
  for (let i = 0; i < 3; i++) {
    command({ type: 'activate', id: host.base.id }); await until(() => !host.pending, 'leave website');
    command({ type: 'activate', id: tab.id }); await until(() => !host.pending, 'return to website');
  }
  assert.equal(tab.browser.contents, page);
  assert.equal(await frame.executeJavaScript('document.querySelector("output").textContent'), '42');
  assert.equal(redirectRequests, 1); assert.equal(scriptRequests, 1);
  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
