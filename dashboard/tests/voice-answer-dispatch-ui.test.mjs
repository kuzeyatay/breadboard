import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('spoken question answers use the current handler and require a matching chat receipt', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState} from 'react';import{createRoot}from'react-dom/client';
      import Voice from './src/app/components/voice-conversation-overlay';
      window.played=[];window.attempts=[];window.received=[];window.processors=[];
      window.cloud=location.search.includes('cloud');
      navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}]});
      class Context {sampleRate=16000;state='running';destination={};
        async resume(){}async close(){this.state='closed';}
        createMediaStreamSource(){return{connect(){},disconnect(){}};}
        createGain(){return{gain:{value:0},connect(){},disconnect(){}};}
        createScriptProcessor(){const p={connect(){},disconnect(){},onaudioprocess:null};window.processors.push(p);return p;}
      }window.AudioContext=Context;
      window.Audio=class extends EventTarget {
        constructor(url){super();this.src=url;}
        async play(){window.played.push(await fetch(this.src).then(r=>r.text()));window.finishSpeech=()=>this.dispatchEvent(new Event('ended'));}
        pause(){}load(){}removeAttribute(){}
      };
      window.say=text=>{
        window.nextTranscript=text;
        const p=window.processors.find(p=>p.onaudioprocess);
        for(const level of [.2,.2,.2,...Array(16).fill(.001)])p.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(level)}});
      };
      function App(){
        const [question,setQuestion]=useState(null),[busy,setBusy]=useState(true);
        const [messages,setMessages]=useState([{role:'user',content:'Research this and send it to my phone.'},{role:'assistant',content:''}]);
        window.ask=id=>{setQuestion({requestId:id,question:'Telegram or WhatsApp?'});setBusy(true);};
        window.noise=()=>setMessages(m=>m.map(row=>row.role==='assistant'?{...row,progressNotes:['Waiting for the destination.']}:row));
        window.complete=(text='Sent to Telegram.')=>{setBusy(false);setMessages(m=>m.map(row=>row.role==='assistant'?{...row,content:text}:row));};
        return <Voice open compact onClose={()=>{}} messages={messages} busy={busy} clarification={question} onSend={text=>{
          window.attempts.push({text,questionId:question?.requestId});
          if(!question)return;
          if(window.rejectAnswer)return Promise.reject(Error('Runtime unavailable'));
          if(window.dropAnswer)return;
          window.deliver=()=>{
            window.received.push({text,questionId:question.requestId});
            setQuestion(null);
            setMessages(m=>[...m,{role:'user',content:text,clientMessageId:'clarify:'+question.requestId}]);
          };
          if(!window.delayAnswer)window.deliver();
        }}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    loader: { '.css': 'empty', '.module.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'speech-fixtures', setup(build) {
      const stubs = {
        'audio-focus': 'export const requestForegroundMicrophone=()=>navigator.mediaDevices.getUserMedia();export const stopForegroundStream=s=>s.getTracks().forEach(t=>t.stop());export const holdForegroundAudio=()=>()=>{};',
        'clap-wake': 'export const holdClapWake=()=>()=>{};',
        'prepare-client': 'export async function prepareLocalSpeech(){}export const speechErrorMessage=(e,f)=>e?.message||f;',
        'request-client': `export async function speechRequest(url,options){return url.endsWith('/transcribe')?Response.json({text:window.nextTranscript}):new Response(JSON.parse(options.body).text);}`,
        'subscription-live': `export const subscriptionSelected=async()=>window.cloud;
          export async function connectSubscriptionVoice(){return{setListening(){},resetTranscript(){},finishTranscript:async()=>window.nextTranscript,
          stopSpeaking(){window.finishSpeech?.();},close:async()=>{},speak:text=>{window.played.push(text);return new Promise(resolve=>window.finishSpeech=resolve);}};}`,
      };
      build.onResolve({ filter: /.*/ }, args => {
        const key=args.path.split('/').at(-1);
        return key in stubs?{path:key,namespace:'fixture'}:null;
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  for(const provider of ['local','cloud']){
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${server.address().port}/?${provider}`);
    const stage=value=>page.locator('.voice-stage[data-stage="'+value+'"]').waitFor();
    const ask=async id=>{
      const count=await page.evaluate(()=>window.played.length);
      await page.evaluate(id=>window.ask(id),id);
      await page.waitForFunction(count=>window.played.length>count,count);
      await page.evaluate(()=>window.finishSpeech());await stage('listening');
    };
    await stage('listening');
    await ask('destination-1');
    await page.evaluate(()=>window.say('Telegram'));
    await page.waitForFunction(()=>window.received.length===1);
    assert.deepEqual(await page.evaluate(()=>window.received),[{text:'Telegram',questionId:'destination-1'}]);
    await page.clock.fastForward(21_000);
    await stage('thinking');
    assert.equal(await page.getByText('The chat has not confirmed your answer. Please try again.',{exact:true}).count(),0);
    await page.evaluate(()=>window.complete());await stage('speaking');
    await page.waitForFunction(()=>window.played.at(-1)==='Sent to Telegram.');
    await page.evaluate(()=>window.finishSpeech());await stage('listening');

    // A lost answer must not be acknowledged by an already-busy run, repeated
    // question snapshots, old answers with the same text, or progress updates.
    await ask('destination-2');
    await page.evaluate(()=>{window.dropAnswer=true;window.say('Telegram');});
    await page.waitForFunction(()=>window.attempts.length===2);
    await stage('thinking');
    await page.evaluate(()=>{window.noise();window.ask('destination-2');});
    await page.clock.fastForward(21_000);
    await stage('listening');
    await page.getByText('The chat has not confirmed your answer. Please try again.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.received.length),1);

    // Rejections also release the microphone for retry, with the question intact.
    await page.evaluate(()=>{window.dropAnswer=false;window.rejectAnswer=true;window.say('Telegram');});
    await page.waitForFunction(()=>window.attempts.length===3);
    await stage('listening');
    await page.getByText('The chat has not confirmed your answer. Please try again.',{exact:true}).waitFor();

    // An ordinary delayed receipt still resumes the same assistant response.
    await page.evaluate(()=>{window.rejectAnswer=false;window.delayAnswer=true;window.say('Telegram');});
    await page.waitForFunction(()=>window.attempts.length===4);
    await page.clock.fastForward(5_000);
    await page.evaluate(()=>window.deliver());
    await page.waitForFunction(()=>window.received.length===2);
    await page.clock.fastForward(21_000);await stage('thinking');
    await page.evaluate(()=>window.complete('Sent to Telegram. The follow-up is sent too.'));await stage('speaking');
    await page.evaluate(()=>window.finishSpeech());await stage('listening');
    assert.deepEqual(errors,[]);
    await page.close();
  }
});
