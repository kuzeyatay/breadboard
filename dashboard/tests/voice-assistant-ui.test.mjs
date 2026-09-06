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
    import Profile from './src/app/profile/voice-assistant-panel';
    import Voice from './src/app/components/voice-conversation-overlay';
    import{holdForegroundAudio}from'./src/lib/speech/clap/audio-focus';
    window.holdAudio=holdForegroundAudio;
    window.cloud=false;window.opens=0;window.played=[];window.streams=[];window.processors=[];
    let listener=()=>{};
    window.voiceCompanion={open:async()=>{window.opens++;listener(true);return true;},onNotification:cb=>{window.notify=cb;return()=>{};}};
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
      return <><div hidden={open}><Profile/></div><Runtime conversationOpen={open}/><Voice open={open} compact messages={[]} busy={false} onClose={()=>setOpen(false)} onSend={()=>{}}/></>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const subscription = `export const subscriptionSelected=async()=>window.cloud;export async function connectSubscriptionVoice(options={}){window.cloudTranscript=options.onTranscript;return{setListening(){},resetTranscript(){},finishTranscript:async()=>'',stopSpeaking(){window.finishSpeech?.();},close:async()=>{},speak:text=>{window.played.push({provider:'chatgpt',text});return new Promise(r=>window.finishSpeech=r);}};}`;
  const bundle = await esbuild.build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'voice-services',setup(build){
    build.onResolve({filter:/(subscription-live|prepare-client|request-client)$/},args=>({path:args.path,namespace:'voice-stub'}));
    build.onLoad({filter:/.*/,namespace:'voice-stub'},args=>({contents:args.path.endsWith('subscription-live')?subscription:args.path.endsWith('prepare-client')?'export async function prepareLocalSpeech(){} export const speechErrorMessage=(e,f)=>e?.message||f;':'export const speechRequest=(...args)=>fetch(...args);',loader:'js'}));
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
    const context=await browser.newContext({viewport:{width:400,height:240},reducedMotion:'reduce'});
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
    const bounds=await page.locator('.voice-stage').boundingBox();assert.deepEqual([bounds.width,bounds.height],[400,240]);
    fs.mkdirSync(path.join(root,'.tmp-voice-assistant-qa'),{recursive:true});await page.screenshot({path:path.join(root,'.tmp-voice-assistant-qa','voice-widget-400x240.png')});
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
    assert.equal(await page.evaluate(()=>window.played.length),3);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
