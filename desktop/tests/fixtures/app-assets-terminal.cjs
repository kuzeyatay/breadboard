// Manual integration check against an already-running dashboard. Configuration
// (including its session cookies) arrives only over a pipe, never a file or log.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { app, BrowserWindow, session } = require('electron');
const { registerAppAssetScheme, installAppAssetTransport } = require('../../dist-tests/src/main/app-assets.js');
const directory = process.argv.at(-1);
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
registerAppAssetScheme();
fs.writeFileSync(path.join(directory, 'progress.json'), JSON.stringify({ step: 'waiting for input' }));
app.on('window-all-closed', () => {});
const input = new Promise(resolve => {
  let data = '';
  const socket = net.connect(process.argv.at(-2));
  socket.setEncoding('utf8');
  socket.on('data', chunk => { data += chunk; });
  socket.on('end', () => resolve(JSON.parse(data)));
});
Promise.all([app.whenReady(), input]).then(async ([, config]) => {
  fs.writeFileSync(path.join(directory, 'progress.json'), JSON.stringify({ step: 'setting session' }));
  const target = session.fromPartition('terminal-qa', { cache: false });
  installAppAssetTransport(target, () => config.origin);
  for (const cookie of config.cookies) {
    await target.cookies.set({ url: config.origin + cookie.path, name: cookie.name,
      value: cookie.value, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly });
  }
  fs.writeFileSync(path.join(directory, 'progress.json'), JSON.stringify({ step: 'loading page' }));
  const reports = [];
  for (let run = 0; run < 2; run++) {
    const window = new BrowserWindow({ show: false, webPreferences: { session: target, backgroundThrottling: false } });
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.setSkipTaskbar(true); window.showInactive();
    const failures = [];
    const requests = new Map();
    const timings = [];
    window.webContents.debugger.attach('1.3');
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent' && params.request.url.startsWith(config.origin + '/api/')) {
        requests.set(params.requestId, { path: new URL(params.request.url).pathname, method: params.request.method, started: params.timestamp });
      }
      if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        const request = requests.get(params.requestId);
        if (request) timings.push({ path: request.path, method: request.method, elapsedMs: Math.round((params.timestamp - request.started) * 1000) });
      }
    });
    await window.webContents.debugger.sendCommand('Network.enable');
    window.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2 && !message.includes('Electron Security Warning') && /chunk|font|script|hydration|stylesheet/i.test(message)) failures.push(message.slice(0, 400));
    });
    const began = Date.now();
    void window.loadURL(config.origin + '/new-tab?asset-transport-qa=1').catch(() => {});
    let state;
    while (Date.now() - began < 15_000) {
      try {
        state = await window.webContents.mainFrame.executeJavaScript(`({path:location.pathname,ready:window.__breadboardInteractionHydration?.ready===true,startup:document.documentElement.dataset.breadboardStartup,sketches:document.querySelectorAll('.browser-sketch-outline path').length,fonts:document.fonts.status,document:document.readyState,assets:performance.getEntriesByType('resource').filter(r=>r.name.includes('/_next/static/')).length})`);
        fs.writeFileSync(path.join(directory, 'progress.json'), JSON.stringify({ run, ...state, failures }));
        if (state.ready && state.startup === 'ready' && state.sketches > 0 && state.fonts === 'loaded') break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    reports.push({ run, elapsedMs: Date.now() - began, ...state, failures, slowestReads: timings.sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 12) });
    window.destroy();
  }
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(reports));
  // Clear the isolated ephemeral session before the harness removes its profile.
  await target.clearStorageData();
  fs.writeFileSync(path.join(directory, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.message); app.exit(1); });
