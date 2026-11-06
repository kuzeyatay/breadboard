const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app } = require('electron');
const { WindowManager } = require('../../dist/main/window-manager.js');
const { allowBackgroundFrames } = require('../../dist/main/first-paint.js');
const dir = process.argv.at(-1);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  for (let end = Date.now() + 8000; Date.now() < end;) {
    if (await probe()) return;
    await sleep(20);
  }
  throw new Error(`Timed out: ${label}`);
};
app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>PDF fixture</title><style>body{margin:0}#pages{height:500px;overflow:auto}canvas{display:block}</style>
      <input id="annotation" value="unsaved highlight"><div id="pages"><canvas width="900" height="4000"></canvas></div>
      <script>const ctx=document.querySelector('canvas').getContext('2d');ctx.fillStyle='#a4cbb5';ctx.fillRect(0,0,900,4000);</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, 'scene.html');
  fs.writeFileSync(scene, '<!doctype html><body>Startup</body>');
  const manager = new WindowManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href]) },
    startupHtmlPath: scene, recoveryHtmlPath: scene, loadingHtmlPath: scene,
    preloadPath: path.resolve(__dirname, '../../dist/preload/preload.js'), minimumStartupVisibleMs: 0,
  });
  const window = manager.createMainWindow();
  window.setOpacity(0); window.showInactive();
  const host = manager.tabs.hosts.get(window.id);
  const base = manager.page(window);
  await base.loadURL(origin + '/dashboard');
  await until(() => host.shellEnabled, 'persistent shell');
  // Critical memory pressure may unload the original dashboard renderer.
  // Send commands from the page that is actually in front.
  const command = value => manager.tabs.handleCommand(host.tabs.find(t => t.id === host.activeId).contents, value);
  command({ type:'open', url:origin + '/gardens/ec-2/pdf/lecture' });
  const pdf = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending, 'PDF first frame');
  assert.equal(pdf.contents.getBackgroundThrottling(), false,
    'the selected PDF must keep rendering after its first-frame probe releases');

  // A navigation can replace the render widget inside this same native view.
  // Reproduce Electron 33's hidden replacement before the app sees DOM-ready:
  // the document shell exists, but client hydration and PDF rendering need the
  // new widget to become visible without a second tab selection.
  pdf.contents.prependListener('dom-ready', () => {
    const throttled = pdf.contents.getBackgroundThrottling();
    pdf.contents.setBackgroundThrottling(true);
    pdf.view.setVisible(false);
    pdf.contents.setBackgroundThrottling(throttled);
  });
  for (const route of ['/gardens/ec-2/pdf/replacement', '/gardens/ec-2/pdf/reloaded']) {
    await pdf.contents.loadURL(origin + route);
    await until(() => pdf.contents.mainFrame.executeJavaScript('document.visibilityState === "visible"'),
      'replacement PDF becomes visible without switching tabs');
    await until(() => pdf.contents.mainFrame.executeJavaScript(`new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 250);
      requestAnimationFrame(() => { clearTimeout(timer); resolve(true); });
    })`), 'replacement PDF receives rendering frames');
    assert.equal(host.activeId, pdf.id, 'the selected PDF stays selected across navigation');
  }

  const releasePreparation = allowBackgroundFrames(pdf.contents);
  releasePreparation();
  assert.equal(pdf.contents.getBackgroundThrottling(), false,
    'late background preparation cannot throttle the document being read');
  manager.tabs.setMemoryPressure('critical');
  assert.ok(window.contentView.children.includes(pdf.view), 'memory pressure retains the selected PDF');
  const scrollTop = await pdf.contents.executeJavaScript("document.querySelector('#pages').scrollTop=850; document.querySelector('#pages').scrollTop");
  const pixels = await pdf.contents.capturePage({x:40,y:80,width:1,height:1}, {stayHidden:true});
  assert.deepEqual([...pixels.toBitmap().subarray(0,3)], [181,203,164], 'PDF canvas still paints after scrolling');

  command({type:'open',url:origin + '/other'});
  const other = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => !host.pending, 'other tab selected');
  assert.equal(pdf.contents.getBackgroundThrottling(), true, 'inactive PDF resumes normal throttling');
  assert.equal(other.contents.getBackgroundThrottling(), false);
  command({type:'activate',id:pdf.id});
  await until(() => !host.pending, 'PDF selected again');
  assert.equal(await pdf.contents.executeJavaScript("document.querySelector('#pages').scrollTop"), scrollTop);
  assert.equal(await pdf.contents.executeJavaScript("document.querySelector('#annotation').value"), 'unsaved highlight');
  assert.equal(other.contents.getBackgroundThrottling(), true);
  assert.equal(pdf.contents.getBackgroundThrottling(), false);
  command({type:'split-tabs',id:pdf.id,targetId:other.id,side:'left'});
  await until(() => other.contents.getBackgroundThrottling() === false, 'both split panes retain frames');
  command({type:'activate',id:host.base.id});
  await until(() => !host.pending, 'leave split pair');
  assert.equal(pdf.contents.getBackgroundThrottling(), true);
  assert.equal(other.contents.getBackgroundThrottling(), true);
  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({passed:true}));
}).catch(error => {console.error(error.stack || error);app.exit(1);});
