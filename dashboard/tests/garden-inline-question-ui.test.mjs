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

const root=fileURLToPath(new URL('../',import.meta.url));
const source=fs.readFileSync(path.join(root,'src/app/gardens/[clusterSlug]/workspace-client.tsx'),'utf8');
const tree=ts.createSourceFile('workspace.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const handlers=new Map();
function visit(node){if(ts.isFunctionDeclaration(node)&&['submitComposer','sendInlineQuestion','stopInlineQuestion'].includes(node.name?.text))handlers.set(node.name.text,node.getText(tree));ts.forEachChild(node,visit)}visit(tree);
const bundle=await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'src')},logLevel:'silent',stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useState,useRef} from 'react';import {createRoot} from 'react-dom/client';
import {runGardenInlineQuestion} from '@/lib/conversations/garden-inline-question';
import {abortGardenTurnCheckpoint} from '@/lib/conversations/garden-turn-client';
import {useAssistantIntelligence,applySavedAssistantIntelligence} from '@/app/components/use-assistant-intelligence';
import {InlineSelectionAnswerPopover,SelectableAssistantMarkdown} from '@/app/components/chat-text-selection-ui';
const selection={id:'highlight-lorentz',mode:'inline',sourceMessageId:'source-message',start:0,end:13,quote:'Lorentz force'};
const second={id:'highlight-magnetic',mode:'inline',sourceMessageId:'source-message',start:29,end:43,quote:'magnetic field'};
const attachment={type:'document',name:'em1.pdf',format:'pdf',blobId:'doc_'+'a'.repeat(32),text:'Charged particle context',sizeBytes:123};
window.mainSignal=new AbortController().signal;window.requests=[];window.streams={};window.refreshes=[];
window.profile={model:localStorage.getItem('breadboard:assistant-model')||'gpt-5.6-sol',reasoningEffort:'max'};
window.changeProfile=()=>{window.profile={model:'cliproxy/kimi-k2',reasoningEffort:'high'};applySavedAssistantIntelligence(window.profile)};
window.fetch=async(url,init={})=>{
 const body=JSON.parse(init.body||'{}');window.requests.push({url,method:init.method,body});
 if(url==='/api/assistant-preferences')return Response.json(window.profile);
 if(url.endsWith('/turns')){
   if(init.method==='DELETE')return Response.json({cancelled:true});
   if(window.holdCheckpoint)await new Promise(resolve=>window.releaseCheckpoint=resolve);
   return Response.json({conversationId:'conv_1',userMessage:{id:'msg_user-'+body.clientMessageId},assistantMessage:{id:'msg_answer-'+body.clientMessageId}});
 }
 if(url==='/api/chat')return new Response(new ReadableStream({start(controller){window.streams[body.clientMessageId]=controller;}}));
 return Response.json({});
};
window.emit=(id,event)=>window.streams[id].enqueue(new TextEncoder().encode('data: '+(typeof event==='string'?event:JSON.stringify(event))+'\\n\\n'));
const messageSelectionSourceId=m=>m.id;
function App(){
 const initial=JSON.parse(localStorage.getItem('messages')||'null')||[{id:'source-message',role:'assistant',content:'Lorentz force moves a charge. magnetic field is part of it.'}];
 const [chatSessions,setChatSessions]=useState([{id:1,isOwn:true,messages:initial},{id:2,isOwn:true,messages:[]}]);
 const [activeChatId,setActiveChatId]=useState(1);const activeChat=chatSessions.find(s=>s.id===activeChatId);const messages=activeChat.messages;
 const [input,setInput]=useState('what is that'),[composerSelection,setComposerSelection]=useState(selection),[chatAttachments,setChatAttachments]=useState([attachment]);
 const [openInlineAnswers,setOpenInlineAnswers]=useState([]),[spacer,setSpacer]=useState(80);
 const inlineQuestionRunsRef=useRef(new Map());
 const activeChatIdRef=useRef(activeChatId);activeChatIdRef.current=activeChatId;
 const chatContentLoading=false,canAskSelection=true,isStreaming=true,externalRunHoldsQueue=false,stoppingGardenChat=false;
 const clusterSlug='em1-fixture',selectedDocumentSlugs=[];
 const {model,setModel,reasoningEffort,setReasoningEffort}=useAssistantIntelligence({scope:'garden_chat:'+clusterSlug,sessionId:activeChatId});
 const setSelectionMenu=()=>{},setInlineSelectionRunId=()=>{},queueFollowUp=()=>{throw Error('Must not queue')},handleSubmit=()=>{throw Error('Must not use main dispatch')};
 const addToast=message=>{throw Error(message)};
 const refreshChatSession=async id=>{window.refreshes.push(id)};
 const updateChatMessages=(id,updater)=>setChatSessions(current=>current.map(session=>{
   if(session.id!==id)return session;const next=typeof updater==='function'?updater(session.messages):updater;
   if(id===1)localStorage.setItem('messages',JSON.stringify(next));return {...session,messages:next};
 }));
 ${[...handlers.values()].join('\n')}
 window.control={switchChat:setActiveChatId,move:()=>setSpacer(160),askSecond:()=>{setComposerSelection(second);setInput('Explain the field')},get messages(){return messages}};
 return <><div id='scroller' style={{height:600,overflowY:'auto',margin:'20px',border:'1px solid transparent'}}><div style={{height:spacer}}/>
 <div style={{maxWidth:700,margin:'0 auto'}}><SelectableAssistantMarkdown sourceMessageId='source-message' content={initial[0].content}
 annotations={[{...selection,kind:'answer'},{...second,kind:'answer'}]} onSelection={()=>{}} onOpenAnnotation={(id,anchor)=>setOpenInlineAnswers([{id,anchor}])}/></div><div style={{height:1800}}/></div>
 <select aria-label='Chat model' value={model} onChange={e=>setModel(e.target.value)}><option>cliproxy/kimi-k2</option><option>gpt-5.6-sol</option><option>cliproxy/claude-opus-5</option></select>
 <select aria-label='Chat reasoning' value={reasoningEffort} onChange={e=>setReasoningEffort(e.target.value)}><option>high</option><option>max</option></select>
 <textarea aria-label='Question' value={input} onChange={e=>setInput(e.target.value)}/><button onClick={submitComposer}>Send</button><output>Main answer is still running</output>
 {openInlineAnswers.map(open=>{const answer=messages.findLast(m=>m.role==='assistant'&&m.textSelection?.id===open.id),question=messages.findLast(m=>m.role==='user'&&m.textSelection?.id===open.id);return <InlineSelectionAnswerPopover key={open.id} anchor={open.anchor} selection={open.id===selection.id?selection:second} question={question?.content} answer={answer?.content} pending={answer?.pending||false}
 onClose={()=>setOpenInlineAnswers([])} onDelete={()=>{}} onStop={()=>stopInlineQuestion(open.id)} onAskAgain={q=>sendInlineQuestion(q,open.id===selection.id?selection:second,[])}/>})}</>;
}createRoot(document.getElementById('root')).render(<App/>);
`}});

test('Ask here starts while the main answer runs, stays at its mark through scrolling and reflow, and stops only itself',{timeout:60000},async()=>{
 const stylesheet=path.join(root,'src/app/globals.css');
 const css=(await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'),{from:stylesheet})).css;
 const executablePath=[chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1229,height:840}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost:53142/**',route=>route.fulfill({contentType:'text/html',body:'<html data-theme="light"><body><div id="root"></div></body></html>'}));
  const mount=async()=>{await page.goto('http://localhost:53142/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});};
  await mount();
  const modelPicker=page.getByRole('combobox',{name:'Chat model',exact:true});
  await page.waitForFunction(()=>localStorage.getItem('breadboard:assistant-model')==='gpt-5.6-sol');
  // The existing chat inherited GPT without a picker click. Changing the
  // profile must not replace that chat's model before its next popup question.
  await page.evaluate(()=>window.changeProfile());
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(()=>Object.keys(window.streams).length===1);
  const request=await page.evaluate(()=>window.requests.find(r=>r.url==='/api/chat').body);
  assert.equal(request.chatSessionId,1);assert.equal(request.textSelection.quote,'Lorentz force');
  assert.equal(request.model,'gpt-5.6-sol');assert.equal(request.reasoningEffort,'max');
  assert.equal(request.attachments[0].name,'em1.pdf');assert.match(request.selectedTextContext.sourceResponse,/magnetic field/);
  assert.equal(await page.evaluate(()=>window.mainSignal.aborted),false);
  assert.equal(await page.evaluate(()=>window.requests.some(r=>r.method==='DELETE'||r.url.endsWith('/abort'))),false);
  const dialog=page.getByRole('dialog',{name:'Answer about highlighted text'});
  const attached=async()=>page.waitForFunction(()=>{const mark=document.querySelector('[data-chat-selection-id="highlight-lorentz"]'),card=document.querySelector('.bb-inline-answer');if(!mark||!card)return false;const a=mark.getBoundingClientRect(),b=card.getBoundingClientRect();return Math.abs(b.top-a.bottom-14)<2||Math.abs(a.top-b.bottom-14)<2});
  await attached();await page.evaluate(()=>window.control.move());await attached();
  await page.locator('#scroller').evaluate(el=>el.scrollTop=90);await attached();
  await page.evaluate(({id})=>window.emit(id,{type:'replace',text:'The **Lorentz force** combines electric and magnetic forces.'}),{id:request.clientMessageId});
  await dialog.getByText('combines electric and magnetic forces.',{exact:false}).waitFor();await attached();
  await dialog.getByRole('button',{name:'Stop this answer',exact:true}).click();
  await page.waitForFunction(()=>window.requests.some(r=>r.method==='DELETE'));
  assert.equal(await page.evaluate(()=>window.requests.find(r=>r.method==='DELETE').body.clientMessageId),request.clientMessageId);
  assert.equal(await page.evaluate(()=>window.mainSignal.aborted),false);
  await modelPicker.selectOption('cliproxy/claude-opus-5');
  await page.getByRole('combobox',{name:'Chat reasoning',exact:true}).selectOption('high');
  await dialog.getByRole('button',{name:'Ask this question again',exact:true}).click();
  await page.waitForFunction(()=>Object.keys(window.streams).length===2);
  const retry=await page.evaluate(()=>window.requests.filter(r=>r.url==='/api/chat').at(-1).body.clientMessageId);
  const retryRequest=await page.evaluate(()=>window.requests.filter(r=>r.url==='/api/chat').at(-1).body);
  assert.equal(retryRequest.model,'cliproxy/claude-opus-5');assert.equal(retryRequest.reasoningEffort,'high');
  assert.equal(await page.evaluate(()=>localStorage.getItem('breadboard:assistant-model')),'cliproxy/kimi-k2');
  await page.evaluate(id=>{window.emit(id,{type:'replace',text:'The saved inline answer.'});window.emit(id,'[DONE]')},retry);
  await dialog.getByText('The saved inline answer.',{exact:true}).waitFor();await attached();
  await page.setViewportSize({width:390,height:700});await attached();
  const bounds=await dialog.boundingBox();assert.ok(bounds.x>=16&&bounds.x+bounds.width<=374);
  await page.locator('#scroller').evaluate(el=>el.scrollTop=1000);await dialog.waitFor({state:'hidden'});
  await page.locator('#scroller').evaluate(el=>el.scrollTop=90);await dialog.waitFor();await attached();
  await mount();await page.locator('[data-chat-selection-id="highlight-lorentz"]').click();
  assert.equal(await modelPicker.inputValue(),'cliproxy/claude-opus-5');
  await dialog.getByText('The saved inline answer.',{exact:true}).waitFor();await attached();
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
