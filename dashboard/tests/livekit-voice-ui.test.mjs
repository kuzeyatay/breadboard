import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('continuous voice interrupts greetings and streamed replies for local and subscription providers', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState} from 'react'; import{createRoot}from'react-dom/client';
      import Voice from './src/app/components/voice-conversation-overlay';
      window.cloud=location.search.includes('cloud');window.greet=location.search.includes('greet');
      window.preparations=0;window.cues=[];window.played=[];window.sent=[];window.stops=0;window.detectorCloses=0;window.frames=0;
      window.transcript='Explain the first question';window.tracks=[];
      window.Audio=class extends EventTarget {
        currentTime=0;duration=10;
        constructor(url){super();this.src=url;}
        async play(){window.played.push(await fetch(this.src).then(r=>r.text()));window.finishAudio=()=>this.dispatchEvent(new Event('ended'));}
        pause(){window.playbackStoppedAt=performance.now();} removeAttribute(){} load(){}
      };
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
        const track={readyState:'live',stop(){this.readyState='ended';}};window.tracks.push(track);return{getTracks:()=>[track]};
      }}});
      window.AudioContext=class{
        sampleRate=48000;state='running';destination={};
        createMediaStreamSource(){return{connect(){},disconnect(){}};}
        createGain(){return{gain:{value:0},connect(){},disconnect(){}};}
        createScriptProcessor(){return window.processor={connect(){},disconnect(){}};}
        async close(){this.state='closed';}async resume(){}
      };
      window.frame=(level=0.1)=>window.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(2048).fill(level)}});
      window.say=()=>{window.detect('speech-start');for(let i=0;i<8;i++)window.frame();window.detect('speech-end');};
      function App(){
        const[open,setOpen]=useState(true),[busy,setBusy]=useState(false),[messages,setMessages]=useState([]);
        window.answer=(text,done=false)=>{setMessages(m=>[...m.slice(0,-1),{role:'assistant',content:text}]);setBusy(!done);};
        return <Voice open={open} greetOnOpen={window.greet} messages={messages} busy={busy}
          onClose={()=>setOpen(false)} onInterrupt={()=>{window.stops++;setBusy(false);}}
          onSend={text=>{window.sent.push(text);setMessages(m=>[...m,{role:'user',content:text},{role:'assistant',content:''}]);setBusy(true);}}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser',
    loader: { '.css': 'empty', '.module.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'voice-fixture', setup(build) {
      const stubs = {
        'voice-cues': `export const playVoiceCue=cue=>window.cues.push(cue);`,
        'voice-response': `export default function VoiceResponse(){return null;}`,
        'clap/audio-focus': `export const requestForegroundMicrophone=()=>navigator.mediaDevices.getUserMedia();export const stopForegroundStream=s=>s?.getTracks().forEach(t=>t.stop());export const holdForegroundAudio=()=>()=>{};`,
        'clap-wake': `export const holdClapWake=()=>()=>{};`,
        'prepare-client': `export async function prepareLocalSpeech(){};export const speechErrorMessage=(e,f)=>e?.message||f;`,
        'request-client': `export async function speechRequest(url,options){
          if(!url.endsWith('/transcribe'))return new Response(JSON.parse(options.body).text);
          (window.recordedSizes??=[]).push(options.body.get('file').size);
          if(window.delayTranscript)return new Promise(resolve=>window.releaseTranscript=()=>resolve(Response.json({text:'Stale incomplete thought'})));
          return Response.json({text:window.transcript});
        }`,
        'livekit-turn-client': `export async function connectLiveKitTurnDetector(options){
          if(location.search.includes('delay-detector'))await new Promise(resolve=>window.releaseDetector=resolve);
          let ready=true;window.recoverDetector=()=>{ready=true;options.onReady?.();};window.failDetector=()=>{ready=false;options.onError(new Error('Delayed inference'));};
          let closed=false;window.detect=type=>{if(!closed)options.onEvent({type,sample:1024});};
          return{get ready(){return ready;},push(){window.frames++;},close(){if(!closed)window.detectorCloses++;closed=true;}};
        }`,
        'subscription-live': `export const subscriptionSelected=async()=>window.cloud;export async function connectSubscriptionVoice(){let finish;return{
          isHealthy:()=>true,setDuplex:v=>window.duplex=v,setListening:v=>window.listening=v,resetTranscript(){},
          prepareSpeaker:async()=>{window.preparations++;},close:async()=>{},finishTranscript:async()=>window.transcript,
          stopSpeaking(){window.playbackStoppedAt=performance.now();finish?.();},speak(text){if(!window.duplex)window.listening=false;window.played.push(text);return new Promise(resolve=>{finish=resolve;window.finishAudio=resolve;});}
        };}`,
      };
      build.onResolve({filter:/.*/},args=>{
        const key=args.path.includes('/clap/audio-focus')?'clap/audio-focus':args.path.split('/').at(-1);
        return key in stubs?{path:key,namespace:'voice-fixture'}:null;
      });
      build.onLoad({filter:/.*/,namespace:'voice-fixture'},args=>({contents:stubs[args.path],loader:'js'}));
    } }],
  });
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>fs.existsSync(p));
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    for(const provider of ['local','cloud']) {
      const cold=await browser.newPage();cold.setDefaultTimeout(6000);
      await cold.goto(`http://127.0.0.1:${server.address().port}/?${provider}&delay-detector`);
      await cold.locator('.voice-stage[data-stage="listening"]').waitFor();
      assert.equal(await cold.evaluate(()=>typeof window.detect),'undefined','voice must listen while native detection loads');
      await cold.evaluate(()=>{for(let i=0;i<30;i++)window.frame();window.releaseDetector();});
      await cold.waitForFunction(()=>typeof window.detect==='function');
      await cold.evaluate(()=>{window.detect('speech-start');window.frame();window.detect('speech-end');});
      await cold.waitForFunction(()=>window.sent.length===1);
      if(provider==='local') assert.ok(await cold.evaluate(()=>window.recordedSizes[0])>40000,'late detector must preserve words captured before it was ready (resampled to 16 kHz)');
      await cold.getByRole('button',{name:'Close voice mode',exact:true}).click();
      await cold.close();

      const abandoned=await browser.newPage();abandoned.setDefaultTimeout(6000);
      await abandoned.goto(`http://127.0.0.1:${server.address().port}/?${provider}&delay-detector`);
      await abandoned.locator('.voice-stage[data-stage="listening"]').waitFor();
      await abandoned.getByRole('button',{name:'Close voice mode',exact:true}).click();
      await abandoned.evaluate(()=>window.releaseDetector());
      await abandoned.waitForFunction(()=>window.detectorCloses===1);
      assert.equal(await abandoned.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
      await abandoned.close();

      const page=await browser.newPage();page.setDefaultTimeout(6000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?${provider}`);
      await page.locator('.voice-stage[data-stage="listening"]').waitFor();
      assert.deepEqual(await page.evaluate(()=>window.cues),['open','enable']);
      if(provider==='cloud') assert.ok(await page.evaluate(()=>window.preparations)>0,'the muted reader prepares before the first question');
      await page.evaluate(()=>window.say());
      await page.waitForFunction(()=>window.sent.length===1);
      await page.evaluate(()=>window.answer('Here is the first complete sentence to speak. The rest is still'));
      await page.waitForFunction(()=>window.played.length===1);
      if(provider==='cloud') assert.equal(await page.evaluate(()=>window.listening),true);
      const interruptionMs=await page.evaluate(()=>{
        window.oldFinish=window.finishAudio;window.frame();const start=performance.now();window.detect('speech-start');
        return window.playbackStoppedAt-start;
      });
      assert.ok(interruptionMs>=0 && interruptionMs<100, 'confirmed speech must stop playback synchronously');
      t.diagnostic(`${provider} browser: playback stopped ${interruptionMs.toFixed(1)} ms after simulated LiveKit speech-start.`);
      await page.locator('.voice-stage[data-stage="listening"]').waitFor();
      await page.waitForFunction(()=>window.stops===1);
      assert.ok(await page.evaluate(()=>window.frames)>0,'mic keeps feeding LiveKit during playback');
      await page.evaluate(()=>{window.transcript='Actually explain the second question';window.frame();window.detect('speech-end');});
      await page.waitForFunction(()=>window.sent.length===2);
      assert.equal(await page.evaluate(()=>window.sent[1]),'Actually explain the second question');
      await page.evaluate(()=>window.oldFinish());
      await page.waitForTimeout(50);
      assert.equal(await page.locator('.voice-stage').getAttribute('data-stage'),'thinking','late completion cannot reclaim the next turn');
      await page.getByRole('button',{name:'Close voice mode',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.detectorCloses),1);
      assert.equal(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')),true);
      assert.deepEqual(errors,[]);
      await page.close();

      const fallback=await browser.newPage();fallback.setDefaultTimeout(6000);
      await fallback.goto(`http://127.0.0.1:${server.address().port}/?${provider}`);
      await fallback.locator('.voice-stage[data-stage="listening"]').waitFor();
      await fallback.evaluate(()=>window.say()); await fallback.waitForFunction(()=>window.sent.length===1);
      await fallback.evaluate(()=>window.answer('This is an answer which can be interrupted.',true));
      await fallback.waitForFunction(()=>window.played.length===1);
      await fallback.evaluate(()=>{window.failDetector();window.frame();window.frame(0);});
      assert.equal(await fallback.locator('.voice-stage').getAttribute('data-stage'),'speaking','a click cannot interrupt');
      await fallback.evaluate(()=>{for(let i=0;i<8;i++)window.frame();});
      await fallback.locator('.voice-stage[data-stage="listening"]').waitFor();
      await fallback.waitForFunction(()=>window.stops===1);
      if(provider==='cloud') assert.equal(await fallback.evaluate(()=>window.listening),true);
      t.diagnostic(`${provider}: acoustic fallback interrupted after 341 ms of sustained simulated speech, preserving pre-roll.`);
      await fallback.evaluate(()=>{window.transcript='Actually, I meant the other one';for(let i=0;i<27;i++)window.frame(0.001);});
      await fallback.waitForFunction(()=>window.sent.length===2);
      assert.equal(await fallback.evaluate(()=>window.sent[1]),'Actually, I meant the other one');
      await fallback.getByRole('button',{name:'Stop waiting for the answer',exact:true}).click();
      await fallback.getByRole('button',{name:'Pause listening',exact:true}).click();
      await fallback.getByRole('button',{name:'Start listening',exact:true}).click();
      await fallback.getByRole('button',{name:'Close voice mode',exact:true}).click();
      const cues=await fallback.evaluate(()=>window.cues);
      assert.deepEqual(cues.slice(0,2),['open','enable']);
      assert.deepEqual(cues.slice(-3),['stop','enable','close']);
      assert.ok(cues.filter(c=>c==='stop').length>=3);
      await fallback.close();

      const handoff=await browser.newPage();handoff.setDefaultTimeout(6000);
      await handoff.goto(`http://127.0.0.1:${server.address().port}/?${provider}`);
      await handoff.locator('.voice-stage[data-stage="listening"]').waitFor();
      await handoff.evaluate(()=>{
        window.detect('speech-start');for(let i=0;i<8;i++)window.frame();
        window.failDetector();window.recoverDetector();
        // The fresh detector has never heard this utterance. Silence must
        // still send it; waiting for a nonexistent speech-end loses the turn.
        for(let i=0;i<27;i++)window.frame(0.001);
      });
      await handoff.waitForFunction(()=>window.sent.length===1);
      assert.equal(await handoff.evaluate(()=>window.sent[0]),'Explain the first question');
      await handoff.getByRole('button',{name:'Close voice mode',exact:true}).click();
      await handoff.close();

      const greeting=await browser.newPage();greeting.setDefaultTimeout(6000);
      await greeting.goto(`http://127.0.0.1:${server.address().port}/?${provider}&greet`);
      await greeting.waitForFunction(()=>window.played.length===1);
      await greeting.evaluate(()=>{window.detect('speech-start');window.frame();});
      await greeting.locator('.voice-stage[data-stage="listening"]').waitFor();
      await greeting.evaluate(()=>window.detect('speech-end'));
      await greeting.waitForFunction(()=>window.sent.length===1);
      await greeting.getByRole('button',{name:'Close voice mode',exact:true}).click();
      await greeting.close();
    }
    const continued=await browser.newPage();continued.setDefaultTimeout(6000);
    await continued.goto(`http://127.0.0.1:${server.address().port}/?local`);
    await continued.locator('.voice-stage[data-stage="listening"]').waitFor();
    await continued.evaluate(()=>{window.delayTranscript=true;window.say();});
    await continued.locator('.voice-stage[data-stage="transcribing"]').waitFor();
    await continued.evaluate(()=>{window.delayTranscript=false;window.transcript='The complete thought with its continuation';window.say();});
    await continued.waitForFunction(()=>window.sent.length===1);
    await continued.evaluate(()=>window.releaseTranscript());
    await continued.waitForTimeout(50);
    assert.deepEqual(await continued.evaluate(()=>window.sent),['The complete thought with its continuation']);
    assert.equal(await continued.evaluate(()=>window.recordedSizes[1]>window.recordedSizes[0]),true,'the resumed transcription contains both clips');
    assert.equal(await continued.evaluate(()=>window.stops),0,'continuing a thought never cancels unrelated model work');
    await continued.getByRole('button',{name:'Close voice mode',exact:true}).click();
    await continued.close();
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
});
