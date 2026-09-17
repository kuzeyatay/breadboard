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

// Real PDF preparation, session hook, attachment renderer and notification
// presence; replace only the large panel's controls and HTTP service boundary.
test('PDF sends render immediately, cancel preparation, and publish viewing presence', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef} from 'react'; import {createRoot} from 'react-dom/client';
      import PdfAssistant from './src/app/components/pdf-assistant';
      import {isChatNotificationTargetViewed} from './src/lib/chat-notification-inbox';
      window.isViewed=isChatNotificationTargetViewed;
      function App(){
        const container=useRef(null);
        const pdf=useRef({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'Lecture 3'}]})})});
        return <><div ref={container}>PDF page</div><PdfAssistant documentKey="pdf:1234abcd" title="Study guide"
          fileName="studyguide.pdf" pageNumber={1} pageCount={1} loading={false} selectionEnabled={false}
          containerRef={container} pdfDocumentRef={pdf} getBytes={async()=>new Uint8Array([37,80,68,70])}/></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: 'bundle.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'panel-controls', setup(builder) {
      const stubs = {
        './hermes/agent-runtime-panel': `
          import Attachments from '${root.replaceAll('\\', '/')}src/app/components/chat-message-attachments';
          export default function Panel(p){window.panel=p; return <div>
            {p.messages.map(m=><div key={m.id}><p>{m.content}</p><Attachments attachments={m.attachments} attachmentNames={m.attachmentNames}/></div>)}
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
  const answers = [];
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
    if (url.pathname === '/api/pdf-assistant/view-decision') { decisions.push(response); return; }
    if (url.pathname === '/api/chat-attachments/documents') {
      response.end(JSON.stringify({blobId:`doc_${'a'.repeat(32)}`,format:'pdf',text:'Lecture 3, including OCR from the scanned page.',sizeBytes:4})); return;
    }
    if (url.pathname === '/api/hermes/sessions' && request.method === 'POST') {
      response.end(JSON.stringify({session:{id:'conv_pdf',activeDirectory:null},initialTurnReserved:true})); return;
    }
    if (url.pathname === '/api/hermes/sessions') { response.end('{"sessions":[]}'); return; }
    if (url.pathname.endsWith('/direct')) { turns.push(JSON.parse(raw)); answers.push(response); return; }
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

  await page.getByRole('textbox',{name:'Message'}).fill('Recover after context failure');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  const failedDecision = decisions.shift();
  failedDecision.statusCode = 500;
  failedDecision.end('{"error":"PDF context could not be prepared."}');
  await page.waitForFunction(() => window.panel.runState==='error');
  assert.equal(await page.getByRole('textbox',{name:'Message'}).inputValue(), '');
  assert.equal(await page.evaluate(() => window.panel.messages.at(-2).content), 'Recover after context failure');
  assert.equal(await page.evaluate(() => window.panel.error), 'PDF context could not be prepared.');
  await page.getByRole('button',{name:'Regenerate',exact:true}).click();
  await waitUntil(() => decisions.length > 0);
  decisions.shift().end('{"captureView":false}');
  await waitUntil(() => turns.length===2);
  assert.equal(turns[1].attachments.length, 2, 'retry prepares one fresh context bundle');
  answers.shift().end('data: {"type":"delta","text":"Recovered answer."}\n\n');
  await page.waitForFunction(() => window.panel.runState==='completed');
  assert.deepEqual(errors, []);
});
