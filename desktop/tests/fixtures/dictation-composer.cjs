// Drive the production chat input with the Windows dictation helper. Extract
// its JSX and sizing hooks so suggestions and React updates stay in the test.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { SystemDictation } = require('../../dist/main/system-dictation');
const { build } = require('../../../dashboard/node_modules/esbuild');
const ts = require('../../../dashboard/node_modules/typescript');
const directory = process.argv.at(-1);
const root = path.resolve(__dirname, '../../../dashboard');
app.setPath('userData', path.join(directory, 'composer-profile'));
let window, helper, controller, server;
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  const source = fs.readFileSync(path.join(root, 'src/app/components/assistant-composer.tsx'), 'utf8');
  const tree = ts.createSourceFile('composer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let input;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.getText(tree).includes('relative flex min-w-0 flex-1 items-center') && node.getText(tree).includes('<textarea')) input = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(input);
  const component = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AssistantComposer');
  const names = new Set(['syncCommandBackdrop', 'resizeTextarea', 'assignTextareaRef']);
  const sizing = component.body.statements.filter(node =>
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => names.has(decl.name.getText(tree)))) ||
    (ts.isExpressionStatement(node) && /^use(?:Layout)?Effect\(/.test(node.getText(tree)) && node.getText(tree).includes('resizeTextarea')),
  ).map(node => node.getText(tree)).join('\n');
  const constants = tree.statements.filter(node =>
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(tree).startsWith('COMPOSER_'))) ||
    (ts.isFunctionDeclaration(node) && node.name?.text === 'composerMaxHeight'),
  ).map(node => node.getText(tree)).join('\n');
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef,useState,useCallback,useEffect,useLayoutEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {useSentenceCompletion} from '@/app/components/use-sentence-completion';
      import PromptSuggestionOverlay from '@/app/components/prompt-suggestion-overlay';
      import {composerSegments} from '@/lib/composer-links';
      import {splitLeadingCommandTokens} from '@/app/components/hermes/command-text';
      window.fetch=async()=>new Response(JSON.stringify({completion:' how this works?'}),{headers:{'content-type':'application/json'}});
      ${constants}
      function App(){
        const [value,onChange]=useState('');const compact=false;
        const sentenceCompletion=useSentenceCompletion({conversationKey:'dictation-test',value,enabled:true,onChange});
        const promptSuggestion={text:null,dismiss:()=>{},handleKeyDown:()=>false};
        const internalTextareaRef=useRef(null),commandBackdropRef=useRef(null);
        const slashCommandMenuRef=useRef(null),commandHubRef=useRef(null),addMenuRef=useRef(null);
        const pendingWorkflowPrompt=null,setPendingWorkflow=()=>{},showSlashCommands=false;
        const menuSearch=null,setMenuSearch=()=>{};
        const setSlashQuery=()=>{},setShowSlashCommands=()=>{},setShowCommandHub=()=>{},slashQueryAt=()=>null;
        const onKeyDown=undefined,walkMessageHistory=()=>false,queueHeld=false;
        const uploadQueued=null,uploadQueuedRef=useRef(null),isAddingDocuments=false;
        const canSubmit=Boolean(value.trim()),isSending=false,disabled=false;
        const submitMessage=()=>{window.sent.push(value);onChange('');};
        const handlePaste=()=>{},textareaStyle=undefined,placeholder='Dictation test';
        ${sizing}
        window.seed=text=>{flushSync(()=>onChange(text));const e=internalTextareaRef.current;e.focus();e.setSelectionRange(text.length,text.length);};
        return <div style={{width:500}}>${input}</div>;
      }
      window.sent=[];flushSync(()=>createRoot(document.getElementById('root')).render(<App/>));
    ` } });
  window = new BrowserWindow({ width: 700, height: 600, title: 'Breadboard composer dictation check', webPreferences: { backgroundThrottling: false } });
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>Breadboard composer dictation check</title><style>body{font:18px sans-serif;padding:24px}textarea{font:18px sans-serif;width:100%}</style><button id="start">Run composer typing check</button><p>Fixed test text only. Nothing is sent.</p><div id="root"></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await window.loadURL(origin);
  await window.webContents.executeJavaScript(bundle.outputFiles[0].text + '\nvoid 0;');
  await window.webContents.executeJavaScript("document.getElementById('start').onclick=()=>window.runCheck=true;void 0;");
  window.show(); window.focus();
  console.log('COMPOSER_CHECK_READY');
  if (process.env.BREADBOARD_DICTATION_INTERACTIVE === '1')
    while (!await window.webContents.executeJavaScript('window.runCheck===true')) await new Promise(resolve => setTimeout(resolve, 100));
  const hwnd = Number(window.getNativeWindowHandle().readBigUInt64LE());
  helper = spawn(path.join(directory, 'probe.exe'), ['--accessibility', path.join(directory, 'windows-dictation.exe'), String(hwnd), '--renderer'], { windowsHide: true, stdio: 'pipe' });
  const lines = createInterface({ input: helper.stdout });
  helper.stderr.on('data', data => console.error(String(data)));
  const edits = [], commands = [];
  controller = new SystemDictation({ dashboardUrl: () => origin, allowed: { origins: new Set([origin]) }, log: console.log });
  controller.helper = { stdin: { destroyed: false, write: line => { commands.push(JSON.parse(line)); helper.stdin.write(line); }, end: () => {} }, kill: () => {} };
  let pending;
  lines.on('line', line => {
    const notice = JSON.parse(line);
    if (notice.type === 'edit') { edits.push(notice); controller.receive(notice); }
    else { const resolve = pending; pending = null; resolve?.(notice); }
  });
  const command = operation => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native probe timed out: ' + operation)), 10000);
    pending = notice => { clearTimeout(timer); resolve(notice); };
    helper.stdin.write(operation + '\n');
  });
  const results=[];
  await window.webContents.executeJavaScript("window.inputEvents=0;document.addEventListener('input',()=>window.inputEvents++);void 0;");
  await window.webContents.executeJavaScript("window.seed('')");
  await new Promise(resolve => setTimeout(resolve, 300));
  let capture = await command('capture');
  if (!capture.foreground && process.env.BREADBOARD_DICTATION_INTERACTIVE !== '1') {
    fs.writeFileSync(path.join(directory,'passed.json'),JSON.stringify({passed:true,skipped:'Windows denied fixture foreground access; run check-dictation-typing.mjs --composer interactively.'}));
    controller.stop(); helper.stdin.end(); window.destroy(); server.close(); app.exit(0); return;
  }
  for (let attempt = 0; !capture.streamable; attempt++) {
    assert.ok(attempt < 30, 'the composer publishes its editable accessibility target');
    await new Promise(resolve => setTimeout(resolve, 100));
    capture = await command('capture');
  }
  assert.equal((await command('stream')).error,null);
  controller.receive({ type: 'start', id: 1, window: hwnd });
  assert.ok(controller.active.editor, 'the controller captures the focused Breadboard editor');
  assert.equal(controller.focusedEditor(hwnd + 1),undefined,'remembered Electron focus cannot authorize another native window');
  assert.ok(commands.some(command => command.type === 'renderer-input'), 'the controller enables atomic insertion before any transcript');
  assert.equal((await command('ctrl down left')).error,null);
  try {
    for (const text of ['Can','Can you','Can you explain','Can you explain the','Can you explain the circuit in detail?', 'Can you explain this circuit in detail?',
      'Can you explain this circuit in detail? The words should appear while I am still speaking. I can pause between sentences and then continue with more details. Please keep every final word, including purple bicycles beside the river.',
      'Can you explain', '', 'Hello café 😀', 'Hello café 😃']) {
      await window.webContents.executeJavaScript('window.inputEvents=0');
      const result = await command('preview '+text);
      const dom = await window.webContents.executeJavaScript("(()=>{const e=document.querySelector('textarea');return {text:e.value,start:e.selectionStart,end:e.selectionEnd,events:window.inputEvents,sent:window.sent}})()");
      results.push({text,result,dom});console.log('PREVIEW',JSON.stringify(results.at(-1)));
      assert.equal(result.error,null);assert.equal(result.preview,true);assert.equal(dom.text,text);assert.deepEqual(dom.sent,[]);
      assert.equal(dom.events,1,'each live transcript revision is a single React edit while Ctrl+Shift remains held');
      if (text.length > 200) assert.ok(result.editMilliseconds < 2000, 'a long preview must not queue seconds of character input');
      assert.equal(controller.active.released,false,'words are visible before shortcut release');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  } finally { await command('ctrl up left'); }
  const finalText = 'Hello café 😃. Keep the final word.';
  assert.equal((await command('final '+finalText)).error,null);
  for (let i=0;i<40 && !(await window.webContents.executeJavaScript('window.sent.length'));i++) await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual(await window.webContents.executeJavaScript('window.sent'),[finalText]);
  await command('final '+finalText);
  assert.deepEqual(await window.webContents.executeJavaScript('window.sent'),[finalText],'duplicate final output is not inserted or submitted twice');
  controller.receive(edits.at(-1));
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('textarea').value"),'','an already acknowledged edit cannot be replayed');
  // Stale or cancelled requests cannot type into another field or a new hold.
  controller.cancel();
  controller.receive({type:'edit',id:1,request:999,text:'Must not appear'});
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('textarea').value"),'');
  assert.equal(edits.length,results.length+1);
  // Replacing selected text preserves everything outside this hold, including
  // when the other Ctrl key is held and the recognizer revises its answer.
  await window.webContents.executeJavaScript("window.seed('Keep before OLD keep after');document.querySelector('textarea').setSelectionRange(12,15)");
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal((await command('capture')).streamable,true);
  assert.equal((await command('stream')).error,null);
  controller.receive({type:'start',id:1,window:hwnd});
  assert.equal((await command('ctrl down right')).error,null);
  try {
    for (const text of ['new words','new café 🧪']) {
      const result=await command('preview '+text);
      assert.equal(result.error,null);
      assert.equal(await window.webContents.executeJavaScript("document.querySelector('textarea').value"),'Keep before '+text+' keep after');
    }
    const before=edits.length;
    await window.webContents.executeJavaScript("document.querySelector('textarea').setSelectionRange(0,0)");
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.match((await command('preview Must not replace other text')).error,/selection changed/);
    assert.equal(edits.length,before,'a moved caret prevents any renderer edit');
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('textarea').value"),'Keep before new café 🧪 keep after');
  } finally { await command('ctrl up right'); }
  controller.cancel();
  controller.stop();
  helper.stdin.end();
  const receipt = JSON.stringify({passed:true,results,edits:edits.length},null,2);
  fs.writeFileSync(path.join(directory,'composer-passed.json'),receipt);
  fs.writeFileSync(path.join(directory,'passed.json'),receipt);
  window.destroy(); server.close(); app.exit(0);
}).catch(error=>{console.error(error);fs.writeFileSync(path.join(directory,'composer-failed.json'),JSON.stringify({error:error.message},null,2));controller?.stop();helper?.kill();window?.destroy();server?.close();app.exit(1);});
