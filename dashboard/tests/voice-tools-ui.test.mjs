import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('spoken turns use agent tools with typed Agent mode off, retain results, and leave typed preferences alone', { timeout: 45000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {useAgentSession} from './src/app/components/hermes/use-agent-session';
      import {voiceRequestOptions} from './src/lib/speech/voice-request';
      const params = new URLSearchParams(location.search);
      localStorage.setItem('breadboard:agent-mode', 'false');
      localStorage.setItem('breadboard:super-agent', 'false');
      localStorage.setItem('breadboard:yolo-mode', 'false');
      window.calls=[];window.streams=[];window.creations=[];
      window.voiceCompanion={getScreenContextAccess:async()=>({port:43210,token:'a'.repeat(64)})};
      window.fetch=async(url,init={})=>{
        url=String(url);
        if(url==='/api/profile/voice-assistant')return Response.json({preferences:{readAloudNotifications:false,alwaysOnVoiceAssistant:false,startVoiceOnStartup:true,voiceModel:'gpt-6-sol'}});
        if(url==='/api/hermes/sessions'&&init.method==='POST'){
          window.creations.push(JSON.parse(init.body));return Response.json({session:{id:'voice-tools'},initialTurnReserved:true});
        }
        if(url.includes('/events?')){
          return new Response(new ReadableStream({start(controller){
            window.streams.push(event=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\\n\\n')));
            controller.enqueue(new TextEncoder().encode(': connected\\n\\n'));
          }}));
        }
        if(url.endsWith('/messages')||url.endsWith('/direct')){
          window.calls.push({url,body:JSON.parse(init.body)});
          if(window.failAgent&&url.endsWith('/messages'))return Response.json({error:'The tool runtime is unavailable'}, {status:503});
          if(url.endsWith('/direct'))return new Response('data: '+JSON.stringify({type:'delta',text:'Typed answer'})+'\\n\\n');
          return Response.json({runId:'run-'+window.calls.length});
        }
        return Response.json({sessions:[],models:[],artifacts:[]});
      };
      function App(){
        const session=useAgentSession(params.has('garden')?'garden_chat':'dashboard_terminal', {restoreLastConversation:false,voice:params.has('standalone')});
        window.session=session;
        const speak=async()=>{
          const options=params.has('standalone')?{model:'gpt-6-sol',reasoningEffort:'high'}:await voiceRequestOptions();
          await session.send('Look up the current weather in Amsterdam',options);
        };
        return <><output>{session.runState}</output>
          <button onClick={()=>void speak()}>Speak</button>
          <button onClick={()=>void session.send('Explain evaporation',{model:'typed-model'})}>Type</button>
          <pre>{JSON.stringify({messages:session.messages,activities:session.activities,error:session.error})}</pre></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'artifact-boundary', setup(builder) {
      builder.onResolve({ filter: /^\.\/inline-artifact-cards$/ }, () => ({ path: 'artifacts', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const primeInlineArtifacts = async () => [];' }));
    } }],
  });
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type', req.url==='/app.js'?'text/javascript':'text/html');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  for(const query of ['', '?garden', '?standalone', '?failure']){
    const page=await browser.newPage();
    page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
    await page.waitForFunction(()=>window.session?.loadingSession===false);
    if(query==='?failure')await page.evaluate(()=>{window.failAgent=true;});
    await page.getByRole('button',{name:'Speak',exact:true}).click();
    await page.waitForFunction(()=>window.calls.length===1);
    const request=await page.evaluate(()=>window.calls[0]);
    assert.ok(request.url.endsWith('/messages'),query);
    assert.equal(request.body.voice,true,query);
    assert.equal(request.body.model,'gpt-6-sol');
    assert.equal(request.body.reasoningEffort,query==='?standalone'?'high':undefined, 'voice does not override the requested reasoning effort');
    assert.equal(request.body.superAgent,false);
    assert.equal(request.body.yoloMode,false);
    if(query!=='?standalone')assert.deepEqual(request.body.browserAccess,{port:43210,token:'a'.repeat(64)});
    assert.equal(await page.evaluate(()=>window.creations[0].initialTurn.agentMode),true);
    assert.equal(await page.evaluate(()=>window.creations[0].initialTurn.voice),true);
    if(query==='?failure'){
      await page.waitForFunction(()=>window.session.runState==='error');
      assert.match(await page.locator('pre').innerText(),/tool runtime is unavailable/);
      assert.ok(await page.evaluate(()=>window.calls.every(call=>call.url.endsWith('/messages'))),
        'agent transport retries must not fall back to a tool-free model');
    }else{
      await page.waitForFunction(()=>window.session.runState==='running');
      await page.evaluate(()=>{
        const emit=window.streams[0];
        emit({type:'tool.started',payload:{tool:'weather_forecast',callId:'weather-1',label:'Checking weather'}});
        emit({type:'tool.completed',payload:{tool:'weather_forecast',callId:'weather-1',status:'success',output:'Amsterdam: 17 C'}});
        emit({type:'assistant.delta',payload:{text:'It is 17 degrees in Amsterdam.'}});
        emit({type:'done'});
      });
      await page.waitForFunction(()=>window.session.runState==='completed');
      assert.equal(await page.evaluate(()=>window.session.messages.at(-1).content),'It is 17 degrees in Amsterdam.');
      if(query!=='?standalone'){
        await page.getByRole('button',{name:'Type',exact:true}).click();
        await page.waitForFunction(()=>window.calls.length===2&&window.session.runState==='completed');
        const typed=await page.evaluate(()=>window.calls[1]);
        assert.ok(typed.url.endsWith('/direct'));
        assert.equal(typed.body.model,'typed-model');
        assert.equal(await page.evaluate(()=>window.session.messages.at(-1).content),'Typed answer');
      }
    }
    assert.equal(await page.evaluate(()=>localStorage.getItem('breadboard:agent-mode')),'false');
    assert.equal(await page.evaluate(()=>localStorage.getItem('breadboard:super-agent')),'false');
    assert.equal(await page.evaluate(()=>localStorage.getItem('breadboard:yolo-mode')),'false');
    assert.deepEqual(errors,[],query);
    await page.close();
  }
});
