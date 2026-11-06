import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/app/garden/garden-assistant.tsx'), 'utf8');
const tree = ts.createSourceFile('assistant.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['startNewChat', 'openChatSession', 'createChatSession', 'ensureTurnSession', 'loadQuartzChatSelection', 'persistQuartzChatSelection']);
const handlers = [];
let historyEffect, newChatButton;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) handlers.push(node.getText(tree));
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' &&
      node.arguments[0]?.getText(tree).includes('const cached = loadQuartzChatSessions')) historyEffect = node.getText(tree);
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button' &&
      node.openingElement.getText(tree).includes('startNewChat')) newChatButton = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(handlers.length, names.size);
assert.ok(historyEffect && newChatButton);

const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { '@': path.join(root, 'src') }, logLevel: 'silent', stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useRef,useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
import{useChatDraft}from'@/app/components/hermes/use-chat-draft';
const old={id:1,title:'Existing chat',messages:[{role:'assistant',content:'Existing answer'}],updated_at:'2026-09-29'};
const loadQuartzChatSessions=()=>JSON.parse(localStorage.getItem('fixture-cache')||'null')||[old],persistQuartzChatSessions=()=>{},MAX_QUARTZ_CHAT_SESSIONS=60;
const QUARTZ_CHAT_SELECTION_KEY_PREFIX='second-brain:quartz-ai-selection:';
const withRecoveredAssistant=m=>m,preserveInlineQuestionMessages=m=>m,reconcileInlineQuestionMessages=m=>m;
window.requests=[];window.fetch=(url,init={})=>{
  window.requests.push({url,method:init.method||'GET',priority:init.priority,body:init.body});
  return new Promise(resolve=>{
    if(init.method==='POST')window.finishCreation=(ok=true)=>resolve(Response.json(ok?{session:{id:2,messages:[],updated_at:'2026-09-29'}}:{error:'Unavailable'},{status:ok?200:503}));
    else window.finishHistory=()=>resolve(Response.json({sessions:[old]}));
  });
};
function App(){
 const activeClusterSlug='ec-2',clusterLabel='EC 2',chatIsStreaming=false;
 const [chatSessions,setChatSessions]=useState([old]),[activeChatId,setActiveChatId]=useState(1),[createdChatId,setCreatedChatId]=useState(null);
 const [messages,setMessages]=useState(old.messages),[showHistory,setShowHistory]=useState(true),[temporaryChat,setTemporaryChat]=useState(false);
 const [input,setInput]=useState(''),[permission,setPermissionRequest]=useState('Old permission');
 const activeChatIdRef=useRef(activeChatId);activeChatIdRef.current=activeChatId;
 const chatSelectionVersionRef=useRef(0),blankChatRequestedRef=useRef(false),clusterSlugRef=useRef(activeClusterSlug);
 const chatBeforeTemporary=useRef(null),localTurnRef=useRef(false),turnSessionCreationRef=useRef(null),composerTextareaRef=useRef(null);
 const textSelection={clearComposerSelection:()=>{}},setSelectedTextContext=()=>{},setChatAttachments=()=>{},setAttachmentStatus=()=>{};
 const permissionRequestFromMessages=()=>null;
 const activeChat=chatSessions.find(s=>s.id===activeChatId)||null;
 useChatDraft({surface:'garden_assistant:ec-2',sessionId:activeChatId===null?null:String(activeChatId),createdSessionId:createdChatId===null?null:String(createdChatId),value:input,onRestore:setInput,enabled:!temporaryChat});
 ${historyEffect};
 ${handlers.join('\n')}
 window.control={show:()=>setShowHistory(true),ensure:ensureTurnSession,old:()=>openChatSession(old),get id(){return activeChatId},get messages(){return messages},get input(){return input},get permission(){return permission}};
 return <><div data-testid="transcript">{messages.map(m=>m.content).join('|')}</div><textarea ref={composerTextareaRef} value={input} onChange={e=>setInput(e.target.value)}/>
 {showHistory&&<section data-testid="history">${newChatButton}</section>}</>;
}createRoot(document.getElementById('root')).render(<App/>);
` }});

test('New chat opens immediately during a stalled request, keeps drafts and ignores stale history', { timeout: 30_000 }, async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(edge) ? { executablePath: edge } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://localhost:53147/**', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
    await page.goto('http://localhost:53147/');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.locator('textarea').fill('Keep this existing draft');
    await page.getByRole('button',{name:'New chat',exact:true}).click();
    await page.waitForFunction(()=>window.control.id===null && !document.querySelector('[data-testid="history"]'));
    assert.equal(await page.getByTestId('transcript').innerText(),'');
    assert.equal(await page.evaluate(()=>window.control.permission),null);
    assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='POST').length),0);
    await page.evaluate(()=>window.finishHistory());
    assert.equal(await page.evaluate(()=>window.control.id),null);
    for(let i=0;i<3;i++){
      await page.evaluate(()=>window.control.show());
      await page.getByRole('button',{name:'New chat',exact:true}).click();
    }
    assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='POST').length),0);
    await page.evaluate(()=>window.control.old());
    await page.waitForFunction(()=>window.control.input==='Keep this existing draft');
    await page.evaluate(()=>localStorage.setItem('fixture-cache',JSON.stringify([{id:3,title:'Later empty chat',messages:[],updated_at:'2026-09-30'}, {id:1,title:'Existing chat',messages:[{role:'assistant',content:'Existing answer'}],updated_at:'2026-09-29'}])));
    await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForFunction(()=>window.control?.id===1);
    assert.equal(await page.getByTestId('transcript').innerText(),'Existing answer');
    assert.equal(await page.locator('textarea').inputValue(),'Keep this existing draft');
    await page.evaluate(()=>window.control.show());await page.getByRole('button',{name:'New chat',exact:true}).click();
    await page.locator('textarea').fill('First question');
    await page.evaluate(()=>{window.sessions=Promise.all([window.control.ensure(),window.control.ensure()])});
    assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='POST').length),1);
    await page.evaluate(()=>window.finishCreation());
    assert.deepEqual(await page.evaluate(async()=> (await window.sessions).map(s=>s.id)),[2,2]);
    await page.waitForFunction(()=>window.control.id===2);
    assert.equal(await page.locator('textarea').inputValue(),'First question');
    assert.deepEqual(errors,[]);
  } finally {await browser.close()}
});

test('failed first-session creation can retry and an older creation cannot reopen a fresh blank chat', { timeout: 30_000 }, async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
  try {
    const page=await browser.newPage();
    await page.route('http://localhost:53147/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
    await page.goto('http://localhost:53147/');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole('button',{name:'New chat',exact:true}).click();
    await page.evaluate(()=>{window.first=window.control.ensure();window.finishCreation(false)});
    assert.equal(await page.evaluate(()=>window.first),null);
    await page.evaluate(()=>{window.second=window.control.ensure()});
    assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='POST').length),2);
    await page.evaluate(()=>window.control.show());await page.getByRole('button',{name:'New chat',exact:true}).click();
    await page.evaluate(()=>window.finishCreation());
    assert.equal(await page.evaluate(async()=>(await window.second).id),2);
    assert.equal(await page.evaluate(()=>window.control.id),null);
    assert.equal(await page.getByTestId('transcript').innerText(),'');
  } finally {await browser.close()}
});
