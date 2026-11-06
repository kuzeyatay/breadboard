// Test-only renderer overlay: refresh just the existing voice pane with current
// source, on its original authenticated origin. Other panes/services stay up.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const WebSocket = require('ws'), { build } = require('../../dashboard/node_modules/esbuild');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'qa/system-dictation/voice-preview-status.json');
if (!process.argv.includes('--serve')) {
  const old = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
  if (old?.ready) { try { process.kill(old.pid, 0); console.log('The voice preview is already loaded.'); process.exit(0); } catch {} }
  const log = path.join(root, 'qa/system-dictation/voice-preview.log');
  const fd = fs.openSync(log, 'w');
  const child = cp.spawn(process.execPath, [__filename, '--serve'], { cwd: root, windowsHide: true, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd); child.unref(); console.log(JSON.stringify({ pid: child.pid, log, receipt: output }));
} else main().catch(error => { console.error(error); fs.writeFileSync(output, JSON.stringify({ ready: false, error: error.message, pid: process.pid })); process.exit(1); });

async function main() {
  const port = fs.readFileSync(path.join(process.env.APPDATA, 'breadboard-desktop/DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(t => /\/voice$/.test(t.url));
  if (!target) throw Error('The existing Breadboard voice pane is unavailable.');
  const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let serial = 0; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || 'Voice preview evaluation failed');
    return result.result.value;
  };
  let html, javascript;
  socket.on('message', data => {
    const message = JSON.parse(data);
    if (message.id) { const entry = pending.get(message.id); pending.delete(message.id); if (message.error) entry?.reject(Error(message.error.message)); else entry?.resolve(message.result); }
    if (message.method === 'Fetch.requestPaused') {
      const body = message.params.request.url === target.url ? html : javascript;
      void call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: message.params.request.url === target.url ? 'text/html' : 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(body).toString('base64') }).catch(console.error);
    }
    if (message.method === 'Runtime.exceptionThrown') console.error('VOICE_PREVIEW_ERROR', message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const previous = await evaluate(`(async()=>({title:document.title,session:localStorage.getItem('breadboard-active-conversation:dashboard_terminal:voice'),styles:[...document.querySelectorAll('link[rel=stylesheet]')].map(e=>e.href),className:document.documentElement.className,theme:document.documentElement.dataset.theme,muted:!!document.querySelector('button[aria-label="Start listening"]'),open:await window.voiceCompanion.state(),linked:await window.voiceCompanion.conversation?.()}))()`);
  if (!previous.open || (!previous.session && !previous.linked)) throw Error('Only an already-open, saved voice conversation can use this preview.');
  const dashboard = path.join(root, 'dashboard');
  const result = await build({ stdin: { resolveDir: dashboard, loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import VoicePage from './src/app/voice/page';
    import {holdDictationPriority,dictationHasPriority} from './src/lib/speech/dictation-priority';
    let release=holdDictationPriority();
    window.dictationVoicePreview={releaseSetup(){release?.();release=null;},priority:dictationHasPriority};
    createRoot(document.getElementById('voice-preview-root')).render(<VoicePage/>);
  ` }, tsconfig: path.join(dashboard, 'tsconfig.json'), bundle: true, write: false, platform: 'browser', format: 'iife', minify: true,
    loader: { '.css': 'empty', '.module.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'restore-preview-conversation', setup(build) {
      if (previous.muted) build.onLoad({ filter: /[\\/]chatgpt-voice-screen\.tsx$/ }, async args => {
        const source = await fs.promises.readFile(args.path, 'utf8');
        const marker = "if (alive) { setStage('live'); setNote(null); setMuted(false); setSpeaking(false); }";
        if (!source.includes(marker)) throw Error('Voice mute restoration fixture needs updating');
        return { loader: 'tsx', contents: source.replace(marker, `await fetch('/api/speech/web-live/'+started+'/microphone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:false})});if(alive){setStage('live');setNote(null);setMuted(true);setSpeaking(false);}`) };
      });
      build.onLoad({ filter: /[\\/]app[\\/]voice[\\/]page\.tsx$/ }, async args => {
        const source = await fs.promises.readFile(args.path, 'utf8');
        if (!source.includes('restoreLastConversation: false') || !source.includes('greetOnOpen onClose')) throw Error('Voice resume fixture needs updating');
        return { loader: 'tsx', contents: source.replace('restoreLastConversation: false', 'restoreLastConversation: true').replace('greetOnOpen onClose', 'greetOnOpen={false} onClose') };
      });
    } }] });
  javascript = result.outputFiles[0].text;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const bundleUrl = new URL('/__dictation-preview/voice.js', target.url).href;
  html = `<!doctype html><html class="${escape(previous.className)}" data-theme="${escape(previous.theme)}"><head><meta charset="utf-8">${previous.styles.map(url => `<link rel="stylesheet" href="${escape(url)}">`).join('')}</head><body><div id="voice-preview-root"></div><script src="${bundleUrl}"></script></body></html>`;
  await call('Runtime.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: target.url, resourceType: 'Document', requestStage: 'Request' }, { urlPattern: bundleUrl, requestStage: 'Request' }] });
  await call('Page.reload');
  const deadline = Date.now() + 20000;
  let loaded;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { loaded = await evaluate(`({ready:Boolean(window.dictationVoicePreview&&document.querySelector('[data-dictation-paused=true]')),title:document.title,session:localStorage.getItem('breadboard-active-conversation:dashboard_terminal:voice')})`); } catch { continue; }
    if (loaded.ready) break;
  }
  if (!loaded?.ready || (!previous.linked && loaded.session !== previous.session) || loaded.title !== previous.title) throw Error('The preview could not verify restoration of the same voice chat.');
  await evaluate('window.dictationVoicePreview.releaseSetup()');
  fs.writeFileSync(output, JSON.stringify({ ready: true, pid: process.pid, loadedAt: new Date().toISOString(), sameChat: true, targetId: target.id, servicesRestarted: false }, null, 2));
  console.log('VOICE_PREVIEW_READY');
  socket.on('close', () => process.exit(0));
}
