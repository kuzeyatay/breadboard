import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('voice mode speaks thinking updates, queues answers, and cancels late audio for both providers', { timeout: 45_000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import Voice from './src/app/components/voice-conversation-overlay';
      window.played = []; window.synthesized = []; window.sent = [];
      window.cloud = location.search.includes('cloud');
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({}) }, configurable: true });
      class Context {
        sampleRate = 48000; state = 'running'; destination = {};
        createMediaStreamSource() { return {connect(){},disconnect(){}}; }
        createGain() { return {gain:{value:0},connect(){},disconnect(){}}; }
        createScriptProcessor() { return window.processor = {connect(){},disconnect(){},onaudioprocess:null}; }
        async close() {} async resume() {}
      }
      window.AudioContext = Context;
      window.say = () => {
        for (const [level, frames] of [[0.2, 5], [0.001, 24]]) {
          for (let i=0;i<frames;i++) window.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4800).fill(level)}});
        }
      };
      function App() {
        const [open, setOpen] = useState(true), [busy, setBusy] = useState(false);
        const [messages, setMessages] = useState([{role:'user',content:'Earlier question'}, {role:'assistant',content:'Earlier answer',progressNotes:['Old progress']}]);
        window.updateAnswer = (content, progressNotes, busy = true) => {
          setMessages(messages => [...messages.slice(0,-1), {role:'assistant',content,progressNotes}]); setBusy(busy);
        };
        window.reopen = () => setOpen(true);
        return <Voice open={open} onClose={()=>setOpen(false)} messages={messages} busy={busy} onSend={text=>{
          window.sent.push(text); setMessages(messages=>[...messages,{role:'user',content:text},{role:'assistant',content:''}]);setBusy(true);
        }}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'voice-fixture', setup(build) {
      const stubs = {
        '@/lib/speech/clap/audio-focus': 'export const requestForegroundMicrophone = () => navigator.mediaDevices.getUserMedia(); export function stopForegroundStream() {}',
        '@/lib/speech/clap-wake': 'export const holdClapWake = () => () => {};',
        '@/lib/desktop-browser-tabs': 'export const desktopTabsBridge = () => null;',
        '@/lib/speech/microphone-access': 'export const describeMicrophoneBlock = () => null;',
        '@/lib/speech/prepare-client': 'export async function prepareLocalSpeech() {} export const speechErrorMessage = (error, fallback) => error?.message || fallback;',
        '@/lib/speech/voice-greeting': 'export const VOICE_GREETING = "Hello"; export async function speakVoiceGreeting() {}',
        '@/lib/speech/request-client': `export async function speechRequest(url, options) {
          if (url.endsWith('/transcribe')) return Response.json({text:'Find my fitness chats'});
          const text = JSON.parse(options.body).text; window.synthesized.push(text);
          if (window.delaySynthesis) await new Promise(resolve=>window.releaseSynthesis=resolve);
          return new Response(text);
        }`,
        '@/lib/speech/playback': `let finished;
          export function stopSpeechPlayback() { const callback=finished;finished=null;callback?.(); }
          export async function playSpeechBlob(blob, callback) {
            window.played.push(await blob.text()); finished=callback;
            window.completeSpeech=()=>{const callback=finished;finished=null;callback?.();};
          }`,
        '@/lib/speech/subscription-live': `export const subscriptionSelected = async () => window.cloud;
          export async function connectSubscriptionVoice() {
            let finish;
            return {resetTranscript(){},setListening(value){window.cloudListening=value;},
              finishTranscript:async()=>'Find my fitness chats', close:async()=>{finish?.();},
              stopSpeaking(){finish?.();},
              speak(text){window.cloudListening=false;window.played.push(text);return new Promise(resolve=>{finish=resolve;window.completeSpeech=resolve;});}
            };
          }`,
      };
      build.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'voice-stub' } : null);
      build.onLoad({ filter: /.*/, namespace: 'voice-stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? bundle.outputFiles[0].text : '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
  ].find(candidate => fs.existsSync(candidate));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const provider of ['local', 'cloud']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?${provider}`);
      const stage = state => page.locator(`.voice-stage[data-stage="${state}"]`).waitFor();
      const played = count => page.waitForFunction(count => window.played.length === count, count);
      await stage('listening');
      await page.evaluate(() => window.say());
      await stage('thinking');
      const first = 'Searching your recent chats for “fitness journey.”';
      const second = 'No exact match. Trying the likely gym, fat-loss, and nutrition terms.';
      await page.evaluate(first => window.updateAnswer('', [first]), first);
      await played(1);
      await stage('speaking');
      assert.equal(await page.locator('.voice-caption-text').textContent(), first);
      await page.evaluate(({ first, second }) => window.updateAnswer('Partial answer', [first, second]), { first, second });
      await page.evaluate(() => window.completeSpeech());
      await played(2);
      await page.evaluate(() => window.completeSpeech());
      await stage('thinking');
      if (provider === 'cloud') assert.equal(await page.evaluate(() => window.cloudListening), false);
      await page.evaluate(({ first, second }) => window.updateAnswer('Here are your fitness chats.', [first, second], false), { first, second });
      await played(3);
      await page.evaluate(() => window.completeSpeech());
      await stage('listening');
      assert.deepEqual(await page.evaluate(() => window.played), [first, second, 'Here are your fitness chats.']);
      assert.equal(await page.locator('.voice-caption-text').textContent(), 'Here are your fitness chats.');
      await page.getByRole('button', { name: 'Pause listening', exact: true }).click();
      await stage('paused');
      assert.equal(await page.locator('.voice-caption-text').textContent(), 'Here are your fitness chats.');
      await page.getByRole('button', { name: 'Start listening', exact: true }).click();
      await stage('listening');

      // Interrupt while a progress message is playing and the answer is queued.
      await page.evaluate(() => window.say());
      await stage('thinking');
      assert.equal(await page.locator('.voice-caption-text').textContent(), 'Find my fitness chats');
      await page.evaluate(() => window.updateAnswer('Must not be spoken', ['A new progress note', 'Queued progress'], false));
      await played(4);
      await page.getByRole('button', { name: 'Interrupt and speak', exact: true }).click();
      await stage('listening');
      await page.evaluate(() => window.completeSpeech());
      assert.equal(await page.evaluate(() => window.played.length), 4);

      // A local provider may still return bytes after cancellation; discard them.
      await page.evaluate(() => { window.delaySynthesis = true; window.say(); });
      await stage('thinking');
      await page.evaluate(() => window.updateAnswer('', ['Speech after closing']));
      if (provider === 'local') await page.waitForFunction(() => typeof window.releaseSynthesis === 'function');
      else await played(5);
      await page.getByRole('button', { name: 'Close voice mode', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.evaluate(() => { window.releaseSynthesis?.(); window.completeSpeech(); window.reopen(); });
      await stage('listening');
      assert.equal(await page.evaluate(() => window.played.length), provider === 'local' ? 4 : 5);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
