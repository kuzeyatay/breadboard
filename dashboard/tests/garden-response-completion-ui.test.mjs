import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { chromium } from "playwright";

// Run the real Garden stream consumer, polling callback and busy-state
// expressions together. Replace only the model request and persistence.
test("Garden releases completed responses after terminal frames, missed frames and chat switches", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = fs.readFileSync(process.env.GARDEN_COMPLETION_WORKSPACE ?? new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("garden.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map(), functions = new Map();
  let request;
  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        declarations.set(d.name.getText(tree), node.getText(tree));
        if (d.name.getText(tree) === "res" && d.initializer?.getText(tree).startsWith('await fetch("/api/chat",')) request = d.initializer.getText(tree);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const declaration = name => { assert.ok(declarations.has(name), name); return declarations.get(name); };
  const submit = functions.get("handleSubmit").body;
  const body = source.slice(source.indexOf("let agentFailed = false;", submit.pos), submit.end - 1)
    .replace(request, "await window.openResponse(typeof viewerSignal === 'undefined' ? agentSignal : viewerSignal)");
  const script = `
    import React,{useState,useRef,useCallback,useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import ActivityPanel from './src/app/components/hermes/activity-panel';
    import {useLegacyAgentActivity} from './src/app/components/hermes/use-legacy-agent-activity';
    import {isRecoverableAgentStreamDisconnect} from './src/app/components/hermes/agent-stream-watchdog';
    import {gardenTurnCompletedOnServer,readGardenResponseData} from './src/lib/hermes/garden-response-stream';
    import {applyGardenStableTextEvent} from './src/lib/hermes/garden-stable-stream';
    import {reconcileExternalAgentMessages} from './src/lib/conversations/external-agent-runs';
    import {preserveInlineQuestionMessages,reconcileInlineQuestionMessages} from './src/lib/conversations/garden-inline-question';
    window.saved=[]; window.notices=[]; window.cancelled=0; window.finished=0;
    const hasRunningExternalAgent=()=>false;
    const notifyChatResponseReady=(_text,options)=>window.notices.push(options);
    const notifyChatResponseFailed=()=>{throw Error('Unexpected failure notice')};
    const agentLaunchQueue={handleEvent:()=>false};
    const initial=[{role:'user',clientMessageId:'turn-1',content:'Video routine and results'}, {role:'assistant',clientMessageId:'turn-1',content:''}];
    window.serverSession={id:1,active:false,messages:[initial[0],{...initial[1],content:'The durable complete answer.',responseCompletedAt:'2026-09-07T19:55:42.301Z'}]};
    window.fetch=async()=>Response.json({sessions:[window.serverSession]});
    window.openResponse=async()=>new Response(new ReadableStream({start(c){window.stream=c},cancel(){window.cancelled++}}));
    window.frame=text=>window.stream.enqueue(new TextEncoder().encode(text));
    function App(){
      const [activeChatId,setActiveChatId]=useState(1);
      const [chatSessions,setChatSessions]=useState([{id:1,active:false,messages:initial},{id:2,active:false,messages:[]}]);
      const [streamingChatIds,setStreamingChatIds]=useState(new Set());
      const streamingChatIdsRef=useRef(new Set());
      const inFlightChatMessagesRef=useRef(new Map());
      const gardenTurnObserversRef=useRef(new Map());
      const activeGardenTurnRef=useRef(null),activeSteerContextRef=useRef(null),activeChatIdRef=useRef(1);
      const locallyAnnouncedChatResponses=useRef(new Set()),awaitedLaunchesRef=useRef(new Map()),deletingChatIds=useRef(new Set());
      const textareaRef=useRef(null),runningRef=useRef(false);
      const agentActivity=useLegacyAgentActivity();
      const clusterSlug='health',canViewPublicChats=false,viewPublicChats=false;
      const showingDraft=false,hasRunningExternalAgentInActiveChat=false;
      const activeChat=chatSessions.find(s=>s.id===activeChatId);
      const messages=activeChat?.messages??[];
      ${declaration('setChatStreaming')}
      ${functions.get('updateChatMessages').getText(tree)}
      ${declaration('refreshChatSession')}
      ${declaration('activeServerChatIds')}
      ${declaration('chatTurnStreaming')}
      ${declaration('isStreaming')}
      ${declaration('visibleAgentConnection')}
      async function refreshRail(){}
      async function refreshChatTitles(){}
      async function persistChatSession(id,messages,title,options={}){
        window.saved.push({id,messages});
        if(window.slowSave){
          await new Promise(resolve=>{window.releaseSave=resolve});
          if(options.updateLocal!==false)setChatSessions(previous=>previous.map(s=>s.id===id?{...s,messages}:s));
        }
        return true;
      }
      async function run(){
        const sessionId=1,clientMessageId='turn-1',session={conversationId:'conv-1'},history=[],title=undefined,displayText='Video';
        const responseStartedAt=performance.now(),steerContext={messages:[]};
        activeSteerContextRef.current=steerContext;
        activeGardenTurnRef.current={sessionId,clientMessageId};
        let agentSignal=agentActivity.start('conv-1');
        const assistantMsg={...initial[1]};
        const messagesWithAssistant=()=>[initial[0],{...assistantMsg}];
        let finalMessages=messagesWithAssistant();
        setChatStreaming(sessionId,true);
        updateChatMessages(sessionId,finalMessages);
        ${body}
        window.finished++;
      }
      useEffect(()=>{if(!runningRef.current){runningRef.current=true;void run()}},[]);
      window.control={poll:()=>refreshChatSession(1),setActiveChatId,
        markActive:()=>setChatSessions(previous=>previous.map(s=>s.id===1?{...s,active:true}:s)),
        startNext:()=>{
          const signal=agentActivity.start('conv-1');
          agentActivity.handleEvent({type:'runtime',sessionId:1,runId:'run-2'},signal);
          setChatStreaming(1,true);
          updateChatMessages(1,[{role:'user',clientMessageId:'turn-2',content:'Next question'},{role:'assistant',clientMessageId:'turn-2',content:'New response underway'}]);
        },
        get observers(){return gardenTurnObserversRef.current.size}};
      return <><main>{activeChat.messages.at(-1)?.content}</main><output>{isStreaming?'Running':'Ready'}</output>
        <ActivityPanel activities={agentActivity.activities} connection={visibleAgentConnection}
          answerContent={activeChat.messages.at(-1)?.content} pendingPermission={null} onPermissionDecision={()=>{}} />
        <span id="connection">{agentActivity.connection}</span><span id="polling">{activeServerChatIds.join(',')}</span>
        {!isStreaming&&activeChat.messages.at(-1)?.role==='assistant'&&<button>Copy response</button>}</>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  `;
  const bundle = await build({ stdin: { contents: script, resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": `${root}/src` }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
  const server = http.createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const mode of process.env.GARDEN_COMPLETION_WORKSPACE ? ["terminal"] : ["terminal", "slow-save", "poll", "switch", "eof"]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.stream);
      await page.evaluate(() => window.frame('data: {"type":"replace","text":"The streamed answer."}\n\n'));
      await page.waitForFunction(() => document.querySelector('main').textContent.includes('streamed answer'));
      assert.equal(await page.locator("output").textContent(), "Running");
      if (mode === "terminal" || mode === "slow-save") {
        if (mode === "slow-save") {
          await page.evaluate(() => { window.slowSave=true; window.control.markActive(); });
        }
        await page.evaluate(() => window.frame('data: [DONE]\n\n'));
      } else if (mode === "eof") {
        await page.evaluate(() => window.stream.close());
      } else {
        assert.equal(await page.locator("#polling").textContent(), "1", "local viewers remain polled after the rail turns idle");
        // An old completed answer must not release the current turn.
        await page.evaluate(async () => { window.serverSession.messages[1].clientMessageId='older'; await window.control.poll(); });
        assert.equal(await page.locator("output").textContent(), "Running");
        assert.equal(await page.locator("main").textContent(), "The streamed answer.");
        if (mode === "switch") await page.evaluate(() => window.control.setActiveChatId(2));
        await page.evaluate(async () => { window.serverSession.messages[1].clientMessageId='turn-1'; await window.control.poll(); });
        if (mode === "switch") await page.evaluate(() => window.control.setActiveChatId(1));
      }
      if (mode === "slow-save") {
        await page.waitForFunction(() => window.releaseSave);
        assert.equal(await page.locator(".assistant-response-label").textContent(), "Thought", "completion clears a stale active rail before saving");
        assert.equal(await page.locator("output").textContent(), "Ready", "a slow chat save must not hold the response open");
        assert.equal(await page.getByRole("button", { name: "Copy response" }).count(), 1);
        assert.equal(await page.evaluate(() => window.finished), 0, "the save is still pending");
        await page.evaluate(() => window.control.startNext());
        await page.waitForFunction(() => document.querySelector('main').textContent==='New response underway');
        await page.evaluate(() => window.releaseSave());
        await page.waitForFunction(() => window.finished===1);
        assert.equal(await page.locator("output").textContent(), "Running", "the old save cannot stop a newer turn");
        assert.equal(await page.locator("#connection").textContent(), "streaming");
        assert.equal(await page.locator("main").textContent(), "New response underway", "the old save cannot replace a newer answer");
        assert.deepEqual(errors, [], mode);
        await page.close();
        continue;
      }
      await page.waitForFunction(() => window.finished === 1, undefined, { timeout: 2000 });
      assert.equal(await page.locator("output").textContent(), "Ready", mode);
      assert.equal(await page.locator(".assistant-response-label").textContent(), "Thought", mode);
      assert.equal(await page.locator("#connection").textContent(), "idle", mode);
      assert.equal(await page.getByRole("button", { name: "Copy response" }).count(), 1, mode);
      assert.equal(await page.locator("main").textContent(), mode === "terminal" ? "The streamed answer." : "The durable complete answer.", mode);
      assert.equal(await page.evaluate(() => window.saved.length), mode === "terminal" ? 1 : 0, "recovery never overwrites the durable answer");
      assert.equal(await page.evaluate(() => window.notices.length), mode === "terminal" ? 1 : 0, "recovery does not duplicate the server's notice");
      assert.equal(await page.evaluate(() => window.control.observers), 0);
      if (mode !== "eof") assert.equal(await page.evaluate(() => window.cancelled), 1);
      assert.deepEqual(errors, [], mode);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
