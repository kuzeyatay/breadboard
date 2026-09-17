import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

test('notifications play decoded speech with zero RTP energy, but genuinely silent tracks still fail', { timeout: 30000 }, async t => {
  const bundle = await esbuild.build({
    stdin: { contents: `export {speakNotification} from './src/lib/speech/notification-speech'; export {connectSubscriptionVoice} from './src/lib/speech/subscription-live';`,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'voice',
  });
  const server = http.createServer((request, response) => {
    if (request.url === '/reader.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
    } else response.end('<button>Start</button><script src="/reader.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    t.signal.addEventListener('abort', () => { void browser?.close(); }, { once: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.click('button');
    const result = await page.evaluate(async () => {
      const context = new AudioContext(); await context.resume();
      const destination = context.createMediaStreamDestination();
      const tone = context.createOscillator(), gain = context.createGain();
      gain.gain.value = 0; tone.connect(gain).connect(destination); tone.start();
      const peers = [], posts = [], players = [];
      let silent = false;
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.src.startsWith('blob:')) players.push(this);
        return nativePlay.call(this);
      };
      // Live readings are heard from the remote track itself: follow its volume.
      const volumes = [];
      const volumeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
      Object.defineProperty(HTMLMediaElement.prototype, 'volume', { configurable: true,
        get() { return volumeDescriptor.get.call(this); },
        set(value) { if (this.srcObject) volumes.push(value); volumeDescriptor.set.call(this, value); } });
      window.RTCPeerConnection = class {
        connectionState = 'connected';
        constructor() { peers.push(this); }
        addTrack() {} close() { this.connectionState = 'closed'; }
        createDataChannel() {
          const channel = { readyState: 'open', close() {}, send() { queueMicrotask(() => channel.onmessage({data: JSON.stringify({type:'session.updated'})})); } };
          queueMicrotask(() => channel.onmessage({data: JSON.stringify({type:'session.started'})}));
          return this.channel = channel;
        }
        async createOffer() { return {sdp:'v=0'}; } async setLocalDescription() {}
        async setRemoteDescription() { this.ontrack({track:destination.stream.getAudioTracks()[0]}); }
        async getStats() { return new Map([
          ['out', {type:'outbound-rtp',kind:'audio',packetsSent:100}],
          ['in', {type:'inbound-rtp',kind:'audio',packetsReceived:100,audioLevel:0,totalAudioEnergy:0,totalSamplesDuration:performance.now()/1000}],
        ]); }
      };
      window.fetch = async (url, options = {}) => {
        if (url === '/api/speech/settings') return Response.json({settings:{enabled:true,speechProvider:'chatgpt',openaiVoice:'sol'}});
        if (options.method === 'DELETE') return Response.json({});
        if (url === '/api/speech/subscription') return Response.json({id:String(peers.length-1),voice:'sol'});
        const id = Number(url.split('/').at(-1).split('?')[0]), peer = peers[id];
        if (options.method === 'POST') {
          const request = JSON.parse(options.body).text;
          const prefix = 'Read aloud exactly this text. Say only these words, with no introduction or commentary: ';
          if (!request.startsWith(prefix)) throw new Error('Missing reading instruction');
          const text = request.slice(prefix.length); posts.push(text);
          if (!silent) gain.gain.value = 0.2;
          setTimeout(() => {
            gain.gain.value = 0;
            peer.channel.onmessage({data:JSON.stringify({type:'turn.done',turn:{id:String(posts.length),role:'assistant',transcript:text}})});
          }, 500);
          return Response.json({ok:true});
        }
        if (url.endsWith('?cursor=0')) return Response.json({cursor:1,events:[{type:'sdp',sdp:'v=0'}]});
        return new Promise((resolve,reject) => options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
      };
      try {
        for (const text of ['First notification.', 'Second notification.']) await voice.speakNotification(text, new AbortController().signal);
        const audibleReadings = volumes.filter(value => value === 1).length;
        const mutedAfter = volumes.at(-1) === 0;
        silent = true;
        const reader = await voice.connectSubscriptionVoice();
        let silenceError;
        try { await reader.speak('This track is silent.'); } catch (error) { silenceError = error.message; }
        finally { await reader.close(); }
        return {posts,audibleReadings,mutedAfter,recordings:players.length,silentMuted:volumes.at(-1) === 0,silenceError,closed:peers.every(p=>p.connectionState==='closed')};
      } finally { tone.stop(); await context.close(); HTMLMediaElement.prototype.play = nativePlay; Object.defineProperty(HTMLMediaElement.prototype, 'volume', volumeDescriptor); }
    });
    assert.deepEqual(result.posts, ['First notification.', 'Second notification.', 'This track is silent.']);
    assert.equal(result.audibleReadings, 2, 'each notification is heard live from the remote track');
    assert.equal(result.mutedAfter, true, 'the track is muted again once a notification has drained');
    assert.equal(result.recordings, 0, 'live readings never play a recording');
    assert.match(result.silenceError, /did not start speaking/);
    assert.equal(result.silentMuted, true, 'a silent reader is muted before it fails');
    assert.equal(result.closed, true);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('real browser recordings are buffered, verified, played to the end and exported once', { timeout: 30000 }, async t => {
  const bundle = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/lib/speech/verified-output.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'verifiedVoice',
  });
  const server = http.createServer((request, response) => {
    if (request.url === '/reader.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(bundle.outputFiles[0].text);
    } else response.end('<button>Start</button><script src="/reader.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(path => fs.existsSync(path));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    t.signal.addEventListener('abort', () => { void browser?.close(); }, { once: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.click('button');
    const result = await page.evaluate(async () => {
      const controller = new AbortController();
      const context = new AudioContext();
      await context.resume();
      const destination = context.createMediaStreamDestination();
      const tone = context.createOscillator();
      const volume = context.createGain();
      volume.gain.value = 0;
      tone.connect(volume).connect(destination);
      tone.start();
      const output = verifiedVoice.createVerifiedSpeechOutput(controller.signal);
      output.attach(destination.stream);
      const originalPlay = HTMLMediaElement.prototype.play;
      let plays = 0;
      HTMLMediaElement.prototype.play = function () { plays++; return originalPlay.call(this); };
      try {
        async function record() {
          await output.begin();
          volume.gain.value = 0.2;
          await new Promise(resolve => setTimeout(resolve, 300));
          volume.gain.value = 0;
        }
        await record();
        let rejected = false;
        try { await output.finish('Read these exact words.', 'An invented answer.', true); }
        catch (error) { rejected = error instanceof verifiedVoice.SpeechFidelityError; }
        const playsAfterRejection = plays;
        await record();
        const audio = await output.finish('Read these exact words.', 'Read these exact words.', true);
        const playsBeforeApproval = plays;
        const progress = [];
        await output.play(audio, value => progress.push(value));
        output.keep(audio);
        const exported = await output.capture(context);
        const decoded = await context.decodeAudioData(await exported.arrayBuffer());
        return { rejected, playsAfterRejection, playsBeforeApproval, plays, progress,
          seconds: decoded.duration, audible: decoded.getChannelData(0).some(value => Math.abs(value) > 0.1) };
      } finally { controller.abort(); tone.stop(); await context.close(); HTMLMediaElement.prototype.play = originalPlay; }
    });
    assert.equal(result.rejected, true);
    assert.equal(result.playsAfterRejection, 0);
    assert.equal(result.playsBeforeApproval, 0);
    assert.equal(result.plays, 1);
    assert.equal(result.progress.at(-1), 1);
    assert.ok(result.seconds >= 0.25 && result.seconds < 0.7, 'export contains the one approved passage');
    assert.equal(result.audible, true);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
