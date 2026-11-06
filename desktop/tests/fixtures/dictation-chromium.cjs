const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../../dashboard/node_modules/esbuild');
const directory = process.argv.at(-1);
const interactive = process.env.BREADBOARD_DICTATION_INTERACTIVE === '1';
app.setPath('userData', path.join(directory, 'chromium-profile'));
let helper, window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 650, height: 700, title: 'Breadboard text field verification', webPreferences: { backgroundThrottling: false } });
  await window.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Breadboard text field verification</title><style>body{font:18px sans-serif;padding:24px}input,textarea,[contenteditable]{display:block;width:95%;min-height:35px;margin:8px 0;border:1px solid #888}</style><p>Local dictation verification. Nothing is sent.</p><div id="root"></div>`));
  const bundle = await build({ stdin: { resolveDir: path.resolve(__dirname, '../../../dashboard'), loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {Schema} from '@tiptap/pm/model';import {EditorState,TextSelection} from '@tiptap/pm/state';import {EditorView} from '@tiptap/pm/view';
    let managed;
    function App(){const [values,setValues]=useState({input:'',textarea:''}),[updates,setUpdates]=useState(0);
      window.seedField=(id,text)=>{if(id==='managed'){const schema=managed.state.schema;managed.updateState(EditorState.create({schema,doc:schema.node('doc',null,[schema.node('paragraph',null,text?schema.text(text):null)])}));managed.focus();return;}flushSync(()=>setValues(old=>({...old,[id]:text})));const e=document.getElementById(id);if(!('value' in e))e.textContent=text;e.focus();};
      return <><input id="input" value={values.input} onChange={e=>setValues(old=>({...old,input:e.target.value}))}/><textarea id="textarea" value={values.textarea} onChange={e=>setValues(old=>({...old,textarea:e.target.value}))}/><div id="editable" contentEditable suppressContentEditableWarning/><div id="rich" role="textbox" contentEditable suppressContentEditableWarning onInput={()=>setUpdates(n=>n+1)}><p><span>Sample</span></p></div><div id="managed-host"/><input id="password" type="password"/><input id="readonly" readOnly/><button id="button">Not a text field</button><div id="custom" tabIndex={0}>Focusable non-editor</div><output>{updates}</output></>;
    }flushSync(()=>createRoot(document.getElementById('root')).render(<App/>));
    const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'text*',group:'block',toDOM:()=>['p',0],parseDOM:[{tag:'p'}]},blockquote:{content:'block+',group:'block',toDOM:()=>['blockquote',0]},text:{inline:true}},marks:{strong:{toDOM:()=>['strong',0]}}});
    managed=new EditorView(document.getElementById('managed-host'),{state:EditorState.create({schema}),attributes:{id:'managed',role:'textbox'}});
    window.seedPlaceholder=()=>{
      const editor=document.getElementById('rich');editor.innerHTML='<p><span role="group" data-placeholder contenteditable="false">Ask a question…</span><br></p>';
      editor.addEventListener('input',()=>editor.querySelector('[data-placeholder]')?.remove(),{once:true});
      editor.focus();const range=document.createRange();range.setStart(editor.firstChild,1);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    };
    window.seedStructured=(crossParagraphs=false)=>{
      const first=schema.node('paragraph',null,schema.text('Keep this first paragraph.'));
      const middle=schema.node('paragraph',null,[schema.text('before '),schema.text('café 🌱',[schema.mark('strong')]),schema.text(' AFTER')]);
      const last=schema.node('paragraph',null,schema.text('Keep this last paragraph.'));
      const doc=schema.node('doc',null,[first,schema.node('blockquote',null,middle),last]);
      const start=first.nodeSize+2;
      managed.updateState(EditorState.create({schema,doc,selection:crossParagraphs?TextSelection.create(doc,3,doc.content.size-3):TextSelection.create(doc,start+7,start+14)}));managed.focus();
    };
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  await window.webContents.executeJavaScript(bundle.outputFiles[0].text + '\nvoid 0;');
  window.show(); window.focus(); window.webContents.focus();
  if (interactive) {
    window.setAlwaysOnTop(true);
    await window.webContents.executeJavaScript(`document.querySelector('p').innerHTML='<strong>Dictation typing check</strong><br>No microphone is needed. This checks fixed text in these test fields only. Keep this window focused until it finishes.<br><button id="run-check">Run typing check</button>';document.getElementById('run-check').onclick=()=>{window.runTypingCheck=true;document.querySelector('p').textContent='Checking typing… Please keep this window focused.';};void 0;`);
    console.log('TYPING_CHECK_READY');
    while (!await window.webContents.executeJavaScript('window.runTypingCheck===true')) await new Promise(resolve => setTimeout(resolve, 200));
    window.setAlwaysOnTop(false);
  }
  async function verify(assembly = path.join(directory, 'windows-dictation.exe')) {
  helper = spawn(path.join(directory, 'probe.exe'), ['--accessibility', assembly, window.getNativeWindowHandle().readBigUInt64LE().toString()], { windowsHide: true, stdio: 'pipe' });
  const lines = createInterface({ input: helper.stdout });
  helper.stderr.on('data', data => console.error(String(data)));
  const command = operation => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Accessibility probe timed out')), operation === 'burst' ? 60000 : 10000);
    lines.once('line', line => { clearTimeout(timer); resolve(JSON.parse(line)); }); helper.stdin.write(operation + '\n');
  });
  const results = [];
  async function verifyOrdinaryTyping(field) {
    await window.webContents.executeJavaScript(`(()=>{if(window.plainKeyListener)document.removeEventListener('keydown',window.plainKeyListener);window.plainKeys=[];window.plainKeyListener=e=>window.plainKeys.push({key:e.key.toLowerCase(),modified:e.ctrlKey||e.metaKey||e.altKey||e.shiftKey});document.addEventListener('keydown',window.plainKeyListener);})()`);
    assert.equal((await command('plain-keys')).error, null, 'all Windows modifiers must be released before ordinary H/E typing');
    for (let tries=0;tries<40;tries++) {
      if (await window.webContents.executeJavaScript('window.plainKeys.length>=2')) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.deepEqual(await window.webContents.executeJavaScript('window.plainKeys'), [{key:'h',modified:false},{key:'e',modified:false}], 'H and E are text keys after dictation, with no lingering modifiers');
    results.push({phase:'post-dictation-typing',field,modifiersReleased:true,keys:'h e'});
  }
  await window.webContents.executeJavaScript('window.seedPlaceholder()');
  await new Promise(resolve => setTimeout(resolve, 150));
  const placeholder = await command('capture');
  const placeholderBefore = await command('text 0 -1');
  assert.equal(placeholder.streamable, true, 'a read-only placeholder outside the caret must not delay all words until release');
  assert.deepEqual(placeholder.selection, [1, 1], 'placeholder contributes an embedded-object offset before the caret');
  await command('remember-placeholder');
  for (const character of 'Testing breadb') window.webContents.sendInputEvent({ type: 'char', keyCode: character });
  await new Promise(resolve => setTimeout(resolve, 150));
  const rebasedPlaceholder = await command('rebase Testing breadb');
  assert.equal(rebasedPlaceholder.preview, true, 'first preview follows its exact text when a placeholder disappears: ' + JSON.stringify({before: placeholderBefore, after: await command('text 0 -1'), rebasedPlaceholder, dom:await window.webContents.executeJavaScript(`({html:document.getElementById('rich').innerHTML,anchor:getSelection().anchorOffset,focus:getSelection().focusOffset})`)}));
  assert.equal((await command('rebase Testing')).preview, false, 'never acknowledge a partial word as the full inserted preview');
  assert.deepEqual((await command('check')).selection, [14, 14]);
  await window.webContents.executeJavaScript(`(()=>{const node=document.getElementById('rich').firstChild.firstChild;node.insertData(0,'unrelated ');const range=document.createRange();range.setStart(node,node.length);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);})()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await command('rebase Testing breadb')).preview, false, 'unrelated surrounding edits must never rebase the owned span');
  results.push({ phase: 'placeholder-removed', streamable: true, rebased: true });
  for (const id of ['input', 'textarea', 'editable', 'rich', 'managed', 'password', 'readonly', 'button', 'custom']) {
    await window.webContents.executeJavaScript(`document.getElementById('${id}').focus()`);
    await new Promise(resolve => setTimeout(resolve, 300));
    const previous = await command('check');
    assert.equal(previous.focused, false, 'switching DOM fields invalidates the captured element');
    const result = await command('capture');
    const editable = ['input', 'textarea', 'editable', 'rich', 'managed'].includes(id);
    console.log(JSON.stringify({ field: id, ...result })); results.push({ field: id, ...result });
    assert.equal(result.editable, editable, id + ' editability');
    assert.equal(result.focused, editable, id + ' focused editor');
    if (editable) assert.ok(result.caret?.[3] > 0 || result.bounds?.[3] > 0, 'caret or field anchor is available');
  }
  for (const id of ['input', 'textarea', 'editable', 'rich', 'managed']) {
    const sample = 'before café 🌱 AFTER';
    await window.webContents.executeJavaScript(`window.seedField('${id}',${JSON.stringify(sample)})`);
    await new Promise(resolve => setTimeout(resolve, 150));
    await command('capture');
    const selection = await command('select 7 14');
    assert.equal(selection.selected, true, 'IA2 can select the owned Unicode span in ' + id);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual((await command('check')).selection, [7, 14], id + ' owned selection');
    assert.equal((await command('text 7 14')).text, 'café 🌱');
    await command('select 14 14');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual((await command('check')).selection, [14, 14], 'caret collapses after the selected Unicode span');
  }
  await window.webContents.executeJavaScript('window.seedStructured()');
  await new Promise(resolve => setTimeout(resolve, 150));
  await command('capture');
  assert.deepEqual((await command('check')).selection, [0, 7], 'nested bold selection uses offsets within its own text container');
  assert.equal((await command('text 0 7')).text, 'café 🌱');
  assert.equal((await command('select 7 7')).selected, true);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual((await command('check')).selection, [7, 7], 'nested caret remains in its formatted text container');
  await window.webContents.executeJavaScript('window.seedStructured(true)');
  await new Promise(resolve => setTimeout(resolve, 100));
  const crossParagraphs = await command('capture');
  assert.equal(crossParagraphs.editable, true);
  assert.equal(crossParagraphs.streamable, false, 'cross-paragraph selections wait for final insertion instead of using object offsets as character offsets');
  // Chromium's accessibility text is also the acknowledgement for streaming.
  // Exercise real edits even when Windows denies this fixture OS foreground.
  for (const id of ['input', 'textarea', 'editable', 'rich', 'managed']) {
    await window.webContents.executeJavaScript(`window.seedField('${id}','')`);
    await new Promise(resolve => setTimeout(resolve, 100)); await command('capture');
    let length = 0;
    for (const text of ['Testing', 'Testing ', 'Testing breadb', 'Testing breadboard ', 'Testing  breadboard.']) {
      await command(`select 0 ${length}`);
      await new Promise(resolve => setTimeout(resolve, 100));
      for (const character of text) window.webContents.sendInputEvent({ type: 'char', keyCode: character });
      await new Promise(resolve => setTimeout(resolve, 100));
      const actual = (await command(`text 0 ${text.length}`)).text;
      const acknowledgement = { field: id, expected: text, accessibilityText: actual, selection: (await command('check')).selection };
      assert.equal(actual?.replaceAll('\u00a0', ' '), text, 'accessible typed text preserves every code unit');
      assert.equal((await command('matches ' + text)).preview, true, 'production confirmation accepts only equivalent spaces');
      results.push(acknowledgement); console.log(JSON.stringify(acknowledgement));
      length = text.length;
    }
  }
  const nativeStreaming = (await command('check')).foreground && process.env.BREADBOARD_DICTATION_SKIP_NATIVE !== '1';
  if (interactive) assert.equal(nativeStreaming, true, 'the automated typing check needs this test window to retain foreground focus');
  const nativeFields = ['placeholder', 'input', 'textarea', 'editable', 'rich', 'managed'].filter(id =>
    !process.env.BREADBOARD_DICTATION_NATIVE_FIELDS || process.env.BREADBOARD_DICTATION_NATIVE_FIELDS.split(',').includes(id));
  if (nativeStreaming) for (const id of nativeFields) {
    console.log(JSON.stringify({ phase: 'native-streaming', field: id }));
    if (id === 'placeholder') {
      await window.webContents.executeJavaScript('window.seedPlaceholder()');
      await new Promise(resolve => setTimeout(resolve, 100)); await command('capture');
      assert.equal((await command('stream')).error, null);
      assert.equal((await command('ctrl down left')).error, null);
      try {
        for (const text of ['Testing breadb', 'Testing breadboard', 'Testing Breadboard. Please keep every final word.']) {
          const result = await command('preview ' + text);
          assert.equal(result.error, null, 'placeholder live insertion: ' + JSON.stringify(result));
          assert.equal(result.preview, true);
          assert.equal(await window.webContents.executeJavaScript(`document.getElementById('rich').textContent`), text);
          results.push({ phase: 'native-preview', field: id, characters: text.length, editMilliseconds: result.editMilliseconds });
        }
      } finally { await command('ctrl up left'); }
      await verifyOrdinaryTyping(id);
      continue;
    }
    await window.webContents.executeJavaScript(`(()=>{window.seedField('${id}','before replace AFTER');const e=document.getElementById('${id}');window.enters=0;e.onkeydown=k=>{if(k.key==='Enter'){k.preventDefault();window.enters++;}};})()`);
    await new Promise(resolve => setTimeout(resolve, 100)); await command('capture'); await command('select 7 14');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await command('stream')).error, null);
    for (const side of ['left', 'right']) {
      assert.equal((await command('ctrl down ' + side)).error, null);
      try {
        for (const text of ['Testing', 'Testing breadb', 'Testing breadboard', 'Testing breadboard dictation.', 'Hello', 'Hello ', 'Hello 🌱', 'Hallo 🌳', '', 'café 世界']) {
          const result = await command('preview ' + text);
          results.push({ phase: 'native-preview', field: id, side, characters: text.length, editMilliseconds: result.editMilliseconds });
          assert.equal(result.error, null, id + ' live update: ' + JSON.stringify(result));
          assert.equal(result.preview, true);
          const snapshot = await window.webContents.executeJavaScript(`({text:document.getElementById('${id}').value??document.getElementById('${id}').textContent,enters:window.enters})`);
          snapshot.text = snapshot.text.replaceAll('\u00a0', ' ');
          assert.deepEqual(snapshot, { text: 'before ' + text + ' AFTER', enters: 0 }, 'live updates preserve surrounding text without submitting');
        }
        const burst = await command(process.env.BREADBOARD_DICTATION_QUICK === '1' ? 'burst-fast' : 'burst');
        assert.equal(burst.error, null, id + ' rapid updates: ' + JSON.stringify(burst));
        assert.equal(burst.preview, true);
        assert.equal(await window.webContents.executeJavaScript(`(document.getElementById('${id}').value??document.getElementById('${id}').textContent).replaceAll('\\u00a0',' ')`), 'before  AFTER');
      } finally { await command('ctrl up ' + side); }
    }
    await command('final Final words.'); await new Promise(resolve => setTimeout(resolve, 100));
    await command('final duplicate'); await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await window.webContents.executeJavaScript(`({text:(document.getElementById('${id}').value??document.getElementById('${id}').textContent).replaceAll('\\u00a0',' '),enters:window.enters})`),
      { text: 'before Final words. AFTER', enters: 1 }, 'final corrections and Enter happen exactly once');
    for (const side of ['left', 'right']) {
      await window.webContents.executeJavaScript(`(()=>{window.seedField('${id}','before replace AFTER');window.enters=0;window.modifiedEnters=0;document.getElementById('${id}').onkeydown=k=>{if(k.key==='Enter'){k.preventDefault();window.enters++;if(k.ctrlKey||k.shiftKey||k.metaKey||k.altKey)window.modifiedEnters++;}};})()`);
      await command('capture'); await command('select 7 14'); await command('stream'); await command('ctrl down ' + side);
      try {
        const firstPreview = await command('preview Final wor');
        assert.equal(firstPreview.error, null, id + ' held send preview: ' + JSON.stringify(firstPreview));
        assert.equal((await command('final-held Final words.')).error, null);
        await new Promise(resolve => setTimeout(resolve, 150));
        await command('final-held duplicate');
        assert.deepEqual(await window.webContents.executeJavaScript(`({text:(document.getElementById('${id}').value??document.getElementById('${id}').textContent).replaceAll('\\u00a0',' '),enters:window.enters,modified:window.modifiedEnters})`),
          { text: 'before Final words. AFTER', enters: 1, modified: 0 }, 'voice send presses plain Enter once while Ctrl and Shift remain physically held');
      } finally { await command('ctrl up ' + side); }
    }
    await verifyOrdinaryTyping(id);
  }
  else console.log('Windows denied native streaming fixture focus; IA2 selection verified, live SendInput still requires physical verification.');
  helper.stdin.end();
  return { passed: true, scope: 'Chromium accessibility and Unicode selection; Windows streaming only for nativeFields; Enter checked for nativeFields other than placeholder', nativeStreaming, nativeFields: nativeStreaming ? nativeFields : [], results };
  }
  if (interactive && process.env.BREADBOARD_DICTATION_BASELINE) {
    try { fs.writeFileSync(path.join(directory, 'baseline.json'), JSON.stringify(await verify(process.env.BREADBOARD_DICTATION_BASELINE), null, 2)); }
    catch (error) { helper?.kill(); fs.writeFileSync(path.join(directory, 'baseline.json'), JSON.stringify({ passed: false, error: error.message }, null, 2)); }
  }
  for (;;) {
    const revision = fs.statSync(path.join(directory, 'windows-dictation.exe')).mtimeMs;
    try { const result = await verify(); fs.writeFileSync(path.join(directory, 'passed.json'), JSON.stringify(result, null, 2)); break; }
    catch (error) {
      if (!interactive) throw error;
      console.error(error); helper?.kill();
      fs.writeFileSync(path.join(directory, 'failed.json'), JSON.stringify({ error: error.message }, null, 2));
      await window.webContents.executeJavaScript(`document.querySelector('p').textContent='The check found a problem. Leave this window open; the next fix will be checked here automatically.';void 0;`);
      while (fs.statSync(path.join(directory, 'windows-dictation.exe')).mtimeMs === revision) await new Promise(resolve => setTimeout(resolve, 500));
      if (!window.isFocused()) {
        await window.webContents.executeJavaScript(`document.querySelector('p').textContent='The next check is ready. Click this window to resume, then leave it focused.';void 0;`);
        while (!window.isFocused()) await new Promise(resolve => setTimeout(resolve, 200));
      }
      await window.webContents.executeJavaScript(`document.querySelector('p').textContent='Checking the updated fix…';void 0;`);
    }
  }
  window.destroy(); app.exit(0);
}).catch(error => { console.error(error); fs.writeFileSync(path.join(directory, 'failed.json'), JSON.stringify({ error: error.message }, null, 2)); helper?.kill(); window?.destroy(); app.exit(1); });
