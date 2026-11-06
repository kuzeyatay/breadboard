import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'src/app/garden/garden-assistant.tsx'), 'utf8');
const tree = ts.createSourceFile('quartz.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['sendMessage', 'sendInlineQuestion', 'stopInlineQuestion', 'ensureTurnSession', 'updateSessionMessages', 'gardenSelectionMessageId'];
const handlers = new Map();
let selectionAsk;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) handlers.set(node.name.text, node.getText(tree));
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useTextSelectionController') {
    selectionAsk = node.arguments[0].properties.find(p => p.name?.getText(tree) === 'onAsk').initializer.getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(handlers.size, names.length);

// Execute Quartz's actual dispatch/stop/state-update functions and the shared
// selection UI. Only HTTP and unrelated agent tools are replaced; no live chat
// or model is used by this fixture.
const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { '@': path.join(root, 'src') }, logLevel: 'silent', stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {useTextSelectionController} from '@/app/components/use-text-selection-controller';
import {SelectableAssistantMarkdown} from '@/app/components/chat-text-selection-ui';
import {runGardenInlineQuestion,preserveInlineQuestionMessages,reconcileInlineQuestionMessages,retireCompletedInlineQuestionViewers} from '@/lib/conversations/garden-inline-question';
import {fetchGardenChat,reserveGardenTurnCheckpoint,abortGardenTurnCheckpoint} from '@/lib/conversations/garden-turn-client';
import {chatMessageAttachments} from '@/lib/chat-attachments';
import {applyGardenStableTextEvent} from '@/lib/hermes/garden-stable-stream';
import {readGardenResponseData} from '@/lib/hermes/garden-response-stream';
import {normalizeChatTokenUsage} from '@/lib/chat-token-usage';
import {delegatedThinkingUpdates} from '@/lib/hermes/super-agent-activity';
const isSuperAgentEnabled=()=>false,isYoloModeEnabled=()=>false,isDirectModeEnabled=()=>true,isPersonalizeEnabled=()=>true;
const persistQuartzChatSessions=()=>{},saveBranchGroups=()=>{},branchGroups={};
const normalizeGenerativeUiResources=()=>[],handleGardenSourceImportResult=()=>{};
const chatRowKey=(m,i)=>m.id||String(i);
const selection={id:'response-selection',mode:'inline',sourceMessageId:'source',start:0,end:8,quote:'Magnetic'};
window.requests=[];window.streams={};window.pageAnswers=[];window.creations=0;window.highlightStores=new Map();
window.fetch=async(url,init={})=>{
  if(url==='/api/extract-text') {
    if(window.holdImage)await new Promise(resolve=>window.releaseImage=resolve);
    if(window.failImage)return Response.json({error:'Image could not be read.'},{status:400});
    const file=init.body.get('file');
    const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);});
    return Response.json({type:'image',dataUrl});
  }
  const body=JSON.parse(init.body||'{}');window.requests.push({url,method:init.method,body});
  if(String(url).includes('/api/text-highlights')) {
    const current=window.highlightStores.get(body.key)||new Map((body.entries||[]).map(item=>[item.id,item]));
    for(const mutation of body.mutations||[])mutation.value===null?current.delete(mutation.id):current.set(mutation.id,mutation.value);
    window.highlightStores.set(body.key,current);
    return Response.json({entries:[...current.values()],acknowledged:(body.mutations||[]).map(m=>m.operationId)});
  }
  if(url.endsWith('/turns')) {
    if(init.method==='POST' && window.holdCheckpoint)await new Promise(resolve=>window.releaseCheckpoint=resolve);
    if(init.method==='POST' && window.failCheckpoint)return Response.json({error:'Chat storage is temporarily unavailable.'},{status:409});
    return Response.json({conversationId:'conv_1',userMessage:{id:'msg_user-'+body.clientMessageId},assistantMessage:{id:'msg_answer-'+body.clientMessageId}});
  }
  if(url==='/api/chat')return new Response(new ReadableStream({start(controller){window.streams[body.clientMessageId]=controller;}}));
  return Response.json({entries:body.entries||[],acknowledged:(body.mutations||[]).map(m=>m.operationId)});
};
window.emit=(id,text,done=false)=>{
  const stream=window.streams[id];stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'replace',text})+'\\n\\n'));
  if(done){stream.enqueue(new TextEncoder().encode('data: [DONE]\\n\\n'));stream.close();}
};
function App(){
  const initial=[{id:'source',role:'assistant',content:'Magnetic fields curve the path of a moving charge.'}];
  const [messages,setMessages]=useState(initial),[chatSessions,setChatSessions]=useState([{id:1,isOwn:true,messages:initial,updated_at:'2026-09-23'}]);
  const [activeChatId,setActiveChatId]=useState(1),[input,setInput]=useState(''),[chatAttachments,setChatAttachments]=useState([]);
  const [selectedTextContext,setSelectedTextContext]=useState(null),[isStreaming,setIsStreaming]=useState(false),[attachmentStatus,setAttachmentStatus]=useState('');
  const activeChat=chatSessions.find(s=>s.id===activeChatId),chatIsStreaming=isStreaming;
  const activeClusterSlug='quartz-fixture',model='test-model',reasoningEffort='high',viewingConversationId='conv_1';
  const activeMarkdown=null,activeMarkdownContext={cluster:activeClusterSlug,slug:'lesson',title:'Fields',content:'Page context about magnetic fields.'};
  const activeChatIdRef=useRef(activeChatId);activeChatIdRef.current=activeChatId;
  const clusterSlugRef=useRef(activeClusterSlug),inlineQuestionRunsRef=useRef(new Map()),turnSessionCreationRef=useRef(null);
  const messageMutationPendingRef=useRef(false),activeSteerContextRef=useRef(null),localTurnRef=useRef(false),composerRef=useRef(null),turnObserverRef=useRef(null);
  const selectionMessages=messages.map((m,i)=>({...m,id:gardenSelectionMessageId(m,i)}));
  const textSelection=useTextSelectionController({scope:'quartz:fixture:'+activeChatId,messages:selectionMessages,busy:chatIsStreaming,concurrentInline:true,composerRef,
    onBeginQuestion:()=>{},onAsk:${selectionAsk},onStop:id=>void stopInlineQuestion(id)});
  const onInlineAnswerUpdate=answer=>window.pageAnswers.push(answer),setPermissionRequest=()=>{};
  const agentActivity={start:()=>{window.mainController=new AbortController();return window.mainController.signal},bindSession:()=>{},handleEvent:()=>{},finish:()=>{}};
  const createChatSession=async()=>{
    window.creations++;if(window.holdCreation)await new Promise(resolve=>window.releaseCreation=resolve);
    const session={id:2,isOwn:true,messages:[],updated_at:'2026-09-23'};setChatSessions(current=>[...current,session]);setActiveChatId(2);activeChatIdRef.current=2;return session;
  };
  const persistChatSession=async(id,next,title)=>{updateSessionMessages(id,next,title);return true};
  ${[...handlers.values()].join('\n')}
  window.control={
    select:()=>textSelection.receiveSelection({...selection,anchor:{left:100,right:200,top:80,bottom:100,width:100,height:20}}),
    main:()=>sendMessage('Explain fields'),
    page:(id,question='Explain this excerpt')=>sendMessage(question,undefined,[],undefined,{requestId:id,highlightId:'mark-'+id,pageSlug:'lesson',mode:'inline',text:'magnetic field',prefix:'A ',suffix:' acts on charges.'}),
    response:()=>sendMessage('Explain the response',undefined,[],undefined,undefined,selection),
    open:(id=selection.id)=>textSelection.openAnnotation(id,{left:100,right:200,top:80,bottom:100,width:100,height:20}),
    stop:stopInlineQuestion,
    blank:()=>{setActiveChatId(null);setMessages(initial)},
    switchChat:()=>{setActiveChatId(3);setMessages([{id:'elsewhere',role:'assistant',content:'Another chat'}])},
    poll:saved=>{retireCompletedInlineQuestionViewers(inlineQuestionRunsRef.current,activeChatId,saved);setMessages(current=>reconcileInlineQuestionMessages(preserveInlineQuestionMessages(saved,current),saved))},
    get messages(){return messages},get sessions(){return chatSessions},get streaming(){return isStreaming},get error(){return attachmentStatus},
  };
  return <><main style={{margin:'50px 100px'}}><SelectableAssistantMarkdown sourceMessageId='source' content={initial[0].content}
    annotations={textSelection.annotations.get('source')||[]} onSelection={textSelection.receiveSelection} onOpenAnnotation={textSelection.openAnnotation}/></main>
    <textarea ref={composerRef} aria-label='Main draft' value={input} onChange={e=>setInput(e.target.value)}/>
    <button onClick={()=>void sendMessage()}>Send main</button><div>{isStreaming?'Main running':'Main idle'}</div>{textSelection.overlays}</>;
}createRoot(document.getElementById('root')).render(<App/>);
` } });

async function fixture(t) {
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('http://localhost:53148/**', route => route.fulfill({ contentType: 'text/html', body: '<style>.bb-inline-answer{position:fixed;overflow-y:auto;z-index:25}.bb-chat-selection-menu{position:fixed;z-index:50}</style><div id="root"></div>' }));
  await page.goto('http://localhost:53148/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.control);
  return page;
}

const requests = page => page.evaluate(() => window.requests.filter(r => r.url === '/api/chat').map(r => r.body));

async function pasteImage(page, editor) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
  await editor.focus();
  await page.keyboard.press('Control+V');
}

test('Ctrl+V attaches an image to Ask here, waits for upload, and keeps it on retry', { timeout: 30000 }, async t => {
  const page = await fixture(t);
  await page.getByRole('textbox', { name: 'Main draft' }).fill('Keep my main draft');
  await page.evaluate(() => window.control.select());
  await page.getByRole('button', { name: 'Ask here', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Answer about highlighted text' });
  const editor = dialog.getByRole('textbox', { name: 'Edit question about highlighted text' });
  await editor.fill('Explain this screenshot');
  await page.evaluate(() => { window.holdImage = true; });
  await pasteImage(page, editor);
  await page.waitForFunction(() => window.releaseImage);
  assert.equal(await dialog.getByRole('button', { name: 'Ask', exact: true }).isDisabled(), true);
  await editor.press('Enter');
  assert.equal((await requests(page)).length, 0);
  await page.evaluate(() => { window.holdImage = false; window.releaseImage(); });
  await dialog.getByRole('img', { name: /^Attached image:/ }).waitFor();
  await editor.press('Enter');
  await page.waitForFunction(() => Object.keys(window.streams).length === 1);
  const sent = (await requests(page))[0];
  assert.equal(sent.messages[0].content, 'Explain this screenshot');
  assert.equal(sent.attachments.length, 1);
  assert.equal(sent.attachments[0].type, 'image');
  assert.match(sent.attachments[0].dataUrl, /^data:image\/png;base64,/);
  assert.equal(sent.textSelection.quote, 'Magnetic');
  const saved = await page.evaluate(() => window.control.messages.find(m => m.role === 'user' && m.textSelection));
  assert.equal(saved.attachments[0].dataUrl, sent.attachments[0].dataUrl);
  assert.equal(await page.getByRole('textbox', { name: 'Main draft' }).inputValue(), 'Keep my main draft');
  await page.evaluate(id => window.emit(id, 'Image explained.', true), sent.clientMessageId);
  await dialog.getByText('Image explained.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.evaluate(id => window.control.open(id), sent.textSelection.id);
  await dialog.getByRole('img', { name: /^Attached image:/ }).waitFor();
  await dialog.getByRole('button', { name: 'Ask this question again', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.streams).length === 2);
  const retry = (await requests(page))[1];
  assert.equal(retry.attachments[0].dataUrl, sent.attachments[0].dataUrl);
  await page.evaluate(id => window.emit(id, 'Retry finished.', true), retry.clientMessageId);
  await dialog.getByText('Retry finished.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Edit this question', exact: true }).click();
  await dialog.getByRole('button', { name: /^Remove / }).click();
  await dialog.getByRole('button', { name: 'Ask again', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.streams).length === 3);
  assert.equal((await requests(page))[2].attachments.length, 0, 'changing only the attachments still submits the edit');
});

test('Ask here supports image-only questions and ignores image reads completed after Cancel', { timeout: 30000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.control.select());
  await page.getByRole('button', { name: 'Ask here', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Answer about highlighted text' });
  const editor = dialog.getByRole('textbox', { name: 'Edit question about highlighted text' });
  await pasteImage(page, editor);
  await dialog.getByRole('img', { name: /^Attached image:/ }).waitFor();
  await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.streams).length === 1);
  const sent = (await requests(page))[0];
  assert.match(sent.messages[0].content, /^Attached:/);
  assert.equal(sent.attachments.length, 1);
  await page.evaluate(id => window.emit(id, 'Image-only answer.', true), sent.clientMessageId);
  await dialog.getByText('Image-only answer.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Edit this question', exact: true }).click();
  await page.evaluate(() => { window.holdImage = true; });
  await pasteImage(page, editor);
  await page.waitForFunction(() => window.releaseImage);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit this question', exact: true }).click();
  await page.evaluate(() => { window.holdImage = false; window.releaseImage(); });
  // Await extraction's response processing before checking the cancelled edit.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  assert.equal(await dialog.getByRole('img', { name: /^Attached image:/ }).count(), 1);
  await page.evaluate(() => { window.failImage = true; });
  await pasteImage(page, editor);
  await dialog.getByRole('status').getByText(/Image could not be read/).waitFor();
  assert.equal(await dialog.getByRole('img', { name: /^Attached image:/ }).count(), 1);
});

test('a failed question save remains visible at its highlight and can be retried', { timeout: 30000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.holdCheckpoint = true; window.failCheckpoint = true; void window.control.response(); });
  await page.waitForFunction(() => window.releaseCheckpoint);
  await page.evaluate(() => window.control.open());
  const dialog = page.getByRole('dialog', { name: 'Answer about highlighted text' });
  await dialog.getByRole('button', { name: 'Stop this answer', exact: true }).waitFor();
  await page.evaluate(() => { window.holdCheckpoint = false; window.releaseCheckpoint(); });
  await dialog.getByText('Chat storage is temporarily unavailable.', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('No question has been sent for this highlight.', { exact: true }).count(), 0);
  assert.equal((await requests(page)).length, 0, 'a failed save must not dispatch the model');
  assert.ok(await page.evaluate(() => window.control.messages.some(m => m.role === 'user' && m.content === 'Explain the response')));
  await page.evaluate(() => { window.failCheckpoint = false; });
  await dialog.getByRole('button', { name: 'Ask this question again', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.streams).length === 1);
  const retry = (await requests(page))[0];
  assert.equal(retry.textSelection.id, 'response-selection');
  await page.evaluate(id => window.emit(id, 'Recovered answer.', true), retry.clientMessageId);
  await dialog.getByText('Recovered answer.', { exact: true }).waitFor();
});

test('Quartz runs page and response questions alongside the main chat, with independent Stop/retry and retained answers', { timeout: 60000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { void window.control.main(); });
  await page.waitForFunction(() => Object.keys(window.streams).length === 1);
  await page.getByRole('textbox', { name: 'Main draft' }).fill('Keep this draft');
  await page.evaluate(() => { void window.control.page('page-one'); void window.control.page('page-two'); void window.control.response(); });
  await page.waitForFunction(() => Object.keys(window.streams).length === 4);
  const sent = await requests(page);
  const main = sent.find(r => !r.textSelection);
  const first = sent.find(r => r.textSelection?.id === 'page-one');
  const second = sent.find(r => r.textSelection?.id === 'page-two');
  const response = sent.find(r => r.textSelection?.id === 'response-selection');
  assert.ok(sent.every(r => r.chatSessionId === 1));
  assert.equal(first.selectedTextContext.pageSlug, 'lesson');
  assert.equal(first.selectedTextContext.sourceMessageId, undefined, 'page excerpts keep page semantics');
  assert.equal(first.activeMarkdown.title, 'Fields');
  assert.equal(first.model, 'test-model');
  assert.equal(first.reasoningEffort, 'high');
  assert.equal(response.selectedTextContext.sourceResponse, 'Magnetic fields curve the path of a moving charge.');
  await page.getByRole('textbox', { name: 'Main draft' }).inputValue().then(value => assert.equal(value, 'Keep this draft'));
  await page.evaluate(({ main, first, second }) => {
    window.emit(main, 'Main keeps streaming'); window.emit(first, 'First page partial'); window.emit(second, 'Second page complete', true);
  }, { main: main.clientMessageId, first: first.clientMessageId, second: second.clientMessageId });
  await page.waitForFunction(() => window.pageAnswers.some(a => a.requestId === 'page-two' && a.state === 'complete'));
  await page.evaluate(() => window.control.open());
  const dialog = page.getByRole('dialog', { name: 'Answer about highlighted text' });
  await dialog.getByRole('button', { name: 'Stop this answer', exact: true }).click();
  await page.waitForFunction(() => window.requests.some(r => r.method === 'DELETE'));
  assert.equal(await page.evaluate(() => window.requests.find(r => r.method === 'DELETE').body.clientMessageId), response.clientMessageId);
  assert.equal(await page.evaluate(() => window.mainController.signal.aborted), false);
  await dialog.getByRole('button', { name: 'Ask this question again', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.streams).length === 5);
  const retry = (await requests(page)).at(-1);
  assert.equal(retry.textSelection.id, 'response-selection');
  await page.evaluate(({ main, first, retry }) => {
    window.emit(retry, 'Retried response answer', true); window.emit(main, 'Main completed', true); window.emit(first, 'First page completed last', true);
  }, { main: main.clientMessageId, first: first.clientMessageId, retry: retry.clientMessageId });
  await page.waitForFunction(() => !window.control.streaming && window.control.messages.some(m => m.content === 'First page completed last' && !m.pending));
  const restored = await page.evaluate(() => window.control.sessions[0].messages);
  for (const content of ['Main completed', 'First page completed last', 'Second page complete', 'Retried response answer']) {
    assert.ok(restored.some(m => m.content === content), content);
  }
  assert.equal(restored.find(m => m.content === 'First page completed last').inlineSelection.highlightId, 'mark-page-one');
  // A history refresh older than the completed turns cannot erase them.
  await page.evaluate(() => window.control.poll([{ id: 'source', role: 'assistant', content: 'Magnetic fields curve the path of a moving charge.' }]));
  assert.ok(await page.evaluate(() => window.control.messages.some(m => m.content === 'Retried response answer')));
});

test('simultaneous first questions share a chat and Stop during checkpoint cancels only that question', { timeout: 60000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.control.blank(); window.holdCreation = true; });
  await page.evaluate(() => { void window.control.page('first'); void window.control.page('second'); });
  await page.waitForFunction(() => window.creations === 1);
  await page.evaluate(() => { window.releaseCreation(); });
  await page.waitForFunction(() => Object.keys(window.streams).length === 2);
  assert.equal(await page.evaluate(() => window.creations), 1);
  assert.ok((await requests(page)).every(r => r.chatSessionId === 2));
  await page.evaluate(() => { window.holdCheckpoint = true; void window.control.page('stopped'); });
  await page.waitForFunction(() => window.releaseCheckpoint);
  await page.evaluate(() => { void window.control.stop('stopped'); window.releaseCheckpoint(); });
  await page.waitForFunction(() => window.pageAnswers.some(a => a.requestId === 'stopped' && a.state === 'error'));
  assert.equal((await requests(page)).length, 2, 'stopped pre-dispatch question never starts a model');
  const sent = await requests(page);
  await page.evaluate(() => window.control.switchChat());
  await page.evaluate(ids => { for (const id of ids) window.emit(id, 'Background answer', true); }, sent.map(r => r.clientMessageId));
  await page.waitForFunction(() => window.control.sessions.find(s => s.id === 2).messages.filter(m => m.content === 'Background answer').length === 2);
  assert.deepEqual(await page.evaluate(() => window.control.messages.map(m => m.content)), ['Another chat']);
});

test('a saved inline failure releases the stale viewer so Ask here can retry while the main answer runs', { timeout: 20000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { void window.control.main(); void window.control.response(); });
  await page.waitForFunction(() => Object.keys(window.streams).length === 2);
  const request = (await requests(page)).find(r => r.textSelection?.id === 'response-selection');
  await page.evaluate(id => {
    const saved = window.control.messages.map(message => message.clientMessageId === id && message.role === 'assistant'
      ? { ...message, content: 'The server stopped this answer.', pending: false, failed: true, responseCompletedAt: new Date().toISOString() }
      : message);
    window.control.poll(saved);
    window.control.open();
  }, request.clientMessageId);
  const dialog = page.getByRole('dialog', { name: 'Answer about highlighted text' });
  await dialog.getByText('The server stopped this answer.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Ask this question again', exact: true }).click();
  await page.waitForFunction(() => Object.keys(window.streams).length === 3);
  const retry = (await requests(page)).at(-1);
  assert.notEqual(retry.clientMessageId, request.clientMessageId);
  assert.equal(retry.textSelection.id, 'response-selection');
  assert.equal(await page.evaluate(() => window.mainController.signal.aborted), false);
  assert.equal(await page.evaluate(() => window.requests.some(r => r.method === 'DELETE')), false, 'retiring a completed viewer must not send Stop');
  await page.evaluate(id => window.emit(id, 'Retry finished.', true), retry.clientMessageId);
  await dialog.getByText('Retry finished.', { exact: true }).waitFor();
});
