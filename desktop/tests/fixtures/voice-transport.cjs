const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const {app, BrowserWindow, session} = require('electron');
const {registerAppAssetScheme, installAppAssetTransport} = require('../../dist-tests/src/main/app-assets.js');
app.setPath('userData', path.join(process.argv.at(-1), 'profile'));
registerAppAssetScheme();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const streams = []; let voiceReads = 0, cancellation = false;
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/stream')) {
      res.writeHead(200, {'content-type':'text/event-stream'}); res.write(': open\n\n'); streams.push(res); return;
    }
    if (req.url.startsWith('/api/speech/') || ['/api/profile/voice-assistant', '/api/assistant-preferences'].includes(req.url)) {
      voiceReads++;
      if (req.headers.cookie !== 'fixture-session=private') { res.writeHead(401); res.end(); return; }
      assert.equal(req.headers.origin, origin);
      if (req.url === '/api/speech/synthesize') {
        res.writeHead(200, {'content-type':'audio/mpeg'}); res.write(Buffer.from([1,2,3]));
        res.on('close', () => { cancellation = true; }); return;
      }
      const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({method:req.method, type:req.headers['content-type'], body:Buffer.concat(chunks).toString('base64')})); return;
    }
    res.setHeader('content-type','text/html'); res.end('<!doctype html><body>Voice test</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const target = session.fromPartition('voice-test', {cache:false});
  installAppAssetTransport(target, () => origin);
  await target.cookies.set({url:origin,name:'fixture-session',value:'private',httpOnly:true});
  const window = new BrowserWindow({show:false,webPreferences:{session:target,backgroundThrottling:false}});
  await window.loadURL(origin + '/voice');
  await window.webContents.executeJavaScript(`Promise.all(Array.from({length:6},(_,i)=>fetch('/stream?'+i))).then(()=>true)`);
  assert.equal(streams.length, 6);
  const started = Date.now();
  const json = await window.webContents.executeJavaScript(`fetch('/api/speech/synthesize-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'Hello'}),signal:AbortSignal.timeout(2000)}).then(r=>r.json())`);
  assert.deepEqual(json, {method:'POST',type:'application/json',body:Buffer.from('{"text":"Hello"}').toString('base64')});
  const voiceReadyMs = Date.now()-started;
  assert.ok(voiceReadyMs < 1500, 'voice must not queue behind the six live streams');
  const preferenceReadMs = {};
  for (const route of ['/api/profile/voice-assistant', '/api/assistant-preferences']) {
    const preferenceStarted = Date.now();
    const result = await window.webContents.executeJavaScript(`fetch(${JSON.stringify(route)}, {cache:'no-store',signal:AbortSignal.timeout(2000)}).then(async response=>({status:response.status,cache:response.headers.get('cache-control'),body:await response.json()}))`);
    preferenceReadMs[route] = Date.now()-preferenceStarted;
    assert.equal(result.status, 200);
    assert.equal(result.body.method, 'GET');
    assert.equal(result.cache, 'private, no-store');
    assert.ok(preferenceReadMs[route] < 1500, route + ' must not queue behind six live streams');
  }
  const pcm = await window.webContents.executeJavaScript(`fetch('/api/speech/livekit?id=fixture&sequence=0',{method:'PUT',body:new Uint8Array([0,1,128,255])}).then(r=>r.json())`);
  assert.equal(pcm.method, 'PUT'); assert.equal(pcm.body, Buffer.from([0,1,128,255]).toString('base64'));
  const form = await window.webContents.executeJavaScript(`(async()=>{const form=new FormData();form.append('file',new Blob(['spoken fixture'],{type:'audio/wav'}),'test.wav');return (await fetch('/api/speech/transcribe',{method:'POST',body:form})).json()})()`);
  assert.match(form.type, /^multipart\/form-data; boundary=/);
  assert.match(Buffer.from(form.body,'base64').toString(), /spoken fixture/);
  const audio = await window.webContents.executeJavaScript(`(async()=>{const controller=new AbortController();const response=await fetch('/api/speech/synthesize',{method:'POST',body:'hello',signal:controller.signal});const reader=response.body.getReader();const first=await reader.read();controller.abort();return [...first.value]})()`);
  assert.deepEqual(audio, [1,2,3], 'first audio is streamed without waiting for the whole response');
  for(let i=0;i<30&&!cancellation;i++) await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(cancellation, 'interrupting audio must close the upstream request');
  const before = voiceReads;
  const direct = await target.fetch('breadboard-assets://voice/'+encodeURIComponent(origin)+'/api/speech/synthesize-test', {method:'POST',body:'untrusted'});
  assert.equal(direct.status,404); assert.equal(voiceReads,before,'direct scheme calls cannot borrow app authentication');
  await target.cookies.remove(origin, 'fixture-session');
  assert.equal(await window.webContents.executeJavaScript(`fetch('/api/speech/settings').then(r=>r.status)`),401);
  for (const route of ['/api/profile/voice-assistant', '/api/assistant-preferences']) {
    assert.equal(await window.webContents.executeJavaScript(`fetch(${JSON.stringify(route)}).then(r=>r.status)`),401);
  }
  assert.ok(streams.every(res=>!res.writableEnded));
  console.log(JSON.stringify({voiceReadyMs,preferenceReadMs,occupiedSockets:streams.length,cancellation,uploads:'JSON, PCM and multipart passed'}));
  require('node:fs').writeFileSync(path.join(process.argv.at(-1),'passed.json'),JSON.stringify({passed:true}));
  for(const res of streams)res.end(); window.destroy();server.closeAllConnections();server.close();app.exit(0);
}).catch(error=>{console.error(error.stack||error);app.exit(1)});
