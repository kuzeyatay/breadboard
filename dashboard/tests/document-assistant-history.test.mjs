import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, {after, beforeEach} from 'node:test';
import ts from 'typescript';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import { listUnreadChatMessages, markUnreadChatMessagesSeen, chatNotificationMessageId } from '../src/lib/chat-notifications/store.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-document-history-'));
process.env.BREADBOARD_DATA_DIR = root;
const {default: db} = await import('../src/lib/db.ts');
const store = await import('../src/lib/conversations/store.ts');
const runtime = await import('../src/lib/hermes/runtime-store.ts');
const runs = await import('../src/lib/hermes/run-store.ts');
const history = await import('../src/lib/document-assistant-history.ts');
const presentation = await import('../src/lib/hermes/session-presentation.ts');
const core = await import('../src/lib/hermes/route-core.ts');
const artifacts = await import('../src/lib/hermes/artifact-store.ts');
after(() => { db.close(); fs.rmSync(root, {recursive: true, force: true}); });
beforeEach(() => {
  db.exec('DELETE FROM hermes_artifacts; DELETE FROM hermes_runs; DELETE FROM hermes_runtime_sessions; DELETE FROM conversations; DELETE FROM users;');
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x'), (2, 'bob', 'bob@example.test', 'x')").run();
});

function fixture(kind, temporary = false) {
  const source = store.createConversation({userId: 1, title: 'Source artifact chat', temporary});
  const session = runtime.createRuntimeSession({conversationId: source.id, surface: 'dashboard_terminal', userId: 1, chatSessionId: null, agentName: 'main', clusterId: null, gardenId: null, pageSlug: null, workspaceKey: 'test', activeDirectory: root, filesystemMode: 'restricted'});
  const run = runs.beginRuntimeRun({runtimeSessionId: session.id, instruction: 'Fixture artifact', dispatch: {}});
  const artifactId = `artifact-${source.id}`;
  db.prepare(`INSERT INTO hermes_artifacts (id,user_id,runtime_session_id,hermes_session_id,conversation_id,originating_run_id,source_surface,kind,renderer_id,title,filename,mime_type,status,created_at,updated_at)
    VALUES (?,1,?,'fixture',?,?,'dashboard_terminal',?,?, 'Document', ?,?,'ready',datetime('now'),datetime('now'))`)
    .run(artifactId, session.id, source.id, run.id, kind === 'word' ? 'document' : 'markdown', kind === 'word' ? 'document-file' : 'markdown', kind === 'word' ? 'file.docx' : 'file.md', kind === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/markdown');
  const sync = entries => history.syncDocumentAssistantHistory({userId: 1, artifactId, kind, entries});
  return {source, artifactId, sync};
}
const transcript = [
  {id:'q1', role:'user', text:'Explain the document'},
  {id:'a1', role:'assistant', text:'The document describes resonance.', activities:['Read document']},
];

for (const kind of ['word', 'markdown']) test(`${kind} imports into a distinct named Terminal conversation exactly once`, () => {
  const {source,sync} = fixture(kind);
  assert.equal(sync([]).conversationId, null);
  const result = sync(transcript);
  const chat = store.getConversationForUser(result.conversationId, 1);
  assert.notEqual(chat.id, source.id);
  const detail = presentation.presentHermesSessionDetail(chat);
  assert.equal(detail.originLabel, kind === 'word' ? 'Word Assistant' : 'Markdown Assistant');
  assert.equal(detail.title, transcript[0].text);
  assert.deepEqual(detail.messages.map(m => m.content), transcript.map(m => m.text));
  assert.equal(store.listConversationMessages(source.id).length, 0);
  const messages = store.listConversationMessages(chat.id);
  assert.equal(messages[0].client_message_id, messages[1].client_message_id);
  assert.equal(sync(transcript).changed, false);
  assert.equal(sync(result.entries).changed, false);
  assert.equal(store.listConversationMessages(chat.id).length, 2);
  store.renameConversation(chat, 'My saved chat');
  assert.equal(sync(transcript).title, 'My saved chat');
  assert.deepEqual(result.entries[1].activities, ['Read document']);
});

test('Terminal edits win over stale caches and new Terminal replies return to the editor', () => {
  const {sync} = fixture('markdown');
  const initial = sync(transcript);
  const chat = store.getConversationForUser(initial.conversationId, 1);
  db.prepare("UPDATE conversation_messages SET content = 'Edited in Terminal' WHERE conversation_id = ? AND role = 'assistant'").run(chat.id);
  assert.equal(sync(initial.entries).entries[1].text, 'Edited in Terminal');
  store.reserveConversationTurn({conversation: chat, clientMessageId: 'terminal-turn', surface: 'dashboard_terminal', content: 'Follow up in Terminal'});
  store.completeAssistantMessage({conversationId: chat.id, clientMessageId: 'terminal-turn', content: 'A Terminal reply'});
  const current = sync(initial.entries);
  assert.equal(current.entries.at(-1).text, 'A Terminal reply');
  assert.match(current.entries.at(-1).id, /^server:/);
  assert.equal(sync(current.entries).changed, false);
  assert.equal(store.listConversationMessages(chat.id).length, 4);
});

test('Word save recovery updates its reply using the saved revision', () => {
  const {sync} = fixture('word');
  const initial = sync([transcript[0], {...transcript[1], error:'Save failed'}]);
  const recovered = {...initial.entries[1], text:'Changes saved.', error:undefined, activities:['Saved as a new artifact version']};
  const current = sync([initial.entries[0], recovered]);
  assert.equal(current.changed, true);
  assert.equal(current.entries[1].text, 'Changes saved.');
  assert.equal(current.entries[1].error, undefined);
  assert.equal(sync(initial.entries).entries[1].text, 'Changes saved.');
});

test('deleting messages and chats leaves tombstones against old browser caches', () => {
  const {sync} = fixture('word');
  const first = sync(transcript);
  const chat = store.getConversationForUser(first.conversationId, 1);
  db.prepare("DELETE FROM conversation_messages WHERE conversation_id = ? AND role = 'assistant'").run(chat.id);
  assert.equal(sync(transcript).entries.length, 1);
  store.deleteConversation(chat);
  assert.equal(sync(transcript).conversationId, null);
  const next = sync([...transcript, {id:'q2', role:'user', text:'A new discussion'}]);
  assert.notEqual(next.conversationId, first.conversationId);
  assert.deepEqual(next.entries.map(m => m.text), ['A new discussion']);
});

test('ownership, document kind and temporary history are preserved', () => {
  const {artifactId, sync} = fixture('word', true);
  assert.throws(() => history.syncDocumentAssistantHistory({userId:2, artifactId, kind:'word', entries:transcript}), error => error.status === 404);
  assert.throws(() => history.syncDocumentAssistantHistory({userId:1, artifactId, kind:'markdown', entries:transcript}), error => error.status === 422);
  assert.equal(store.getConversationForUser(sync(transcript).conversationId, 1).temporary, 1);
});

test('the authenticated history route imports transcripts and rejects invalid input', async () => {
  const {artifactId} = fixture('markdown');
  const modules = {
    'next/server': {NextResponse:{json:Response.json}},
    '@/lib/server-auth': {requireUserId:async () => 1},
    '@/lib/hermes/artifact-store.ts': artifacts,
    '@/lib/hermes/session-service.ts': {authorizeGardenAccess:() => {throw Error('Unexpected garden');}},
    '@/lib/hermes/route-helpers.ts': {...core, apiErrorResponse:error => Response.json({error:error.message}, {status:error.status ?? 500})},
    '@/lib/document-assistant-history.ts': history,
  };
  const code = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/document-assistant/history/route.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const api = {};
  new Function('require','exports',code)(id => modules[id] ?? {}, api);
  const post = body => api.POST(new Request('http://localhost/api/document-assistant/history', {method:'POST',body:JSON.stringify(body)}));
  const valid = await post({artifactId,kind:'markdown',entries:transcript});
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).entries.length, 2);
  assert.equal((await post({artifactId,kind:'pdf',entries:[]})).status, 400);
  assert.equal((await post({artifactId,kind:'markdown',entries:{}})).status, 400);
  assert.equal((await post({artifactId:'unknown',kind:'markdown',entries:transcript})).status, 404);
});

test('browser imports both caches without opening editors, then safely syncs a turn in progress', {timeout:30_000}, async () => {
  const word = fixture('word');
  const markdown = fixture('markdown');
  const bundle = await build({
    stdin:{resolveDir:fileURLToPath(new URL('../', import.meta.url)),loader:'tsx',contents:`
      import React, {useEffect,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {watchLegacyDocumentAssistantHistory} from './src/lib/document-assistant-history-client';
      import {useDocumentAssistantHistory} from './src/app/components/use-document-assistant-history';
      import {UnreadChatDot} from './src/app/components/hermes/history-client';
      function Editor() {
        const [chat,setChat] = useState([]);
        const [busy,setBusy] = useState(false);
        const [viewing,setViewing] = useState(true);
        const {error,unread} = useDocumentAssistantHistory({artifactId:${JSON.stringify(word.artifactId)},kind:'word',chat,setChat,busy,viewing});
        return <><output data-unread={unread}>{chat.map(e => e.text).join('|')}</output><div role="status">{error}</div>
          {unread&&<UnreadChatDot className="ai-unread-chat-dot" label="Unread document response"/>}
          <button onClick={()=>setViewing(value=>!value)}>{viewing?'Collapse':'Expand'}</button>
          <button onClick={() => {setBusy(true);setChat(c => [...c,{id:'q2',role:'user',text:'Second question'}]);}}>Begin</button>
          <button onClick={() => {setChat(c => [...c,{id:'a2',role:'assistant',text:'Second answer'}]);setBusy(false);}}>Finish</button></>;
      }
      function App() {
        const [open,setOpen] = useState(false);
        useEffect(watchLegacyDocumentAssistantHistory,[]);
        return <><button onClick={() => setOpen(true)}>Open Word</button>{open && <Editor/>}</>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  });
  let heldResponse;
  let hold = false;
  let failNext = false;
  const requests = [];
  const server = createServer(async (request,response) => {
    if(request.url === '/bundle.js') {response.setHeader('content-type','text/javascript');response.end(bundle.outputFiles[0].text);return;}
    if(request.url === '/style.css') {response.setHeader('content-type','text/css');response.end(fs.readFileSync(new URL('../src/app/genoffice-docs/genoffice-host.css',import.meta.url)));return;}
    if(request.url.startsWith('/api/chat-notifications')) {
      response.setHeader('content-type','application/json');
      if(request.method === 'POST') {
        const chunks=[]; for await(const chunk of request) chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks).toString());
        markUnreadChatMessagesSeen(db,1,(body.read??[]).map(chatNotificationMessageId).filter(id=>id!==null),body.seen);
        response.end('{"ok":true}');
      } else response.end(JSON.stringify({unread:listUnreadChatMessages(db,1)}));
      return;
    }
    if(request.url === '/api/document-assistant/history') {
      const chunks = [];
      for await(const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(input);
      response.setHeader('content-type','application/json');
      if(failNext) {failNext=false;response.statusCode=503;response.end(JSON.stringify({error:'History temporarily unavailable'}));return;}
      try {
        const result = history.syncDocumentAssistantHistory({...input,userId:1});
        const finish = () => { if (!response.writableEnded) response.end(JSON.stringify(result)); };
        if(hold && input.entries.some(e => e.id === 'q2')) {hold=false;heldResponse=finish;} else finish();
      } catch(error) {response.statusCode=error.status ?? 500;response.end(JSON.stringify({error:error.message}));}
      return;
    }
    response.setHeader('content-type','text/html');response.end('<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
    browser = await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.addInitScript(({wordId,markdownId,entries}) => {
      localStorage.setItem('breadboard.genoffice.ai.chat.missing-artifact',JSON.stringify(entries));
      localStorage.setItem('breadboard.genoffice.ai.chat.'+wordId,JSON.stringify(entries));
      localStorage.setItem('breadboard.markdown.ai.chat.'+markdownId,JSON.stringify(entries));
      const interval = window.setInterval.bind(window);
      window.setInterval = (callback,delay,...args) => interval(callback,delay === 10_000 ? 200 : delay,...args);
    },{wordId:word.artifactId,markdownId:markdown.artifactId,entries:transcript});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelector('button'));
    for(let attempt=0;attempt<50 && !markdown.sync([]).conversationId;attempt++) await new Promise(resolve => setTimeout(resolve,20));
    assert.ok(word.sync([]).conversationId);
    assert.ok(markdown.sync([]).conversationId);
    assert.equal(await page.locator('output').count(),0,'migration happens from Terminal, before an editor opens');
    failNext = true;
    await page.getByRole('button',{name:'Open Word'}).click();
    await page.waitForFunction(() => document.querySelector('output')?.textContent.includes('resonance'));
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent === '');
    hold = true;
    await page.getByRole('button',{name:'Begin',exact:true}).click();
    for(let attempt=0;attempt<50 && !heldResponse;attempt++) await new Promise(resolve => setTimeout(resolve,20));
    assert.ok(heldResponse,'the first turn snapshot is still in flight');
    await page.getByRole('button',{name:'Finish',exact:true}).click();
    heldResponse();
    await page.waitForFunction(() => document.querySelector('output')?.textContent.endsWith('Second question|Second answer'));
    for(let attempt=0;attempt<50 && word.sync([]).entries.length<4;attempt++) await new Promise(resolve => setTimeout(resolve,20));
    assert.equal(word.sync([]).entries.length,4);
    assert.equal(word.sync([]).entries.at(-1).text,'Second answer');
    assert.deepEqual(errors,[]);
    assert.ok(requests.length<30,'history synchronization settles instead of looping');
    await page.getByRole('button',{name:'Collapse',exact:true}).click();
    const background = word.sync([
      ...word.sync([]).entries,
      {id:'q3',role:'user',text:'Background follow-up'},
      {id:'a3',role:'assistant',text:'Background answer'},
    ]);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>document.querySelector('output')?.dataset.unread==='true');
    assert.deepEqual(await page.getByRole('status',{name:'Unread document response'}).evaluate(node=>{
      const style=getComputedStyle(node);return {width:style.width,height:style.height,color:style.backgroundColor};
    }),{width:'8px',height:'8px',color:'rgb(47, 158, 90)'});
    assert.ok(listUnreadChatMessages(db,1).some(record=>record.target.chatId===background.conversationId));
    await page.getByRole('button',{name:'Expand',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('output')?.dataset.unread==='false');
    for(let attempt=0;attempt<50 && listUnreadChatMessages(db,1).some(record=>record.target.chatId===background.conversationId);attempt++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(listUnreadChatMessages(db,1).some(record=>record.target.chatId===background.conversationId),false);
  } finally {
    heldResponse?.();
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
