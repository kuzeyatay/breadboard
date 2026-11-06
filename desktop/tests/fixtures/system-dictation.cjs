const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, session, screen } = require('electron');
const { build } = require('../../../dashboard/node_modules/esbuild');
const { SystemDictation } = require('../../dist/main/system-dictation');
const capture = require('../../dist/main/dictation-screen');
const { hardenSession } = require('../../dist/main/security');
const directory = process.argv.at(-1);
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 180; i++) { if (await predicate()) return; await sleep(50); }
  throw new Error('Timed out: ' + label);
}
app.whenReady().then(async () => {
  const dashboard = path.resolve(__dirname, '../../../dashboard');
  const globals = fs.readFileSync(path.join(dashboard, 'src/app/globals.css'), 'utf8');
  const cssStart = globals.indexOf('.dictation-live-control {');
  const css = globals.slice(cssStart, globals.lastIndexOf('/*', globals.indexOf('   Liquid glass terminal bar', cssStart)));
  const bundle = await build({ stdin: { resolveDir: dashboard, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Page from './src/app/dictation/page';
    window.streams=[]; const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);window.streams.push(stream);return stream;};
    createRoot(document.getElementById('root')).render(<Page/>);
  ` }, tsconfig: path.join(dashboard, 'tsconfig.json'), bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"test"' } });
  let uploads = 0, holdResponse = false, pendingResponse, pendingSettings, holdSettings = true;
  const snapshot = { dataUrl: 'data:image/jpeg;base64,Y2FyZXQ=', width: 1600, height: 900, caret: { x: 250, y: 500 } };
  const captures = [], replyRequests = [];
  let pendingReply, resolveCapture;
  capture.captureDictationScreen = async anchor => { captures.push(anchor); return snapshot; };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end(css); return; }
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === '/api/speech/dictation-reply') {
      const parts = []; for await (const part of req) parts.push(part);
      replyRequests.push(JSON.parse(Buffer.concat(parts).toString()));
      res.setHeader('content-type', 'application/x-ndjson');
      pendingReply = res; return;
    }
    if (req.url.startsWith('/api/speech/')) {
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/settings')) {
        if (holdSettings) pendingSettings = res;
        else res.end(JSON.stringify({ settings: { enabled: true, speechProvider: 'local' } }));
        return;
      }
      if (req.url.endsWith('/prepare')) { res.end('{}'); return; }
      if (req.url.endsWith('/transcribe')) {
        const parts = []; for await (const part of req) parts.push(part);
        assert.ok(Buffer.concat(parts).includes(Buffer.from('RIFF')), 'real capture uploads normalized WAV');
        uploads++;
        if (holdResponse) { pendingResponse = res; return; }
        res.end(JSON.stringify({ text: 'Hello café. Send message.' })); return;
      }
    }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const allowed = { origins: new Set([origin]) }; hardenSession(session.defaultSession, allowed);
  const commands = [];
  const controller = new SystemDictation({ dashboardUrl: () => origin, allowed, log: () => {} });
  // Exercise the actual private Electron bridge, UI, MediaRecorder, audio
  // conversion and provider dispatch; keep OS input inside this fixture.
  controller.startHelper = () => { controller.helper = { stdin: { destroyed: false,
    write: value => commands.push(JSON.parse(value)), end: () => {} }, kill: () => {} }; };
  await controller.start();
  await until(() => controller.helper, 'renderer ready');
  const window = controller.window;
  assert.equal(window.isFocusable(), false);
  const originalSize = window.getSize();
  assert.equal(await window.webContents.executeJavaScript('window.streams.length'), 0, 'no startup microphone capture');
  const anchor = { x: 500, y: 500, width: 1, height: 20 };
  controller.receive({ type: 'start', id: 1, anchor });
  await until(() => pendingSettings, 'provider selection pending');
  await until(() => window.webContents.executeJavaScript('document.querySelector("[data-dictation-loading=true]") !== null'), 'connecting wave');
  const visualDirectory = path.resolve(__dirname, '../../../qa/system-dictation');
  fs.mkdirSync(visualDirectory, { recursive: true });
  const sampleWave = async time => window.webContents.executeJavaScript(`(async()=>{
    for (const a of document.getAnimations()) { a.pause(); a.currentTime=${time}; }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return [...document.querySelectorAll('.dictation-level-bar')].map(e=>{
      const s=getComputedStyle(e); return { animation:s.animationName, transform:s.transform, opacity:s.opacity };
    });
  })()`);
  const loadingA = await sampleWave(0);
  const loadingImageA = (await window.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(visualDirectory, 'connecting-wave-0.png'), loadingImageA);
  const loadingB = await sampleWave(200);
  const loadingImageB = (await window.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(visualDirectory, 'connecting-wave-200.png'), loadingImageB);
  assert.equal(loadingImageA.equals(loadingImageB), false, 'loading wave paints distinct visible frames');
  assert.deepEqual(await window.webContents.executeJavaScript(`(()=>{const e=document.querySelector('.dictation-live-control'),r=e.getBoundingClientRect();return [r.width,r.height,getComputedStyle(e).transform,document.body.innerText.trim()];})()`), [96, 32, 'none', ''], 'connection progress never scales the pill or adds text');
  assert.equal(loadingA.length, 5);
  assert.ok(loadingA.every(dot => dot.animation === 'dictation-connecting-wave'));
  assert.ok(new Set(loadingA.map(dot => dot.transform)).size > 1, 'dots are staggered along a wave');
  assert.notDeepEqual(loadingA, loadingB, 'connection dots move while the provider is pending');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reducedA = await sampleWave(0), reducedB = await sampleWave(200);
  assert.ok(reducedA.every(dot => dot.animation === 'dictation-connecting-fade'));
  assert.deepEqual(reducedA.map(dot => dot.transform), reducedB.map(dot => dot.transform), 'reduced motion keeps dots stationary');
  assert.notDeepEqual(reducedA.map(dot => dot.opacity), reducedB.map(dot => dot.opacity), 'reduced motion still signals connection progress');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  window.webContents.debugger.detach();
  await window.webContents.executeJavaScript('document.getAnimations().forEach(a=>a.play())');
  holdSettings = false;
  pendingSettings.end(JSON.stringify({ settings: { enabled: true, speechProvider: 'local' } }));
  await until(() => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label").includes("Listening")'), 'recording');
  assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-dictation-loading=true]")'), null, 'readiness replaces the loading wave');
  assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".dictation-level-bar")).animationName'), 'none', 'live microphone meter is no longer animated by the loading state');
  const pill = await window.webContents.executeJavaScript(`(()=>{const e=document.querySelector('.dictation-live-control');const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {width:r.width,height:r.height,background:s.backgroundColor,transform:s.transform,bars:e.querySelectorAll('.dictation-level-bar').length};})()`);
  assert.deepEqual(pill, { width: 96, height: 32, background: 'rgb(17, 18, 17)', transform: 'none', bars: 5 });
  assert.equal(await window.webContents.executeJavaScript('document.body.innerText.trim()'), '', 'cursor UI shows only dots, no instruction text');
  const anchoredPosition = window.getPosition();
  const staleAnchor = { x: 200, y: 200, width: 1, height: 20 };
  controller.receive({ type: 'anchor', id: 999, anchor: staleAnchor });
  assert.deepEqual(window.getPosition(), anchoredPosition, 'a stale session cannot move the pill');
  assert.equal(controller.followTimer, undefined, 'no mouse-following timer is installed');
  for (const display of screen.getAllDisplays()) {
    const area = display.workArea;
    for (let i = 0; i < 20; i++) {
      controller.positionAtCaret({ x: area.x + Math.round(i / 19 * (area.width - 1)),
        y: area.y + Math.round((19 - i) / 19 * (area.height - 1)), width: 1, height: 20 });
      await sleep(20);
      const size = window.getSize();
      assert.ok(Math.abs(size[0] - originalSize[0]) <= 1 && Math.abs(size[1] - originalSize[1]) <= 1,
        `cursor surface stays fixed across monitor DPI: ${originalSize} → ${size}`);
      const visibleSize = await window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.dictation-live-control').getBoundingClientRect();return [r.width,r.height];})()`);
      assert.deepEqual(visibleSize, [96, 32], 'moving across displays never scales the visible pill');
    }
  }
  controller.positionAtCaret();
  const returnedSize = window.getSize();
  assert.ok(returnedSize.every((value, i) => Math.abs(value - originalSize[i]) <= 1), 'native surface only permits one-DIP monitor rounding');
  fs.writeFileSync(path.join(visualDirectory, 'cursor-pill.png'), (await window.webContents.capturePage()).toPNG());
  // A result before release is never permitted to type or send.
  await window.webContents.executeJavaScript('window.breadboardDictation.report({type:"result",id:1,text:"early",submit:true})');
  await sleep(40); assert.equal(commands.filter(c => c.type === 'insert').length, 0);
  await window.webContents.executeJavaScript('window.breadboardDictation.report({type:"preview",id:999,text:"stale"});window.breadboardDictation.report({type:"preview",id:1,text:"Hello",submit:true})');
  await sleep(40); assert.deepEqual(commands.filter(c => c.type === 'preview'), [{ type: 'preview', id: 1, text: 'Hello' }], 'live draft never carries submission and must belong to the active hold');
  await sleep(700); controller.receive({ type: 'stop', id: 1 });
  assert.equal(window.isVisible(), true, 'releasing either shortcut key retains transcription progress');
  await until(() => window.webContents.executeJavaScript('document.querySelector("[data-dictation-loading=true]")?.getAttribute("aria-label") === "Transcribing dictation"'), 'transcription wave after key release');
  const transcribingA = await sampleWave(0), transcribingB = await sampleWave(200);
  assert.ok(transcribingA.every(dot => dot.animation === 'dictation-connecting-wave'));
  assert.notDeepEqual(transcribingA, transcribingB, 'transcription progress reuses the moving five-dot wave');
  await window.webContents.executeJavaScript('document.getAnimations().forEach(a=>a.play())');
  controller.receive({ type: 'anchor', id: 1, anchor });
  assert.equal(window.isVisible(), true, 'caret updates retain the active transcription pill');
  await until(() => commands.some(c => c.type === 'insert'), 'transcript');
  assert.equal(window.isVisible(), true, 'the wave stays until the editor acknowledges insertion');
  assert.deepEqual(commands.find(c => c.type === 'insert'), { type: 'insert', id: 1, text: 'Hello café.', submit: true });
  assert.equal(await window.webContents.executeJavaScript('window.streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'), true);
  await window.webContents.executeJavaScript('window.breadboardDictation.report({type:"result",id:1,text:"duplicate",submit:true})');
  await window.webContents.executeJavaScript('window.breadboardDictation.report({type:"preview",id:1,text:"late"})');
  await sleep(40); assert.equal(commands.filter(c => c.type === 'insert').length, 1, 'duplicate cannot send twice');
  assert.equal(commands.filter(c => c.type === 'preview').length, 1, 'committing a hold rejects late partials');
  controller.receive({ type: 'inserted', id: 1 });
  assert.equal(window.isVisible(), false, 'completed insertion dismisses the pill');
  await until(() => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label").includes("Enter pressed")'), 'completion');
  assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-dictation-loading=true]") === null'), true, 'completed insertion stops the wave');
  controller.receive({ type: 'anchor', id: 1, anchor });
  assert.equal(window.isVisible(), false, 'late caret updates cannot resurrect completed dictation');
  fs.writeFileSync(path.join(directory, 'dictation.png'), (await window.webContents.capturePage()).toPNG());

  holdResponse = true; controller.receive({ type: 'start', id: 2, anchor });
  await until(() => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label").includes("Listening")'), 'second recording');
  await sleep(500); controller.receive({ type: 'stop', id: 2 });
  await until(() => pendingResponse, 'pending transcription');
  assert.equal(window.isVisible(), true, 'pending transcription remains visible');
  controller.receive({ type: 'cancel', id: 2 });
  assert.equal(window.isVisible(), false, 'cancellation immediately hides the dots');
  pendingResponse.end(JSON.stringify({ text: 'Stale text. Send message.' }));
  await sleep(150); assert.equal(commands.filter(c => c.type === 'insert').length, 1, 'focus cancellation prevents late send');

  holdResponse = false; controller.receive({ type: 'start', id: 3, anchor });
  await until(() => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label").includes("Listening")'), 'voice-command recording');
  await sleep(400);
  await window.webContents.executeJavaScript('window.breadboardDictation.report({type:"finish",id:999});window.breadboardDictation.report({type:"finish",id:3})');
  await until(() => commands.some(c => c.type === 'insert' && c.id === 3), 'voice command submits without a physical stop');
  assert.equal(window.isVisible(), true, 'voice send keeps progress until text insertion is acknowledged');
  assert.deepEqual(commands.filter(c => c.type === 'finish'), [{ type: 'finish', id: 3 }], 'only the active hold may finish by voice');
  assert.deepEqual(commands.find(c => c.type === 'insert' && c.id === 3), { type: 'insert', id: 3, text: 'Hello café.', submit: true });
  controller.receive({ type: 'stop', id: 3 });
  controller.receive({ type: 'inserted', id: 3 });
  assert.equal(window.isVisible(), false, 'spoken send dismisses the pill after insertion');

  // Another page with the same preload still lacks this window's authority.
  const rogue = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, '../../dist/preload/dictation-preload.js') } });
  await rogue.loadURL(origin + '/rogue');
  assert.equal(await rogue.webContents.executeJavaScript('window.breadboardDictation.ready()'), false);
  controller.active = { id: 4, released: true };
  await rogue.webContents.executeJavaScript('window.breadboardDictation.report({type:"result",id:4,text:"forged",submit:true})');
  await rogue.webContents.executeJavaScript('window.breadboardDictation.report({type:"preview",id:4,text:"forged"})');
  await rogue.webContents.executeJavaScript('window.breadboardDictation.report({type:"finish",id:4})');
  await sleep(80); assert.equal(commands.filter(c => c.type === 'insert').length, 2, 'other renderer denied');
  assert.equal(commands.filter(c => c.type === 'finish').length, 1, 'another renderer cannot finish dictation');
  assert.equal(commands.filter(c => c.type === 'preview').length, 1, 'another renderer cannot stream text either');
  assert.equal(uploads, 3);
  assert.equal(captures.length, 0, 'ordinary dictation never captures a screen');
  assert.equal(await window.webContents.executeJavaScript('window.breadboardDictation.screenContext(4).then(()=>false,()=>true)'), true, 'ordinary dictation has no screenshot authority');

  controller.receive({ type: 'start', id: 5, mode: 'reply', anchor });
  await until(() => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label").includes("Listening")'), 'screen-aware recording');
  assert.equal(captures.length, 1, 'screen-aware hold takes one snapshot');
  assert.equal(await rogue.webContents.executeJavaScript('window.breadboardDictation.screenContext(5).then(()=>false,()=>true)'), true, 'other renderer cannot read the captured screen');
  assert.equal(await window.webContents.executeJavaScript('window.breadboardDictation.screenContext(999).then(()=>false,()=>true)'), true, 'stale id cannot read the captured screen');
  await window.webContents.executeJavaScript('window.breadboardDictation.report({type:"finish",id:5})');
  await sleep(60);
  assert.equal(commands.some(c => c.type === 'finish' && c.id === 5), false, 'screen-aware speech cannot trigger Enter or early completion');
  await sleep(400); controller.receive({ type: 'stop', id: 5 });
  assert.equal(window.isVisible(), true, 'screen-aware release keeps the progress pill visible');
  await until(() => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label") === "Drafting reply"'), 'drafting state');
  const draftingA = await sampleWave(0), draftingB = await sampleWave(200);
  assert.ok(draftingA.every(dot => dot.animation === 'dictation-connecting-wave'), 'reply preparation uses the existing five-dot wave');
  assert.notDeepEqual(draftingA, draftingB, 'drafting wave moves while the reply is pending');
  assert.deepEqual(await window.webContents.executeJavaScript(`(()=>{const e=document.querySelector('.dictation-live-control'),r=e.getBoundingClientRect();return [r.width,r.height,getComputedStyle(e).transform,e.getAttribute('aria-label'),document.body.innerText.trim()];})()`), [96, 32, 'none', 'Drafting reply', ''], 'drafting keeps the pill fixed-size with no visible text');
  fs.writeFileSync(path.join(visualDirectory, 'drafting-wave.png'), (await window.webContents.capturePage()).toPNG());
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.ok((await sampleWave(200)).every(dot => dot.animation === 'dictation-connecting-fade'), 'drafting respects reduced motion');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  window.webContents.debugger.detach();
  await window.webContents.executeJavaScript('document.getAnimations().forEach(a=>a.play())');
  await until(() => replyRequests.length === 1, 'screen-aware request');
  assert.deepEqual(replyRequests[0], { text: 'Hello café. Send message.', screen: snapshot }, 'model receives the raw spoken request and the selected snapshot');
  assert.equal(commands.some(c => c.id === 5 && (c.type === 'preview' || c.type === 'insert')), false, 'spoken instructions never enter the field');
  pendingReply.write(JSON.stringify({ type: 'delta', text: 'Here is the ' }) + '\n');
  await until(() => commands.some(c => c.id === 5 && c.type === 'preview'), 'streamed assistant draft');
  assert.equal(window.isVisible(), true, 'wave remains visible while the answer streams into the field');
  controller.receive({ type: 'anchor', id: 5, anchor: staleAnchor });
  assert.notDeepEqual(window.getPosition(), anchoredPosition, 'drafting pill follows the typing caret');
  assert.deepEqual(commands.find(c => c.id === 5 && c.type === 'preview'), { type: 'preview', id: 5, text: 'Here is the ' });
  pendingReply.end(JSON.stringify({ type: 'delta', text: 'draft café.' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n');
  await until(() => commands.some(c => c.id === 5 && c.type === 'insert'), 'assistant final draft');
  assert.deepEqual(commands.find(c => c.id === 5 && c.type === 'insert'), { type: 'insert', id: 5, text: 'Here is the draft café.', submit: false });
  assert.equal(window.isVisible(), true, 'progress lasts until native text insertion finishes');
  controller.receive({ type: 'inserted', id: 5 });
  assert.equal(window.isVisible(), false, 'completed insertion immediately hides the drafting pill');
  await until(() => window.webContents.executeJavaScript('document.querySelector("[data-dictation-loading=true]") === null'), 'completed draft stops its wave');
  controller.receive({ type: 'anchor', id: 5, anchor });
  assert.equal(window.isVisible(), false, 'late caret updates cannot reopen a completed reply');

  // Adding Win after Ctrl+Shift reuses the recorder and captured field.
  const streamCount = await window.webContents.executeJavaScript('window.streams.length');
  controller.receive({ type: 'start', id: 6, anchor });
  await until(() => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label").includes("Listening")'), 'promoted recording');
  controller.receive({ type: 'mode', id: 6, mode: 'reply', anchor });
  controller.receive({ type: 'mode', id: 6, mode: 'reply', anchor });
  await until(() => commands.some(c => c.id === 6 && c.type === 'preview'), 'promotion clears owned preview');
  assert.deepEqual(commands.find(c => c.id === 6 && c.type === 'preview'), { type: 'preview', id: 6, text: '' });
  assert.equal(captures.length, 2, 'repeated promotion does not capture again');
  assert.equal(await window.webContents.executeJavaScript('window.streams.length'), streamCount + 1, 'promotion keeps the same audio capture');
  await sleep(400); controller.receive({ type: 'stop', id: 6 });
  await until(() => replyRequests.length === 2, 'promoted model request');
  assert.equal(window.isVisible(), true, 'promoted screen-aware holds also show drafting progress');
  controller.receive({ type: 'cancel', id: 6 });
  assert.equal(window.isVisible(), false, 'focus cancellation immediately hides the drafting pill');
  pendingReply.end(JSON.stringify({ type: 'delta', text: 'Must not type' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n');
  await sleep(150);
  assert.equal(commands.some(c => c.id === 6 && (c.type === 'insert' || c.type === 'preview' && c.text)), false, 'focus cancellation discards late assistant output');
  assert.equal(window.isVisible(), false, 'cancelled model output cannot reopen the pill');
  assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-dictation-loading=true]") === null'), true, 'cancellation stops the wave');

  // A cancelled capture cannot leak its result even to the formerly valid owner.
  capture.captureDictationScreen = () => new Promise(resolve => { resolveCapture = resolve; });
  controller.receive({ type: 'start', id: 7, mode: 'reply', anchor });
  await window.webContents.executeJavaScript('window.contextRejected = null; window.breadboardDictation.screenContext(7).then(()=>window.contextRejected=false,()=>window.contextRejected=true); void 0');
  controller.receive({ type: 'cancel', id: 7 }); resolveCapture(snapshot);
  await until(() => window.webContents.executeJavaScript('window.contextRejected === true'), 'capture cancellation');
  assert.equal(replyRequests.length, 2, 'cancelled capture never reaches the model');
  controller.active = { id: 8, mode: 'reply', released: true };
  await window.webContents.executeJavaScript('window.breadboardDictation.report({type:"result",id:8,text:"Draft only",submit:true})');
  await until(() => commands.some(c => c.id === 8 && c.type === 'insert'), 'main-process draft enforcement');
  assert.deepEqual(commands.find(c => c.id === 8 && c.type === 'insert'), { type: 'insert', id: 8, text: 'Draft only', submit: false }, 'main process independently prevents screen-aware Enter');
  controller.receive({ type: 'inserted', id: 8 });
  capture.captureDictationScreen = async () => snapshot;
  controller.receive({ type: 'start', id: 9, mode: 'reply', anchor });
  await until(() => window.webContents.executeJavaScript('document.querySelector("main").getAttribute("aria-label").includes("Listening")'), 'failed reply recording');
  await sleep(400); controller.receive({ type: 'stop', id: 9 });
  await until(() => replyRequests.length === 3, 'failed reply request');
  assert.equal(window.isVisible(), true);
  pendingReply.end(JSON.stringify({ type: 'error', message: 'Model unavailable' }) + '\n');
  await until(() => !window.isVisible(), 'failed reply hides progress');
  await until(() => window.webContents.executeJavaScript('document.querySelector("[data-dictation-loading=true]") === null'), 'failed reply stops the wave');
  rogue.destroy(); controller.stop(); server.close();
  fs.writeFileSync(path.join(directory, 'passed.json'), JSON.stringify({ passed: true })); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
