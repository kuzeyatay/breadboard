import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import ts from 'typescript';

function gardenSteerHandler() {
  const path = '../src/app/gardens/[clusterSlug]/workspace-client.tsx';
  const source = readFileSync(new URL(path, import.meta.url),'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'steerActiveResponse') handler = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler);
  return handler;
}

test('a reopened Garden chat shows its question, answers once, and steers without the original stream', { timeout: 45_000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../',import.meta.url)), loader:'tsx', contents:`
      import React, {useRef,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useLegacyAgentActivity} from './src/app/components/hermes/use-legacy-agent-activity';
      import ActivityPanel from './src/app/components/hermes/activity-panel';
      import {useQueuedFollowUps} from './src/app/components/hermes/queued-follow-ups';
      import {attachmentOnlyMessageText,chatMessageAttachments} from './src/lib/chat-attachments';
      window.results=[]; window.refreshed=[];
      function App() {
        const [activeChatId, setChat] = useState(42);
        const [controls, setControls] = useState({42:{sessionId:3,runId:'run3',pendingClarification:{requestId:'q1',question:'Which lesson should I use?',choices:['Lesson one','Lesson two']}},43:{sessionId:4,runId:'run4',pendingClarification:null}});
        const agentActivity = useLegacyAgentActivity({sessionReference:'conv_'+activeChatId,runtimeControl:controls[activeChatId]});
        const activeSteerContextRef = useRef(null);
        const addToast = message => {throw new Error(message)};
        const refreshChatSession = async id => {window.refreshed.push(id)};
        const updateChatMessages = () => {throw new Error('No local stream owns this restored turn')};
        ${gardenSteerHandler()}
        const queue = useQueuedFollowUps({conversationKey:String(activeChatId),runInFlight:Boolean(agentActivity.activeRunId),steerableRunActive:Boolean(agentActivity.activeRunId),onSteer:steerActiveResponse,onSendQueued:async()=>{throw new Error('Unexpected new turn')},onRestoreDraft:()=>{}});
        window.chat=setChat; window.control=(id,value)=>setControls(current=>({...current,[id]:value}));
        window.poll=()=>setControls(current=>structuredClone(current)); window.queue=queue.queueFollowUp;
        window.answer=text=>agentActivity.respondToClarification(text).then(value=>window.results.push(value));
        window.start=()=>{window.owner=agentActivity.start('conv_'+activeChatId);agentActivity.handleEvent({type:'runtime',sessionId:3,runId:'local'},window.owner)};
        window.event=event=>agentActivity.handleEvent(event,window.owner);
        return <><output>{activeChatId}:{agentActivity.activeRunId}:{agentActivity.connection}</output>
          <ActivityPanel activities={agentActivity.activities} connection={agentActivity.connection} pendingPermission={null} pendingClarification={agentActivity.pendingClarification} onClarificationAnswer={answer=>void agentActivity.respondToClarification(answer)}/>
          {queue.headerContent}</>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"'},
  });
  let failAnswer = false;
  let holdAnswer;
  const answers=[]; const steers=[];
  const server=createServer(async(req,res)=>{
    if(req.url==='/bundle.js') {res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(req.method==='POST') {
      let body=''; for await(const chunk of req) body+=chunk;
      const value=JSON.parse(body);
      if(req.url.includes('/clarifications/')) {
        answers.push(value);
        if(holdAnswer) await new Promise(resolve=>{holdAnswer.resolve=resolve});
        res.statusCode=failAnswer?503:200; res.end(JSON.stringify(failAnswer?{error:'Offline'}:{ok:true}));
      } else {steers.push({url:req.url,...value});res.end(JSON.stringify({accepted:true}));}
      return;
    }
    res.setHeader('content-type','text/html');res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(existsSync);
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    const page=await browser.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'Lesson one',exact:true}).waitFor();
    await page.reload(); // question was raised while this view was absent
    await page.getByRole('button',{name:'Lesson two',exact:true}).waitFor();
    await page.evaluate(()=>window.chat(43));
    await page.getByRole('button',{name:'Lesson one',exact:true}).waitFor({state:'detached'});
    await page.evaluate(()=>window.chat(42));
    await page.getByRole('button',{name:'Lesson one',exact:true}).waitFor();
    failAnswer=true;
    const failedAnswer = page.waitForResponse(response=>response.url().includes('/clarifications/') && response.status()===503);
    await page.getByRole('button',{name:'Lesson one',exact:true}).click();
    await failedAnswer;
    await page.getByRole('button',{name:'Lesson one',exact:true}).waitFor();
    failAnswer=false;
    holdAnswer={};
    await page.evaluate(()=>{window.answer('Use the chat above');window.answer('Use the chat above')});
    await page.waitForFunction(()=>window.results.includes(false));
    while(!holdAnswer.resolve) await new Promise(resolve=>setTimeout(resolve,10));
    holdAnswer.resolve(); holdAnswer=null;
    await page.waitForFunction(()=>window.results.includes(true));
    assert.equal(answers.length,2,'failed delivery plus exactly one accepted retry');
    assert.deepEqual(answers[1],{sessionId:3,answer:'Use the chat above'});
    await page.evaluate(()=>window.poll());
    assert.equal(await page.getByRole('button',{name:'Lesson one',exact:true}).count(),0,'stale polls cannot revive an answered question');
    await page.evaluate(()=>window.control(42,{sessionId:3,runId:'run3',pendingClarification:{requestId:'q2',question:'Any extra context?',choices:[]}}));
    await page.getByRole('textbox',{name:"Answer the agent's question"}).fill('The Laplace notes');
    const typedAnswer=page.waitForResponse(response=>response.url().includes('/clarifications/q2'));
    await page.getByRole('button',{name:'Answer',exact:true}).click();await typedAnswer;
    await page.getByRole('textbox',{name:"Answer the agent's question"}).waitFor({state:'detached'});
    assert.deepEqual(answers[2],{sessionId:3,answer:'The Laplace notes'});
    await page.evaluate(()=>window.queue('Focus on the second lesson'));
    await page.getByRole('button',{name:'Steer the active response with: Focus on the second lesson',exact:true}).click();
    await page.waitForFunction(()=>window.refreshed.length===1);
    assert.equal(steers.length,1);assert.equal(steers[0].runId,'run3');assert.equal(steers[0].url,'/api/hermes/sessions/3/steer');
    await page.evaluate(()=>{window.start();window.event({type:'clarify',requestId:'live',question:'New live question?',choices:[]})});
    await page.getByText('New live question?',{exact:true}).waitFor();
    await page.evaluate(()=>window.poll());
    assert.equal(await page.getByText('New live question?',{exact:true}).count(),1,'old poll cannot erase a live question');
    await page.evaluate(()=>window.chat(43));
    await page.waitForFunction(()=>document.querySelector('output').textContent.startsWith('43:run4'));
    await page.evaluate(()=>window.event({type:'clarify',requestId:'late',question:'Wrong chat',choices:[]}));
    assert.equal(await page.getByText('Wrong chat',{exact:true}).count(),0);
    await page.evaluate(()=>window.control(43,null));
    await page.waitForFunction(()=>document.querySelector('output').textContent==='43::idle');
    assert.deepEqual(errors,[]);
  } finally {
    holdAnswer?.resolve?.();
    await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
