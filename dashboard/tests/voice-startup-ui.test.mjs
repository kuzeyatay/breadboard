import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('Profile saves the voice answer model; startup never opens a mic; dictation records while service startup is pending', { timeout: 40_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef,useState} from 'react';import{createRoot}from'react-dom/client';
      import Profile from './src/app/profile/voice-assistant-panel';
      import Runtime from './src/app/components/voice-assistant-runtime';
      import Dictation from './src/app/components/speech-dictation-button';
      import {voiceRequestOptions} from './src/lib/speech/voice-request';
      import {reserveDictationStandby} from './src/lib/speech/dictation-priority';
      import {foregroundAudioActive} from './src/lib/speech/clap/audio-focus';
      window.reserveDictationStandby=reserveDictationStandby;window.foregroundAudioActive=foregroundAudioActive;window.preloads=[];
      window.voiceRequestOptions=voiceRequestOptions;window.streams=[];
      document.addEventListener('click',e=>{if(e.target.closest('[role="menuitem"]'))window.dictationClickedAt=performance.now();},true);
      navigator.mediaDevices.getUserMedia=async()=>{
        window.microphoneRequestedAt=performance.now();
        const track=new EventTarget();track.readyState='live';track.stop=()=>track.readyState='ended';
        const stream={getTracks:()=>[track]};window.streams.push(stream);return stream;
      };
      class Context{sampleRate=16000;state='running';destination={};async resume(){}async close(){this.state='closed';}
        createMediaStreamSource(){return{connect(){},disconnect(){}};}createGain(){return{gain:{value:0},connect(){},disconnect(){}};}
        createScriptProcessor(){return window.processor={connect(){},disconnect(){},onaudioprocess:null};}
      }window.AudioContext=Context;
      window.MediaRecorder=class extends EventTarget{state='inactive';mimeType='audio/webm';static isTypeSupported(){return true;}
        start(){this.state='recording';window.recorder=this;window.recordingStartedAt=performance.now();}stop(){this.state='inactive';this.dispatchEvent(new Event('stop'));}
        pause(){this.state='paused';}resume(){this.state='recording';}
      };
      window.speak=()=>{window.spokeAt=performance.now();for(let i=0;i<12;i++)window.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1600).fill(.2)}});};
      function App(){const ref=useRef(null);const[value,setValue]=useState('');return <><Profile/><Runtime/>
        <textarea aria-label="Dictated text" ref={ref} value={value} onChange={e=>setValue(e.target.value)}/>
        <Dictation value={value} onChange={setValue} textareaRef={ref}/></>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty', '.module.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'voice-startup-fixture', setup(build) {
      const stubs = {
        'use-assistant-models': "export const useAssistantModels=()=>({models:['gpt-6-sol','anthropic/claude-sonnet-4-5'],modelsLoading:false});",
        'subscription-live': 'export const subscriptionSelected=async()=>false;export const connectSubscriptionVoice=async()=>{};export const preloadSubscriptionVoice=async(...args)=>{window.preloads.push(args);};export const clearSubscriptionPreload=async()=>{};',
        'wake-listener': 'export async function listenForHeyBread(){}',
        'notification-speech': 'export async function speakNotification(){}',
      };
      build.onResolve({ filter: /.*/ }, args => {
        const key = args.path.split('/').at(-1); return key in stubs ? { path: key, namespace: 'fixture' } : null;
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  let preferences = { readAloudNotifications: false, alwaysOnVoiceAssistant: false, startVoiceOnStartup: true, voiceModel: 'default' };
  const prepares = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url.startsWith('/api/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/profile/voice-assistant') {
        if (req.method === 'PUT') preferences = JSON.parse(body);
        res.end(JSON.stringify({ userId: '1', preferences }));
      } else if (req.url === '/api/speech/settings') res.end(JSON.stringify({ userId: '1', settings: { enabled: true, speechProvider: 'local' } }));
      else if (req.url === '/api/speech/prepare') prepares.push(res);
      else if (req.url === '/api/speech/transcribe') res.end(JSON.stringify({ text: 'Immediate microphone capture' }));
      else res.end('{}');
      return;
    }
    res.setHeader('Content-Type', 'text/html');res.end('<!doctype html><html><body style="padding:30px"><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();page.setDefaultTimeout(7000);
  const errors = [];page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const startup = page.getByRole('switch', { name: 'Prepare voice on startup' });
  await page.waitForFunction(() => !document.querySelector('[aria-label="Default voice model"]').disabled);
  assert.equal(await startup.getAttribute('aria-checked'), 'true');
  await page.waitForTimeout(150);
  assert.equal(prepares.length, 1);
  assert.equal(await page.evaluate(() => window.streams.length), 0, 'startup must not request the microphone');
  await page.waitForFunction(() => window.preloads.at(-1)?.[2] === true);
  await page.evaluate(() => { window.releaseStandby = window.reserveDictationStandby(); });
  await page.waitForFunction(() => window.preloads.at(-1)?.[2] === false);
  assert.equal(await page.evaluate(() => window.foregroundAudioActive()), false, 'standby reserves one provider slot without blocking ambient audio');
  assert.equal(await page.evaluate(() => window.streams.length), 0);
  await page.evaluate(() => window.releaseStandby());
  await page.waitForFunction(() => window.preloads.at(-1)?.[2] === true);
  await page.getByRole('combobox', { name: 'Default voice model' }).selectOption('anthropic/claude-sonnet-4-5');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Default voice model"]').disabled);
  assert.equal(preferences.voiceModel, 'anthropic/claude-sonnet-4-5');
  assert.deepEqual(await page.evaluate(() => window.voiceRequestOptions()), { model: preferences.voiceModel, voice: true },
    'the voice default selects the answering model without overriding its reasoning effort');
  await page.getByRole('button', { name: 'Voice options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Dictate live', exact: false }).click();
  await page.waitForFunction(() => window.recorder?.state === 'recording');
  assert.equal(prepares.every(response => !response.writableEnded), true, 'recording must start before preparation completes');
  const capture = await page.evaluate(() => ({ microphoneMs: window.microphoneRequestedAt - window.dictationClickedAt, recordingMs: window.recordingStartedAt - window.dictationClickedAt }));
  assert.ok(capture.microphoneMs >= 0 && capture.recordingMs < 500, 'capture must not wait for service readiness');
  await page.evaluate(() => window.speak());
  await page.waitForFunction(() => document.querySelector('textarea').value === 'Immediate microphone capture');
  const partialMs = await page.evaluate(() => performance.now() - window.spokeAt);
  assert.ok(partialMs < 2000, 'live dictation must poll promptly after captured speech');
  t.diagnostic(`Browser with simulated microphone/provider: mic requested ${capture.microphoneMs.toFixed(1)} ms, recording ${capture.recordingMs.toFixed(1)} ms after click, first partial ${partialMs.toFixed(1)} ms; preparation still pending.`);
  await page.evaluate(() => window.recorder.stop());
  await page.waitForFunction(() => window.streams.every(s => s.getTracks()[0].readyState === 'ended'));
  await startup.click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Default voice model"]').disabled);
  assert.equal(preferences.startVoiceOnStartup, false);
  prepares.forEach(response => response.end('{"ready":true}'));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Default voice model"]').disabled);
  assert.equal(await startup.getAttribute('aria-checked'), 'false');
  assert.equal(await page.getByRole('combobox', { name: 'Default voice model' }).inputValue(), preferences.voiceModel);
  assert.deepEqual(errors, []);
});
