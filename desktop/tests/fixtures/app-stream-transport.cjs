const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, session } = require('electron');
const { PDFDocument } = require('../../../dashboard/node_modules/@cantoo/pdf-lib');
const { registerAppAssetScheme, installAppAssetTransport } = require('../../dist/main/app-assets.js');
app.setPath('userData', path.join(process.argv.at(-1), 'profile'));
registerAppAssetScheme();
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  // A local textbook can exercise the same test without uploading it or
  // interacting with the user's open reader. CI generates its own document.
  let bytes;
  if (process.env.BREADBOARD_PDF_FIXTURE) bytes = fs.readFileSync(process.env.BREADBOARD_PDF_FIXTURE);
  else {
    const pdf = await PDFDocument.create();
    for (let i = 1; i <= 1757; i++) pdf.addPage([600, 800]).drawText(`Page ${i}`, { x: 40, y: 740 });
    bytes = await pdf.save();
  }
  const held = [], streams = []; let documentReads = 0, cancelled = 0, directBody;
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/held')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': open\n\n'); held.push(res); return;
    }
    if (/^\/api\/hermes\/sessions\/one\//.test(req.url)) {
      if (req.headers.cookie !== 'fixture-session=private') { res.writeHead(401); res.end(); return; }
      assert.equal(req.headers.origin, origin);
      if (req.method === 'POST') { const chunks = []; for await (const c of req) chunks.push(c); directBody = Buffer.concat(chunks).toString(); }
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: ready\n\n');
      res.on('close', () => { cancelled++; }); streams.push(res); return;
    }
    if (req.url === '/fixture.pdf') { res.setHeader('content-type', 'application/pdf'); res.end(bytes); return; }
    if (req.url.startsWith('/pdfjs/')) {
      const name = path.basename(req.url);
      if (!['pdf.mjs', 'pdf.worker.mjs'].includes(name)) { res.writeHead(404); res.end(); return; }
      res.setHeader('content-type', 'text/javascript');
      res.end(fs.readFileSync(path.join(__dirname, '../../../dashboard/node_modules/pdfjs-dist/build', name))); return;
    }
    if (req.url.startsWith('/reader')) {
      documentReads++;
      res.setHeader('content-type', 'text/html');
      if (req.url === '/reader?control') { res.end('<!doctype html><body>Document control</body>'); return; }
      res.end(`<!doctype html><canvas></canvas><script type="module">
        import * as pdfjs from '/pdfjs/pdf.mjs';
        pdfjs.GlobalWorkerOptions.workerSrc='/pdfjs/pdf.worker.mjs';
        const pdf=await pdfjs.getDocument('/fixture.pdf').promise;
        const page=await pdf.getPage(1351); const viewport=page.getViewport({scale:1});
        const canvas=document.querySelector('canvas'); canvas.width=viewport.width; canvas.height=viewport.height;
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        window.pdfReady={pages:pdf.numPages,page:page.pageNumber};
      </script>`); return;
    }
    res.setHeader('content-type', 'text/html'); res.end('<!doctype html><body>Chat feeds</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const target = session.fromPartition('stream-test', { cache: false });
  installAppAssetTransport(target, () => origin);
  await target.cookies.set({ url: origin, name: 'fixture-session', value: 'private', httpOnly: true });
  const options = { show: false, webPreferences: { session: target, backgroundThrottling: false } };
  const chat = new BrowserWindow(options), reader = new BrowserWindow(options);
  await chat.loadURL(origin);
  // Control: six ordinary live HTTP replies prevent even the document request.
  await chat.webContents.executeJavaScript(`Promise.all(Array.from({length:6},(_,i)=>fetch('/held?'+i))).then(()=>true)`);
  const blocked = reader.loadURL(origin + '/reader?control');
  await sleep(500);
  assert.equal(documentReads, 0, 'control must reproduce Chromium socket starvation');
  for (const res of held) res.end();
  await blocked;
  // Real session feeds now use the independent streaming transport.
  await chat.webContents.executeJavaScript(`(async()=>{
    window.feedAbort=new AbortController();
    await Promise.all(Array.from({length:4},(_,i)=>fetch('/api/hermes/sessions/one/events?feed='+i,{signal:feedAbort.signal})));
    await new Promise((resolve,reject)=>{window.feed=new EventSource('/api/hermes/sessions/one/events?feed=eventsource');feed.onmessage=()=>resolve();feed.onerror=()=>reject(new Error('EventSource failed'));});
    const reply=await fetch('/api/hermes/sessions/one/direct',{method:'POST',headers:{'content-type':'application/json'},body:'{"text":"hello"}',signal:feedAbort.signal});
    const first=await reply.body.getReader().read();
    if(new TextDecoder().decode(first.value)!=='data: ready\\n\\n')throw new Error('Direct reply was not streamed');
  })()`);
  assert.equal(streams.length, 6);
  assert.equal(directBody, '{"text":"hello"}');
  const began = Date.now();
  await reader.loadURL(origin + '/reader');
  let ready;
  for (let end = began + 10_000; Date.now() < end;) {
    ready = await reader.webContents.mainFrame.executeJavaScript('window.pdfReady');
    if (ready) break;
    await sleep(25);
  }
  assert.deepEqual(ready, { pages: 1757, page: 1351 });
  const pdfReadyMs = Date.now() - began;
  assert.ok(pdfReadyMs < 5000, `PDF queued behind live feeds: ${pdfReadyMs}ms`);
  assert.ok(streams.every(res => !res.writableEnded));
  const direct = await target.fetch('breadboard-assets://stream/' + encodeURIComponent(origin) + '/api/hermes/sessions/one/events');
  assert.equal(direct.status, 404, 'direct scheme calls cannot borrow app credentials');
  assert.equal(streams.length, 6);
  await chat.webContents.executeJavaScript('feedAbort.abort();feed.close()');
  for (let end = Date.now() + 3000; cancelled < 6 && Date.now() < end;) await sleep(25);
  assert.equal(cancelled, 6, 'cancelling consumers closes all upstream streams');
  console.log(JSON.stringify({ pdfReadyMs, pdfBytes: bytes.length, pages: ready.pages, requestedPage: ready.page, liveFeeds: streams.length, cancelled }));
  fs.writeFileSync(path.join(process.argv.at(-1), 'passed.json'), JSON.stringify({ passed: true }));
  chat.destroy(); reader.destroy(); server.closeAllConnections(); server.close();
}).catch(error => { console.error(error.stack || error); app.exit(1); });
