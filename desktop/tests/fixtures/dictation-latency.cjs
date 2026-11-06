const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');
const { build } = require('../../../dashboard/node_modules/esbuild');
const { openDictationProviderBridge } = require('./dictation-provider-bridge.cjs');
const directory = process.argv.at(-1);
const dashboard = path.resolve(__dirname, '../../../dashboard');
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const fakeMicrophone = process.env.BREADBOARD_DICTATION_FAKE_MIC === '1';
if (fakeMicrophone) {
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', path.join(directory, 'sample-long.wav'));
}
app.on('window-all-closed', () => {});
let bridge, server, window;
app.whenReady().then(async () => {
  bridge = await openDictationProviderBridge(process.env.BREADBOARD_DICTATION_CDP);
  await bridge.setAudioFocus(true);
  const bundle = await build({ stdin: { resolveDir: dashboard, loader: 'ts', contents: `
    import {HoldDictationRecorder} from './src/lib/speech/hold-dictation';
    import {bufferDictationAudio} from './src/lib/speech/dictation-audio-buffer';
    import {openDictationProvider, selectDictationProvider} from './src/lib/speech/dictation-provider';
    import {createDictationProviderCache} from './src/lib/speech/dictation-provider-cache';
    import {decodedRecordingAsWav} from './src/lib/speech/live-dictation';
    import {prepareSpeech} from './src/lib/speech/prepare-client';
    import {requestTranscript} from './src/lib/speech/dictation-transcript';
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const cache=createDictationProviderCache(openDictationProvider);
    window.closeTestCache=cache.clear;
    window.run=async (mode,sampleUrl='/sample.wav')=>{
      const context=new AudioContext(); await context.resume();
      const sample=await context.decodeAudioData(await (await fetch(sampleUrl)).arrayBuffer());
      const source=context.createBufferSource(); source.buffer=sample;
      const destination=context.createMediaStreamDestination(); source.connect(destination);
      const times={}, cleanups=[], partials=[]; let fallbackCount=0, resolveResult;
      const result=new Promise(resolve=>resolveResult=resolve);
      let microphone;
      const deps={microphone:async()=>{microphone=${fakeMicrophone ? "await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})" : 'destination.stream'};return microphone;},
        stopStream:stream=>{stream?.getTracks().forEach(t=>t.stop());times.microphoneStopped=performance.now();},
        recorder:stream=>new MediaRecorder(stream),
        transcribe:async(blob,signal)=>{fallbackCount++;const wav=await decodedRecordingAsWav(blob);await prepareSpeech(signal);return await requestTranscript(wav,'dictation.wav',signal,true);}
      };
      if(mode==='streaming')Object.assign(deps,{
        selectProvider:selectDictationProvider,
        openProvider:async(stream,selected,signal,disconnected,onTranscript,onInputReady)=>{
          const voice=await (${process.env.BREADBOARD_DICTATION_NO_CACHE === '1' ? 'openDictationProvider' : 'cache.open'})(stream,selected,signal,(text,final)=>{times.firstPartial??=performance.now();partials.push({ms:Math.round(performance.now()-times.start),text});onTranscript(text,final);},disconnected,()=>{times.inputReady=performance.now();onInputReady();});
          times.connected=performance.now();
          if(!voice)return null;
          return {...voice,close:()=>{const promise=voice.close();cleanups.push(promise);return promise;}};
        },
        buffer:stream=>{const audio=bufferDictationAudio(stream);return {...audio,finish:async()=>{await audio.finish();times.drained=performance.now();}};}
      });
      const hold=new HoldDictationRecorder(notice=>{if(notice.type==='preview'){times.firstPreview??=performance.now();return;}if(notice.type==='finish')return;times.result=performance.now();resolveResult(notice);},()=>{},deps);
      try{
        times.start=performance.now();await hold.start(1);
        source.start(context.currentTime+0.1);
        await sleep(sample.duration*1000+${fakeMicrophone ? '-500' : '500'});
        times.release=performance.now();hold.stop(1);
        const notice=await result;
        const metrics={mode,notice,fallbackCount,partials,sampleMs:Math.round(sample.duration*1000),
          releaseToTextMs:Math.round(times.result-times.release),
          connectionMs:times.connected?Math.round(times.connected-times.start):null,
          inputReadyMs:times.inputReady?Math.round(times.inputReady-times.start):null,
          drainAfterReleaseMs:times.drained?Math.round(times.drained-times.release):null,
          firstPartialMs:times.firstPartial?Math.round(times.firstPartial-times.start):null,
          firstPreviewMs:times.firstPreview?Math.round(times.firstPreview-times.start):null,
          previewBeforeRelease:!!times.firstPreview&&times.firstPreview<times.release,
          microphoneStopMs:Math.round(times.microphoneStopped-times.release),
          tracksEnded:microphone.getTracks().every(t=>t.readyState==='ended')};
        await hold.retirement;await Promise.allSettled(cleanups);return metrics;
      }finally{hold.cancel();source.disconnect();destination.stream.getTracks().forEach(t=>t.stop());await context.close();}
    };
  ` }, tsconfig: path.join(dashboard, 'tsconfig.json'), bundle: true, write: false, platform: 'browser', format: 'iife' });
  server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
      if (req.url === '/sample.wav' || req.url === '/sample-long.wav') { res.setHeader('content-type', 'audio/wav'); res.end(fs.readFileSync(path.join(directory, req.url.slice(1)))); return; }
      if (req.url.startsWith('/api/speech/')) { const result = await bridge.forward(req); res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(result.body); return; }
      res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Breadboard dictation latency verification</title><script src="/bundle.js"></script>');
    } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('http://127.0.0.1:' + server.address().port);
  const runs = [];
  for (const mode of process.env.BREADBOARD_DICTATION_TAIL_ONLY === '1' ? ['streaming'] : ['baseline', 'streaming', 'streaming', 'baseline']) {
    const result = await window.webContents.executeJavaScript('window.run(' + JSON.stringify(mode) + (fakeMicrophone ? ",'/sample-long.wav'" : '') + ')');
    console.log('LATENCY_RESULT', JSON.stringify(result)); runs.push(result);
    fs.writeFileSync(path.join(directory, 'latency-runs.json'), JSON.stringify(runs, null, 2));
    assert.equal(result.notice.type, 'result', result.notice.message);
    assert.equal(result.notice.submit, true, 'complete send message command recognized and stripped');
    assert.equal(result.tracksEnded, true); assert.ok(result.microphoneStopMs < 100, 'microphone stops on release');
    assert.equal(result.fallbackCount, mode === 'baseline' ? 1 : 0, 'streaming never replays the recording');
  }
  const tail = await window.webContents.executeJavaScript("window.run('streaming','/sample-long.wav')");
  console.log('TAIL_RESULT', JSON.stringify(tail));
  fs.writeFileSync(path.join(directory, 'latency-runs.json'), JSON.stringify({ runs, tail }, null, 2));
  for (const result of runs) assert.match(result.notice.text, fakeMicrophone ? /^the words should appear while i am still speaking/i : /^testing bread\s*board dictation[.,!?;:]?$/i, 'first words retained');
  assert.equal(tail.notice.type, 'result', tail.notice.message);
  assert.match(tail.notice.text, /^the words should appear while i am still speaking/i, 'the opening words are retained too');
  assert.match(tail.notice.text, /purple bicycles beside the river[.!?]?$/i, 'the final words are retained');
  assert.equal(tail.notice.submit, true);
  assert.equal(tail.fallbackCount, 0);
  assert.equal(tail.previewBeforeRelease, true, 'long speech appears while the key is held');
  assert.ok(tail.firstPreviewMs < tail.sampleMs / 2, 'first words arrive well before the end of a longer utterance');
  const mean = mode => { const values = runs.filter(r => r.mode === mode); return values.length ? Math.round(values.reduce((sum, r) => sum + r.releaseToTextMs, 0) / values.length) : null; };
  const baselineMs = mean('baseline'), streamingMs = mean('streaming');
  if (runs.some(r => r.mode === 'baseline')) assert.ok(streamingMs < baselineMs, 'streaming reduces measured release-to-text latency');
  fs.writeFileSync(path.join(directory, 'passed.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(),
    scope: fakeMicrophone ? 'Chromium file microphone, configured provider, cold and consecutive holds; native keyboard/insertion excluded' : 'real Web Audio and configured garden/terminal provider; synthetic speech; native keyboard/insertion excluded',
    baselineMs, streamingMs, improvementPercent: baselineMs ? Math.round((baselineMs - streamingMs) / baselineMs * 100) : null, runs, tail }, null, 2));
  await window.webContents.executeJavaScript('window.closeTestCache()');
  await bridge.close(); server.close(); window.destroy(); app.exit(0);
}).catch(async error => { console.error(error); await bridge?.close().catch(() => {}); server?.close(); window?.destroy(); app.exit(1); });
