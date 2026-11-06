const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const cp = require('node:child_process');
const { createInterface } = require('node:readline');
const WebSocket = require('ws');
const { app, session, screen } = require('electron');
const { build } = require('../../../dashboard/node_modules/esbuild');
const { hardenSession } = require('../../dist/main/security');
const directory = process.argv.at(-1);
const root = path.resolve(__dirname, '../../..');
const physical = process.env.BREADBOARD_DICTATION_PHYSICAL === '1';
assert.ok(process.env.BREADBOARD_DICTATION_CDP, 'verification requires the configured Breadboard speech provider');
app.setPath('userData', path.join(directory, 'profile'));
if (!physical) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', path.join(directory, 'sample.wav') + '%noloop');
}
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await sleep(50); }
  throw new Error('Timed out: ' + label);
}
let controller, server, pipe, dashboardSocket;
app.whenReady().then(async () => {
  const dashboard = path.join(root, 'dashboard');
  const globals = fs.readFileSync(path.join(dashboard, 'src/app/globals.css'), 'utf8');
  const cssStart = globals.indexOf('.dictation-live-control {');
  const css = globals.slice(cssStart, globals.lastIndexOf('/*', globals.indexOf('   Liquid glass terminal bar', cssStart)));
  const bundle = await build({ stdin: { resolveDir: dashboard, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Page from './src/app/dictation/page';
    window.streams=[]; const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{const s=await original(constraints);window.streams.push(s);return s;};
    createRoot(document.getElementById('root')).render(<Page/>);
  ` }, tsconfig: path.join(dashboard, 'tsconfig.json'), bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"test"' } });
  let forward;
  {
    const targets = await (await fetch(process.env.BREADBOARD_DICTATION_CDP + '/json/list')).json();
    const target = targets.find(t => /^http:\/\/127\.0\.0\.1:\d+\/notification-overlay$/.test(t.url));
    assert.ok(target, 'existing authenticated Breadboard renderer');
    dashboardSocket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { dashboardSocket.once('open', resolve); dashboardSocket.once('error', reject); });
    let requestId = 0; const pending = new Map();
    dashboardSocket.on('message', data => {
      const message = JSON.parse(data); const reply = pending.get(message.id);
      if (reply) { pending.delete(message.id); reply(message); }
    });
    forward = async req => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = { url: req.url, method: req.method, type: req.headers['content-type'], body: Buffer.concat(chunks).toString('base64') };
      const expression = `(async input=>{const response=await fetch(input.url,{method:input.method,headers:input.type?{'content-type':input.type}:{},body:input.body?Uint8Array.from(atob(input.body),c=>c.charCodeAt(0)):undefined});return {status:response.status,body:await response.text()};})(${JSON.stringify(input)})`;
      const id = ++requestId;
      const reply = new Promise(resolve => pending.set(id, resolve));
      dashboardSocket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      const result = await reply;
      if (result.error || result.result?.exceptionDetails) throw new Error('The authenticated speech request failed');
      return result.result.result.value;
    };
  }
  let uploadCount = 0, connections = 0;
  server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
      if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end(css); return; }
      if (req.url.startsWith('/api/speech/')) {
        if (req.url === '/api/speech/transcribe') uploadCount++;
        if (req.url === '/api/speech/subscription' && req.method === 'POST') connections++;
        const result = await forward(req); res.statusCode = result.status;
        res.setHeader('content-type', 'application/json'); res.end(result.body); return;
      }
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const allowed = { origins: new Set([origin]) }; hardenSession(session.defaultSession, allowed);
  const pipeName = 'breadboard-dictation-test-' + process.pid;
  const spawn = cp.spawn;
  cp.spawn = (executable, args, options) => /windows-dictation\.exe$/i.test(executable)
    ? spawn(path.join(directory, 'native-host.exe'), [executable, pipeName], { ...options, windowsHide: false })
    : spawn(executable, args, options);
  const { SystemDictation } = require('../../dist/main/system-dictation');
  controller = new SystemDictation({ dashboardUrl: () => origin, allowed, log: line => console.log(line) });
  const events = [], receive = controller.receive.bind(controller);
  controller.receive = notice => { events.push(notice); receive(notice); };
  const commits = [], write = controller.write.bind(controller);
  controller.write = notice => { if (notice.type === 'insert') commits.push(notice); write(notice); };
  let speechError;
  const send = controller.send.bind(controller);
  controller.send = notice => {
    if (notice.type === 'start') speechError = undefined;
    if (notice.type === 'error') {
      speechError = notice.message;
      console.log('DICTATION_ERROR', notice.message);
      if (physical && pipe) void command('status ' + notice.message).then(snapshot => console.log('ERROR_FOCUS', JSON.stringify({foreground: snapshot.foreground, focused: snapshot.focused}))).catch(console.error);
    }
    send(notice);
  };
  await controller.start();
  await until(() => events.some(e => e.type === 'ready'), 'production Windows hooks');
  cp.spawn = spawn;
  await until(async () => {
    try {
      pipe = await new Promise((resolve, reject) => {
        const socket = net.connect('\\\\.\\pipe\\' + pipeName, () => resolve(socket)); socket.once('error', reject);
      });
      return true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
  }, 'native verification pipe');
  const lines = createInterface({ input: pipe });
  async function command(op) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native test command timed out: ' + op)), 10000);
      lines.once('line', line => { clearTimeout(timer); const value = JSON.parse(line); value.error ? reject(new Error(value.error)) : resolve(value); });
      pipe.write(op + '\n');
    });
  }
  const window = controller.window;
  const status = () => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label")');
  assert.equal(await window.webContents.executeJavaScript('window.streams.length'), 0);
  await command('focus');
  if (physical) {
    console.log('READY_FOR_PHYSICAL_TEST');
    fs.writeFileSync(path.join(root, 'qa/system-dictation/physical-ready.json'), JSON.stringify({ ready: true, at: new Date().toISOString() }));
  }
  else { await sleep(400); await command('start'); }
  await until(async () => { if (speechError && !physical) throw new Error(speechError); return (await status()).includes('Listening'); }, 'hold starts recording', physical ? 300000 : 20000);
  if (!physical) {
    await sleep(5000);
    assert.equal((await command('snapshot')).submits, 0, 'holding never submits');
    await command('stop');
  }
  const firstId = events.find(e => e.type === 'start').id;
  const nativeAnchor = events.find(e => e.type === 'start').anchor;
  assert.ok(nativeAnchor && nativeAnchor.height > 0, 'the native helper supplies the text caret location');
  const caret = screen.screenToDipRect(null, nativeAnchor);
  const { dictationPosition } = require('../../dist/main/dictation-position');
  const expected = dictationPosition(caret, screen.getDisplayNearestPoint(caret).workArea);
  const anchoredPosition = window.getPosition();
  assert.ok(Math.abs(anchoredPosition[0] - expected.x) <= 1 && Math.abs(anchoredPosition[1] - expected.y) <= 1, 'pill sits above the caret');
  await until(() => {
    if (speechError) throw new Error(speechError);
    if (events.some(e => e.type === 'cancel' && e.id === firstId)) throw new Error('Native session cancelled before insertion: focus or keyboard input changed');
    return events.some(e => e.type === 'inserted');
  }, 'recognized speech inserted', 120000);
  await sleep(150);
  const result = await command('snapshot');
  console.log('INSERTION_OBSERVED', JSON.stringify(result));
  assert.match(result.text, /^testing bread\s*board dictation[.,!?;:]?$/i);
  assert.equal(result.submits, 1, 'spoken send command presses Enter once');
  assert.equal(result.other, 'untouched');
  assert.equal(result.foreground && result.focused, true, 'overlay never steals focus');
  assert.equal(commits.length, 1); assert.equal(commits[0].submit, true);
  assert.ok(uploadCount + connections >= 1, 'the configured provider transcribed the recording');
  const completedUploads = uploadCount;
  assert.equal(await window.webContents.executeJavaScript('window.streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'), true);
  assert.equal(await window.webContents.executeJavaScript('document.body.innerText.trim()'), '');
  const size = window.getSize();
  for (let i = 0; i < 100; i++) controller.positionAtCaret();
  assert.deepEqual(window.getSize(), size);
  fs.writeFileSync(path.join(directory, 'cursor-pill.png'), (await window.webContents.capturePage()).toPNG());
  // Focus changes must cancel the actual native session before another upload.
  await command('start');
  await until(() => events.filter(e => e.type === 'start').length === 2, 'second hold');
  await command('other');
  await until(() => events.some(e => e.type === 'cancel'), 'native focus cancellation');
  await command('stop');
  await sleep(200);
  const unchanged = await command('snapshot');
  assert.equal(unchanged.text, result.text); assert.equal(unchanged.submits, 1); assert.equal(commits.length, 1);
  assert.equal(uploadCount, completedUploads, 'focus cancellation prevents another transcription');
  fs.writeFileSync(path.join(directory, 'passed.json'), JSON.stringify({ passed: true, physical, shortcut: 'Ctrl + Shift', checkedAt: new Date().toISOString(),
    stimulus: physical ? 'physical keys and microphone' : 'production hook callback and known WAV capture',
    inserted: result.text, submits: result.submits, focusCancellation: true, caretAnchored: true,
    provider: 'existing configured garden/terminal provider',
    pipeline: 'native chord → Electron IPC → shared dictation provider → native SendInput → Enter' }, null, 2));
  console.log('LIVE_PIPELINE_PASSED', JSON.stringify(result));
  controller.stop(); pipe.destroy(); dashboardSocket?.close(); server.close(); app.exit(0);
}).catch(error => {
  console.error(error);
  controller?.stop(); pipe?.destroy(); dashboardSocket?.close(); server?.close(); app.exit(1);
});
