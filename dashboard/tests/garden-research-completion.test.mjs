import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { chromium } from "playwright";
import { reconcileExternalAgentMessages } from "../src/lib/conversations/external-agent-runs.ts";

const worker = {
  role: "assistant", content: "", clientMessageId: "research-worker",
  maxResearchRun: { runId: "job_research", query: "Research" },
  delegatedAgentRun: true, externalAgentName: "Max Research", externalAgentOutcome: "running",
};

test("durable worker completion replaces stale running metadata without replacing live chat text", () => {
  const user = { ...worker, role: "user", content: "Private research brief" };
  const writing = { role: "assistant", content: "A newer answer still streaming" };
  const local = [user, worker, writing];
  const finished = { ...worker, externalAgentOutcome: "completed", externalAgentResult: "Full report", responseDurationMs: 4518146 };
  const result = reconcileExternalAgentMessages(local, [user, finished]);
  assert.equal(result[0], user, "the launch's user half must remain untouched");
  assert.equal(result[2], writing, "do not roll streaming text back to a server checkpoint");
  assert.deepEqual(result[1], finished);
  assert.equal(worker.externalAgentOutcome, "running", "do not mutate cached objects");
  assert.equal(reconcileExternalAgentMessages(result, [worker]), result, "stale polls cannot revive finished work");
  assert.equal(reconcileExternalAgentMessages(local, [{ ...finished, maxResearchRun: { ...worker.maxResearchRun, runId: "another-run" } }]), local);
  for (const externalAgentOutcome of ["failed", "aborted"]) {
    assert.equal(reconcileExternalAgentMessages(local, [{ ...finished, externalAgentOutcome }])[1].externalAgentOutcome, externalAgentOutcome);
  }
});

// Execute the Garden's actual callback, reconciliation, scope reset, recovery
// and dispatch effects. Only persistence/model transport is replaced. Extracting
// the card JSX also catches a missing callback at the real call site.
test("Garden delivers research once after live completion, missed events, and chat switches", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = fs.readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("garden.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map(), functions = new Map(), effects = [];
  let card;
  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        declarations.set(declaration.name.getText(tree), node.getText(tree));
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree));
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
      ["useEffect", "useLayoutEffect"].includes(node.expression.expression.getText(tree))) effects.push(node.getText(tree));
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "InlineMaxResearchRun") card = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const declaration = name => { assert.ok(declarations.has(name), name); return declarations.get(name); };
  const effect = marker => { const match = effects.filter(value => value.includes(marker)); assert.equal(match.length, 1, marker); return match[0]; };
  assert.ok(card);
  const script = `
    import React, {useState,useRef,useEffect,useLayoutEffect,useCallback} from 'react';
    import {createRoot} from 'react-dom/client';
    import InlineMaxResearchRun from './src/app/components/hermes/inline-max-research-run';
    import {assistantExternalAgentRunId,externalAgentCardContent,externalAgentResponseDurationMs,reconcileExternalAgentMessages} from './src/lib/conversations/external-agent-runs.ts';
    import {agentLaunchContinuationMessage,MAX_AGENT_LAUNCH_HOPS} from './src/lib/hermes/agent-launch.ts';
    import {gardenTurnCompletedOnServer} from './src/lib/hermes/garden-response-stream.ts';
    window.streams=[]; window.submissions=[];
    class FakeEvents {
      constructor(url){this.url=url;this.listeners={};window.streams.push(this)}
      addEventListener(type,fn){this.listeners[type]=fn}
      close(){this.closed=true}
      emit(type,payload){this.listeners[type]?.({data:JSON.stringify({type,payload,sequenceNumber:1,at:'2026-09-07T18:42:24.495Z'})})}
    }
    window.EventSource=FakeEvents;
    const report='The complete research report. '+ 'Evidence [S1]. '.repeat(2900)+'\\n\\n## Sources\\n[S1] https://example.test/study';
    const worker=${JSON.stringify(worker)};
    const parent={role:'assistant',content:'Research is reviewing the evidence.',verification:{externalAgents:[{agentName:'Max Research'}]}};
    const initial=[{role:'user',content:'Research'},parent,{role:'user',content:'Research brief',internalAgentContinuation:true},worker];
    const finished={...worker,externalAgentOutcome:'completed',externalAgentResult:report,responseCompletedAt:'2026-09-07T18:42:24.495Z'};
    const mode=new URLSearchParams(location.search).get('mode');
    const target=mode==='switch'?2:1;
    function App(){
      const [activeChatId,setActiveChatId]=useState(1);
      const [chatSessions,setChatSessions]=useState([
        {id:1,messages:mode==='switch'?[]:initial,active:mode!=='switch'},
        {id:2,messages:mode==='switch'?[...initial.slice(0,-1),finished]:[],active:false},
      ]);
      const messages=chatSessions.find(s=>s.id===activeChatId).messages;
      const [steerableTurnActive,setBusy]=useState(mode==='busy');
      const [streamingChatIds,setStreamingChatIds]=useState(new Set([1]));
      const streamingChatIdsRef=useRef(new Set([1]));
      const gardenTurnObserversRef=useRef(new Map());
      const inFlightChatMessagesRef=useRef(new Map(mode==='switch'?[]:[[1,initial]]));
      const launchRoundOriginsRef=useRef(new Set());
      const [externalAgentStatus,setExternalAgentStatus]=useState('');
      const deletingChatIds=useRef(new Set());
      const clusterSlug='health', canViewPublicChats=false, viewPublicChats=false;
      const chatContentLoading=false,delegatedAgentLaunching=false,launchingExternalAgent=null;
      ${declaration('awaitedLaunchesRef')}
      ${declaration('launchHopsRef')}
      ${declaration('continuedDelegatedRunsRef')}
      ${declaration('[pendingLaunchContinuations, setPendingLaunchContinuations]')}
      ${declaration('setChatStreaming')}
      ${functions.get('updateChatMessages')}
      ${declaration('refreshChatSession')}
      ${declaration('agentLaunchScopeRef')}
      ${effect('agentLaunchScopeRef.current === activeChatId')}
      ${effect('const continuedKeys = new Set')}
      ${declaration('pendingLaunchContinuation')}
      ${effect('const continuation = pendingLaunchContinuation')}
      ${functions.get('handleExternalAgentTerminal')}
      async function persistChatSession(){}
      async function handleSubmit(content,_history,_attachments,internal,onTurnStarted){
        if(steerableTurnActive)return;
        window.submissions.push({chatId:activeChatId,content,internal});
        updateChatMessages(activeChatId,previous=>[...previous,{role:'user',content,internalAgentContinuation:true},{role:'assistant',content:report}]);
        onTurnStarted();
      }
      window.control={setActiveChatId,setBusy,report,async poll(){
        window.fetch=async()=>Response.json({sessions:[{id:target,messages:[...initial.slice(0,-1),finished],active:false}]});
        await refreshChatSession(target);
      }};
      const msg=messages.find(m=>m.role==='assistant'&&m.maxResearchRun);
      const onExternalAgentTerminal=handleExternalAgentTerminal;
      return <><div hidden>{msg&&${card}}</div><main>{messages.at(-1)?.content}</main><output>{activeChatId}:{pendingLaunchContinuations.length}</output></>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  `;
  const bundle = await build({
    stdin: { contents: script, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": `${root}/src` }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent",
  });
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const mode of ["live", "poll", "switch", "busy"]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
      await page.waitForFunction(() => window.control);
      if (mode === "switch") {
        await page.evaluate(() => window.control.setActiveChatId(2));
      } else if (mode === "poll") {
        await page.evaluate(() => window.control.poll());
      } else {
        await page.waitForFunction(() => window.streams.some(stream => !stream.closed));
        await page.evaluate(() => window.streams.findLast(stream => !stream.closed).emit("run.completed", {result:window.control.report}));
        if (mode === "busy") {
          await page.waitForFunction(() => document.querySelector("output").textContent === "1:1");
          assert.equal(await page.evaluate(() => window.submissions.length), 0);
          await page.evaluate(() => window.control.setBusy(false));
        }
      }
      await page.waitForFunction(() => window.submissions.length === 1, undefined, { timeout: 5000 });
      const submission = await page.evaluate(() => window.submissions[0]);
      assert.equal(submission.chatId, mode === "switch" ? 2 : 1, mode);
      assert.equal(submission.internal, true, mode);
      assert.ok(submission.content.includes(await page.evaluate(() => window.control.report)), `${mode}: full report and sources survive`);
      assert.match(await page.locator("main").innerText(), /The complete research report/);
      await page.evaluate(() => window.control.setActiveChatId(window.submissions[0].chatId === 1 ? 2 : 1));
      await page.waitForFunction(() => Number(document.querySelector("output").textContent.split(":")[0]) !== window.submissions[0].chatId);
      await page.evaluate(() => window.control.setActiveChatId(window.submissions[0].chatId));
      await page.waitForFunction(() => document.querySelector("main").textContent.includes("The complete research report"));
      assert.equal(await page.evaluate(() => window.submissions.length), 1, `${mode}: restored marker prevents duplicate synthesis`);
      assert.deepEqual(errors, [], mode);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
