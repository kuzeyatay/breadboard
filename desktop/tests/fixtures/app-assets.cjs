const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {app, BrowserWindow, session} = require('electron');
const {registerAppAssetScheme, installAppAssetTransport} = require('../../dist-tests/src/main/app-assets.js');
const directory = process.argv.at(-1);
app.setPath('userData', path.join(directory, 'profile'));
registerAppAssetScheme();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const streams = [];
  let assetReads = 0; let leakedCookie = false; let previewReads = 0;
  let recoveryReads = 0;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/stream')) {
      res.writeHead(200, {'content-type':'text/event-stream'}); res.write(': open\n\n'); streams.push(res); return;
    }
    if (req.url.startsWith('/api/hermes/artifacts/art_test/preview')) {
      previewReads++;
      if (req.headers.cookie !== 'test-session=private') { res.writeHead(401); res.end(); return; }
      res.setHeader('content-type', 'image/png');
      res.setHeader('cache-control', 'private, no-store');
      res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')); return;
    }
    if (req.url === '/api/hermes/artifacts/art_text/preview') {
      res.setHeader('content-type','text/plain'); res.end('Existing text preview'); return;
    }
    if (req.url === '/logo.png') {
      leakedCookie ||= Boolean(req.headers.cookie);
      res.setHeader('content-type','image/png');
      res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));return;
    }
    if (req.url === '/_next/static/chunks/recover.js') {
      if (++recoveryReads < 3) { res.writeHead(503); res.end('runtime restarting'); return; }
      res.setHeader('content-type', 'text/javascript');
      res.end('window.recoveredBootstrap=true;'); return;
    }
    if (req.url.startsWith('/_next/static/')) {
      assetReads++; leakedCookie ||= Boolean(req.headers.cookie);
      res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      res.setHeader('content-type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(req.url.endsWith('.css') ? 'body {color:rgb(1,2,3)}' : 'window.startupReady=(window.startupReady||0)+1;'); return;
    }
    if (req.url === '/api/check') { res.end(req.headers.cookie || ''); return; }
    res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body>Home</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const target = session.fromPartition('asset-test', {cache:false});
  installAppAssetTransport(target, () => origin);
  await target.cookies.set({url:origin,name:'test-session',value:'private',httpOnly:true});
  const window = new BrowserWindow({show:false,webPreferences:{session:target,backgroundThrottling:false}});
  await window.loadURL(origin + '/new-tab');
  assert.equal(await window.webContents.executeJavaScript(`fetch('/api/check').then(r=>r.text())`), 'test-session=private', 'normal requests keep session cookies');
  await window.webContents.executeJavaScript(`Promise.all(Array.from({length:6},(_,i)=>fetch('/stream?'+i))) .then(()=>true)`);
  assert.equal(streams.length, 6);
  const began = Date.now();
  const result = await window.webContents.executeJavaScript(`Promise.all([
    new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/_next/static/chunks/home.js';script.onload=resolve;script.onerror=()=>reject(Error('script failed'));document.head.append(script)}),
    new Promise((resolve,reject)=>{const style=document.createElement('link');style.rel='stylesheet';style.href='/_next/static/chunks/home.css';style.onload=resolve;style.onerror=()=>reject(Error('style failed'));document.head.append(style)}),
    new Promise((resolve,reject)=>{const image=new Image();image.src='/logo.png';image.onload=resolve;image.onerror=()=>reject(Error('logo failed'));document.body.append(image)})
  ]).then(()=>({ready:window.startupReady,color:getComputedStyle(document.body).color}))`);
  assert.deepEqual(result,{ready:1,color:'rgb(1, 2, 3)'});
  assert.ok(Date.now()-began < 1500, 'assets must not wait for a stream connection');
  assert.equal(assetReads, 2); assert.equal(leakedCookie, false);
  await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/_next/static/chunks/home.js';script.onload=()=>resolve(window.startupReady);script.onerror=reject;document.head.append(script)})`);
  assert.equal(assetReads, 2, 'a second reader reuses completed assets with Chromium caching disabled');
  assert.equal(await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='/_next/static/chunks/recover.js';
    script.onload=()=>resolve(window.recoveredBootstrap);script.onerror=()=>reject(Error('poisoned bootstrap'));
    document.head.append(script);
  })`), true, 'a transient backend failure must never reach the page chunk loader');
  assert.equal(recoveryReads, 3, 'the bootstrap script survives two transient failures');
  const preview = await window.webContents.executeJavaScript(`(async()=>{
    const response=await fetch('/api/hermes/artifacts/art_test/preview');
    if(!response.ok)throw Error('preview '+response.status);
    const url=URL.createObjectURL(await response.blob());
    try {
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      return {width:image.naturalWidth,pixel:[...context.getImageData(0,0,1,1).data]};
    }finally{URL.revokeObjectURL(url)}
  })()`);
  assert.deepEqual(preview,{width:1,pixel:[0,0,0,0]},'authenticated previews load and stay readable by the animation canvas');
  assert.equal(await window.webContents.executeJavaScript(`fetch('/api/hermes/artifacts/art_text/preview').then(r=>r.text())`),
    'Existing text preview','the artifact viewer still receives non-image previews');
  await target.cookies.remove(origin, 'test-session');
  const signedOutStatus = await window.webContents.executeJavaScript(`fetch('/api/hermes/artifacts/art_test/preview').then(r=>r.status)`);
  assert.equal(signedOutStatus,401,'an image from a previous authenticated request must not be cached');
  assert.equal(previewReads,2);
  const direct = await target.fetch('breadboard-assets://image/'+encodeURIComponent(origin)+'/api/hermes/artifacts/art_test/preview');
  assert.equal(direct.status,404,'direct scheme requests cannot borrow the app session');
  assert.equal(previewReads,2,'a denied request never reaches the authenticated server');
  assert.ok(streams.every(res=>!res.writableEnded),'loading assets must not close live streams');
  console.log(JSON.stringify({assetReadyMs:Date.now()-began,assetReads,streams:streams.length}));
  for(const response of streams) response.end();
  window.destroy(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(directory,'passed.json'),JSON.stringify({passed:true}));
}).catch(error=>{console.error(error.stack||error);app.exit(1)});
