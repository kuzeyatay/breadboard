import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Stop releases the chat immediately and isolates cancelled turns from the next message", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useAgentSession} from './src/app/components/hermes/use-agent-session';
      const params = new URLSearchParams(location.search);
      localStorage.setItem('breadboard:agent-mode', String(params.get('mode') !== 'direct'));
      window.requests = []; window.aborts = []; window.dispatches = []; window.streams = [];
      const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
      const stream = () => { let controller; const body = new ReadableStream({start(c){controller=c;}});
        const entry = {body, emit: value => { try { controller.enqueue(new TextEncoder().encode(value)); } catch {} }};
        window.streams.push(entry); return entry;
      };
      window.fetch = async (url, init = {}) => {
        url = String(url); window.requests.push({url, method:init.method ?? 'GET'});
        if (url.endsWith('/abort')) {
          const request = deferred(); window.aborts.push(request);
          return request.promise;
        }
        if (url === '/api/hermes/sessions' && init.method === 'POST') {
          if (params.has('cold')) {
            const request = deferred(); window.creation = request; return request.promise;
          }
          return Response.json({session:{id:'conv_stop_test'}});
        }
        if (url.includes('/events?')) {
          const entry = stream();
          if (!params.has('handshake')) entry.emit(': connected\\n\\n');
          // Deliberately ignore AbortSignal: emulate already buffered/late data.
          return new Response(entry.body);
        }
        if (url.endsWith('/messages') || url.endsWith('/direct')) {
          const request = deferred(); request.body = JSON.parse(init.body);
          window.dispatches.push(request); return request.promise;
        }
        return Response.json({sessions:[], models:[], artifacts:[]});
      };
      window.releaseAborts = () => window.aborts.forEach(request => request.resolve(Response.json({aborted:true})));
      window.acceptDispatch = index => {
        const request = window.dispatches[index];
        if (params.get('mode') === 'direct') request.resolve(new Response(stream().body));
        else request.resolve(Response.json({runId:'run-' + index}));
      };
      function App() {
        const session = useAgentSession('dashboard_terminal', {restoreLastConversation:false});
        const [draft,setDraft] = useState('First message');
        window.session = session;
        return <>
          <output>{session.loadingSession ? 'loading' : session.runState}</output>
          <textarea value={draft} onChange={e=>setDraft(e.target.value)}/>
          <button onClick={()=>{void session.send(draft);setDraft('');}}>Send</button>
          <button onClick={()=>{void session.abort();}}>Stop</button>
          <pre>{JSON.stringify({messages:session.messages, activities:session.activities, activeRunId:session.activeRunId, error:session.error})}</pre>
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "artifact-boundary", setup(builder) {
      builder.onResolve({ filter: /^\.\/inline-artifact-cards$/ }, () => ({ path: "artifacts", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const primeInlineArtifacts = async () => [];" }));
    } }],
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? bundle.outputFiles[0].text : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const query of ["", "?mode=direct", "?handshake", "?cold", "?dispatch", "?mode=direct&dispatch"]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
      await page.waitForFunction(() => document.querySelector('output')?.textContent === 'idle');
      await page.getByRole("button", { name: "Send", exact: true }).click();
      if (query === "?cold") await page.waitForFunction(() => Boolean(window.creation));
      else if (query === "?handshake") await page.waitForFunction(() => window.streams.length === 1);
      else {
        await page.waitForFunction(() => window.dispatches.length === 1);
        if (!query.includes('dispatch')) {
          await page.evaluate(() => window.acceptDispatch(0));
          await page.waitForFunction(() => window.session.runState === 'running');
        }
      }
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.waitForFunction(() => window.session.runState === 'cancelled');
      const stopped = await page.evaluate(() => ({
        activeRunId:window.session.activeRunId,
        message:window.session.messages.at(-1),
        activities:window.session.activities,
      }));
      assert.equal(stopped.activeRunId, null, query);
      assert.equal(stopped.message.interrupted, true, query);
      assert.ok(stopped.message.responseCompletedAt, query);
      assert.ok(stopped.activities.every(item => item.status === 'cancelled'), query);

      await page.locator("textarea").fill("Second message");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.waitForFunction(() => window.session.messages.some(m => m.content === 'Second message'));
      assert.equal(await page.evaluate(() => window.session.runState), 'submitting', 'the next message is accepted while cleanup is pending');
      if (query === "?cold") {
        await page.evaluate(() => window.creation.resolve(Response.json({session:{id:'conv_stop_test'},initialTurnReserved:true})));
      }
      if (query.includes('dispatch')) await page.evaluate(() => window.acceptDispatch(0));
      // Trailing text and busy/permission/done frames must never revive or
      // overwrite the stopped reply, even if the transport ignores abort.
      await page.evaluate(() => window.streams[0]?.emit(
        'data: '+JSON.stringify({type:'delta',text:'LATE OLD TEXT'})+'\n\n'+
        'data: '+JSON.stringify({type:'session.status',payload:{status:'busy'}})+'\n\n'+
        'data: '+JSON.stringify({type:'done'})+'\n\n'
      ));
      for (let attempt = 0; attempt < 8; attempt++) {
        await page.evaluate(() => window.releaseAborts());
        await page.waitForTimeout(30);
      }
      if (query === "?handshake") {
        await page.waitForFunction(() => window.streams.length === 2);
        await page.evaluate(() => window.streams[1].emit(': connected\n\n'));
      }
      const nextIndex = query === "?cold" || query === "?handshake" ? 0 : 1;
      await page.waitForFunction(index => window.dispatches.length > index, nextIndex);
      await page.evaluate(index => window.acceptDispatch(index), nextIndex);
      await page.waitForFunction(() => window.session.runState === 'running');
      assert.equal(await page.evaluate(() => window.session.messages.filter(m=>m.role==='user').length), 2, query);
      assert.equal(await page.evaluate(() => window.session.messages[1].interrupted), true, query);
      assert.equal(await page.evaluate(() => window.session.messages[1].responseCompletedAt), stopped.message.responseCompletedAt, query);
      assert.doesNotMatch(await page.locator('pre').innerText(), /LATE OLD TEXT/);
      assert.deepEqual(errors, [], query);

      // Repeated stop/send cycles remain usable even when abort fails.
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.waitForFunction(() => window.session.runState === 'cancelled');
      await page.evaluate(() => window.aborts.at(-1)?.resolve(Response.json({error:'offline'}, {status:503})));
      await page.waitForTimeout(30);
      assert.equal(await page.evaluate(() => window.session.runState), 'cancelled');
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("the real composer swaps Stop for the draft arrow in one button position", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import AssistantComposer from './src/app/components/assistant-composer';
      window.stops = 0; window.queued = [];
      window.fetch = async () => Response.json({settings:{},models:[],sessions:[],success:true});
      function App() {
        const [props, setProps] = useState({runState:'running',value:'',isSending:true});
        window.updateComposer = patch => setProps(current=>({...current,...patch}));
        return <AssistantComposer {...props} onChange={value=>setProps(current=>({...current,value}))}
          onSubmit={()=>{}} onQueueSteer={text=>window.queued.push(text)} canSubmit={Boolean(props.value.trim())}
          model="test" models={[]} reasoningEffort="medium" onModelChange={()=>{}} onReasoningEffortChange={()=>{}}
          onStop={()=>{window.stops++;setProps(current=>({...current,runState:'cancelled',isSending:false,externalRunActive:false,stopPending:false,loading:false,disabled:false}));}}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    outfile: "composer-fixture.js",
    plugins: [{ name: "composer-leaves", setup(builder) {
      builder.onResolve({ filter: /^(next\/dynamic|next\/navigation)$|\/(settings-dialog|voice-conversation-overlay|speech-dictation-button)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({path}) => ({ contents:
        path === 'next/navigation'
          ? "export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();"
          : path === 'next/dynamic' ? "export default function dynamic(){return ()=>null;}" : "export default function Leaf(){return null;}"
      }));
    } }],
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? bundle.outputFiles.find(file=>file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    let clicks = 0;
    for (const props of [
      {runState:'submitting', value:'', isSending:true, loading:true, disabled:true},
      {runState:'connecting', value:'A draft', isSending:true},
      {runState:'stopping', value:'', stopPending:true},
      {runState:'running', value:'A follow-up'},
      {runState:'waiting_for_permission', value:'An answer'},
      {runState:'idle', value:'', externalRunActive:true},
      {runState:'idle', value:'An external follow-up', externalRunActive:true},
      {runState:'idle', value:'', isSending:true},
    ]) {
      await page.evaluate(props => window.updateComposer({loading:false,disabled:false,stopPending:false,isSending:false,externalRunActive:false,clarificationPending:false,...props}), props);
      const stop = page.getByRole('button', {name:'Stop active run',exact:true});
      const queue = page.getByRole('button', {name:'Queue message',exact:true});
      const action = page.locator('button.neu-button-accent');
      await action.waitFor();
      assert.equal(await action.count(), 1);
      const originalButton = await action.elementHandle();
      if (props.value) {
        await queue.waitFor();
        assert.equal(await stop.count(), 0);
        assert.equal(await queue.isEnabled(), true);
        assert.equal(await queue.locator('svg').count(), 1);
        await queue.click();
        assert.equal(await page.evaluate(()=>window.queued.at(-1)), props.value);
      }
      await stop.waitFor();
      assert.equal(await action.count(), 1);
      assert.equal(await stop.evaluate((node, original) => node === original, originalButton), true);
      assert.equal(await stop.isEnabled(), true);
      assert.equal(await stop.getAttribute('aria-busy'), null);
      if (props.runState === 'running') {
        await page.locator('textarea').fill('Another correction');
        await queue.waitFor();
        assert.equal(await action.count(), 1);
        assert.equal(await stop.count(), 0);
        assert.equal(await queue.evaluate((node, original) => node === original, originalButton), true);
        await page.locator('textarea').fill('   ');
        await stop.waitFor();
        assert.equal(await action.count(), 1);
      }
      await stop.click();
      assert.equal(await page.evaluate(()=>window.stops), ++clicks);
      await page.locator('textarea').fill('Next message');
      assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isEnabled(), true);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("stopping a pending delegated launch frees the panel and cannot cancel a later launch", { timeout: 30_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import AgentRuntimePanel from './src/app/components/hermes/agent-runtime-panel';
      window.cancelledUrls=[]; window.terminals=[];
      window.fetch=async url=>{
        if(String(url).endsWith('/abort')) { window.cancelledUrls.push(String(url)); return new Promise(()=>{}); }
        return Response.json({});
      };
      function App(){
        const [messages,setMessages]=useState([
          {role:'user',content:'Old request',clientMessageId:'old'},
          {role:'assistant',content:'',clientMessageId:'old'},
        ]);
        window.setPanelMessages=setMessages;
        return <AgentRuntimePanel messages={messages} sessionId="conv_external" createdSessionId="conv_external"
          activities={[]} connection="idle" runState="idle" externalRunLaunching={true}
          input="" onInputChange={()=>{}} onSubmit={()=>{}} onAbort={()=>{}}
          onExternalAgentTerminal={(id,result)=>{window.terminals.push(id);setMessages(current=>current.map(m=>m.role==='assistant'&&m.clientMessageId===id?{...m,externalAgentOutcome:result.outcome}:m));}}
          pendingPermission={null} onPermissionDecision={()=>{}} error={null} model="test" models={[]}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    outfile: "panel-fixture.js", bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "panel-leaves", setup(builder) {
      builder.onResolve({ filter: /\/assistant-composer$|\/virtualized-message-list$|^\.\/(inline-[^/.]+|generative-ui-renderer)$/ }, args => ({path:args.path,namespace:"fixture"}));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({path}) => ({loader:"tsx",resolveDir:root,contents:
        path.endsWith('assistant-composer')
          ? "import React from 'react';export default function Composer(props){window.panelComposer=props;return <button onClick={props.onStop}>Stop panel</button>;}"
          : path.endsWith('inline-artifact-cards')
            ? "export const primeInlineArtifacts=async()=>[];export const useInlineArtifactPrefetch=()=>true;export const useInlineArtifactScope=()=>null;export const useInlineArtifactViewer=()=>null;export const useRegisterInlineArtifact=()=>{};export const InlineArtifactCardsProvider=({children})=>children;export default function Cards(){return null;}"
          : path.endsWith('inline-proposal-cards')
            ? "export const InlineProposalCardsProvider=({children})=>children;export default function Cards(){return null;}"
            : "export default function Rows(){return null;}"
      }));
    } }],
  });
  const server = createServer((request,response)=>{
    response.setHeader('content-type',request.url==='/bundle.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
    response.end(request.url==='/bundle.js'?bundle.outputFiles.find(file=>file.path.endsWith('.js')).text:'<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    const page=await browser.newPage();
    page.setDefaultTimeout(5_000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForTimeout(100);
    assert.deepEqual(errors,[]);
    await page.getByRole('button',{name:'Stop panel'}).click();
    assert.equal(await page.evaluate(()=>window.panelComposer.externalRunActive),false);
    assert.equal(await page.evaluate(()=>window.panelComposer.isSending),false);
    await page.evaluate(()=>window.setPanelMessages(current=>[...current,
      {role:'user',content:'New request',clientMessageId:'new'},
      {role:'assistant',content:'',clientMessageId:'new',deepResearchRun:{runId:'new-run',query:'New request'}},
    ]));
    await page.waitForFunction(()=>window.panelComposer.externalRunActive);
    assert.deepEqual(await page.evaluate(()=>window.cancelledUrls),[]);
    await page.evaluate(()=>window.setPanelMessages(current=>current.map(m=>m.role==='assistant'&&m.clientMessageId==='old'
      ? {...m,deepResearchRun:{runId:'old-run',query:'Old request'}}:m)));
    await page.waitForFunction(()=>window.cancelledUrls.length===1);
    assert.match(await page.evaluate(()=>window.cancelledUrls[0]),/old-run/);
    assert.deepEqual(await page.evaluate(()=>window.terminals),['old']);
    await page.getByRole('button',{name:'Stop panel'}).click();
    await page.waitForFunction(()=>window.cancelledUrls.length===2);
    assert.match(await page.evaluate(()=>window.cancelledUrls[1]),/new-run/);
    assert.equal(await page.evaluate(()=>window.panelComposer.externalRunActive),false);
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
