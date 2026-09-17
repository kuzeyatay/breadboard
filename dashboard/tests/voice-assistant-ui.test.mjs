import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('profile switches drive wake capture and queued notifications through both providers; compact voice cleans up', {timeout:60000}, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = `
    import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
    import Runtime from './src/app/components/voice-assistant-runtime';
    import{useToast,Toaster}from'./src/app/components/toast';
    import Profile from './src/app/profile/voice-assistant-panel';
    import Voice from './src/app/components/voice-conversation-overlay';
    import{holdForegroundAudio}from'./src/lib/speech/clap/audio-focus';
    window.holdAudio=holdForegroundAudio;
    window.cloud=false;window.opens=0;window.played=[];window.streams=[];window.processors=[];
    let listener=()=>{};
    window.voiceCompanion={open:async()=>{window.opens++;listener(true);return true;},onMinimized:cb=>{window.nativeMinimized=cb;return()=>{};},onNotification:cb=>{window.notify=cb;return()=>{};}};
    navigator.mediaDevices.getUserMedia=async()=>{
      if(window.denyMic)throw new DOMException('Microphone permission denied','NotAllowedError');
      const track=new EventTarget();track.readyState='live';track.stop=()=>track.readyState='ended';
      const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};window.streams.push(stream);return stream;
    };
    class Context{sampleRate=16000;state='running';destination={};
      async resume(){}async close(){this.state='closed';}
      createMediaStreamSource(){return{connect(){},disconnect(){}};}
      createGain(){return{gain:{value:0},connect(){},disconnect(){}};}
      createScriptProcessor(){const p={connect(){},disconnect(){},onaudioprocess:null};window.processors.push(p);return p;}
    }window.AudioContext=Context;
    window.Audio=class extends EventTarget{constructor(url){super();this.src=url;}async play(){const text=await fetch(this.src).then(r=>r.text());window.played.push({provider:'local',text});window.finishSpeech=()=>this.dispatchEvent(new Event('ended'));}pause(){}load(){}removeAttribute(){}};
    window.emitUtterance=()=>{const p=window.processors.find(p=>p.onaudioprocess);if(!p)throw Error('No wake capture');for(const level of [.2,.2,.001,.001,.001])p.onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(level)}});};
    function App(){const[open,setOpen]=useState(false);listener=setOpen;window.closeVoice=()=>setOpen(false);
      const{toasts,dismissToast}=useToast();
      return <><div hidden={open}><Profile/></div><Runtime conversationOpen={open}/><Toaster toasts={toasts} onDismiss={dismissToast}/><Voice open={open} compact messages={[]} busy={false} onClose={()=>setOpen(false)} onSend={()=>{}}/></>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const subscription = `export const preloadSubscriptionVoice=async()=>{};export const clearSubscriptionPreload=async()=>{};export const subscriptionSelected=async()=>window.cloud;export async function connectSubscriptionVoice(options={}){window.cloudTranscript=options.onTranscript;return{setListening(){},resetTranscript(){},finishTranscript:async()=>'',stopSpeaking(){window.finishSpeech?.();},close:async()=>{},speak:text=>{window.played.push({provider:'chatgpt',text});return new Promise(r=>window.finishSpeech=r);}};}`;
  const bundle = await esbuild.build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty','.module.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'voice-services',setup(build){
    build.onResolve({filter:/^(next\/navigation|\.\/navigation-progress)$|(?:subscription-live|prepare-client|request-client)$/},args=>({path:args.path,namespace:'voice-stub'}));
    build.onLoad({filter:/.*/,namespace:'voice-stub'},args=>({contents:args.path.endsWith('subscription-live')?subscription:args.path.endsWith('prepare-client')?'export async function prepareLocalSpeech(){} export const speechErrorMessage=(e,f)=>e?.message||f;':args.path.endsWith('request-client')?'export const speechRequest=(...args)=>fetch(...args);':'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};',loader:'js'}));
  }}]});
  const fixture={preferences:{readAloudNotifications:false,alwaysOnVoiceAssistant:false},transcript:'hello there',messages:[],transcriptions:0};
  const css = fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8');
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css.slice(css.indexOf('.voice-stage {')));return;}
    if(req.url.startsWith('/api/')){
      let raw='';for await(const chunk of req)raw+=chunk;
      res.setHeader('Content-Type','application/json');
      if(req.url==='/api/profile/voice-assistant'){if(req.method==='PUT')fixture.preferences=JSON.parse(raw);res.end(JSON.stringify({userId:'1',preferences:fixture.preferences}));}
      else if(req.url==='/api/chat-notifications')res.end(JSON.stringify({messages:fixture.messages}));
      else if(req.url==='/api/speech/settings')res.end(JSON.stringify({settings:{speechProvider:'local',enabled:true}}));
      else if(req.url==='/api/speech/transcribe'){fixture.transcriptions++;res.end(JSON.stringify({text:fixture.transcript}));}
      else if(req.url==='/api/speech/synthesize'){res.setHeader('Content-Type','audio/wav');res.end(JSON.parse(raw).text);}
      else res.end('{}');return;
    }
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}button{font:inherit}p{margin:0}</style></head><body><main id="root"></main><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try {
    const context=await browser.newContext({viewport:{width:800,height:480},reducedMotion:'reduce'});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const always=page.getByRole('switch',{name:'Always on voice assistant'}), read=page.getByRole('switch',{name:'Read aloud notifications'});
    await always.waitFor();assert.equal(await always.getAttribute('aria-checked'),'false');
    assert.equal(await page.evaluate(()=>window.streams.length),0);
    await always.click();await page.waitForFunction(()=>window.streams.some(s=>s.getTracks()[0].readyState==='live'));
    const peer=await page.context().newPage();
    await peer.route('**/peer',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Audio peer</body></html>'}));
    await peer.goto(`http://127.0.0.1:${server.address().port}/peer`);
    await peer.evaluate(()=>{window.channel=new BroadcastChannel('breadboard:audio-focus');window.channel.postMessage({id:'peer-test',holds:1});});
    await page.waitForFunction(()=>window.streams.every(s=>s.getTracks()[0].readyState==='ended'));
    await peer.evaluate(()=>window.channel.postMessage({id:'peer-test',holds:0}));
    await page.waitForFunction(()=>window.streams.some(s=>s.getTracks()[0].readyState==='live'));await peer.close();
    await page.evaluate(()=>window.emitUtterance());await page.waitForFunction(()=>window.processors.some(p=>p.onaudioprocess));
    assert.equal(await page.evaluate(()=>window.opens),0,'ordinary speech does not open voice');
    fixture.transcript='Hey, Bread!';await page.waitForTimeout(150);await page.evaluate(()=>window.emitUtterance());
    await page.getByRole('dialog',{name:'Voice conversation'}).waitFor();await page.getByRole('button',{name:'Pause listening'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Chat',exact:true}).count(),0);
    assert.equal(await page.locator('.voice-caption, .voice-transcript, textarea').count(),0);
    await page.getByRole('log',{name:'Conversation transcript'}).waitFor();
    const bounds=await page.locator('.voice-stage').boundingBox();assert.deepEqual([bounds.width,bounds.height],[800,480]);
    fs.mkdirSync(path.join(root,'.tmp-voice-assistant-qa'),{recursive:true});await page.screenshot({path:path.join(root,'.tmp-voice-assistant-qa','voice-widget-800x480.png')});
    const streamsBeforeMinimize=await page.evaluate(()=>window.streams.length);
    const minimize=page.getByRole('button',{name:'Minimize voice assistant'});
    const minimizeBounds=await minimize.boundingBox(),closeBounds=await page.getByRole('button',{name:'Close voice mode'}).boundingBox();
    assert.ok(minimizeBounds.x+minimizeBounds.width<closeBounds.x,'minimize sits beside close');
    await page.getByRole('button',{name:'Pause listening',exact:true}).click();
    await minimize.click();
    const expand=page.getByRole('button',{name:'Expand voice assistant'});await expand.waitFor();
    const miniBounds=await page.locator('.voice-stage').boundingBox();assert.deepEqual([miniBounds.width,miniBounds.height],[240,72]);
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.getByRole('button',{name:'Close voice mode'}).isVisible(),false);
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
    assert.equal(await page.evaluate(()=>window.streams.length),streamsBeforeMinimize);
    assert.equal(await page.evaluate(()=>window.streams.at(-1).getTracks()[0].readyState),'live');
    assert.equal(await page.locator('.voice-mini-status').textContent(),'Paused');
    assert.equal(await page.locator('.voice-stage-minimized').getByText('Voice assistant',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Start listening',exact:true}).click();
    await page.locator('.voice-stage-minimized[data-stage="listening"]').waitFor();
    const dragArea=await page.locator('.voice-mini-status').boundingBox();
    await page.mouse.move(dragArea.x+dragArea.width/2,dragArea.y+dragArea.height/2);
    await page.mouse.down();await page.mouse.move(dragArea.x+dragArea.width/2-160,dragArea.y+dragArea.height/2-120,{steps:12});await page.mouse.up();
    const moved=await page.locator('.voice-stage').boundingBox();
    assert.ok(Math.abs(moved.x-(miniBounds.x-160))<2 && Math.abs(moved.y-(miniBounds.y-120))<2,'dragging moves the compact overlay');
    assert.equal(await page.locator('.voice-stage').getAttribute('data-stage'),'listening','dragging must not pause or expand voice');
    await page.locator('.voice-mini-status').click();
    assert.equal(await page.locator('.voice-stage-minimized').count(),1,'the drag surface does not toggle voice');
    await page.screenshot({path:path.join(root,'.tmp-voice-assistant-qa','voice-minimized.png')});
    await expand.click();await page.getByRole('button',{name:'Pause listening'}).waitFor();
    assert.equal(await page.evaluate(()=>window.streams.length),streamsBeforeMinimize,'expanding keeps the same microphone session');
    assert.deepEqual(await page.locator('.voice-stage').boundingBox(),bounds);
    await minimize.click();await expand.waitFor();
    assert.deepEqual(await page.locator('.voice-stage').boundingBox(),moved,'the chosen position survives expanding and shrinking');
    await page.setViewportSize({width:320,height:200});
    await page.waitForFunction(()=>{
      const box=document.querySelector('.voice-stage').getBoundingClientRect();
      return box.x>=8&&box.y>=8&&box.right<=innerWidth-8&&box.bottom<=innerHeight-8;
    });
    await page.setViewportSize({width:800,height:480});
    await expand.click();await page.getByRole('button',{name:'Pause listening'}).waitFor();
    // A native window uses its resized viewport and restores via either keyboard or the shell.
    await page.evaluate(()=>{window.voiceCompanion.setMinimized=async value=>value;});
    await minimize.click();await page.setViewportSize({width:240,height:72});
    await page.waitForFunction(()=>document.documentElement.dataset.voiceMiniWindow==='true');
    const nativeBounds=await page.locator('.voice-stage').boundingBox();assert.ok(nativeBounds.width>=236&&nativeBounds.height>=68);
    assert.equal(await page.locator('.voice-stage-centre').evaluate(node=>getComputedStyle(node).getPropertyValue('-webkit-app-region')),'drag');
    assert.equal(await page.locator('.voice-ring-button').evaluate(node=>getComputedStyle(node).getPropertyValue('-webkit-app-region')),'no-drag');
    assert.equal(await expand.evaluate(node=>getComputedStyle(node).getPropertyValue('-webkit-app-region')),'no-drag');
    await page.screenshot({path:path.join(root,'.tmp-voice-assistant-qa','voice-minimized-native.png')});
    await expand.focus();await page.keyboard.press('Enter');await page.setViewportSize({width:800,height:480});
    await page.getByRole('button',{name:'Pause listening'}).waitFor();
    await minimize.click();await page.evaluate(()=>window.nativeMinimized(false));
    await page.getByRole('button',{name:'Pause listening'}).waitFor();
    assert.equal(await page.evaluate(()=>window.streams.length),streamsBeforeMinimize);
    await page.setViewportSize({width:320,height:200});await page.screenshot({path:path.join(root,'.tmp-voice-assistant-qa','voice-widget-320x200.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'Close voice mode'}).click();
    await always.click();await page.waitForFunction(()=>window.streams.every(s=>s.getTracks()[0].readyState==='ended'));
    await read.click();await page.waitForTimeout(300);
    await page.evaluate(()=>{window.notify({title:'First',message:'One'});window.notify({title:'Second',message:'Two'});});
    await page.waitForFunction(()=>window.played.length===1);assert.deepEqual(await page.evaluate(()=>window.played[0]),{provider:'local',text:'First. One'});
    await page.evaluate(()=>window.finishSpeech());await page.waitForFunction(()=>window.played.length===2);
    await page.evaluate(()=>window.finishSpeech());
    await page.evaluate(()=>{window.cloud=true;window.releaseAudio=window.holdAudio();window.notify({message:'Wait for foreground audio'});});
    await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.played.length),2);
    await page.evaluate(()=>window.releaseAudio());await page.waitForFunction(()=>window.played.length===3);
    assert.equal(await page.evaluate(()=>window.played[2].provider),'chatgpt');
    await page.evaluate(()=>window.notify({message:'Discard this queued notification when disabled'}));
    await read.click();await page.evaluate(()=>window.finishSpeech());await always.click();await page.waitForFunction(()=>typeof window.cloudTranscript==='function');
    await page.evaluate(()=>window.cloudTranscript('Hey bread'));await page.getByRole('dialog',{name:'Voice conversation'}).waitFor();
    assert.equal(await page.evaluate(()=>window.opens),2);await page.getByRole('button',{name:'Close voice mode'}).click();
    await always.click();await page.waitForFunction(()=>window.streams.every(s=>s.getTracks()[0].readyState==='ended'));
    await page.evaluate(()=>window.notify({message:'Must stay silent'}));await page.waitForTimeout(650);
    await page.getByText('Must stay silent',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.played.length),3);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test('closing notifications stops only their speech and removes queued readings across windows', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Runtime from './src/app/components/voice-assistant-runtime';
      import Overlay from './src/app/notification-overlay/notification-overlay-client';
      import {useToast,Toaster} from './src/app/components/toast';
      window.played=[];window.cloud=false;window.inboxPolls=0;window.settingsPolls=0;window.activeText=null;
      window.voiceCompanion={onNotification:cb=>{window.notify=cb;return()=>{};}};
      window.breadboardDesktop={onNotificationToast:cb=>{window.deliver=cb;return()=>{};},resizeNotificationOverlay:async()=>true};
      const originalFetch=window.fetch;
      window.fetch=async(...args)=>{const response=await originalFetch(...args);if(args[0]==='/api/chat-notifications')window.inboxPolls++;if(args[0]==='/api/speech/settings')window.settingsPolls++;return response;};
      window.Audio=class extends EventTarget {
        constructor(url){super();this.src=url;}
        async play(){const text=await fetch(this.src).then(r=>r.text());window.played.push({provider:'local',text});window.activeText=text;}
        pause(){window.activeText=null;}load(){}removeAttribute(){}
      };
      function App(){const {toasts,dismissToast,addToast}=useToast();window.addToast=addToast;return <><Runtime/><Toaster toasts={toasts} onDismiss={dismissToast}/></>;}
      createRoot(document.getElementById('root')).render(location.pathname==='/reader'?<Runtime/>:location.pathname==='/overlay'?<Overlay/>:<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'notification-services', setup(build) {
      build.onResolve({filter: /^(next\/navigation|\.\/navigation-progress)$|(?:subscription-live|request-client)$/}, args => ({path: args.path, namespace:'fixture'}));
      build.onLoad({filter: /.*/, namespace:'fixture'}, args => ({loader:'js', contents:
        args.path.endsWith('subscription-live') ? `export const preloadSubscriptionVoice=async()=>{};export const clearSubscriptionPreload=async()=>{};export const subscriptionSelected=async()=>window.cloud;
          export async function connectSubscriptionVoice(){
            if(window.delayConnection)await new Promise(resolve=>window.releaseConnection=resolve);
            let finish=()=>{};
            return{close:async()=>{window.activeText=null;finish();},stopSpeaking(){window.activeText=null;finish();},
              speak:text=>{window.activeText=text;window.played.push({provider:'chatgpt',text});return new Promise(resolve=>finish=resolve);}};
          }` :
        args.path.endsWith('request-client') ? 'export const speechRequest=(...args)=>fetch(...args);' :
        'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};'
      }));
    } }],
  });
  let messages = [];
  let releaseSynthesis;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') {res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    res.setHeader('Content-Type','application/json');
    // Intentionally stale after dismissal: the reader must also reject old in-flight polls.
    if (req.url === '/api/chat-notifications') {res.end(JSON.stringify({messages}));return;}
    if (req.url === '/api/profile/voice-assistant') {res.end(JSON.stringify({userId:'1',preferences:{readAloudNotifications:true,alwaysOnVoiceAssistant:false}}));return;}
    if (req.url === '/api/speech/settings') {res.end(JSON.stringify({settings:{speechProvider:'local',enabled:true}}));return;}
    if (req.url === '/api/speech/synthesize') {let raw='';for await(const chunk of req)raw+=chunk;
      const text=JSON.parse(raw).text;
      if(text.includes('Delayed synthesis'))await new Promise(resolve=>releaseSynthesis=resolve);
      res.setHeader('Content-Type','audio/wav');res.end(text);return;}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => {server.closeAllConnections();return new Promise(resolve => server.close(resolve));});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(() => browser.close());
  const context=await browser.newContext();
  const reader=await context.newPage(), overlay=await context.newPage();
  const errors=[];
  for(const page of [reader,overlay]){page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(6000);}
  const origin=`http://127.0.0.1:${server.address().port}`;
  await reader.goto(origin+'/reader');
  await reader.waitForFunction(()=>window.settingsPolls>=1);
  await overlay.goto(origin+'/overlay');
  await overlay.waitForFunction(()=>window.inboxPolls>=1);
  const notice=(id,response)=>({id,title:'Response ready',type:'success',response,chatTitle:'Migration',target:{surface:'dashboard_terminal',chatId:'conv_1'},updatedAt:'2026-09-07 12:00:00'});
  const closeCard=async text=>overlay.getByRole('status').filter({hasText:text}).getByRole('button',{name:'Dismiss message',exact:true}).click();
  let count=0;
  for(const provider of ['local','chatgpt']){
    await reader.evaluate(cloud=>window.cloud=cloud,provider==='chatgpt');
    const full=`Full ${provider} response. `+'The full report remains visible in the notification. '.repeat(20);
    messages=[...messages,notice(`msg_${provider}_1`,full),notice(`msg_${provider}_2`,`Queued ${provider} response.`),notice(`msg_${provider}_3`,`Remaining ${provider} response.`)];
    await overlay.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await reader.waitForFunction(count=>window.played.length===count+1,count);
    assert.equal(await overlay.getByText(full,{exact:true}).innerText(),full.trim());
    await closeCard(`Queued ${provider} response.`);
    await reader.waitForTimeout(150);
    assert.match(await reader.evaluate(()=>window.activeText),new RegExp(`Full ${provider} response`));
    await closeCard(`Full ${provider} response.`);
    await reader.waitForFunction(count=>window.played.length===count+2,count);
    assert.match(await reader.evaluate(()=>window.activeText),new RegExp(`Remaining ${provider} response`));
    await closeCard(`Remaining ${provider} response.`);
    await reader.waitForFunction(()=>window.activeText===null,{},{timeout:1000});
    count+=2;
  }
  await reader.waitForTimeout(3200);
  assert.equal(await reader.evaluate(()=>window.played.length),count,'dismissed entries from a stale poll must never restart');

  // Shell-delivered cards carry the same id into the separate voice companion.
  const shellNotice={id:'toast:from-shell',message:'Desktop notification body',type:'success'};
  await reader.evaluate(notice=>window.notify(notice),shellNotice);
  await reader.waitForFunction(()=>window.activeText==='Desktop notification body');
  await closeCard('Desktop notification body');
  await reader.waitForFunction(()=>window.activeText===null,{},{timeout:1000});
  count++;

  // A dismissed card cannot start talking when an in-flight cloud connection eventually opens.
  await reader.evaluate(()=>window.delayConnection=true);
  const delayed={id:'toast:late-cloud',message:'Delayed cloud connection',type:'success'};
  await reader.evaluate(notice=>window.notify(notice),delayed);
  await reader.waitForFunction(()=>typeof window.releaseConnection==='function');
  await closeCard(delayed.message);
  await reader.waitForTimeout(100);
  await reader.evaluate(()=>{window.delayConnection=false;window.releaseConnection();});
  await reader.waitForTimeout(200);
  assert.equal(await reader.evaluate(()=>window.played.length),count);

  // The local synthesis request is also cancelled before audio starts.
  await reader.evaluate(()=>window.cloud=false);
  const generating={id:'toast:late-local',message:'Delayed synthesis',type:'success'};
  const request=reader.waitForRequest(request=>request.url().endsWith('/api/speech/synthesize'));
  await reader.evaluate(notice=>window.notify(notice),generating);await request;
  await closeCard(generating.message);
  await reader.waitForTimeout(100);releaseSynthesis?.();
  await reader.waitForTimeout(200);
  assert.equal(await reader.evaluate(()=>window.played.length),count);

  // A browser-only card and its reader in the same page use the same cancellation path.
  messages=[];await reader.close();await overlay.close();
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/page');await page.waitForFunction(()=>window.inboxPolls>=1&&window.settingsPolls>=1);await page.waitForTimeout(100);
  await page.evaluate(()=>window.addToast('Local browser notice','success'));
  await page.waitForFunction(()=>window.activeText==='Local browser notice');
  await page.getByRole('button',{name:'Dismiss message',exact:true}).click();
  await page.waitForFunction(()=>window.activeText===null,{},{timeout:1000});
  assert.deepEqual(errors,[]);
});

test('messages received by voice populate the UI even when its inbox poll is stalled', { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import Runtime from './src/app/components/voice-assistant-runtime';
      import Overlay from './src/app/notification-overlay/notification-overlay-client';
      import{useToast,Toaster}from'./src/app/components/toast';
      import{holdForegroundAudio}from'./src/lib/speech/clap/audio-focus';
      window.blockAudio=()=>{window.releaseAudio=holdForegroundAudio();};
      window.played=[];window.polls=0;window.settingsPolls=0;window.notify=()=>{};window.hidden=false;
      Object.defineProperty(document,'visibilityState',{get:()=>window.hidden?'hidden':'visible'});
      window.voiceCompanion={onNotification:cb=>{window.notify=cb;return()=>{};}};
      window.breadboardDesktop={onNotificationToast:cb=>{window.deliver=cb;return()=>{};},resizeNotificationOverlay:async()=>true};
      const fetchOriginal=window.fetch;
      window.fetch=async(url,options)=>{const response=await fetchOriginal(url,{...options,headers:{...options?.headers,'x-notification-host':location.pathname}});
        if(url==='/api/chat-notifications'&&options?.method!=='POST')window.polls++;
        if(url==='/api/speech/settings')window.settingsPolls++;
        return response;};
      const interval=window.setInterval;window.setInterval=(callback,ms)=>interval(callback,ms===3000||ms===4000?100:ms);
      function Page(){const{toasts,addToast,dismissToast}=useToast();window.addToast=addToast;
        return <Toaster toasts={toasts} onDismiss={dismissToast}/>;}
      createRoot(document.getElementById('root')).render(location.pathname==='/reader'?<Runtime/>:location.pathname==='/page'?<Page/>:<Overlay/>);
    ` },
    bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'presentation-services',setup(build){
      build.onResolve({filter:/^(next\/navigation|\.\/navigation-progress)$|(?:notification-speech|wake-listener)$/},args=>({path:args.path,namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('notification-speech')?
        'export async function speakNotification(text){window.played.push(text);}':args.path.endsWith('wake-listener')?
        'export async function listenForHeyBread(){}':'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};'}));
    }}],
  });
  const notice = (id, response) => ({id,title:'Response ready',type:'success',response,chatTitle:'Test chat',target:{surface:'dashboard_terminal',chatId:'conv_test'},updatedAt:'2026-09-08 12:00:00'});
  let messages=[notice('old','Already in the inbox')],holdOverlay=false;
  const waiting=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/profile/voice-assistant'){res.end(JSON.stringify({userId:'1',preferences:{readAloudNotifications:true,alwaysOnVoiceAssistant:false}}));return;}
    if(req.url==='/api/speech/settings'){res.end('{"settings":{"speechProvider":"local"}}');return;}
    if(req.url==='/api/chat-notifications'){
      if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const {dismiss=[]}=JSON.parse(raw);messages=messages.filter(n=>!dismiss.includes(n.id));res.end('{}');return;}
      const snapshot=JSON.stringify({messages});
      if(holdOverlay&&req.headers['x-notification-host']==='/overlay')waiting.push(()=>res.end(snapshot));else res.end(snapshot);
      return;
    }
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>.hidden .bb-page-toast-host{display:none}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});t.after(()=>browser.close());
  const context=await browser.newContext();const reader=await context.newPage(),overlay=await context.newPage();
  const errors=[];for(const page of [reader,overlay]){page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);}
  const origin=`http://127.0.0.1:${server.address().port}`;
  await reader.goto(origin+'/reader');await reader.waitForFunction(()=>window.settingsPolls>0);
  await overlay.goto(origin+'/overlay');await overlay.getByText('Already in the inbox',{exact:true}).waitFor();
  await reader.waitForTimeout(250);assert.deepEqual(await reader.evaluate(()=>window.played),[],'old inbox cards are not re-announced');
  holdOverlay=true;
  await new Promise(resolve=>{const check=()=>waiting.length?resolve():setTimeout(check,10);check();});
  const fullResponse='The complete answer from voice. '+'Every detail must be available in the UI. '.repeat(40);
  messages.push(notice('new',fullResponse));
  await overlay.getByText(fullResponse,{exact:true}).waitFor();
  await reader.waitForFunction(()=>window.played.length===1);
  assert.match(await reader.evaluate(()=>window.played[0]),/The complete answer from voice/);
  // The older request captured before this answer must not erase its card.
  holdOverlay=false;for(const release of waiting.splice(0))release();
  await reader.waitForTimeout(250);
  assert.equal(await overlay.getByText(fullResponse,{exact:true}).innerText(),fullResponse.trim());

  const shellNotice={id:'toast:shell',message:'Delivered to the overlay',type:'success'};
  await reader.evaluate(notice=>window.notify(notice),shellNotice);
  await overlay.getByText(shellNotice.message,{exact:true}).waitFor();await reader.waitForFunction(()=>window.played.length===2);
  await reader.evaluate(notice=>window.notify(notice),shellNotice);
  await overlay.evaluate(notice=>window.deliver(notice),shellNotice);
  await reader.waitForTimeout(200);assert.equal(await reader.evaluate(()=>window.played.length),2,'duplicate delivery is read once');
  assert.equal(await overlay.getByText(shellNotice.message,{exact:true}).count(),1);

  // A notification from another page must reach the visible shared overlay.
  const page=await context.newPage();await page.goto(origin+'/page');
  await page.evaluate(()=>{document.documentElement.className='hidden';window.addToast('Hidden page copy','success');});
  await overlay.getByText('Hidden page copy',{exact:true}).waitFor();
  await reader.waitForFunction(()=>window.played.length===3);
  await page.close();

  const dismissButtons=overlay.getByRole('button',{name:'Dismiss message',exact:true});
  while(await dismissButtons.count())await dismissButtons.first().click();
  await overlay.waitForFunction(()=>!document.querySelector('[role=status]'));
  await overlay.evaluate(()=>{window.hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
  const polls=await overlay.evaluate(()=>window.polls);messages.push(notice('empty','Arrived at an empty overlay'));
  await overlay.waitForFunction(polls=>window.polls>polls,polls);
  await overlay.getByText('Arrived at an empty overlay',{exact:true}).waitFor();
  await reader.waitForFunction(()=>window.played.length===4);
  await overlay.evaluate(()=>{window.hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await reader.evaluate(()=>window.blockAudio());
  messages.push(notice('updated','Superseded queued update'));
  await overlay.getByText('Superseded queued update',{exact:true}).waitFor();
  messages=messages.map(record=>record.id==='updated'?{...record,response:'Current update on the card',updatedAt:'2026-09-08 12:00:01'}:record);
  await overlay.getByText('Current update on the card',{exact:true}).waitFor();
  await reader.waitForTimeout(100);await reader.evaluate(()=>window.releaseAudio());
  await reader.waitForFunction(()=>window.played.length===5);
  assert.match(await reader.evaluate(()=>window.played.at(-1)),/Current update on the card/);
  // Recreating the overlay restores notices received through voice as well.
  await reader.evaluate(()=>window.blockAudio());
  await reader.evaluate(()=>window.notify({id:'toast:reopen',message:'Available after reopening the UI',type:'success'}));
  await overlay.getByText('Available after reopening the UI',{exact:true}).waitFor();
  await overlay.reload();
  await overlay.getByText('Available after reopening the UI',{exact:true}).waitFor();
  await reader.evaluate(()=>window.releaseAudio());
  await reader.waitForFunction(()=>window.played.length===6);

  // Outbound reminder chat titles contain a preview of the same body. Read the
  // body once, and do not replay it for database touches or a chat rename.
  const reminder = "In 20 minutes: Snack: whey + apple 16:30 – 16:45";
  messages.push({...notice('reminder',reminder),chatTitle:`Telegram: ${reminder}`});
  await reader.waitForFunction(()=>window.played.length===7);
  assert.equal(await reader.evaluate(()=>window.played.at(-1)),`Response ready. ${reminder}`);
  for (let revision=1;revision<=3;revision++) {
    messages=messages.map(record=>record.id==='reminder'?{...record,
      chatTitle:`Reminder chat ${revision}`,updatedAt:`2026-09-08 12:01:0${revision}`}:record);
    const polls=await reader.evaluate(()=>window.polls);
    await reader.waitForFunction(polls=>window.polls>polls+1,polls);
  }
  await reader.waitForTimeout(600);
  assert.equal(await reader.evaluate(()=>window.played.length),7,'timestamp-only updates are silent');
  messages=messages.map(record=>record.id==='reminder'?{...record,response:'The event time has changed.'}:record);
  await reader.waitForFunction(()=>window.played.length===8);
  assert.equal(await reader.evaluate(()=>window.played.at(-1)),'Response ready. The event time has changed.');
  assert.deepEqual(errors,[]);
});
