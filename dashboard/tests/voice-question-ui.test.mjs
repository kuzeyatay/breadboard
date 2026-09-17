import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('voice companion speaks tool questions, hears their answers and narrates the continued response', { timeout: 60000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import VoicePage from './src/app/voice/page';
      window.played=[]; window.sent=[]; window.answers=[]; window.processors=[]; window.streams=[];
      window.closedVoice=0;
      window.voiceCompanion={state:async()=>true,close:async()=>{window.closedVoice++;},onOpen:callback=>{window.openVoice=()=>callback(true);return()=>{};}};
      window.cloud=new URLSearchParams(location.search).has('cloud');
      navigator.mediaDevices.getUserMedia=async()=>{
        const track=new EventTarget();track.readyState='live';track.stop=()=>track.readyState='ended';
        const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};window.streams.push(stream);return stream;
      };
      class Context {sampleRate=16000;state='running';destination={};
        async resume(){}async close(){this.state='closed';}
        createMediaStreamSource(){return{connect(){},disconnect(){}};}
        createGain(){return{gain:{value:0},connect(){},disconnect(){}};}
        createScriptProcessor(){const p={connect(){},disconnect(){},onaudioprocess:null};window.processors.push(p);return p;}
      }window.AudioContext=Context;
      window.Audio=class extends EventTarget {
        constructor(url){super();this.src=url;}
        async play(){const text=await fetch(this.src).then(r=>r.text());window.played.push(text);window.finishSpeech=()=>this.dispatchEvent(new Event('ended'));}
        pause(){}load(){}removeAttribute(){}
      };
      window.say=text=>{
        window.nextTranscript=text;window.partial?.(text);
        const p=window.processors.find(p=>p.onaudioprocess);if(!p)throw Error('No microphone');
        for(const level of [.2,.2,.2,...Array(16).fill(.001)])p.onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(level)}});
      };
      createRoot(document.getElementById('root')).render(<VoicePage/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'voice-fixtures', setup(build) {
      build.onResolve({ filter: /(use-agent-session|use-assistant-intelligence|chat-notification-inbox|voice-assistant-runtime|subscription-live|prepare-client|request-client)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: modulePath }) => {
        let contents;
        if (modulePath.endsWith('use-agent-session')) contents = `
          import {useState} from 'react';
          export const isActiveAgentRunState=state=>state==='running'||state==='waiting_for_permission';
          export function useAgentSession(){
            const [state,setState]=useState({messages:[],runState:'idle',sessionId:'voice-test',loadingSession:false});
            window.updateSession=patch=>setState(current=>({...current,...patch}));
            window.complete=text=>setState(current=>({...current,runState:'completed',messages:current.messages.map(m=>m.role==='assistant'?{...m,content:text}:m)}));
            return {...state,send:async text=>{
              window.sent.push(text);
              if(state.pendingClarification){
                window.answers.push({requestId:state.pendingClarification.requestId,text});
                setState(current=>({...current,pendingClarification:null,runState:'running',messages:[...current.messages,{role:'user',content:text,clientMessageId:'clarify:'+state.pendingClarification.requestId}]}));
              }else setState(current=>({...current,runState:'running',messages:[...current.messages,{role:'user',content:text},{role:'assistant',content:''}]}));
            }};
          }`;
        else if (modulePath.endsWith('subscription-live')) contents = `
          export const subscriptionSelected=async()=>window.cloud;
          export async function connectSubscriptionVoice(options={}){
            window.partial=options.onTranscript;
            return {setListening(value){window.cloudListening=value;},resetTranscript(){},finishTranscript:async()=>window.nextTranscript,
              stopSpeaking(){window.finishSpeech?.();},close:async()=>{},speak:text=>{window.played.push(text);return new Promise(resolve=>window.finishSpeech=resolve);}};
          }`;
        else if (modulePath.endsWith('prepare-client')) contents = 'export async function prepareLocalSpeech(){} export const speechErrorMessage=(e,f)=>e?.message||f;';
        else if (modulePath.endsWith('request-client')) contents = `export async function speechRequest(url,options){
          if(url.endsWith('/transcribe'))return Response.json({text:window.nextTranscript});
          if(window.failSpeech)throw Error('Speech is temporarily unavailable');
          return new Response(JSON.parse(options.body).text);
        }`;
        else if (modulePath.endsWith('use-assistant-intelligence')) contents = 'export const useAssistantIntelligence=()=>({model:"fixture",reasoningEffort:"low"});';
        else if (modulePath.endsWith('voice-assistant-runtime')) contents = 'export default function Runtime(){return null;}';
        else contents = 'export function setActiveChatNotificationTarget(){}';
        return { contents, loader: 'js', resolveDir: root };
      });
    } }],
  });
  const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.slice(css.indexOf('.voice-stage {'))); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}button{font:inherit}p{margin:0}</style></head><body><main id="root"></main><script src="/app.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const artifacts = path.join(root, '.tmp-voice-question-qa'); fs.mkdirSync(artifacts, { recursive: true });
  try {
    for (const cloud of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 800, height: 480 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/voice${cloud ? '?cloud' : ''}`);
      await page.waitForFunction(() => window.played.length === 1);
      await page.evaluate(() => window.finishSpeech());
      await page.getByRole('button', { name: 'Pause listening' }).waitFor();
      assert.equal(await page.locator('.voice-widget-name,.voice-widget-hint').count(), 0);
      await page.evaluate(() => window.say('I want help with fitness.'));
      await page.waitForFunction(() => window.sent.length === 1);
      const transcript = page.getByRole('log', { name: 'Conversation transcript' });
      assert.equal(await transcript.innerText(), 'I want help with fitness.');
      const question = 'What do you want help with first?';
      await page.evaluate(question => window.updateSession({ pendingClarification: { requestId: 'question-1', question }, runState: 'waiting_for_permission' }), question);
      await page.waitForFunction(question => window.played.includes(question), question);
      assert.equal(await page.locator('.voice-stage').getAttribute('data-stage'), 'speaking');
      assert.deepEqual(await transcript.locator('.voice-widget-message').allTextContents(), ['I want help with fitness.', question]);
      assert.equal(await page.getByText('Tap the ring to answer aloud.', { exact: true }).count(), 0);
      await page.screenshot({ path: path.join(artifacts, `question-${cloud ? 'cloud' : 'local'}.png`) });
      // A refreshed tool object with the same id must not replay the question.
      await page.evaluate(question => window.updateSession({ pendingClarification: { requestId: 'question-1', question } }), question);
      await page.evaluate(() => window.finishSpeech());
      await page.getByRole('button', { name: 'Pause listening' }).waitFor();
      assert.equal(await page.evaluate(question => window.played.filter(text => text === question).length, question), 1);
      if (cloud) {
        assert.equal(await page.evaluate(() => window.cloudListening), true);
        await page.evaluate(() => window.partial('Build me a workout'));
        await page.getByText('Build me a workout', { exact: true }).waitFor();
      }
      await page.evaluate(() => window.say('Build me a workout plan.'));
      await page.waitForFunction(() => window.answers.length === 1);
      assert.deepEqual(await page.evaluate(() => window.answers), [{ requestId: 'question-1', text: 'Build me a workout plan.' }]);
      const answer = 'Start with three full-body sessions a week.\nLeave a rest day between sessions.';
      await page.evaluate(answer => window.complete(answer), answer);
      await page.waitForFunction(() => window.played.length === 3);
      assert.match(await transcript.innerText(), /Build me a workout plan\./);
      assert.match(await transcript.innerText(), /Start with three full-body sessions/);
      assert.deepEqual(await transcript.locator('.voice-widget-message p').allTextContents(), [
        'I want help with fitness.', question, 'Build me a workout plan.', answer,
      ]);
      await page.evaluate(() => window.finishSpeech());
      await page.getByRole('button', { name: 'Pause listening' }).waitFor();
      await page.screenshot({ path: path.join(artifacts, `answer-${cloud ? 'cloud' : 'local'}.png`) });
      if (!cloud) {
        // A failed question readout keeps its text and returns to listening.
        await page.evaluate(() => {
          window.failSpeech = true;
          window.updateSession({ pendingClarification: { requestId: 'question-2', question: 'What equipment do you have?' }, runState: 'waiting_for_permission' });
        });
        await page.getByText('Speech is temporarily unavailable', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Pause listening' }).waitFor();
        await page.getByText('What equipment do you have?', { exact: true }).waitFor();
        await page.evaluate(() => { window.failSpeech = false; window.say('Dumbbells.'); });
        await page.waitForFunction(() => window.answers.length === 2);
        assert.equal(await page.evaluate(() => window.answers[1].requestId), 'question-2');
        await page.evaluate(() => window.complete('Use dumbbells for squats and rows.'));
        await page.waitForFunction(() => window.played.length === 4);
        await page.evaluate(() => window.finishSpeech());
        await page.getByRole('button', { name: 'Pause listening' }).waitFor();
      }
      // Long responses stay scrollable inside the window at both sizes.
      await page.evaluate(() => window.complete('A detailed plan. '.repeat(250)));
      assert.equal(await transcript.evaluate(node => node.scrollHeight > node.clientHeight), true);
      await page.setViewportSize({ width: 400, height: 300 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(artifacts, `small-${cloud ? 'cloud' : 'local'}.png`) });

      // The exact spoken close request from the reported bug must wait for
      // the farewell audio, then close the native companion and microphone.
      const sentBeforeGoodbye = await page.evaluate(() => window.sent.length);
      await page.evaluate(() => window.say('[sigh] You can close yourself now'));
      await page.waitForFunction(count => window.sent.length === count + 1, sentBeforeGoodbye);
      await page.evaluate(() => window.complete('Goodbye, Kuzey.'));
      await page.waitForFunction(() => window.played.at(-1) === 'Goodbye, Kuzey.');
      assert.equal(await page.evaluate(() => window.closedVoice), 0, 'do not cut off the farewell');
      await page.evaluate(() => window.finishSpeech());
      await page.waitForFunction(() => window.closedVoice === 1);
      await page.getByRole('dialog', { name: 'Voice conversation' }).waitFor({ state: 'detached' });
      await page.waitForFunction(() => window.streams.every(stream => stream.getTracks()[0].readyState === 'ended'));

      // Reopening starts a fresh conversation. Interrupting a farewell cancels
      // its pending close, so old completion callbacks cannot close a new turn.
      await page.evaluate(() => window.openVoice());
      await page.waitForFunction(() => window.played.at(-1) !== 'Goodbye, Kuzey.');
      await page.evaluate(() => window.finishSpeech());
      await page.getByRole('button', { name: 'Pause listening' }).waitFor();
      await page.evaluate(() => window.say('Goodbye.'));
      await page.waitForFunction(count => window.sent.length === count + 2, sentBeforeGoodbye);
      await page.evaluate(() => window.complete('See you later.'));
      await page.waitForFunction(() => window.played.at(-1) === 'See you later.');
      await page.getByRole('button', { name: 'Interrupt and speak' }).click();
      await page.getByRole('button', { name: 'Pause listening' }).waitFor();
      await page.evaluate(() => window.finishSpeech());
      assert.equal(await page.evaluate(() => window.closedVoice), 1);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.streams.every(stream => stream.getTracks()[0].readyState === 'ended'));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
