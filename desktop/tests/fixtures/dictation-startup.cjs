// Same recorded speech through the real provider, with cold/warm startup and
// speech beginning both before and after readiness. No microphone or OS typing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');
const { build } = require('../../../dashboard/node_modules/esbuild');
const { openDictationProviderBridge } = require('./dictation-provider-bridge.cjs');
const directory = process.argv.at(-1), dashboard = path.resolve(__dirname, '../../../dashboard');
app.setPath('userData', path.join(directory, 'startup-profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('remote-debugging-port', '0');
app.on('window-all-closed', () => {});
let bridge, server, window;
app.whenReady().then(async () => {
  bridge = await openDictationProviderBridge(process.env.BREADBOARD_DICTATION_CDP);
  await bridge.setAudioFocus(true);
  const bundle = await build({ stdin: { resolveDir: dashboard, loader: 'ts', contents: `
    import {HoldDictationRecorder} from './src/lib/speech/hold-dictation';
    import {bufferDictationAudio} from './src/lib/speech/dictation-audio-buffer';
    import {openDictationProvider,prepareDictationProvider,selectDictationProvider} from './src/lib/speech/dictation-provider';
    import {createDictationProviderCache} from './src/lib/speech/dictation-provider-cache';
    import {connectSubscriptionVoice} from './src/lib/speech/subscription-live';
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const cache=createDictationProviderCache(openDictationProvider,{prepare:prepareDictationProvider,idleMs:Infinity});
    const events=[];window.getVoiceTrace=()=>events;
    const createChannel=RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel=function(...args){const channel=createChannel.apply(this,args);channel.addEventListener('message',event=>{
      try{const m=JSON.parse(event.data);events.push({at:performance.now(),type:m.type,keys:Object.keys(m),role:m.role??m.turn?.role,turn:m.turn?.id,start:m.start_ms??m.turn?.start_ms,end:m.end_ms??m.turn?.end_ms,turnKeys:Object.keys(m.turn??{}),transcript:m.transcript??m.turn?.transcript,text:m.text,item:m.type==='input_transcript.added'?m.item:undefined});}catch{}
    });return channel;};
    window.closeTestCache=cache.clear;
    window.run=async (name,early=false,baseline=false,sendWhileHeld=false)=>{
      window.testPhase='audio-context';
      const context=new AudioContext();await context.resume();
      window.testPhase='decode-sample';
      const sample=await context.decodeAudioData(await(await fetch('/sample-long.wav')).arrayBuffer());
      const samples=sample.getChannelData(0);let last=samples.length-1;while(last>0&&Math.abs(samples[last])<=1/32768)last--;
      const speechDuration=(last+1)/sample.sampleRate;
      const source=context.createBufferSource();source.buffer=sample;
      const destination=context.createMediaStreamDestination();source.connect(destination);
      events.length=0;
      const times={},partials=[],stages=[];let resolveResult,resolveReady,fallbacks=0,lastVoice,physicallyReleased=false;
      window.getRunStatus=()=>({phase:window.testPhase,stages,partials,fallbacks});
      const ready=new Promise(r=>resolveReady=r),result=new Promise(r=>resolveResult=r);
      const hold=new HoldDictationRecorder(notice=>{
        if(notice.type==='preview'){times.firstPreview??=performance.now();partials.push(notice.text);}
        else if(notice.type==='finish'){times.command=performance.now();times.commandBeforeRelease=!physicallyReleased;}
        else{times.result=performance.now();times.resultBeforeRelease=!physicallyReleased;resolveResult(notice);}
      },()=>{},{microphone:async()=>destination.stream,stopStream:stream=>{stream?.getTracks().forEach(t=>t.stop());times.stopped=performance.now();},
        recorder:stream=>new MediaRecorder(stream),selectProvider:selectDictationProvider,buffer:bufferDictationAudio,
        transcribe:async()=>{fallbacks++;throw Error('Unexpected file fallback');},
        openProvider:async(stream,selected,signal,disconnected,onTranscript,onInputReady)=>{
          const notified=()=>{times.ready=performance.now();onInputReady();resolveReady();};
          return lastVoice=await (baseline?connectSubscriptionVoice({microphone:stream,signal,onTranscript,onDisconnect:disconnected,onInputReady:notified}):cache.open(stream,selected,signal,onTranscript,disconnected,notified));
        }
      },undefined,(id,stage)=>stages.push({stage,ms:Math.round(performance.now()-times.start)}));
      try{
        ${process.env.BREADBOARD_DICTATION_STANDBY === '1' ? `window.testPhase='preparing-standby';await cache.prepare(new AbortController().signal);` : ''}
        window.testPhase='hold-start';
        times.start=performance.now();await hold.start(1);
        window.testPhase='provider-ready';
        if(!early)await Promise.race([ready,result.then(n=>{throw Error(n.message||'Connection failed');}),sleep(30000).then(()=>{throw Error('Provider readiness exceeded 30 seconds');})]);
        window.testPhase='speaking';
        times.speech=performance.now()+100;source.start(context.currentTime+.1);
        // Release 30ms after the last audible sample, without the WAV's long
        // trailing pause, so this actually checks final-word preservation.
        if(sendWhileHeld)await Promise.race([result,sleep(20000).then(()=>{throw Error('Voice command did not complete within 20 seconds');})]);else await sleep(speechDuration*1000+130);
        physicallyReleased=true;times.release=performance.now();hold.stop(1);
        const notice=await result;
        window.testPhase='retiring-provider';
        await hold.retirement;
        ${process.env.BREADBOARD_DICTATION_STARTUP_TRACE === '1' ? 'await sleep(2500);' : ''}
        return {name,notice,fallbacks,partials,stages,lateTranscript:lastVoice?.transcript(),events:events.map(event=>({...event,at:Math.round(event.at-times.start)})),startupMs:Math.round(times.ready-times.start),speechMs:Math.round(speechDuration*1000),
          firstWordsAfterSpeechMs:Math.round(times.firstPreview-times.speech),firstWordsBeforeRelease:times.firstPreview<times.release,
          releaseToTextMs:Math.round(times.result-times.release),microphoneStopMs:Math.round(times.stopped-times.release),
          commandBeforeRelease:times.commandBeforeRelease,resultBeforeRelease:times.resultBeforeRelease,
          commandConfirmationToResultMs:Math.round(times.result-times.command)};
      }finally{hold.cancel();source.disconnect();destination.stream.getTracks().forEach(t=>t.stop());await context.close();}
    };
  ` }, tsconfig: path.join(dashboard, 'tsconfig.json'), bundle: true, write: false, platform: 'browser', format: 'iife' });
  server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
      if (req.url === '/sample-long.wav') { res.setHeader('content-type', 'audio/wav'); res.end(fs.readFileSync(path.join(directory, 'sample-long.wav'))); return; }
      if (req.url.startsWith('/api/speech/')) {
        const result = await bridge.forward(req);
        if (process.env.BREADBOARD_DICTATION_DROP_USER_RELAY === '1' && req.method === 'GET' && req.url.includes('cursor=')) {
          const body = JSON.parse(result.body);
          if (Array.isArray(body.events)) { body.events = body.events.filter(event => event.role !== 'user'); result.body = JSON.stringify(body); }
        }
        res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(result.body); return;
      }
      res.setHeader('content-type', 'text/html'); res.end('<script src="/bundle.js"></script>');
    } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
  window.webContents.on('console-message', (_event, _level, message) => { if (/audio|error/i.test(message)) console.log('RENDERER', message); });
  await window.loadURL('http://127.0.0.1:' + server.address().port);
  const runs = [];
  const commandOnly = process.env.BREADBOARD_DICTATION_COMMAND_ONLY === '1';
  for (const [name, early, baseline, sendWhileHeld = false] of commandOnly ? [['command-held', false, false, true], ['command-released', false, false, false]] : process.env.BREADBOARD_DICTATION_STARTUP_TRACE === '1' ? [['dictation-cold', false, false]] : [['full-voice-startup', false, true], ['dictation-cold', false, false], ['dictation-warm', false, false], ['dictation-early-speech', true, false]]) {
    if (early) await window.webContents.executeJavaScript('window.closeTestCache()');
    let result;
    try { result = await window.webContents.executeJavaScript(`window.run(${JSON.stringify(name)},${early},${baseline},${sendWhileHeld})`); }
    catch (error) {
      const trace = await window.webContents.executeJavaScript('window.getVoiceTrace()');
      const status = await window.webContents.executeJavaScript('window.getRunStatus?.()');
      fs.writeFileSync(path.join(directory, 'latency-runs.json'), JSON.stringify({ failed: name, status, trace }, null, 2));
      throw error;
    }
    runs.push(result); console.log('STARTUP_RESULT', JSON.stringify(result));
    fs.writeFileSync(path.join(directory, 'latency-runs.json'), JSON.stringify(runs, null, 2));
    assert.equal(result.notice.type, 'result', result.notice.message);
    if (process.env.BREADBOARD_DICTATION_SHORT_COMMANDS === '1') assert.match(result.notice.text, /^ready to send[.!?]?$/i);
    else {
      assert.match(result.notice.text, /^the words should appear while i am still speaking/i, 'opening words retained');
      assert.match(result.notice.text, /purple bicycles beside the river[.!?]?$/i, 'last words retained');
    }
    assert.equal(result.notice.submit, true); assert.equal(result.fallbacks, 0);
    if (process.env.BREADBOARD_DICTATION_STANDBY === '1') assert.ok(result.startupMs < 250, 'prepared input must bypass remote session negotiation');
    if (process.env.BREADBOARD_DICTATION_SHORT_COMMANDS !== '1') assert.equal(result.firstWordsBeforeRelease, true);
    assert.ok(result.microphoneStopMs < 100);
    if (commandOnly) {
      if (sendWhileHeld) {
        assert.equal(result.commandBeforeRelease, true);
        assert.equal(result.resultBeforeRelease, true, 'recognized voice command sends without requiring key release');
      }
      assert.ok(result.commandConfirmationToResultMs < 100, 'recognized command bypasses relay and finalization waits');
    }
  }
  await window.webContents.executeJavaScript('window.closeTestCache()');
  await bridge.close(); server.close(); window.destroy();
  fs.writeFileSync(path.join(directory, 'passed.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), scope: 'generated speech through the configured provider; native keyboard excluded', runs }, null, 2));
  app.exit(0);
}).catch(async error => { console.error(error); await bridge?.close().catch(() => {}); server?.close(); window?.destroy(); app.exit(1); });
