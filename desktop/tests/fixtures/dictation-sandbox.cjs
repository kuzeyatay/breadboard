const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');
const { app, BrowserWindow, session, screen, ipcMain } = require('electron');
const { build } = require('../../../dashboard/node_modules/esbuild');
const { hardenSession } = require('../../dist/main/security');
const { openDictationProviderBridge } = require('./dictation-provider-bridge.cjs');
const directory = process.argv.at(-1);
const root = path.resolve(__dirname, '../../..');
const smoke = process.env.BREADBOARD_DICTATION_SANDBOX_SMOKE === '1';
const resumeVoice = process.env.BREADBOARD_DICTATION_RESUME_VOICE === '1';
app.setPath('userData', path.join(directory, 'profile'));
app.on('window-all-closed', () => {});
let editor, controller, server, bridge, meter, lastMessage;
const receipt = { openedAt: new Date().toISOString(), status: 'starting', sessions: [], services: 'existing Breadboard', scopedToTestWindow: true };
const output = path.join(root, 'qa/system-dictation/sandbox-status.json');
function save() { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(receipt, null, 2)); }
function status(message) {
  if (message === lastMessage || !editor || editor.isDestroyed()) return;
  lastMessage = message;
  void editor.webContents.executeJavaScript(`window.showStatus?.(${JSON.stringify(message)})`).catch(() => {});
}
async function close() {
  clearInterval(meter); controller?.stop(); await bridge?.close(); server?.close();
  receipt.status = 'closed'; receipt.closedAt = new Date().toISOString(); save(); app.exit(0);
}
app.whenReady().then(async () => {
  bridge = await openDictationProviderBridge(process.env.BREADBOARD_DICTATION_CDP);
  const dashboard = path.join(root, 'dashboard');
  const globals = fs.readFileSync(path.join(dashboard, 'src/app/globals.css'), 'utf8');
  const cssStart = globals.indexOf('.dictation-live-control {');
  const css = globals.slice(cssStart, globals.lastIndexOf('/*', globals.indexOf('   Liquid glass terminal bar', cssStart)));
  const bundle = await build({ stdin: { resolveDir: dashboard, loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Page from './src/app/dictation/page';
    import {parseDictationCommand} from './src/lib/speech/dictation-command';
    // Timing/count diagnostics only; never persist microphone transcripts.
    window.dictationTransportEvents=[];
    const createChannel=RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel=function(...args){const channel=createChannel.apply(this,args);
      channel.addEventListener('message',event=>{try{const m=JSON.parse(event.data);
        if(m.type!=='input_transcript.added'&&!(m.type?.startsWith('turn.')&&m.turn?.role==='user'))return;
        const text=m.item?.text??m.turn?.transcript??'';
        window.dictationTransportEvents.push({at:Date.now(),type:m.type,start:m.start_ms??m.turn?.start_ms,end:m.end_ms??m.turn?.end_ms,characters:text.length,command:parseDictationCommand(text).submit});
        if(window.dictationTransportEvents.length>256)window.dictationTransportEvents.shift();
      }catch{}});return channel;};
    createRoot(document.getElementById('root')).render(<Page/>);
  ` }, tsconfig: path.join(dashboard, 'tsconfig.json'), bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: resumeVoice ? [{ name: 'cross-origin-voice-resume', setup(build) {
      // The test lives on a separate origin and cannot see the paused voice
      // pane's normal foreground lease. Supply that one cache policy here.
      build.onLoad({ filter: /dictation-provider-cache\.ts$/ }, async args => {
        const source = await fs.promises.readFile(args.path, 'utf8');
        if (!source.includes('otherAudio: otherForegroundAudioActive,')) throw Error('Dictation cache fixture needs updating');
        return { loader: 'ts', contents: source.replace('otherAudio: otherForegroundAudioActive,', 'otherAudio: () => true,') };
      });
    } }] : [] });
  const editorBundle = await build({ stdin: { resolveDir: dashboard, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    let typingMetrics={keyDown:0,controlDown:0,metaDown:0,inputEvents:0,insertedCharacters:0};
    window.resetTypingMetrics=()=>{typingMetrics={keyDown:0,controlDown:0,metaDown:0,inputEvents:0,insertedCharacters:0};};
    document.addEventListener('keydown',e=>{if(!['rich','plain','multiline'].includes(e.target?.id)||['Control','Meta'].includes(e.key))return;typingMetrics.keyDown++;if(e.ctrlKey)typingMetrics.controlDown++;if(e.metaKey)typingMetrics.metaDown++;});
    document.addEventListener('input',e=>{if(!['rich','plain','multiline'].includes(e.target?.id))return;typingMetrics.inputEvents++;typingMetrics.insertedCharacters+=e.data?.length??0;});
    function App(){const [plain,setPlain]=useState(''),[multiline,setMultiline]=useState(''),[counts,setCounts]=useState({rich:0,plain:0,multiline:0}),[message,setMessage]=useState('Preparing test…');
      window.showStatus=setMessage;
      window.testSnapshot=()=>({characters:{rich:document.getElementById('rich')?.innerText.length??0,plain:plain.length,multiline:multiline.length},enterCounts:counts,typingMetrics});
      const enter=id=>e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();setCounts(old=>({...old,[id]:old[id]+1}));}};
      return <main><h1>Isolated dictation test</h1><p className="intro">The updated shortcut is active in these three fields. Click a field below, hold <kbd>Ctrl</kbd> + <kbd>Shift</kbd>, speak when the dots respond, then release both keys.</p>
        <p className="hint">Say “Testing Breadboard dictation. Send message.” The command submits while holding the keys or after release. Nothing is posted or sent from these fields.</p>
        <div role="status" id="status">{message}</div>
        <label htmlFor="rich">Rich chat editor <span>Enter: {counts.rich}</span></label><div id="rich" role="textbox" aria-label="Rich chat editor" contentEditable suppressContentEditableWarning onKeyDown={enter('rich')} />
        <label htmlFor="plain">Plain text field <span>Enter: {counts.plain}</span></label><input id="plain" value={plain} onChange={e=>setPlain(e.target.value)} onKeyDown={enter('plain')}/>
        <label htmlFor="multiline">Multiline field <span>Enter: {counts.multiline}</span></label><textarea id="multiline" value={multiline} onChange={e=>setMultiline(e.target.value)} onKeyDown={enter('multiline')}/>
        <p className="foot">After releasing the keys, the dots should wave until the text finishes, then disappear. Keep this field focused while it finishes. Close this window to stop the test.</p></main>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, tsconfig: path.join(dashboard, 'tsconfig.json'), bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  const editorHtml = `<!doctype html><meta charset="utf-8"><title>Breadboard — isolated dictation test</title><style>body{margin:0;background:#f4f3ef;color:#20231f;font:15px/1.5 system-ui}main{max-width:700px;margin:auto;padding:26px 32px}h1{font-size:25px;margin:0 0 10px}.intro,.hint{margin:8px 0}.hint,.foot{color:#5b6259;font-size:13px}kbd{background:white;border:1px solid #ccc;border-radius:5px;padding:1px 5px}#status{background:#e4eddf;border-radius:8px;padding:10px 14px;margin:18px 0;min-height:23px}label{display:flex;justify-content:space-between;font-weight:600;margin:14px 0 6px}label span{font-weight:400;color:#5b6259}input,textarea,[contenteditable]{box-sizing:border-box;width:100%;background:#fff;border:1px solid #abb3a5;border-radius:8px;padding:10px 12px;font:17px/1.5 system-ui;outline:none}input:focus,textarea:focus,[contenteditable]:focus{border-color:#547d44;box-shadow:0 0 0 2px #547d4433}[contenteditable]{height:100px;overflow:auto}textarea{height:86px;resize:vertical}.foot{margin-top:20px}</style><div id="root"></div><script src="/editor.js"></script>`;
  server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/editor.js' || req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end((req.url === '/editor.js' ? editorBundle : bundle).outputFiles[0].text); return; }
      if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end(css); return; }
      if (req.url.startsWith('/api/speech/')) {
        // This test needs no configuration writes, only existing settings,
        // preparation, voice sessions and transcription requests.
        if (req.url.startsWith('/api/speech/settings') && req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        const abort = new AbortController();
        res.on('close', () => { if (!res.writableEnded) abort.abort(); });
        const result = await bridge.forward(req, abort.signal); res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(result.body); return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(req.url === '/editor' ? editorHtml : '<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
    } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const allowed = { origins: new Set([origin]) }; hardenSession(session.defaultSession, allowed);
  const primary = screen.getPrimaryDisplay();
  const display = screen.getAllDisplays().find(item => item.id !== primary.id) || primary;
  const area = display.workArea;
  const width = Math.min(800, area.width), height = Math.min(760, area.height);
  editor = new BrowserWindow({ width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2),
    show: false, alwaysOnTop: !smoke, title: 'Breadboard — isolated dictation test', webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  receipt.testWindow = { bounds: editor.getBounds(), displayId: display.id, scaleFactor: display.scaleFactor };
  editor.setMenu(null); editor.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  editor.webContents.on('will-navigate', event => event.preventDefault());
  await editor.loadURL(origin + '/editor');
  const spawn = cp.spawn;
  cp.spawn = (executable, args, options) => /windows-dictation\.exe$/i.test(executable)
    ? spawn(path.join(directory, 'sandbox-host.exe'), [path.join(directory, 'windows-dictation.exe'), editor.getNativeWindowHandle().readBigUInt64LE().toString(), String(process.pid)], options)
    : spawn(executable, args, options);
  const { SystemDictation } = require('../../dist/main/system-dictation');
  controller = new SystemDictation({ dashboardUrl: () => origin, allowed, log: line => console.log(line) });
  const receive = controller.receive.bind(controller), send = controller.send.bind(controller), write = controller.write.bind(controller);
  let current, helperReady = false;
  ipcMain.on('breadboard:dictation-report', (event, notice) => {
    if (!controller.owns(event) || notice?.type !== 'diagnostic' || notice.id !== current?.id) return;
    (current.stages ??= []).push({ stage: notice.message, at: Date.now() }); save();
  });
  controller.receive = notice => {
    if (notice.type === 'start') {
      editor.setAlwaysOnTop(false);
      void editor.webContents.executeJavaScript('window.resetTypingMetrics()').catch(() => {});
      void bridge.setAudioFocus(true).catch(error => status(error.message));
    } else if (['cancel', 'inserted', 'error'].includes(notice.type) && (!notice.id || notice.id === current?.id)) {
      void bridge.setAudioFocus(false).catch(() => {});
    }
    receive(notice);
    if (notice.type === 'ready') {
      helperReady = true; receipt.nativeReady = true;
    } else if (notice.type === 'start') {
      current = { id: notice.id, startedAt: Date.now(), anchor: notice.anchor, pillBounds: controller.window.getBounds() }; receipt.sessions.push(current); status('Preparing microphone…');
      void controller.window.webContents.executeJavaScript('window.dictationTransportEvents=[]').catch(() => {});
      const started = current;
      setTimeout(async () => {
        try {
          if (current !== started || started.releasedAt || controller.window.isDestroyed()) return;
          started.pillVisible = controller.window.isVisible();
          fs.writeFileSync(path.join(directory, `pill-${started.id}.png`), (await controller.window.webContents.capturePage()).toPNG()); save();
        } catch { /* The user may close the test during capture. */ }
      }, 300);
    } else if (current && notice.id === current.id) {
      if (notice.type === 'stop') {
        current.releasedAt = Date.now(); current.hiddenOnRelease = !controller.window.isVisible(); status('Keys released. Finishing transcription…');
      } else if (notice.type === 'preview-unconfirmed') {
        current.unconfirmed = notice; // Counts and offsets only, never the transcript.
      } else if (notice.type === 'previewed') {
        current.firstPreviewAt ??= Date.now();
        current.firstPreviewMs ??= current.firstPreviewAt - current.startedAt;
        current.previewCount = (current.previewCount || 0) + 1;
        current.previewWhileHeld ||= notice.whileHeld;
        current.previewCharacters = notice.characters;
        if (!current.releasedAt) status('Recognized text is appearing while you speak.');
      } else if (notice.type === 'inserted') {
        current.insertedAt = Date.now(); current.releaseToInsertMs = current.insertedAt - current.releasedAt;
        status('Text inserted. You can try another field.');
        const completed = current;
        setTimeout(async () => {
          try { if (!editor.isDestroyed()) {
            completed.snapshot = await editor.webContents.executeJavaScript('window.testSnapshot()');
            completed.transport = await controller.window.webContents.executeJavaScript('window.dictationTransportEvents');
            const command = completed.transport?.findLast(event => event.type === 'turn.done' && event.command);
            if (command) completed.commandToInsertMs = completed.insertedAt - command.at;
            save();
          } }
          catch { /* Closing the test may destroy the renderer during this read. */ }
        }, 150);
      } else if (notice.type === 'cancel') {
        current.cancelled = true; current.cancelledAt = Date.now(); current.cancelReason = notice.reason;
        // The controller cancels its native target after a provider error too.
        // That acknowledgment must not overwrite the actual failure.
        if (!current.error) status(notice.reason === 'focus' ? 'Cancelled because the selected field lost focus. Try again.'
          : notice.reason === 'input' ? 'Cancelled because keyboard or mouse input changed. Try again.' : 'Dictation cancelled. Try again.');
      }
    }
    if (notice.type !== 'anchor') save();
  };
  controller.send = notice => { if (notice.type === 'error') { void bridge.setAudioFocus(false).catch(() => {}); status(notice.message); receipt.lastError = notice.message; if (current) {
    current.error = notice.message; const failed = current;
    void editor.webContents.executeJavaScript('window.testSnapshot()').then(snapshot => { failed.snapshot = snapshot; save(); }).catch(() => {});
  } save(); } send(notice); };
  controller.write = notice => { if (notice.type === 'insert' && current?.id === notice.id) { current.characters = notice.text.length; current.submitRequested = notice.submit; save(); } write(notice); };
  await controller.start();
  const deadline = Date.now() + 10000;
  while (!helperReady && !receipt.lastError && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (!helperReady || !controller.helper) throw new Error(receipt.lastError || 'The test keyboard helper did not start');
  cp.spawn = spawn;
  // Confirm the shared service is reachable before inviting microphone use.
  const settings = await controller.window.webContents.executeJavaScript(`fetch('/api/speech/settings').then(async r=>{if(!r.ok)throw Error('Voice settings unavailable');const b=await r.json();return {enabled:b.settings?.enabled,provider:b.settings?.speechProvider};})`);
  if (!settings.enabled) throw new Error('Speech is disabled in Breadboard Voice settings');
  receipt.provider = settings.provider; receipt.resumesOpenVoice = resumeVoice; receipt.status = 'ready'; receipt.pid = process.pid; receipt.origin = origin; save();
  status('Ready. Click the rich chat editor to begin.');
  meter = setInterval(async () => {
    if (!current || current.releasedAt || current.cancelled || current.insertedAt || current.error || !controller.window || controller.window.isDestroyed()) return;
    try {
      const state = await controller.window.webContents.executeJavaScript('({recording:document.querySelector("main")?.getAttribute("data-recording")==="true",loading:document.querySelector("[data-dictation-loading=true]")!==null})');
      if (state.loading) status('Connecting dictation. The dots move in a wave until ready.');
      else if (state.recording) { if (!current.recordingAt) { current.recordingAt = Date.now(); save(); } status('Listening. Speak, then release Ctrl + Shift.'); }
    } catch { }
  }, 200);
  editor.on('closed', close);
  if (smoke) { receipt.smokePassed = true; save(); setTimeout(close, 300); }
  else {
    editor.show();
    // Apply the size again after Windows has moved the native surface to the
    // chosen monitor and completed its initial DPI transition.
    editor.setBounds({ width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) });
    editor.focus(); editor.flashFrame(true); editor.once('focus', () => editor.flashFrame(false));
    await new Promise(resolve => setTimeout(resolve, 300));
    if (!editor.isVisible()) editor.show();
    receipt.testWindow = { ...receipt.testWindow, bounds: editor.getBounds(), visible: editor.isVisible(), minimized: editor.isMinimized(), focused: editor.isFocused(), alwaysOnTop: editor.isAlwaysOnTop(), displays: screen.getAllDisplays().map(item => ({ id: item.id, bounds: item.bounds, workArea: item.workArea, scaleFactor: item.scaleFactor })) };
    save();
    fs.writeFileSync(path.join(directory, 'test-window.png'), (await editor.webContents.capturePage()).toPNG());
  }
  console.log('SANDBOX_READY');
}).catch(async error => {
  console.error(error); receipt.status = 'failed'; receipt.error = error.message; save();
  clearInterval(meter); controller?.stop(); await bridge?.close().catch(() => {}); server?.close(); app.exit(1);
});
