import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

async function waitUntil(predicate) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'expected service request did not arrive');
    await delay(10);
  }
}

test('large PDFs keep highlight listeners bounded and restore highlights after page recycling', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useEffect,useRef,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Layer from './src/app/components/pdf-selection-layer';
      const app=createRoot(document.getElementById('root'));
      window.dispose=()=>app.unmount();
      window.selections=[];window.opened=[];
      function text(page){const layer=document.createElement('div');layer.className='textLayer';
        const span=document.createElement('span');span.textContent='Page '+page+' selectable text';
        layer.append(span);return layer;}
      function App(){
        const container=useRef(null),[highlights,setHighlights]=useState([]),[enabled,setEnabled]=useState(true);
        const [mounted,setMounted]=useState(true);
        window.setHighlights=pages=>setHighlights(pages.map(page=>({selection:{id:'mark-'+page,quote:'Page '+page,mode:'chat'},
          color:'yellow',rects:[{page,left:0.1,top:0.1,width:0.3,height:0.08}]})));
        window.setEnabled=setEnabled;window.setMounted=setMounted;
        useEffect(()=>{const viewer=container.current.firstChild;
          for(let n=1;n<=606;n++){const page=document.createElement('div');page.className='page';
            page.dataset.pageNumber=String(n);page.append(text(n));viewer.append(page);}
          window.resetPage=n=>{document.querySelector('.page[data-page-number="'+n+'"]').replaceChildren(text(n))};
          window.replacePage=n=>{const old=document.querySelector('.page[data-page-number="'+n+'"]');
            const page=old.cloneNode(false);page.append(text(n));old.replaceWith(page)};
          return ()=>viewer.replaceChildren();
        },[]);
        return <><div ref={container} id="scroller"><div className="pdfViewer"/></div>
          {mounted&&<Layer containerRef={container} documentKey="pdf:test" enabled={enabled} highlights={highlights}
            onSelection={s=>window.selections.push(s)} onOpenHighlight={h=>window.opened.push(h.selection.id)}/>}</>;
      }
      app.render(<App/>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const executablePath = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
  ].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><style>
    body{margin:0}#scroller{height:400px;width:600px;overflow:auto;overflow-anchor:none}
    .page{height:300px;position:relative;border:9px solid transparent;box-sizing:border-box}.textLayer{padding:4px}
    .absolute{position:absolute}.inset-0{inset:0}.pointer-events-none{pointer-events:none}
  </style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => document.querySelectorAll('.page').length === 606);
  // Give both effects and viewport observers time to settle before measuring.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const cdp = await page.context().newCDPSession(page);
  const counters = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return cdp.send('Memory.getDOMCounters');
  };
  const empty = await counters();
  assert.equal(await page.locator('[data-pdf-highlight-host]').count(), 0);
  assert.ok(empty.jsEventListeners < 500, `empty PDF retained ${empty.jsEventListeners} listeners`);

  // Selection works before any highlight overlay exists, across page boundaries.
  await page.evaluate(() => {
    const first = document.querySelector('.page[data-page-number="1"] span').firstChild;
    const second = document.querySelector('.page[data-page-number="2"] span').firstChild;
    const range = document.createRange(); range.setStart(first, 0); range.setEnd(second, 6);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.querySelector('#scroller').dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: true, bubbles: true }));
  });
  await page.waitForFunction(() => window.selections.length === 1);
  assert.deepEqual(await page.evaluate(() => [...new Set(window.selections[0].rects.map(rect => rect.page))]), [1, 2]);
  await page.evaluate(() => { window.getSelection().removeAllRanges(); window.setHighlights([1, 100, 606]); });
  await page.locator('[data-pdf-highlight="mark-1"]').waitFor();
  assert.equal(await page.locator('[data-pdf-highlight-host]').count(), 1, 'offscreen highlights must not retain portals');
  const mark = await page.locator('[data-pdf-highlight="mark-1"]').boundingBox();
  const pageBounds = await page.locator('.page[data-page-number="1"]').boundingBox();
  assert.ok(Math.abs(mark.x - (pageBounds.x + 0.1 * pageBounds.width)) < 1, 'legacy marks retain border-box coordinates');
  assert.ok(Math.abs(mark.y - (pageBounds.y + 0.1 * pageBounds.height)) < 1);
  await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2);
  assert.deepEqual(await page.evaluate(() => window.opened), ['mark-1']);

  await page.evaluate(() => window.resetPage(1));
  await page.locator('[data-pdf-highlight="mark-1"]').waitFor();
  assert.equal(await page.locator('[data-pdf-highlight-host]').count(), 1, 'zoom must recreate a single overlay');
  await page.evaluate(() => window.replacePage(1));
  await page.locator('[data-pdf-highlight="mark-1"]').waitFor();

  await page.evaluate(() => window.setHighlights(Array.from({ length: 606 }, (_, index) => index + 1)));
  let peakListeners = empty.jsEventListeners;
  for (const number of [100, 606, 1]) {
    await page.evaluate(n => { document.querySelector('#scroller').scrollTop = (n - 1) * 300; }, number);
    await page.locator(`[data-pdf-highlight="mark-${number}"]`).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-pdf-highlight-host]').length <= 8);
    const current = await counters();
    peakListeners = Math.max(peakListeners, current.jsEventListeners);
    assert.ok(current.jsEventListeners < 2_000, `scrolling retained ${current.jsEventListeners} listeners`);
  }
  await page.evaluate(() => window.setEnabled(false));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-pdf-highlight="mark-1"]')).pointerEvents === 'none');
  assert.ok(await page.locator('[data-pdf-highlight]').count() > 0, 'tool mode must preserve existing highlights');
  await page.evaluate(() => window.setHighlights([]));
  await page.waitForFunction(() => !document.querySelector('[data-pdf-highlight-host]'));
  const cleared = await counters();
  assert.ok(cleared.jsEventListeners <= empty.jsEventListeners + 30,
    `removing highlights retained ${cleared.jsEventListeners} listeners (empty: ${empty.jsEventListeners})`);

  await page.evaluate(() => window.setHighlights([1]));
  await page.locator('[data-pdf-highlight="mark-1"]').waitFor();
  await page.evaluate(() => window.setMounted(false));
  await page.waitForFunction(() => !document.querySelector('[data-pdf-highlight-host]'));
  await page.evaluate(() => window.resetPage(1));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.locator('[data-pdf-highlight-host]').count(), 0, 'unmounted observers must not recreate hosts');
  await page.evaluate(() => window.dispose());
  assert.deepEqual(errors, []);
  t.diagnostic(`606-page PDF: ${empty.jsEventListeners} listeners empty, ${peakListeners} while scrolling highlights on every page, ${cleared.jsEventListeners} after clearing`);
});

// Real PDF preparation, session hook, attachment renderer and notification
// presence; replace only the large panel's controls and HTTP service boundary.
test('PDF sends render immediately, cancel preparation, and publish viewing presence', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef,useState} from 'react'; import {createRoot} from 'react-dom/client';
      import PdfAssistant from './src/app/components/pdf-assistant';
      import {isChatNotificationTargetViewed} from './src/lib/chat-notification-inbox';
      window.isViewed=isChatNotificationTargetViewed;
      window.pageReads=[];
      window.readPdfBytes=async()=>new Uint8Array([37,80,68,70]);
      function App(){
        const [currentPage,setCurrentPage]=useState(1);window.setPdfPage=setCurrentPage;
        const container=useRef(null);
        const pdf=useRef({numPages:65,getPage:async n=>{
          window.pageReads.push(n);
          return {getTextContent:async()=>({items:window.scanned?[]:[{str:'Lecture 3'}]})};
        }});
        return <><div ref={container} style={{width:600,height:400,overflow:'auto'}}><div className="page" data-page-number={currentPage} data-loaded="true" style={{width:600,height:400}}><div className="canvasWrapper"><canvas width={600} height={400}/></div></div></div><PdfAssistant documentKey="pdf:1234abcd" title="Study guide"
          fileName="studyguide.pdf" pageNumber={currentPage} pageCount={65} loading={false} selectionEnabled={false}
          containerRef={container} pdfDocumentRef={pdf} getBytes={()=>window.readPdfBytes()}/></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: 'bundle.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'panel-controls', setup(builder) {
      const stubs = {
        './hermes/agent-runtime-panel': `
          import Attachments from '${root.replaceAll('\\', '/')}src/app/components/chat-message-attachments';
          import ActivityPanel from '${root.replaceAll('\\', '/')}src/app/components/hermes/activity-panel';
          export default function Panel(p){window.panel=p; return <div>
            {p.messages.map(m=><div key={m.id}><p>{m.content}</p><Attachments attachments={m.attachments} attachmentNames={m.attachmentNames}/></div>)}
            <ActivityPanel activities={p.activities} connection={p.connection} pendingPermission={null}
              onPermissionDecision={()=>{}} preparationLabel={p.preparationLabel}
              stateFailed={p.runState==='error'||p.runState==='cancelled'}/>
            <textarea aria-label="Message" disabled={p.disabled} value={p.input} onChange={e=>p.onInputChange(e.target.value)}/>
            <button disabled={p.disabled} onClick={p.onSubmit}>Send</button>
            <button onClick={p.onAbort}>Stop</button><output>{p.runState}</output><p>{p.error}</p>
            <button onClick={()=>p.onRetryMessage(p.messages.findLastIndex(m=>m.role==='user'),'retry-pdf')}>Regenerate</button>
          </div>}`,
        './pdf-selection-layer': 'export default function Selection(){return null}; export const pdfHighlightAnchor=()=>null;',
        './inline-artifact-cards': 'export const primeInlineArtifacts=async()=>[];',
        'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
        'next/dynamic': 'export default function dynamic(){return ()=>null}',
        'next/navigation': 'export const useRouter=()=>({push(){}}); export const usePathname=()=>"/pdf"; export const useSearchParams=()=>new URLSearchParams();',
      };
      builder.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  const decisions = [];
  const turns = [];
  const uploads = [];
  const answers = [];
  const stops = [];
  const creations = [];
  const agentTurns = [];
  let savedDetails = null;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bundle.js') {
      response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><style>.hidden{display:none}</style><div id="root"></div><script src="/bundle.js"></script>'); return;
    }
    response.setHeader('content-type', 'application/json');
    let raw = ''; for await (const chunk of request) raw += chunk;
    if (url.pathname === '/api/pdf-assistant/view-decision') { response.question=JSON.parse(raw).question; decisions.push(response); return; }
    if (url.pathname === '/api/chat-attachments/documents') {
      uploads.push(request.headers['x-pdf-ocr-pages']);
      response.end(JSON.stringify({blobId:`doc_${'a'.repeat(32)}`,format:'pdf',text:'Lecture 3, including OCR from the scanned page.',sizeBytes:4})); return;
    }
    if (url.pathname === '/api/hermes/sessions' && request.method === 'POST') {
      creations.push(JSON.parse(raw));
      response.end(JSON.stringify({session:{id:creations.length===1?'conv_pdf':`conv_pdf_${creations.length}`,activeDirectory:null},initialTurnReserved:true})); return;
    }
    if (url.pathname === '/api/hermes/sessions') { response.end(JSON.stringify({sessions:savedDetails?[savedDetails]:[]})); return; }
    if (url.pathname === '/api/hermes/sessions/conv_pdf') { response.end(JSON.stringify({session:savedDetails})); return; }
    if (url.pathname.endsWith('/messages') && request.method==='POST') { agentTurns.push(JSON.parse(raw)); response.end('{"accepted":true,"runId":"inline-agent-run"}'); return; }
    if (url.pathname.endsWith('/direct')) { const turn=JSON.parse(raw); turns.push(turn); response.turn=turn; answers.push(response); response.flushHeaders(); return; }
    if (url.pathname.endsWith('/abort')) { stops.push(url.searchParams.get('inlineTurnId')); response.end('{"aborted":true}'); return; }
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const executablePath = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
  ].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? {executablePath} : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('breadboard:agent-mode', 'false');
    const state = {selfId:1,activeId:1,windowFocused:true,enabled:true,tabs:[],extensions:[]};
    let listener;
    window.breadboardDesktop = {getTabsState:async()=>state,onTabsState:cb=>{listener=cb;return()=>{};}};
    window.setFocus = focused => {state.windowFocused=focused;listener?.({...state});};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', {name:'Open PDF assistant',exact:true}).click();
  await page.waitForFunction(() => window.panel && !window.panel.disabled);
  await page.getByRole('textbox', {name:'Message'}).fill('Make a study plan');
  await page.getByRole('button', {name:'Send',exact:true}).click();
  await page.waitForFunction(() => window.panel.messages.some(m=>m.content==='Make a study plan'));
  assert.equal(await page.getByRole('textbox', {name:'Message'}).inputValue(), '');
  assert.equal(await page.locator('output').textContent(), 'submitting');
  assert.equal(turns.length, 0, 'the message must be visible while PDF preparation is still pending');
  await page.getByRole('button', {name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  assert.equal(decisions.length, 1, 'a duplicate Send cannot start another preparation');
  assert.equal(await page.evaluate(() => window.panel.preparationLabel), 'Choosing PDF context');
  assert.equal(await page.getByText('Choosing PDF context',{exact:true}).count(), 1, 'preparation shows immediately in the real response metadata');
  assert.equal(await page.getByText('↓ usage pending',{exact:true}).count(), 0, 'preparation does not pretend answer token usage is pending');
  decisions.shift().end('{"captureView":false}');
  await page.waitForFunction(() => window.panel.sessionId==='conv_pdf');
  await page.waitForFunction(() => window.isViewed({surface:'dashboard_terminal',chatId:'conv_pdf'}));
  await page.waitForFunction(() => window.panel.messages[0].attachments?.length===2);
  assert.equal(await page.getByText('PDF reading context.txt',{exact:true}).count(), 0);
  assert.equal(await page.getByText('studyguide.pdf',{exact:true}).count(), 0);
  await waitUntil(() => turns.length > 0);
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].attachments.map(a=>a.context), ['pdf','pdf']);
  assert.equal(turns[0].attachments.find(a=>a.type==='document').text, 'Lecture 3, including OCR from the scanned page.');
  assert.deepEqual(await page.evaluate(() => window.pageReads), [1], 'the server reading replaces the duplicate client text walk');
  assert.equal(await page.evaluate(() => window.panel.preparationLabel), undefined, 'preparation ends before answer generation');
  answers.shift().end('data: {"type":"delta","text":"Here is your plan."}\n\n');
  await page.waitForFunction(() => window.panel.runState==='completed');
  await page.getByRole('button',{name:'Close PDF assistant',exact:true}).click();
  await page.waitForFunction(() => !window.isViewed({surface:'dashboard_terminal',chatId:'conv_pdf'}));
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  await page.waitForFunction(() => window.isViewed({surface:'dashboard_terminal',chatId:'conv_pdf'}));
  await page.evaluate(() => window.setFocus(false));
  assert.equal(await page.evaluate(() => window.isViewed({surface:'dashboard_terminal',chatId:'conv_pdf'})), false);
  await page.evaluate(() => window.setFocus(true));

  await page.getByRole('textbox',{name:'Message'}).fill('Stop this preparation');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(() => window.panel.runState==='submitting');
  await waitUntil(() => decisions.length > 0);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.waitForFunction(() => window.panel.runState==='cancelled');
  decisions.splice(0).forEach(response=>response.end('{"captureView":false}'));
  assert.equal(turns.length, 1, 'stopped preparation must never dispatch a model request');
  assert.equal(await page.evaluate(() => window.panel.messages.at(-1).interrupted), true);

  // Reproduce the reported stall after the context decision but before upload.
  // The worker deliberately ignores AbortSignal, like PDF.js getData/saveDocument.
  await page.evaluate(() => { window.readPdfBytes=()=>new Promise(resolve=>{window.finishOldPdfRead=resolve;}); });
  await page.getByRole('textbox',{name:'Message'}).fill('Stop a stuck PDF worker');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  decisions.shift().end('{"captureView":false}');
  await page.waitForFunction(() => window.panel.preparationLabel==='Preparing the PDF file');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.waitForFunction(() => window.panel.runState==='cancelled' && !window.panel.preparationLabel);

  await page.clock.install();
  await page.getByRole('textbox',{name:'Message'}).fill('Time out a stuck PDF worker');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  decisions.shift().end('{"captureView":false}');
  await page.waitForFunction(() => window.panel.preparationLabel==='Preparing the PDF file');
  await page.clock.fastForward(30_001);
  await page.waitForFunction(() => window.panel.runState==='error' && !window.panel.preparationLabel);
  assert.match(await page.evaluate(() => window.panel.error), /Preparing the PDF file took too long.*Regenerate/);
  assert.equal(turns.length, 1, 'a timed-out worker cannot dispatch an answer');
  await page.evaluate(() => {
    window.finishOldPdfRead(new Uint8Array([37,80,68,70]));
    window.readPdfBytes=async()=>new Uint8Array([37,80,68,70]);
  });
  await page.getByRole('button',{name:'Regenerate',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  decisions.shift().end('{"captureView":false}');
  await waitUntil(() => turns.length===2);
  assert.equal(turns[1].text ?? turns[1].instruction, 'Time out a stuck PDF worker');
  answers.shift().end('data: {"type":"delta","text":"Recovered from worker timeout."}\n\n');
  await page.waitForFunction(() => window.panel.runState==='completed');

  await page.getByRole('textbox',{name:'Message'}).fill('Recover after context failure');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  const failedDecision = decisions.shift();
  failedDecision.statusCode = 403;
  failedDecision.end('{"error":"PDF context could not be prepared."}');
  await page.waitForFunction(() => window.panel.runState==='error');
  assert.equal(await page.getByRole('textbox',{name:'Message'}).inputValue(), '');
  assert.equal(await page.evaluate(() => window.panel.messages.at(-2).content), 'Recover after context failure');
  assert.equal(await page.evaluate(() => window.panel.error), 'PDF context could not be prepared.');
  await page.getByRole('button',{name:'Regenerate',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  decisions.shift().end('{"captureView":false}');
  await waitUntil(() => turns.length===3);
  assert.equal(turns[2].attachments.length, 2, 'retry prepares one fresh context bundle');
  answers.shift().end('data: {"type":"delta","text":"Recovered answer."}\n\n');
  await page.waitForFunction(() => window.panel.runState==='completed');
  // A scan can use the assistant-requested viewport directly, without any OCR.
  await page.evaluate(() => { window.scanned=true;window.setPdfPage(39); });
  await page.getByRole('textbox',{name:'Message'}).fill('What does transient state mean?');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  decisions.shift().end('{"captureView":true,"readWholeDocument":false}');
  await waitUntil(() => turns.length===4);
  assert.equal(uploads.at(-1), '[]', 'a requested screenshot disables redundant OCR');
  assert.equal(turns[3].attachments.filter(a=>a.type==='image').length, 1);
  assert.match(turns[3].attachments.find(a=>a.type==='image').dataUrl, /^data:image\//);
  assert.match(turns[3].attachments[0].text, /"currentPage":39/);
  answers.shift().end('data: {"type":"delta","text":"An explanation from the screenshot."}\n\n');
  await page.waitForFunction(() => window.panel.runState==='completed');

  await page.evaluate(() => window.setPdfPage(40));
  await page.getByRole('textbox',{name:'Message'}).fill('Read this page');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  decisions.shift().end('{"captureView":false,"readWholeDocument":false}');
  await waitUntil(() => turns.length===5);
  assert.equal(uploads.at(-1), '[40]', 'a different page cannot reuse a screenshot-only reading as its OCR');
  answers.shift().end('data: {"type":"delta","text":"Current page reading."}\n\n');
  await page.waitForFunction(() => window.panel.runState==='completed');

  await page.getByRole('textbox',{name:'Message'}).fill('Summarize the whole document');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  decisions.shift().end('{"captureView":false,"readWholeDocument":true}');
  await waitUntil(() => turns.length===6);
  assert.equal(uploads.at(-1), undefined, 'whole-document questions still request every page');
  answers.shift().end('data: {"type":"delta","text":"Whole document summary."}\n\n');
  await page.waitForFunction(() => window.panel.runState==='completed');

  // The PDF's real preparation and session controllers must run independently.
  const selection = id => ({id,mode:'inline',sourceMessageId:'pdf:1234abcd:40',start:0,end:7,quote:'Lecture'});
  const ask = async (id,question,sourceMessageId) => page.evaluate(({selection,question}) => { void window.panel.onAskSelection(question,selection); }, {selection:{...selection(id),...(sourceMessageId?{sourceMessageId}: {})},question});
  const decide = question => { const index=decisions.findIndex(response=>response.question===question); assert.ok(index>=0,question); decisions.splice(index,1)[0].end('{"captureView":false}'); };
  const finish = (question,text) => { const index=answers.findIndex(response=>response.turn.text===question); assert.ok(index>=0,question); answers.splice(index,1)[0].end(`data: ${JSON.stringify({type:'delta',text})}\n\ndata: [DONE]\n\n`); };
  await page.getByRole('textbox',{name:'Message'}).fill('Main parallel answer');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(()=>decisions.some(response=>response.question==='Main parallel answer'));
  await page.getByRole('textbox',{name:'Message'}).fill('Keep my main draft');
  const stopsBefore=stops.length;
  const chatAnswerId=await page.evaluate(()=>window.panel.messages.findLast(m=>m.role==='assistant'&&m.content==='Whole document summary.').clientMessageId);
  assert.ok(chatAnswerId);
  await ask('side-one','First inline answer',chatAnswerId);
  await ask('side-two','Second inline answer');
  await waitUntil(()=>decisions.length===3);
  assert.equal(stops.length,stopsBefore,'asking beside the PDF must not stop the main preparation');
  assert.equal(await page.evaluate(()=>window.panel.preparationLabel),'Choosing PDF context');
  decide('Second inline answer'); decide('First inline answer'); decide('Main parallel answer');
  await waitUntil(()=>turns.length===9);
  assert.equal(turns.find(turn=>turn.text==='First inline answer').textSelection.sourceMessageId,chatAnswerId,'chat selections retain the response they came from');
  assert.equal(await page.getByRole('textbox',{name:'Message'}).inputValue(),'Keep my main draft');
  await page.waitForFunction(()=>window.panel.messages.filter(m=>m.role==='assistant'&&m.pending&&m.textSelection?.mode==='inline').length===2);
  await page.evaluate(()=>window.panel.onAbortInline('side-one'));
  await page.waitForFunction(()=>window.panel.messages.some(m=>m.textSelection?.id==='side-one'&&m.interrupted));
  assert.equal(stops.at(-1),turns.find(turn=>turn.text==='First inline answer').clientMessageId);
  assert.ok(['submitting','connecting','running'].includes(await page.evaluate(()=>window.panel.runState)));
  assert.equal(await page.evaluate(()=>window.panel.messages.findLast(m=>m.textSelection?.id==='side-two').pending),true);
  await ask('side-one','Retry first inline answer',chatAnswerId);
  await waitUntil(()=>decisions.length===1); decide('Retry first inline answer');
  await waitUntil(()=>turns.length===10);
  finish('Retry first inline answer','Retried inline result');
  finish('Main parallel answer','Main finished independently');
  await page.waitForFunction(()=>window.panel.runState==='completed'&&window.panel.messages.some(m=>m.content==='Retried inline result'&&!m.pending));
  assert.equal(await page.evaluate(()=>window.panel.messages.findLast(m=>m.textSelection?.id==='side-two').pending),true);

  // An inline-only run neither blocks a new main question nor owns its Stop.
  await page.getByRole('textbox',{name:'Message'}).fill('Another main answer');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(()=>decisions.length===1); decide('Another main answer');
  await waitUntil(()=>turns.length===11);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.waitForFunction(()=>window.panel.runState==='cancelled');
  assert.equal(stops.at(-1),null,'main Stop must not target any inline turn');
  finish('Second inline answer','Side answer survives main Stop');
  await page.waitForFunction(()=>window.panel.messages.some(m=>m.content==='Side answer survives main Stop'&&!m.pending));
  assert.equal(await page.evaluate(()=>window.panel.messages.some(m=>m.content==='Main finished independently')),true);

  // Stop before dispatch only cancels that PDF preparation; failure stays inline.
  await ask('preparing-side','Stop inline preparation');
  await waitUntil(()=>decisions.length===1);
  const turnCount=turns.length;
  await page.evaluate(()=>window.panel.onAbortInline('preparing-side'));
  await page.waitForFunction(()=>window.panel.messages.some(m=>m.textSelection?.id==='preparing-side'&&m.interrupted));
  decide('Stop inline preparation');
  assert.equal(turns.length,turnCount);
  await ask('bad-side','Fail inline preparation');
  await waitUntil(()=>decisions.length===1);
  const failedInlineDecision=decisions.shift();failedInlineDecision.statusCode=403;failedInlineDecision.end('{"error":"Inline context failed"}');
  await page.waitForFunction(()=>window.panel.messages.some(m=>m.textSelection?.id==='bad-side'&&m.failed&&m.content==='Inline context failed'));
  assert.equal(await page.evaluate(()=>window.panel.input),'');

  await page.evaluate(()=>localStorage.setItem('breadboard:agent-mode','true'));
  await ask('agent-side','Agent mode inline question');
  await waitUntil(()=>decisions.length===1); decide('Agent mode inline question');
  await waitUntil(()=>agentTurns.length===1);
  assert.equal(agentTurns[0].concurrentInline,true);
  const agentId=agentTurns[0].clientMessageId;
  const savedMessages=await page.evaluate(()=>window.panel.messages);
  savedDetails={id:'conv_pdf',pageSlug:'pdf:1234abcd',title:'Study guide',messages:savedMessages.map(m=>m.clientMessageId===agentId&&m.role==='assistant'?{...m,reasoning:'Checking the selected equation',activityLabel:'Reading PDF'}:m)};
  await page.waitForFunction(()=>window.panel.messages.some(m=>m.reasoning==='Checking the selected equation'));
  await page.evaluate(()=>localStorage.setItem('breadboard:agent-mode','false'));
  // A restored pending inline answer must not take ownership of the main run.
  await page.reload();
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  await page.waitForFunction(()=>window.panel?.sessionId==='conv_pdf'&&!window.panel.disabled);
  assert.equal(await page.evaluate(()=>window.panel.runState),'idle');
  savedDetails.messages=savedDetails.messages.map(m=>m.clientMessageId===agentId&&m.role==='assistant'?{...m,pending:false,content:'Restored agent answer',responseCompletedAt:new Date().toISOString()}:m);
  await page.waitForFunction(()=>window.panel.messages.some(m=>m.content==='Restored agent answer'&&!m.pending));

  // Simultaneous first sends must join one conversation creation.
  await page.getByRole('button',{name:'New PDF chat',exact:true}).click();
  await page.waitForFunction(()=>window.panel.sessionId===null);
  const creationsBefore=creations.length;
  await ask('cold-one','First cold inline question');
  await ask('cold-two','Second cold inline question');
  await page.getByRole('textbox',{name:'Message'}).fill('First cold main question');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(()=>decisions.length===3);
  decide('First cold main question');decide('First cold inline question');decide('Second cold inline question');
  await waitUntil(()=>turns.length===turnCount+3);
  assert.equal(creations.length,creationsBefore+1);
  finish('First cold main question','Cold main completed');finish('First cold inline question','Cold one completed');finish('Second cold inline question','Cold two completed');
  await page.waitForFunction(()=>window.panel.runState==='completed'&&window.panel.messages.some(m=>m.content==='Cold two completed'&&!m.pending));

  // Reproduce the screenshot: a request can stall before the server planner runs.
  // Continue automatically using the frozen send-time view, even after scrolling.
  await page.evaluate(() => window.setPdfPage(20));
  await page.waitForFunction(() => document.querySelector('.page').dataset.pageNumber==='20');
  const beforeFallback = turns.length;
  await page.getByRole('textbox',{name:'Message'}).fill('What are Chebyshev filters and what do I need to know about them?');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length===1);
  const stalledDecision = decisions.shift();
  await page.evaluate(() => window.setPdfPage(21));
  await page.clock.fastForward(8_001);
  await waitUntil(() => turns.length===beforeFallback+1);
  const fallbackTurn = turns.at(-1);
  assert.equal(uploads.at(-1), '[]', 'a stalled decision must not trigger whole-document OCR');
  assert.match(fallbackTurn.attachments[0].text, /"currentPage":20/);
  assert.equal(fallbackTurn.attachments.find(a=>a.type==='image').name, 'Current PDF view — pages 20.png');
  assert.ok(fallbackTurn.attachments.some(a=>a.type==='document'), 'the original PDF is still attached');
  assert.equal(await page.evaluate(() => window.panel.error), null);
  assert.equal(await page.evaluate(() => window.panel.preparationLabel), undefined);
  stalledDecision.end('{"captureView":false,"readWholeDocument":true}');
  finish(fallbackTurn.text, 'Chebyshev filters use ripple to get a sharper transition.');
  await page.waitForFunction(() => window.panel.runState==='completed');
  assert.equal(turns.length, beforeFallback+1, 'late decisions must not dispatch another answer');

  await page.getByRole('textbox',{name:'Message'}).fill('Continue when the planning service is unavailable');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length===1);
  const unavailableDecision = decisions.shift();
  unavailableDecision.statusCode = 503;
  unavailableDecision.end('{"error":"Planner unavailable"}');
  await waitUntil(() => turns.length===beforeFallback+2);
  assert.equal(turns.at(-1).attachments.filter(a=>a.type==='image').length, 1);
  finish('Continue when the planning service is unavailable', 'Answered with the PDF and visible page.');
  await page.waitForFunction(() => window.panel.runState==='completed');
  assert.deepEqual(errors, []);
});
