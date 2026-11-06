const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');
const WebSocket = require('ws');
const { configureGpuPreferences, EMPTY_GPU_STATE } = require('../../dist/main/gpu-preferences.js');
const dir = process.argv.at(-1);
const profile = path.join(dir, 'profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', '0');
configureGpuPreferences(app.commandLine, profile, Date.now(), EMPTY_GPU_STATE);
app.on('window-all-closed', () => {});

const readJson = url => new Promise((resolve, reject) => {
  http.get(url, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    response.on('error', reject);
    response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});

app.whenReady().then(async () => {
  // A real render starts the GPU process. No window appears in the user's app.
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<canvas width="8" height="8"></canvas>');
  await window.webContents.executeJavaScript(`
    const ctx = document.querySelector('canvas').getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 8, 8);
  `);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let end = Date.now() + 5000; !fs.existsSync(portFile) && Date.now() < end;) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const version = await readJson(`http://127.0.0.1:${port}/json/version`);
  const info = await new Promise((resolve, reject) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('GPU info timed out')); }, 5000);
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('open', () => socket.send(JSON.stringify({ id: 1, method: 'SystemInfo.getInfo' })));
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
  });
  const workarounds = info.gpu.driverBugWorkarounds;
  assert.ok(workarounds.includes('disable_direct_composition_video_overlays'),
    `Video overlay workaround was not activated: ${JSON.stringify(workarounds)}`);
  assert.ok(!info.commandLine.includes('--disable-gpu'));
  assert.ok(!info.commandLine.includes('--use-angle=swiftshader'));
  console.log(JSON.stringify({ overlayWorkaround: true, featureStatus: info.gpu.featureStatus }));
  window.destroy();
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
