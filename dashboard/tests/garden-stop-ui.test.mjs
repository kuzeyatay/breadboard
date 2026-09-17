import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { chromium } from "playwright";

test("Garden Stop works after restore, across chats, and through late worker registration", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = fs.readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("garden.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map(), functions = new Map(), props = new Map();
  function visit(node) {
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) declarations.set(d.name.getText(tree), node.getText(tree));
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree));
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === "AssistantComposer") {
      for (const p of node.attributes.properties) if (ts.isJsxAttribute(p)) props.set(p.name.getText(tree), p.getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const name of ['isSending', 'externalRunActive', 'runState', 'onStop']) assert.ok(props.has(name), name);
  const declaration = name => { assert.ok(declarations.has(name), name); return declarations.get(name); };
  const script = `
    import React,{useState,useRef,useCallback} from 'react';
    import {createRoot} from 'react-dom/client';
    import AssistantComposer from './src/app/components/assistant-composer';
    import {useLegacyAgentActivity} from './src/app/components/hermes/use-legacy-agent-activity';
    import {abortGardenTurnCheckpoint} from './src/lib/conversations/garden-turn-client';
    const hasRunningExternalAgent=m=>m.externalAgentOutcome==='running';
    window.requests=[];window.pending=[];window.resets=[];window.errors=[];
    window.fetch=async(url,init={})=>{
      if(init.method==='POST'&&String(url).endsWith('/abort')){
        window.requests.push(String(url));return new Promise(resolve=>window.pending.push(resolve));
      }
      if(init.method==='DELETE')window.requests.push(String(url));
      return Response.json({settings:{},models:[],success:true});
    };
    window.release=(status=200)=>window.pending.splice(0).forEach(resolve=>resolve(Response.json({aborted:true},{status})));
    function App(){
      const [config,setConfig]=useState({id:1,active:true,external:false,launching:false,inline:false,draft:false});
      const [chatSessions,setChatSessions]=useState([1,2].map(id=>({id,conversationId:'conv_'+id,active:true,messages:[]})));
      const activeChatId=config.draft?null:config.id;
      const activeChat=chatSessions.find(c=>c.id===activeChatId);
      const showingDraft=config.draft;
      const messages=[{role:'assistant',clientMessageId:'worker',delegatedAgentRun:config.external,
        externalAgentOutcome:config.external?'running':undefined,
        textSelection:config.inline?{mode:'inline'}:undefined}];
      const launchingExternalAgent=config.launching?'codex':null,delegatedAgentLaunching=false;
      const hasRunningExternalAgentInActiveChat=config.external;
      const externalRunHoldsQueue=config.external||config.launching;
      const [streamingChatIds,setStreamingChatIds]=useState(new Set());
      const streamingChatIdsRef=useRef(new Set()),inFlightChatMessagesRef=useRef(new Map());
      const activeGardenTurnRef=useRef(null),gardenTurnObserversRef=useRef(new Map());
      const awaitedLaunchesRef=useRef(new Map()),continuedDelegatedRunsRef=useRef(new Set());
      const [,setPendingLaunchContinuations]=useState([]),[,setDraftMessages]=useState(null);
      const [status,setExternalAgentStatus]=useState('');
      const agentActivity=useLegacyAgentActivity();
      const agentLaunchQueue={reset:scope=>window.resets.push(scope)};
      ${declaration('stoppingGardenChatsRef')}
      ${declaration('[stoppingGardenChats, setStoppingGardenChats]')}
      ${declaration('stoppedExternalLaunchesRef')}
      ${declaration('setChatStreaming')}
      ${declaration('chatTurnStreaming')}
      ${declaration('isStreaming')}
      const respondingToInlineSelection=config.inline;
      ${declaration('visibleAgentConnection')}
      ${declaration('stoppingGardenChat')}
      ${declaration('canStopGardenChat')}
      async function refreshChatSession(id){
        setChatSessions(current=>current.map(c=>c.id===id?{...c,active:false}:c));
        return chatSessions.find(c=>c.id===id);
      }
      async function persistExternalAgentTurn(){window.persisted=true;}
      ${functions.get('stopActiveGardenTurn')}
      ${functions.get('commitExternalAgentTurn')}
      window.control={configure:patch=>{
        setConfig(c=>({...c,...patch}));setChatSessions(current=>current.map(c=>({...c,active:patch.active??true})));
      },startLocal:(id=1)=>{
        window.oldSignal=agentActivity.start('conv_'+id);
        activeGardenTurnRef.current={sessionId:id,clientMessageId:'local-'+id,conversationId:'conv_'+id};
        agentActivity.handleEvent({type:'runtime',sessionId:100+id,runId:'runtime-'+id},window.oldSignal);
        agentActivity.handleEvent({type:'clarify',requestId:'question',question:'Waiting'},window.oldSignal);
      },late:()=>agentActivity.handleEvent({type:'runtime',sessionId:999},window.oldSignal),
      commit:()=>commitExternalAgentTurn(activeChat,'brief',{role:'assistant',content:''}),
      get connection(){return agentActivity.connection},get clarification(){return agentActivity.pendingClarification},
      get stopped(){return [...stoppedExternalLaunchesRef.current]}};
      return <><output>{status}</output><AssistantComposer value='' onChange={()=>{}} onSubmit={()=>{}} canSubmit={false}
        model='test' models={[]} reasoningEffort='medium' onModelChange={()=>{}} onReasoningEffortChange={()=>{}}
        ${props.get('isSending')} ${props.get('externalRunActive')} ${props.get('runState')} ${props.get('onStop')}/></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const bundle = await build({ stdin: {contents:script,resolveDir:root,loader:"tsx"}, outfile:"stop.js", bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic", define:{"process.env.NODE_ENV":'"production"'}, plugins:[{name:"css",setup(b){b.onLoad({filter:/\.css$/},()=>({contents:"",loader:"css"}));}}] });
  const server = http.createServer((_req,res)=>{res.setHeader("content-type","text/html");res.end(`<div id="root"></div><script>${bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}</script>`);});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  let browser;
  try {
    const executablePath=["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe","/usr/bin/chromium"].find(fs.existsSync);
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const reload=()=>page.goto(`http://127.0.0.1:${server.address().port}`);
    const stop=()=>page.getByRole('button',{name:'Stop active run',exact:true});
    for(const config of [{},{external:true,active:false},{inline:true},{launching:true,active:false}]){
      await reload();await page.evaluate(config=>window.control.configure(config),config);
      await stop().click();await page.waitForFunction(()=>window.requests.length===1);
      assert.equal(await page.evaluate(()=>window.requests[0]),'/api/hermes/sessions/conv_1/abort');
      await page.evaluate(()=>window.release());
      if(config.launching){
        await page.waitForFunction(()=>window.control.stopped.includes(1));
        await page.evaluate(()=>{void window.control.commit()});
        await page.waitForFunction(()=>window.requests.length===2);
        assert.equal(await page.evaluate(()=>window.requests[1]),'/api/hermes/sessions/conv_1/abort');
        await page.evaluate(()=>window.release());
        await page.waitForFunction(()=>window.control.stopped.length===0);
      }
    }
    await reload();
    await page.evaluate(()=>{window.control.startLocal(1);window.control.configure({id:2})});
    await stop().click();await page.waitForFunction(()=>window.requests.length===1);
    assert.deepEqual(await page.evaluate(()=>window.requests),['/api/hermes/sessions/conv_2/abort']);
    assert.equal(await page.evaluate(()=>window.oldSignal.aborted),false,'selected chat must not abort another chat stream');
    await page.evaluate(()=>window.release());
    await page.evaluate(()=>window.control.configure({id:1}));
    await stop().click();await page.waitForFunction(()=>window.oldSignal.aborted);
    assert.equal(await page.evaluate(()=>window.control.clarification),null);
    assert.deepEqual(await page.evaluate(()=>window.requests.slice(1)),['/api/hermes/sessions/conv_1/abort','/api/chat-sessions/1/turns']);
    await page.evaluate(()=>{window.control.late();window.release()});
    await page.waitForFunction(()=>window.control.connection==='idle');
    assert.deepEqual(await page.evaluate(()=>window.resets),[2,1]);
    await reload();await stop().click();await page.evaluate(()=>window.release(503));
    await page.getByText('Could not stop the conversation. Try Stop again.').waitFor();
    assert.equal(await stop().isEnabled(),true,'failed cancellation remains retryable');
    assert.deepEqual(errors,[]);
  } finally { await browser?.close();await new Promise(resolve=>server.close(resolve)); }
});
