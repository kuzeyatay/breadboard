import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import esbuild from 'esbuild';
import { chromium } from 'playwright';
import { speakableText } from '../src/lib/speech/voice-conversation.ts';
import { splitSpeechPassages } from '../src/lib/speech/passages.ts';

test('voice mode speaks thinking updates, queues answers, and cancels late audio for both providers', { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import Voice from './src/app/components/voice-conversation-overlay';
      import { chimeForNotifications } from './src/lib/notification-sound';
      window.played = []; window.synthesized = []; window.sent = [];
      window.transcript = 'Find my fitness chats';
      window.tracks = []; window.contexts = []; window.cloudClosed = 0;
      window.audioPlayers = []; window.cloudStops = 0; window.chimeNotes = 0; window.lastChimeAt = 0;
      window.chime = id => { window.lastChimeAt = Date.now(); window.stopChime = chimeForNotifications([id], () => true); };
      window.voiceAudioState = () => ({
        tracks: window.tracks.map(track => track.readyState),
        contexts: window.contexts.filter(context => !context.chime).map(context => context.state),
        players: window.audioPlayers.map(audio => ({ paused: audio.paused, time: audio.currentTime })),
        cloudStops: window.cloudStops, cloudClosed: window.cloudClosed, cloudListening: window.cloudListening,
      });
      window.cloud = location.search.includes('cloud');
      window.compact = location.search.includes('compact');
      window.greet = location.search.includes('greet');
      window.failGreeting = location.search.includes('fail-greet');
      window.delaySynthesis = location.search.includes('timeout-greet') || location.search.includes('skip-greet');
      window.Audio = class extends EventTarget {
        currentTime = 0; duration = 100;
        constructor(url) { super(); this.src = url; this.paused = true; window.audioPlayers.push(this); }
        async play() {
          this.paused = false;
          window.played.push(await fetch(this.src).then(response => response.text()));
          window.completeSpeech = () => this.dispatchEvent(new Event('ended'));
          window.advanceSpeech = progress => { this.currentTime = this.duration * progress; this.dispatchEvent(new Event('timeupdate')); };
        }
        pause() { this.paused = true; } removeAttribute() {} load() {}
      };
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
        const track = {readyState:'live',stop(){this.readyState='ended';}};
        window.tracks.push(track);
        return {getTracks:()=>[track]};
      } }, configurable: true });
      class Context {
        sampleRate = 48000; state = 'running'; destination = {};
        constructor() { window.contexts.push(this); }
        createMediaStreamSource() { return {connect(){},disconnect(){}}; }
        createGain() { return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}; }
        createOscillator() {
          this.chime = true;
          return {frequency:{setValueAtTime(){}},connect:node=>node,start(){window.chimeNotes++;},stop(){}};
        }
        createScriptProcessor() { return window.processor = {connect(){},disconnect(){},onaudioprocess:null}; }
        async close() { this.state = 'closed'; } async resume() {}
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
        return <Voice greetOnOpen={window.greet} compact={window.compact} open={open} onClose={()=>{
          window.micStoppedOnClose = window.tracks.every(track=>track.readyState==='ended');
          setOpen(false);
        }} messages={messages} busy={busy} onSend={text=>{
          window.sent.push(text); setMessages(messages=>[...messages,{role:'user',content:text},{role:'assistant',content:''}]);setBusy(true);
        }}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    // The fixture supplies voice styles below; imported widget CSS is unused.
    loader: { '.css': 'empty', '.module.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'voice-fixture', setup(build) {
      const stubs = {
        '@/lib/speech/clap/audio-focus': 'export const requestForegroundMicrophone = () => navigator.mediaDevices.getUserMedia(); export function stopForegroundStream(stream) { stream?.getTracks().forEach(track=>track.stop()); } export const holdForegroundAudio = () => () => {};',
        '@/lib/speech/clap-wake': 'export const holdClapWake = () => () => {};',
        '@/lib/speech/microphone-access': 'export const describeMicrophoneBlock = () => null;',
        '@/lib/speech/prepare-client': 'export async function prepareLocalSpeech() {} export const speechErrorMessage = (error, fallback) => error?.message || fallback;',
        '@/lib/speech/request-client': `export async function speechRequest(url, options) {
          if (url.endsWith('/transcribe')) return Response.json({text:window.transcript});
          const text = JSON.parse(options.body).text; window.synthesized.push(text);
          if (window.failGreeting) throw new Error('Fixture greeting reader failed.');
          if (window.delaySynthesis) await new Promise(resolve=>window.releaseSynthesis=resolve);
          return new Response(text);
        }`,
        '@/lib/speech/subscription-live': `export const subscriptionSelected = async () => window.cloud;
          export async function connectSubscriptionVoice(options) {
            window.cloudConnections=(window.cloudConnections||0)+1;
            if(window.delayConnect)await new Promise(resolve=>window.releaseConnect=resolve);
            options.signal.throwIfAborted();
            if(window.failConnect)throw new Error(window.failConnect);
            let finish,closed=false,healthy=true;
            window.disconnect=()=>{healthy=false;options.onDisconnect?.(new Error('Fixture connection lost'));};
            return {isHealthy:()=>healthy&&!closed,resetTranscript(){},setListening(value){window.cloudListening=value;},
              finishTranscript:async()=>{if(window.failTranscript){window.failTranscript=false;healthy=false;throw new Error('Fixture transcription failed');}return window.transcript;},
              close:async()=>{if(closed)return;closed=true;window.cloudClosed++;window.cloudListening=false;finish?.();if(window.delayClose){window.delayClose=false;await new Promise(resolve=>window.releaseClose=resolve);}},
              stopSpeaking(){window.cloudStops++;finish?.();},
              speak(text, play, onProgress){if(window.failGreeting)return Promise.reject(new Error('Fixture greeting reader failed.'));if(window.failSpeaking){window.failSpeaking=false;healthy=false;return Promise.reject(new Error('Fixture speech failed'));}window.advanceSpeech=onProgress;window.cloudListening=false;window.played.push(text);return new Promise(resolve=>{finish=resolve;window.completeSpeech=()=>{onProgress?.(1);resolve();};});}
            };
          }`,
      };
      build.onResolve({ filter: /.*/ }, args => {
        const key = args.path in stubs ? args.path : `@/lib/speech/${args.path.split('/').at(-1)}`;
        return key in stubs ? { path: key, namespace: 'voice-stub' } : null;
      });
      build.onLoad({ filter: /.*/, namespace: 'voice-stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const css = fs.readFileSync(root + 'src/app/globals.css', 'utf8');
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript; charset=utf-8' : request.url === '/style.css' ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
    response.end(request.url === '/app.js' ? bundle.outputFiles[0].text : request.url === '/style.css' ? css.slice(css.indexOf('.voice-stage {')) : '<!doctype html><html><head><link rel="stylesheet" href="/style.css"><style>*{box-sizing:border-box}body,p{margin:0}body{font-family:Arial}button{font:inherit}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
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
    for (const provider of ['local', 'cloud']) for (const failure of ['fail', 'timeout', 'skip']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (failure === 'timeout') await page.clock.install();
      await page.goto(`http://127.0.0.1:${server.address().port}/?${provider}&${failure}-greet`);
      if (failure !== 'fail') {
        await page.waitForFunction(() => window.cloud ? window.played.length === 1 : typeof window.releaseSynthesis === 'function');
        if (failure === 'timeout') await page.clock.fastForward(25_100);
        else await page.getByRole('button', { name: 'Skip greeting and listen', exact: true }).click();
      }
      await page.locator('.voice-stage[data-stage="listening"]').waitFor().catch(async error => {
        throw new Error(`${provider}/${failure}: ${await page.locator('body').innerText()}\n${errors.join('\n')}`, { cause: error });
      });
      if (failure !== 'skip') assert.match(await page.locator('.voice-note').textContent(), /You can still speak/);
      assert.equal(await page.evaluate(() => window.tracks.filter(track => track.readyState === 'live').length), 1);
      if (provider === 'cloud') {
        assert.equal(await page.evaluate(() => window.cloudListening), true);
        assert.equal(await page.evaluate(() => window.cloudConnections), 1, 'a failed greeting preserves the microphone session');
      }
      // A late synthesis result must not play over the newly active microphone.
      await page.evaluate(() => { window.failGreeting=false;window.delaySynthesis=false;window.releaseSynthesis?.();window.completeSpeech?.(); });
      if (failure === 'timeout') await page.clock.resume();
      await page.waitForTimeout(100);
      if (provider === 'local' && failure !== 'fail') assert.equal(await page.evaluate(() => window.played.length), 0);
      assert.equal(await page.locator('.voice-stage').getAttribute('data-stage'), 'listening');
      await page.getByRole('button', { name: 'Close voice mode', exact: true }).click();
      assert.equal(await page.evaluate(() => window.tracks.every(track => track.readyState === 'ended')), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
    for (const provider of ['local', 'cloud']) {
      const page = await browser.newPage();
      page.setDefaultTimeout(8_000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Offline conversion must not fetch locale data from a CDN.
      await page.route('https://**/*', route => route.abort());
      await page.goto(`http://127.0.0.1:${server.address().port}/?${provider}`);
      await page.locator('.voice-stage[data-stage="listening"]').waitFor();
      await page.evaluate(() => window.say());
      await page.locator('.voice-stage[data-stage="thinking"]').waitFor();
      const formula = String.raw`The result is $x^2 + y_1 = \frac{a}{b}$.`;
      await page.evaluate(formula => window.updateAnswer(formula, [], false), formula);
      await page.waitForFunction(() => window.played.length === 1).catch(async error => {
        throw new Error(`${provider}/math: ${await page.locator('body').innerText()} ${errors.join('; ')}`, { cause: error });
      });
      assert.equal(await page.evaluate(() => window.played[0]), 'The result is x squared plus y sub 1 equals a over b.');
      assert.equal(await page.locator('.voice-caption-text .katex').count(), 1, 'the visible response retains the original rendered formula');
      await page.evaluate(() => window.completeSpeech());
      await page.locator('.voice-stage[data-stage="listening"]').waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
    for (const provider of ['local', 'cloud']) for (const compact of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?${provider}${compact ? '&compact' : ''}`);
      const caption = () => page.locator(compact ? '.voice-widget-message-assistant' : '.voice-caption-text').last();
      const stage = state => page.locator(`.voice-stage[data-stage="${state}"]`).waitFor();
      const played = count => page.waitForFunction(count => window.played.length === count, count);
      const readingClock = async text => {
        const spoken = await speakableText(text);
        const passages = provider === 'local'
          ? splitSpeechPassages(spoken, { maxCharacters: 360, maxWords: 50 }) : [spoken];
        const total = passages.reduce((count, part) => count + part.length, 0);
        let part = 0, completed = 0;
        return { spoken, async advance(progress) {
          const target = total * progress;
          while (part < passages.length - 1 && completed + passages[part].length <= target) {
            const count = await page.evaluate(() => window.played.length);
            await page.evaluate(() => window.completeSpeech());
            await played(count + 1);
            completed += passages[part++].length;
          }
          await page.evaluate(fraction => window.advanceSpeech(fraction), (target - completed) / passages[part].length);
        } };
      };
      const checkChime = async (expectedStage, dismiss) => {
        const delay = await page.evaluate(() => Math.max(0, window.lastChimeAt + 1100 - Date.now()));
        if (delay) await page.waitForTimeout(delay);
        const before = await page.evaluate(() => ({ audio: window.voiceAudioState(), notes: window.chimeNotes }));
        await page.evaluate(id => window.chime(id), `notification-during-${expectedStage}`);
        await page.waitForFunction(notes => window.chimeNotes === notes + 2, before.notes);
        if (dismiss) await page.evaluate(() => window.stopChime());
        await page.waitForFunction(() => window.contexts.filter(context => context.chime).every(context => context.state === 'closed'));
        assert.equal(await page.locator('.voice-stage').getAttribute('data-stage'), expectedStage);
        assert.deepEqual(await page.evaluate(() => window.voiceAudioState()), before.audio,
          'playing and cleaning up a notification chime cannot pause, rewind, stop, or reconnect voice');
      };
      await stage('listening');
      const initialCapture = await page.evaluate(() => ({ tracks: window.tracks.length, connections: window.cloudConnections }));
      if (compact) await checkChime('listening', false);
      await page.getByRole('button', { name: 'Minimize voice assistant' }).click();
      await page.locator('.voice-stage-minimized[data-stage="listening"]').waitFor();
      await page.evaluate(() => window.say());
      await stage('thinking');
      const first = 'Searching your recent chats for “fitness journey.”';
      const second = 'No exact match. Trying the likely gym, fat-loss, and nutrition terms.';
      await page.evaluate(first => window.updateAnswer('', [first]), first);
      await played(1);
      await stage('speaking');
      if (compact) await checkChime('speaking', true);
      assert.equal(await page.locator('.voice-mini-status').textContent(), 'Answering');
      assert.equal(await caption().textContent(), first);
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
      assert.deepEqual(await page.evaluate(() => ({ tracks: window.tracks.length, connections: window.cloudConnections })), initialCapture,
        'minimized speech sends a turn and reads progress and answers without replacing capture');
      await page.getByRole('button', { name: 'Expand voice assistant' }).click();
      assert.equal(await caption().textContent(), 'Here are your fitness chats.');
      await page.getByRole('button', { name: 'Pause listening', exact: true }).click();
      await stage('paused');
      assert.equal(await caption().textContent(), 'Here are your fitness chats.');
      await page.getByRole('button', { name: 'Minimize voice assistant' }).click();
      await page.locator('.voice-stage-minimized[data-stage="paused"]').waitFor();
      await page.getByRole('button', { name: 'Start listening', exact: true }).click();
      await stage('listening');
      await page.getByRole('button', { name: 'Expand voice assistant' }).click();

      // Interrupt while a progress message is playing and the answer is queued.
      await page.evaluate(() => window.say());
      await stage('thinking');
      if (!compact) assert.equal(await caption().textContent(), 'Find my fitness chats');
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

      // The current spoken message owns scrolling even when the complete
      // answer arrives before playback, and when new chat content streams in.
      await page.evaluate(() => { window.delaySynthesis = false; window.say(); });
      await stage('thinking');
      const longReply = 'Each exercise should feel controlled. Rest between sets and keep your form steady. '.repeat(16);
      const longReading = await readingClock(longReply);
      const beforeLongReading = await page.evaluate(() => window.played.length);
      await page.evaluate(longReply => window.updateAnswer(longReply, [], false), longReply);
      await stage('speaking');
      await played(beforeLongReading + 1);
      const viewport = page.locator(compact ? '.voice-widget-transcript' : '.voice-caption-text');
      assert.equal(await viewport.evaluate(node => getComputedStyle(node).scrollbarWidth), 'none');
      assert.equal(await viewport.evaluate(node => getComputedStyle(node, '::-webkit-scrollbar').display), 'none');
      await page.waitForFunction(() => {
        const text = document.querySelector('.voice-narrated-text');
        const viewport = text.closest('.voice-widget-transcript, .voice-caption-text');
        return Math.abs(text.getBoundingClientRect().top - viewport.getBoundingClientRect().top) < 2;
      });
      const initialScroll = await viewport.evaluate(node => node.scrollTop);
      await longReading.advance(0.6);
      await page.waitForFunction(initialScroll => {
        const node = document.querySelector('.voice-widget-transcript, .voice-caption-text');
        return node.scrollTop > initialScroll + 60;
      }, initialScroll);
      await longReading.advance(1);
      await page.waitForFunction(() => {
        const node = document.querySelector('.voice-widget-transcript, .voice-caption-text');
        return node.scrollHeight - node.clientHeight - node.scrollTop < 2;
      });
      fs.mkdirSync(root + '.tmp-voice-scroll-qa', { recursive: true });
      await page.screenshot({ path: root + `.tmp-voice-scroll-qa/${provider}-${compact ? 'compact' : 'full'}.png` });
      await page.getByRole('button', { name: 'Interrupt and speak', exact: true }).click();
      await stage('listening');
      await viewport.evaluate(node => { node.scrollTop = 0; });
      await page.evaluate(() => window.advanceSpeech(0.9));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await viewport.evaluate(node => node.scrollTop), 0, 'late playback updates cannot restart following');

      // Long answers are read in full. Following the audio must keep reaching
      // the current words across every passage, all the way to the final line.
      await page.evaluate(() => window.say());
      await stage('thinking');
      const hugeReply = 'Each exercise should feel controlled. Rest between sets and keep your form steady. '.repeat(80);
      const prefixReading = await readingClock(hugeReply);
      assert.equal(prefixReading.spoken, hugeReply.trim());
      const beforePrefixReading = await page.evaluate(() => window.played.length);
      await page.evaluate(text => window.updateAnswer(text, [], false), hugeReply);
      await stage('speaking');
      await played(beforePrefixReading + 1);
      const readingPosition = async progress => {
        await prefixReading.advance(progress);
        await page.waitForFunction(({ progress, length }) => {
          const viewport = document.querySelector('.voice-widget-transcript, .voice-caption-text');
          const paragraph = document.querySelector('.voice-narrated-text .chat-markdown p');
          const offset = Math.min(paragraph.firstChild.length - 1, Math.floor(length * progress));
          const range = document.createRange();
          range.setStart(paragraph.firstChild, offset);
          range.setEnd(paragraph.firstChild, offset + 1);
          const line = range.getBoundingClientRect();
          const top = line.top - viewport.getBoundingClientRect().top;
          return top >= 0 && top + line.height <= viewport.clientHeight;
        }, { progress, length: prefixReading.spoken.length }, { timeout: 3000 });
      };
      for (const progress of [0.2, 0.6, 0.9, 1]) await readingPosition(progress);
      assert.ok(await viewport.evaluate(node => node.scrollTop >= (node.scrollHeight - node.clientHeight) * 0.9), 'the final spoken words remain visible');
      await page.setViewportSize({ width: 1600, height: 1000 });
      await readingPosition(1);
      await page.getByRole('button', { name: 'Interrupt and speak', exact: true }).click();
      await stage('listening');
      await page.setViewportSize({ width: 1000, height: 600 });

      // A tall block the voice omits must not count as reading time. Follow
      // prose after that block using its actual position in the rendered page.
      await page.evaluate(() => window.say());
      await stage('thinking');
      const codeReply = [
        '# Read the setup',
        'Prepare carefully and take your time. '.repeat(8),
        '```text\n' + 'These instructions are displayed as code.\n'.repeat(50) + '```',
        '## Continue the exercise',
        'Resume here with controlled movement and a steady breath. '.repeat(60),
      ].join('\n\n');
      const codeReading = await readingClock(codeReply);
      const beforeCodeReading = await page.evaluate(() => window.played.length);
      await page.evaluate(text => window.updateAnswer(text, [], false), codeReply);
      await stage('speaking');
      await played(beforeCodeReading + 1);
      await codeReading.advance(0.65);
      await page.waitForFunction(spoken => {
        const viewport = document.querySelector('.voice-widget-transcript, .voice-caption-text');
        const paragraph = [...document.querySelectorAll('.voice-narrated-text .chat-markdown > p')].find(node => node.textContent.startsWith('Resume here'));
        const offset = Math.floor(spoken.length * 0.65) - spoken.indexOf('Resume here');
        const range = document.createRange();
        range.setStart(paragraph.firstChild, offset);
        range.setEnd(paragraph.firstChild, offset + 1);
        const line = range.getBoundingClientRect();
        const top = line.top - viewport.getBoundingClientRect().top;
        return top >= 0 && top + line.height <= viewport.clientHeight;
      }, codeReading.spoken, { timeout: 3000 });
      await page.getByRole('button', { name: 'Interrupt and speak', exact: true }).click();
      await stage('listening');

      // Mentioned or negated close instructions still reach the ordinary chat.
      for (const transcript of ['And then don’t close yourself now.', 'Explain what “close yourself” means.']) {
        await page.evaluate(transcript => { window.transcript = transcript; window.say(); }, transcript);
        await stage('thinking');
        assert.equal(await page.evaluate(() => window.sent.at(-1)), transcript);
        await page.evaluate(() => window.updateAnswer('Understood.', [], false));
        await stage('speaking');
        await page.evaluate(() => window.completeSpeech());
        await stage('listening');
      }

      // Exit controls must release capture and close without asking a model.
      for (const transcript of ['And then close yourself now', 'Could you please close the voice assistant?', 'Goodbye.']) {
        const before = await page.evaluate(() => ({ sent:window.sent.length, played:window.played.length, synthesized:window.synthesized.length, cloudClosed:window.cloudClosed }));
        await page.evaluate(transcript => { window.transcript = transcript; window.say(); }, transcript);
        await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 });
        assert.deepEqual(await page.evaluate(() => ({ sent:window.sent.length, played:window.played.length, synthesized:window.synthesized.length })),
          { sent:before.sent, played:before.played, synthesized:before.synthesized }, transcript);
        assert.equal(await page.evaluate(() => window.micStoppedOnClose), true, 'capture stops before the host closes');
        assert.equal(await page.evaluate(() => window.contexts.every(context => context.state === 'closed')), true);
        assert.equal(await page.evaluate(() => window.processor.onaudioprocess), null);
        if (provider === 'cloud') {
          assert.equal(await page.evaluate(() => window.cloudClosed), before.cloudClosed + 1);
          assert.equal(await page.evaluate(() => window.cloudListening), false);
        }
        await page.evaluate(() => window.reopen());
        await stage('listening');
      }
      if (provider === 'cloud') {
        const before = await page.evaluate(() => ({sent:[...window.sent], connections:window.cloudConnections, tracks:window.tracks.length}));
        // A failed utterance releases the old session before reconnecting, and
        // never dispatches phantom/duplicate text or replaces the host chat.
        await page.evaluate(() => {window.failTranscript=true;window.delayClose=true;window.say();});
        await stage('opening');
        assert.equal(await page.evaluate(() => window.cloudConnections), before.connections);
        await page.waitForFunction(() => typeof window.releaseClose === 'function');
        await page.evaluate(() => window.releaseClose());
        await stage('listening');
        assert.match(await page.locator('.voice-note').textContent(), /reconnected/i);
        assert.deepEqual(await page.evaluate(() => window.sent), before.sent);
        assert.equal(await page.evaluate(() => window.tracks.length), before.tracks);
        assert.equal(await page.evaluate(() => window.cloudConnections), before.connections + 1);
        await page.evaluate(() => {window.transcript='Continue this same chat';window.say();});
        await stage('thinking');
        assert.deepEqual(await page.evaluate(() => window.sent), [...before.sent, 'Continue this same chat']);
        await page.evaluate(() => window.updateAnswer('We can continue.', [], false));
        await stage('speaking');
        await page.evaluate(() => window.completeSpeech());
        await stage('listening');

        // Idle failures recover without another utterance, preserving pause.
        await page.getByRole('button', {name:'Pause listening', exact:true}).click();
        await page.evaluate(() => window.disconnect());
        await page.waitForFunction(count => window.cloudConnections===count, before.connections + 2);
        await stage('paused');
        assert.equal(await page.evaluate(() => window.cloudListening), false);
        await page.getByRole('button', {name:'Start listening', exact:true}).click();
        await stage('listening');
        await page.evaluate(() => window.disconnect());
        await page.waitForFunction(count => window.cloudConnections===count, before.connections + 3);
        await stage('listening');
        // Consecutive failures stop at a finite budget; manual retry resets it.
        await page.evaluate(() => window.disconnect());
        await stage('unavailable');
        assert.match(await page.locator('.voice-note').textContent(), /Fixture connection lost/);
        assert.equal(await page.evaluate(() => window.cloudConnections), before.connections + 3);
        await page.getByRole('button', {name:'Retry voice',exact:true}).click();
        await stage('listening');

        // A failed reconnect exposes the provider error, then Retry works in
        // the same host. Rapid clicks cannot allocate parallel sessions.
        await page.evaluate(() => {window.failConnect='Fixture provider offline';window.disconnect();});
        await stage('unavailable');
        assert.match(await page.locator('.voice-note').textContent(), /Fixture provider offline/);
        const retries = await page.evaluate(() => window.cloudConnections);
        await page.evaluate(() => {
          window.failConnect=null;window.delayConnect=true;
          const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Retry voice');
          button.click();button.click();
        });
        await page.waitForFunction(count => window.cloudConnections===count, retries+1);
        await page.evaluate(() => {window.delayConnect=false;window.releaseConnect();});
        await stage('listening');

        // Losing narration still leaves the answer visible and restores input.
        await page.evaluate(() => {window.transcript='Read the next answer';window.say();});
        await stage('thinking');
        await page.evaluate(() => {window.failSpeaking=true;window.updateAnswer('Still in the chat.', [], false);});
        await stage('listening');
        assert.equal(await caption().textContent(), 'Still in the chat.');

        // Closing during a pending reconnect aborts it: no reopened mic/chat.
        await page.evaluate(() => {window.delayConnect=true;window.releaseConnect=null;window.disconnect();});
        await stage('opening');
        await page.waitForFunction(() => typeof window.releaseConnect==='function');
        await page.getByRole('button', {name:'Close voice mode',exact:true}).click();
        await page.getByRole('dialog').waitFor({state:'detached'});
        await page.evaluate(() => {window.delayConnect=false;window.releaseConnect();});
        await page.waitForTimeout(100);
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await page.evaluate(() => window.tracks.every(track=>track.readyState==='ended')), true);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
