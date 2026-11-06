import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';

test('PDF chat picks files, pastes clipboard images, and retains attachments through queued sends', { timeout: 120_000 }, async t => {
  // Exercise the real PDF assistant, runtime panel, composer and session hook.
  // Only Next navigation and unrelated dialogs are replaced; HTTP stands in
  // for the server/model, so every assertion checks the dispatched payload.
  const stubs = {
    'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
    'next/dynamic': 'export default function dynamic(){return ()=>null}',
    'next/navigation': 'export const useRouter=()=>({push(){},refresh(){}}); export const usePathname=()=>"/pdf"; export const useSearchParams=()=>new URLSearchParams();',
    '@/app/components/settings-dialog': 'export default function Settings(){return null}',
    '@/app/components/hermes/command-hub': 'export const CommandHub=()=>null;',
  };
  const bundle = await build({ bundle: true, write: false, outfile: 'bundle.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef,useState} from 'react'; import {createRoot} from 'react-dom/client';
      import PdfAssistant from './src/app/components/pdf-assistant';
      function App(){
        const [page,setPage]=useState(2);window.setPdfPage=setPage;
        const container=useRef(null),pdf=useRef({numPages:20,getPage:async()=>({getTextContent:async()=>({items:[{str:'Circuit notes'}]})})});
        return <><div ref={container} style={{width:600,height:400}}><div className="page" data-page-number={page}>
          <div className="canvasWrapper"><canvas width={600} height={400}/></div>
        </div></div><PdfAssistant documentKey="pdf:attachment-test" title="Circuit notes" fileName="circuit.pdf"
          pageNumber={page} pageCount={20} loading={false} selectionEnabled={false}
          containerRef={container} pdfDocumentRef={pdf} getBytes={async()=>new Uint8Array([37,80,68,70])}/></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: 'unrelated-ui', setup(builder) {
      builder.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, 'utf8'), { from: stylesheet })).css;
  const turns = [], pending = [], uploads = [];
  let heldExtraction;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bundle.js') { response.setHeader('content-type', 'text/javascript; charset=utf-8'); response.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text); return; }
    if (url.pathname === '/style.css') { response.setHeader('content-type', 'text/css; charset=utf-8'); response.end(css); return; }
    if (!url.pathname.startsWith('/api/')) {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><link rel="stylesheet" href="/style.css"><body style="--paper:#f8f8f3;--paper-raised:#fff;--ink:#222;--ink-muted:#666;--line:#ccc"><div id="root"></div><script src="/bundle.js"></script>'); return;
    }
    let raw = ''; for await (const chunk of request) raw += chunk;
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/extract-text') {
      if (raw.includes('broken.png')) { response.statusCode=422; response.end('{"error":"Image could not be read"}'); return; }
      if (raw.includes('slow.png')) { heldExtraction=response; return; }
      response.end(JSON.stringify({type:'image',dataUrl:png})); return;
    }
    if (url.pathname === '/api/chat-attachments/documents') {
      const name=decodeURIComponent(request.headers['x-document-filename']); uploads.push(name);
      response.end(JSON.stringify({blobId:`doc_${(name==='extra.pdf'?'b':'a').repeat(32)}`,format:'pdf',text:`Reading of ${name}`,sizeBytes:4})); return;
    }
    if (url.pathname === '/api/pdf-assistant/view-decision') { response.end('{"captureView":false}'); return; }
    if (url.pathname === '/api/hermes/sessions' && request.method === 'POST') {
      response.end('{"session":{"id":"conv_pdf_files","activeDirectory":null},"initialTurnReserved":true}'); return;
    }
    if (url.pathname === '/api/hermes/sessions') { response.end('{"sessions":[]}'); return; }
    if (url.pathname.endsWith('/direct')) {
      turns.push(JSON.parse(raw)); pending.push(response);
      response.setHeader('content-type','text/event-stream'); response.flushHeaders(); return;
    }
    response.end('{"artifacts":[],"messages":[],"models":[],"entries":[]}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{ server.closeAllConnections(); return new Promise(resolve=>server.close(resolve)); });
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  const context = await browser.newContext({viewport:{width:1400,height:1000},permissions:['clipboard-read','clipboard-write']});
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors=[]; page.on('pageerror',error=>{ errors.push(error.message); t.diagnostic(String(error)); });
  await page.addInitScript(()=>localStorage.setItem('breadboard:agent-mode','false'));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  const assistant=page.getByRole('complementary',{name:'PDF assistant',exact:true});
  const draft=assistant.locator('textarea');
  const waitFor=async predicate=>{const deadline=Date.now()+10_000;while(!predicate()){assert.ok(Date.now()<deadline,'Server request did not arrive');await new Promise(resolve=>setTimeout(resolve,20));}};
  const finish=async text=>{pending.shift().end(`data: ${JSON.stringify({type:'delta',text})}\n\n`);await page.getByText(text,{exact:true}).waitFor();};
  const imageFile=name=>({name,mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});
  const pasteImage=async()=>{
    const previous=await assistant.getByRole('button',{name:/^Remove /}).count();
    await draft.focus();
    await page.evaluate(async dataUrl=>{
      const blob=await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
    },png);
    await page.keyboard.press('Control+V');
    await assistant.getByRole('button',{name:/^Remove /}).nth(previous).waitFor();
    await page.waitForFunction(()=>document.querySelector('[aria-label="Add to chat"]')?.getAttribute('aria-busy')==='false');
  };

  await assistant.getByRole('button',{name:'Add to chat',exact:true}).click();
  await page.getByRole('menuitem',{name:'Files and folders',exact:true}).hover();
  const choosing=page.waitForEvent('filechooser');
  await page.getByRole('menuitem',{name:'Choose files',exact:true}).click();
  const chooser=await choosing;
  assert.equal(chooser.isMultiple(),true);
  await chooser.setFiles([{name:'extra.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')},imageFile('first.png')]);
  await assistant.getByRole('button',{name:'Remove first.png',exact:true}).waitFor();
  assert.deepEqual(uploads,['extra.pdf']);
  await assistant.getByRole('button',{name:'Remove first.png',exact:true}).click();
  await pasteImage();
  await assistant.getByRole('button',{name:/^Remove .*\.png$/}).waitFor();
  await draft.fill('Compare my screenshot and attachment to the PDF');
  await assistant.getByRole('button',{name:'Send',exact:true}).click();
  await waitFor(()=>turns.length===1);
  const visible=turns[0].attachments.filter(a=>a.context!=='pdf');
  assert.deepEqual(visible.map(a=>a.type),['document','image']);
  assert.equal(visible[0].name,'extra.pdf');
  assert.equal(visible[1].dataUrl,png);
  assert.ok(!turns[0].attachments.some(a=>a.name==='first.png'));
  assert.equal(turns[0].attachments.filter(a=>a.context==='pdf').length,2);
  assert.equal(await assistant.getByRole('button',{name:/^Remove /}).count(),0,'sent files leave the composer');

  // Follow-up captures both the user image and the PDF page at queue time.
  await page.evaluate(()=>window.setPdfPage(5));
  await pasteImage();
  await draft.fill('Use this screenshot next');
  await assistant.getByRole('button',{name:'Queue message',exact:true}).click();
  await page.evaluate(()=>window.setPdfPage(7));
  await finish('First answer');
  await waitFor(()=>turns.length===2);
  assert.equal(turns[1].attachments.filter(a=>a.context!=='pdf').length,1);
  assert.equal(turns[1].attachments.find(a=>a.context==='pdf').pdfPage.pageNumber,5);
  await finish('Queued answer');

  // Images alone are valid sends, and ordinary text paste still edits the draft.
  await pasteImage();
  await assistant.getByRole('button',{name:'Send',exact:true}).click();
  await waitFor(()=>turns.length===3);
  assert.match(turns[2].text,/^Attached: .*\.png$/);
  assert.equal(turns[2].attachments.filter(a=>a.context!=='pdf').length,1);
  await finish('Image-only answer');
  await draft.focus();
  await page.evaluate(()=>navigator.clipboard.writeText('Pasted text'));
  await page.keyboard.press('Control+V');
  assert.equal(await draft.inputValue(),'Pasted text');

  const fileInput=page.getByLabel('Attach files to PDF chat', {exact:true});
  // A clicked Send holds the draft until the user-selected file is ready.
  await fileInput.setInputFiles(imageFile('slow.png'));
  await waitFor(()=>Boolean(heldExtraction));
  await assistant.getByRole('button',{name:'Queue message',exact:true}).click();
  await assistant.getByText('Message queued — waiting for files…',{exact:true}).waitFor();
  assert.equal(turns.length,3);
  heldExtraction.end(JSON.stringify({type:'image',dataUrl:png}));
  heldExtraction=null;
  await waitFor(()=>turns.length===4);
  assert.equal(turns[3].text,'Pasted text');
  assert.equal(turns[3].attachments.find(a=>a.context!=='pdf').name,'slow.png');
  await finish('Uploaded image answer');

  // Failed reads stay visible, and a late upload cannot land in a new chat.
  await draft.fill('Pasted text');
  await fileInput.setInputFiles(imageFile('broken.png'));
  await page.getByRole('alert').filter({hasText:'Image could not be read'}).waitFor();
  assert.equal(await draft.inputValue(),'Pasted text');
  await fileInput.setInputFiles(imageFile('slow.png'));
  await waitFor(()=>Boolean(heldExtraction));
  assert.equal(await assistant.getByRole('button',{name:'Add to chat',exact:true}).isDisabled(),true);
  await assistant.getByRole('button',{name:'New PDF chat',exact:true}).click();
  const finishedExtraction=page.waitForResponse(response=>response.url().endsWith('/api/extract-text'));
  heldExtraction.end(JSON.stringify({type:'image',dataUrl:png}));
  await (await finishedExtraction).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForFunction(()=>document.querySelector('[aria-label="Add to chat"]')?.getAttribute('aria-busy')==='false');
  assert.equal(await assistant.getByRole('button',{name:/^Remove /}).count(),0);
  assert.equal(await draft.inputValue(),'');
  assert.deepEqual(errors,[]);
});
