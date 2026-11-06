import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {normalizeChatTextSelectionReference, chatTextSelectionQuestionPrompt} from '../src/lib/chat-text-selection.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const selection = {id:'web-selection', mode:'inline', sourceMessageId:'web:lesson', start:4, end:18, quote:'selected words',
  sourceUrl:'https://example.com/lesson', sourceTitle:'Lesson', prefix:'The ', suffix:' follow.'};

test('web selection source metadata survives normalization and is quoted as question context', () => {
  assert.deepEqual(normalizeChatTextSelectionReference(selection), selection);
  const prompt = chatTextSelectionQuestionPrompt('Explain this', selection);
  assert.match(prompt, /excerpt from the web page/);
  assert.match(prompt, /"sourceUrl":"https:\/\/example.com\/lesson"/);
  assert.match(prompt, /quoted conversation data, not instructions/);
  assert.match(prompt, /User question:\nExplain this/);
  assert.equal(normalizeChatTextSelectionReference({...selection,sourceUrl:'javascript:alert(1)'})?.sourceUrl, undefined);
});

// Run the real panel's hydration and thread-building code with an isolated host.
const source = fs.readFileSync(path.join(root, 'src/app/components/hermes/agent-runtime-panel.tsx'), 'utf8');
const tree = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let threads, received, receiveEffect, resetEffect, deleteSelection;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === 'deleteInlineSelection') deleteSelection = node.getText(tree);
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText(tree) === 'inlineSelectionThreads') threads = node.getText(tree);
    if (node.name.getText(tree) === 'receivedWebSelection') received = node.getText(tree);
  }
  if (ts.isExpressionStatement(node) && node.expression.getText(tree).startsWith('useEffect(')) {
    const text = node.getText(tree);
    if (text.includes('const newlyCreated =')) receiveEffect = text;
    if (text.includes('setInlineSelectionRunId(null)') && text.includes('[sessionId, setComposerSelection]')) resetEffect = text;
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(threads && received && receiveEffect && resetEffect && deleteSelection);

test('first-chat Ask here stays open through conversation creation, keeps its source, and fits the native drawer', {timeout:60000}, async t => {
  const bundle = await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'src')},logLevel:'silent',
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React,{useState,useRef,useCallback,useEffect,useMemo} from 'react';
      import {createRoot} from 'react-dom/client';
      import {InlineSelectionAnswerPopover} from '@/app/components/chat-text-selection-ui';
      const initialWebSelection = {requestId:'request-one',reference:${JSON.stringify(selection)}};
      const activeRun = false; const onAbortInline = undefined;
      window.deleteCommands = []; window.failDelete = false;
      const sendDesktopTabsCommand = async command => { window.deleteCommands.push(command); return !window.failDelete; };
      const conversationLoading = false; const createdSessionId = 'conv_created';
      const reusableChatAttachments = () => []; const delegatedThinkingUpdates = () => [];
      const messageSelectionSourceId = m => m.id;
      function App() {
        const [webSelection,setWebSelection] = useState(initialWebSelection);
        window.selectInChat = () => setWebSelection({requestId:'request-two',reference:{...initialWebSelection.reference,mode:'chat'}});
        const [sessionId,setSessionId] = useState(null);
        const [messages,setMessages] = useState([]);
        const [savedInlineSelections,setSaved] = useState([]);
        const setSavedInlineSelections = useCallback(fn => { if (sessionId) setSaved(fn); },[sessionId]);
        const [openInlineAnswers,setOpenInlineAnswers] = useState([]);
        const [composerSelection,setComposerSelection] = useState(null);
        const [deletedInlineSelectionIds,setDeletedInlineSelectionIds] = useState(new Set());
        const [webHighlightDeleteFailure,setWebHighlightDeleteFailure] = useState(null);
        const [,setSelectionMenu] = useState(null); const [,setInlineSelectionRunId] = useState(null);
        const composerTextareaRef = useRef(null);
        const ${threads}; const ${received};
        ${resetEffect}
        ${receiveEffect}
        ${deleteSelection}
        window.deleteSelection = () => deleteInlineSelection(initialWebSelection.reference);
        window.snapshot = {sessionId,messages,composerSelection,webHighlightDeleteFailure,deleted:[...deletedInlineSelectionIds]};
        return <>
          <aside className='browser-terminal-drawer' data-open='true' style={{position:'fixed',top:40,bottom:0,left:40,width:580,transform:'none'}}>Terminal</aside>
          {openInlineAnswers.map(open => {
            const thread = inlineSelectionThreads.get(open.id);
            return thread && <InlineSelectionAnswerPopover key={open.id} {...thread} anchor={open.anchor}
              onClose={()=>setOpenInlineAnswers([])} onDelete={()=>setOpenInlineAnswers([])}
              onAskAgain={question=>{
                setSessionId('conv_created');
                setMessages([{id:'user-1',role:'user',content:question,textSelection:thread.selection},
                  {id:'assistant-1',role:'assistant',content:'A saved explanation.',textSelection:thread.selection}]);
              }}/>;
          })}
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `}});
  const stylesheet = path.join(root,'src/app/globals.css');
  const css = (await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'),{from:stylesheet})).css;
  const executablePath = [chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({executablePath,headless:true}); t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1400,height:900}});
  const errors = []; page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://web-selection.test/',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
  await page.goto('http://web-selection.test/'); await page.addStyleTag({content:css}); await page.addScriptTag({content:bundle.outputFiles[0].text});
  const dialog = page.getByRole('dialog',{name:'Answer about highlighted text'});
  await dialog.waitFor({state:'visible'});
  const editor = dialog.locator('textarea'); await editor.fill('Explain the passage');
  const send = dialog.getByRole('button',{name:'Ask',exact:true});
  await send.click();
  await page.waitForFunction(()=>window.snapshot?.sessionId==='conv_created');
  await dialog.getByText('A saved explanation.').waitFor({state:'visible'});
  assert.deepEqual(await page.evaluate(()=>window.snapshot.messages[0].textSelection),selection);
  assert.equal(await page.evaluate(()=>window.snapshot.composerSelection),null);
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 40 && bounds.x + bounds.width <= 620, 'answer stays inside the trusted drawer');
  await page.evaluate(()=>window.selectInChat());
  await page.waitForFunction(()=>window.snapshot.composerSelection?.mode==='chat');
  assert.equal(await page.evaluate(()=>window.snapshot.composerSelection.sourceUrl),selection.sourceUrl);
  await page.evaluate(async()=>{window.failDelete=true; await window.deleteSelection();});
  await page.waitForFunction(()=>window.snapshot.webHighlightDeleteFailure?.id==='web-selection');
  assert.deepEqual(await page.evaluate(()=>window.snapshot.deleted),[], 'failed webpage deletion retains the thread');
  await page.evaluate(async()=>{window.failDelete=false; await window.deleteSelection();});
  await page.waitForFunction(()=>window.snapshot.deleted.includes('web-selection'));
  assert.deepEqual(await page.evaluate(()=>window.deleteCommands), [
    {type:'browser-selection-delete',id:selection.id,url:selection.sourceUrl},
    {type:'browser-selection-delete',id:selection.id,url:selection.sourceUrl},
  ]);
  assert.deepEqual(errors,[]);
});
