import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

// Exercise the reader, session hook, runtime panel and selection UI together.
// Only the unrelated composer widgets and HTTP/model boundary are replaced.
test('PDF marks support repeated text, drag selection, inline answers and nested follow-ups', { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({ bundle: true, write: false, outfile: 'bundle.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef} from 'react'; import {createRoot} from 'react-dom/client';
      import PdfAssistant from './src/app/components/pdf-assistant';
      function App(){
        const container=useRef(null);
        const pdf=useRef({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'Repeated phrase. Repeated phrase.'}]})})});
        return <><div id="scroller" ref={container}><div className="page" data-page-number="1">
          <div className="textLayer"><span id="first">Repeated phrase. </span><span id="second">Repeated phrase. </span></div>
        </div></div><PdfAssistant documentKey="pdf:1234abcd" title="Study guide" fileName="studyguide.pdf"
          sourceUrl="/api/documents/study-guide/source-pdf?clusterSlug=physics"
          pageNumber={1} pageCount={1} loading={false} selectionEnabled containerRef={container}
          pdfDocumentRef={pdf} getBytes={async()=>new Uint8Array([37,80,68,70])}/></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: 'controls', setup(builder) {
      const stubs = {
        '@/app/components/assistant-composer': `export default function Composer(p){return <div>{p.headerContent}
          <textarea ref={p.textareaRef} aria-label="Message" value={p.value} onChange={e=>p.onChange(e.target.value)}/>
          <button onClick={p.onSubmit}>Send</button></div>}`,
        'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
        'next/dynamic': 'export default function dynamic(){return ()=>null}',
        'next/navigation': 'export const useRouter=()=>({push(){},refresh(){}}); export const usePathname=()=>"/pdf"; export const useSearchParams=()=>new URLSearchParams();',
      };
      builder.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  const saved = new Map();
  const turns = [];
  const messages = [];
  const pending = [];
  const starWrites = [];
  let stars = [];
  let aborts = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bundle.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8'); response.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(`<!doctype html><style>
        body{margin:0;font:16px Arial;--selection-yellow:#ffe08a;--selection-highlight-blue:#8cf}
        #scroller{position:absolute;left:20px;top:30px;width:800px;height:650px;overflow:auto}
        .page{position:relative;width:800px;height:1200px;border:9px solid transparent}.textLayer{position:absolute;inset:0;font:20px/30px monospace}
        #first,#second{position:absolute;left:40px;top:80px}#second{top:220px}
        .absolute{position:absolute}.inset-0{inset:0}.pointer-events-none{pointer-events:none}.hidden{display:none}
        #pdf-assistant-panel:not(.hidden){position:fixed;right:20px;top:20px;bottom:20px;width:420px;background:#eee}
        .bb-composer-overlay{position:fixed;right:30px;bottom:20px;width:380px}
        .bb-inline-answer,.bb-chat-selection-menu{position:fixed;background:white;border:1px solid #888;padding:12px;box-sizing:border-box}
        .bb-chat-selection-menu{z-index:80}.bb-inline-answer{overflow:auto}.bb-inline-answer p{margin:8px 0}svg{width:16px;height:16px}
        .bb-chat-scroller{max-height:650px;overflow:auto}button{cursor:pointer}textarea{display:block}
      </style><div id="root"></div><script src="/bundle.js"></script>`); return;
    }
    response.setHeader('content-type', 'application/json');
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = raw.startsWith('{') ? JSON.parse(raw) : {};
    if (url.pathname === '/api/starred-messages') {
      if (request.method === 'PUT') {
        starWrites.push(body);
        const saved = messages.find(message => message.role === 'assistant' && message.clientMessageId === body.messageId);
        assert.ok(saved, 'stars must use persisted turn identities, not the selection/display id');
        stars = stars.filter(star => star.clientMessageId !== body.messageId);
        if (body.starred) stars.push({conversationId:'conv_pdf',messageId:saved.id,clientMessageId:body.messageId,gardenSlug:'physics'});
      }
      response.end(JSON.stringify({messages:stars})); return;
    }
    if (url.pathname === '/api/text-highlights') {
      const entries = saved.get(body.key) ?? new Map();
      for (const entry of body.entries ?? []) entries.set(entry.id ?? entry.selection?.id, entry);
      for (const mutation of body.mutations ?? []) {
        if (mutation.value === null) entries.delete(mutation.id);
        else entries.set(mutation.id, mutation.value);
      }
      saved.set(body.key, entries);
      response.end(JSON.stringify({entries:[...entries.values()],acknowledged:(body.mutations??[]).map(m=>m.operationId)})); return;
    }
    if (url.pathname === '/api/pdf-assistant/view-decision') { response.end('{"captureView":false}'); return; }
    if (url.pathname === '/api/chat-attachments/documents') {
      response.end(JSON.stringify({blobId:`doc_${'a'.repeat(32)}`,format:'pdf',text:'Repeated phrase. Repeated phrase.',sizeBytes:4})); return;
    }
    if (url.pathname === '/api/hermes/sessions' && request.method === 'POST') {
      response.end(JSON.stringify({session:{id:'conv_pdf',activeDirectory:null},initialTurnReserved:true})); return;
    }
    if (url.pathname === '/api/hermes/sessions/conv_pdf') { response.end(JSON.stringify({session:{id:'conv_pdf',messages}})); return; }
    if (url.pathname === '/api/hermes/sessions') { response.end('{"sessions":[]}'); return; }
    if (url.pathname.endsWith('/abort')) {
      aborts++;
      const inlineTurnId = url.searchParams.get('inlineTurnId');
      for (let index = pending.length - 1; index >= 0; index--) {
        if ((pending[index].inlineTurnId ?? null) === inlineTurnId) pending.splice(index, 1)[0].end();
      }
      response.end('{}'); return;
    }
    if (url.pathname.endsWith('/direct')) {
      response.setHeader('content-type','text/event-stream'); response.flushHeaders();
      response.inlineTurnId = body.concurrentInline ? body.clientMessageId : null;
      turns.push(body); pending.push(response);
      messages.push({id:'user_'+turns.length,clientMessageId:body.clientMessageId,role:'user',content:body.text,textSelection:body.textSelection},
        {id:'answer_'+turns.length,clientMessageId:body.clientMessageId,role:'assistant',content:turns.length===1?'An explanation of the repeated phrase.':'The phrase appears twice.',textSelection:body.textSelection});
      return;
    }
    response.end('{"artifacts":[],"messages":[],"models":[]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve=>server.close(resolve)); });
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1400,height:950}});
  page.setDefaultTimeout(8_000);
  const errors=[]; page.on('pageerror', error=>{ errors.push(error.message); t.diagnostic(String(error)); });
  page.on('console', message=>{ if(message.type()==='error') t.diagnostic(message.text()); });
  await page.addInitScript(()=>localStorage.setItem('breadboard:agent-mode','false'));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#first').waitFor();
  const select = async (selector, text) => {
    await page.locator(selector).evaluate((element,text) => {
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
      let node; while((node=walker.nextNode())) {
        const start=node.textContent.indexOf(text); if(start<0) continue;
        const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+text.length);
        getSelection().removeAllRanges();getSelection().addRange(range);
        element.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',shiftKey:true,bubbles:true}));return;
      }
      throw new Error('Selection text missing: '+text);
    },text);
  };
  const mark = async selector => {
    await select(selector,'Repeated phrase');
    await page.getByRole('button',{name:'Highlight blue',exact:true}).click();
  };
  await mark('#first');
  await mark('#second');
  await expect(page.locator('[data-pdf-highlight]')).toHaveCount(2);
  const entries=await page.evaluate(()=>JSON.parse(localStorage.getItem('breadboard:pdf-highlights:pdf:1234abcd')));
  assert.deepEqual(entries.map(e=>e.selection.start).sort((a,b)=>a-b),[0,17]);
  assert.ok(entries.every(e=>e.rects.length===1),'a selected span must paint once');
  assert.ok(entries.every(e=>e.coordinateSpace==='content'));
  const assertAligned = async () => {
    const positions=await page.evaluate(()=>{
      const entries=JSON.parse(localStorage.getItem('breadboard:pdf-highlights:pdf:1234abcd'));
      return entries.map(entry=>{
        const span=document.querySelector(entry.selection.start===0?'#first':'#second');
        const range=document.createRange();range.setStart(span.firstChild,0);range.setEnd(span.firstChild,entry.selection.quote.length);
        const text=range.getBoundingClientRect();
        const mark=document.querySelector('[data-pdf-highlight="'+entry.selection.id+'"]').getBoundingClientRect();
        return ['left','top','width','height'].map(key=>Math.abs(text[key]-mark[key]));
      });
    });
    assert.ok(positions.flat().every(delta=>delta<2),`marks must match selected glyphs: ${JSON.stringify(positions)}`);
  };
  await assertAligned();

  // Start a real native drag inside an existing highlight.
  const first=await page.locator('#first').boundingBox();
  await page.mouse.move(first.x+3,first.y+10);await page.mouse.down();
  await page.mouse.move(first.x+100,first.y+10,{steps:8});await page.mouse.up();
  assert.ok((await page.evaluate(()=>getSelection().toString())).length>3);
  await page.keyboard.press('Escape');

  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep my main chat draft');
  await page.getByRole('button',{name:'Close PDF assistant',exact:true}).click();
  await select('#second','Repeated phrase');
  await page.getByRole('button',{name:'Ask here',exact:true}).click();
  const inlineEditor = () => page.locator('.bb-inline-answer').last().getByRole('textbox',{name:'Edit question about highlighted text'});
  await expect(inlineEditor()).toBeFocused();
  await expect(page.getByRole('complementary',{name:'PDF assistant',exact:true})).toBeHidden();
  assert.equal(turns.length,0,'opening Ask here does not submit a turn');
  await inlineEditor().fill('Explain the second occurrence');
  await inlineEditor().press('Enter');
  await expect(page.locator('.bb-inline-answer')).toBeVisible();
  await expect.poll(()=>turns.length).toBe(1);
  await expect(page.locator('#pdf-assistant-panel textarea')).toHaveValue('Keep my main chat draft');
  assert.equal(turns[0].textSelection.start,17);
  assert.equal(turns[0].textSelection.quote,'Repeated phrase');
  const thinking = 'I will compare this occurrence with the surrounding paragraph.';
  messages.at(-1).reasoning = thinking;
  pending.shift().end('data: '+JSON.stringify({type:'thinking',text:thinking})+'\n\ndata: {"type":"delta","text":"An explanation of the repeated phrase."}\n\n');
  await expect(page.locator('.bb-inline-answer')).toContainText('An explanation of the repeated phrase.');
  await page.locator('.bb-inline-answer').getByRole('button',{name:'Star message',exact:true}).click();
  await expect(page.locator('.bb-inline-answer').getByRole('button',{name:'Unstar message',exact:true})).toBeVisible();
  assert.deepEqual(starWrites[0], {conversationId:'conv_pdf',messageId:turns[0].clientMessageId,starred:true,
    sourceUrl:'/api/documents/study-guide/source-pdf?clusterSlug=physics'});
  await page.locator('.bb-inline-answer').getByTitle('Show thinking updates').click();
  await expect(page.getByRole('list',{name:'Thinking updates'})).toContainText(thinking);
  await page.locator('.bb-inline-answer').getByTitle('Hide thinking updates').click();
  await expect(page.locator('.bb-chat-scroller')).not.toContainText('An explanation of the repeated phrase.');

  await select('.bb-inline-answer [data-chat-selectable-message]','repeated phrase');
  await page.getByRole('button',{name:'Ask here',exact:true}).click();
  await expect(inlineEditor()).toBeFocused();
  await expect(page.getByRole('complementary',{name:'PDF assistant',exact:true})).toBeHidden();
  await inlineEditor().fill('Why does it repeat?');
  await inlineEditor().press('Enter');
  await expect.poll(()=>turns.length).toBe(2);
  pending.shift().end('data: {"type":"delta","text":"The phrase appears twice."}\n\n');
  // The nested question opens directly and both cards remain usable.
  await expect(page.locator('.bb-inline-answer')).toHaveCount(2);
  await expect(page.locator('.bb-inline-answer').last()).toContainText('The phrase appears twice.');
  await page.locator('.bb-inline-answer').last().getByRole('button',{name:'Star message',exact:true}).click();
  await expect(page.locator('.bb-inline-answer').last().getByRole('button',{name:'Unstar message',exact:true})).toBeVisible();
  assert.equal(starWrites[1].messageId, turns[1].clientMessageId);
  assert.equal(starWrites[1].sourceUrl, starWrites[0].sourceUrl);

  await page.keyboard.press('Escape');
  const second=await page.locator('#second').boundingBox();
  await page.mouse.click(second.x+25,second.y+10);
  await expect(page.locator('.bb-inline-answer')).toContainText('An explanation of the repeated phrase.');
  await page.locator('.bb-inline-answer').getByTitle('Show thinking updates').click();
  await expect(page.getByRole('list',{name:'Thinking updates'})).toContainText(thinking);
  await page.locator('.bb-inline-answer').getByTitle('Hide thinking updates').click();
  await page.locator('#scroller').evaluate(element=>{element.scrollTop=500;});
  await expect(page.locator('.bb-inline-answer')).toBeHidden();
  await page.locator('#scroller').evaluate(element=>{element.scrollTop=0;});
  await expect(page.locator('.bb-inline-answer')).toBeVisible();
  await page.evaluate(()=>{
    const page=document.querySelector('.page');page.style.width='1200px';page.style.height='1800px';
    document.querySelector('.textLayer').style.font='30px/45px monospace';
    for(const [id,top] of [['first',120],['second',330]]){
      const span=document.getElementById(id);span.style.left='60px';span.style.top=top+'px';
    }
  });
  await assertAligned();
  await expect(page.locator('.bb-inline-answer')).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-pdf-highlight]')).toHaveCount(2);
  const restored=await page.locator('#second').boundingBox();
  await page.mouse.click(restored.x+25,restored.y+10);
  await expect(page.locator('.bb-inline-answer')).toContainText('An explanation of the repeated phrase.');
  await page.locator('.bb-inline-answer [data-chat-selection-id]').click();
  await expect(page.locator('.bb-inline-answer')).toHaveCount(2);
  await expect(page.locator('.bb-inline-answer').last()).toContainText('The phrase appears twice.');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep working on the document');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(()=>turns.length).toBe(3);
  await select('#first','Repeated phrase');
  await page.getByRole('button',{name:'Ask here',exact:true}).click();
  await expect(inlineEditor()).toBeFocused();
  await inlineEditor().fill('Explain the first occurrence');
  await inlineEditor().press('Enter');
  await expect.poll(()=>turns.length).toBe(4);
  assert.equal(turns[3].textSelection.start,0,'a selection question during a response must dispatch its own turn');
  assert.equal(aborts,0,'Ask here runs alongside the main answer');
  await page.getByRole('button',{name:'Stop this answer',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop this answer',exact:true})).toHaveCount(0);
  pending.shift().end('data: {"type":"delta","text":"Main answer completed."}\n\n');
  await page.getByRole('button',{name:'More highlight actions',exact:true}).click();
  await page.getByRole('menuitem',{name:'Delete highlight',exact:true}).click();
  await expect(page.locator('[data-pdf-highlight]')).toHaveCount(1);
  await select('#first','Repeated phrase');
  await page.getByRole('button',{name:'Ask here',exact:true}).click();
  await expect(page.locator('[data-pdf-highlight]')).toHaveCount(2);
  await page.locator('.bb-inline-answer').getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('[data-pdf-highlight]')).toHaveCount(1);
  // Ask-in-chat uses the same reader color and restores its owning chat.
  await select('#first','Repeated phrase');
  await page.getByRole('button',{name:'Ask in chat',exact:true}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Explain in the main chat');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(()=>turns.length).toBe(5);
  pending.shift().end('data: {"type":"delta","text":"The phrase appears twice."}\n\n');
  const chatMark=page.getByRole('button',{name:'Open question in chat: Repeated phrase',exact:true});
  await expect(chatMark).toHaveCount(1);
  await expect(chatMark).toHaveCSS('background-color','color(srgb 1 0.878431 0.541176 / 0.45)');
  await page.reload();
  await expect(chatMark).toHaveCount(1);
  const point=await page.locator('#first').boundingBox();
  await page.mouse.click(point.x+25,point.y+10);
  await expect(page.locator('#pdf-assistant-panel')).toBeVisible();
  const question=page.locator('[data-starred-message-target]');
  await expect(question).toContainText('Explain in the main chat');
  await expect(question).toBeFocused();
  await page.locator('#pdf-assistant-panel .bb-chat-scroller').getByRole('button',{name:'Star message',exact:true}).last().click();
  await expect.poll(() => starWrites.length).toBe(3);
  assert.equal(starWrites.at(-1).messageId, turns[4].clientMessageId);
  assert.equal(starWrites.at(-1).sourceUrl, starWrites[0].sourceUrl);
  assert.deepEqual(errors,[]);
});
