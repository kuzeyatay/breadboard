// Run from dashboard: node scripts/pdf-assistant-browser-smoke.mjs
// Renders the real PDF viewer; only framework and AI service boundaries are stubbed.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../.tmp-pdf-assistant-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let n=1;n<=3;n++) {
  const page=pdf.addPage([612,792]);
  page.drawText(`Signals and systems - page ${n}`,{x:55,y:725,size:24,font});
  page.drawText('A signal carries information through a physical system.',{x:55,y:676,size:16,font});
  page.drawText(`This is physical page ${n}. The blue curve represents amplitude.`,{x:55,y:643,size:14,font});
  page.drawLine({start:{x:65,y:410},end:{x:545,y:410},color:rgb(.2,.2,.2),thickness:1});
  page.drawLine({start:{x:65,y:305},end:{x:65,y:540},color:rgb(.2,.2,.2),thickness:1});
  for(let x=65;x<540;x+=4)page.drawLine({start:{x,y:410+Math.sin((x-65)/44)*85},end:{x:x+4,y:410+Math.sin((x+4-65)/44)*85},color:rgb(.15,.35,.8),thickness:3});
  page.drawText('Figure 1. Periodic amplitude over time',{x:65,y:278,size:14,font});
}
const pdfBytes = await pdf.save();
const sessionStub = `
export * from '${root.replaceAll('\\','/')}src/app/components/hermes/use-agent-session.ts';
import {useState,useCallback} from 'react';
export function useAgentSession(surface, options) {
  const key='qa:session:'+options.pageSlug;
  const [messages,setMessages]=useState(()=>JSON.parse(localStorage.getItem(key)||'[]'));
  const [sessionId,setSessionId]=useState(messages.length?'conv_pdfqa':null);
  const [connection,setConnection]=useState('idle');
  const [runState,setRunState]=useState('idle');
  const send=async(text,opts)=>{
    window.qaSends??=[]; window.qaSends.push({text,attachments:opts.attachments,textSelection:opts.textSelection});
    opts.onTurnStarted?.(); setConnection('streaming'); setRunState('running');setSessionId('conv_pdfqa');
    const id=crypto.randomUUID(); const question={id,clientMessageId:id,role:'user',content:text,createdAt:new Date().toISOString(),textSelection:opts.textSelection};
    const answer={id:id+'a',clientMessageId:id,role:'assistant',content:'The blue curve shows a periodic signal. Its amplitude changes over time, as illustrated in Figure 1 on PDF page 1.',createdAt:new Date().toISOString(),textSelection:opts.textSelection};
    const next=[...messages,question,answer];setMessages(next);localStorage.setItem(key,JSON.stringify(next));
    opts.onTurnPersisted?.('conv_pdfqa');
    await new Promise(r=>setTimeout(r,450));setConnection('idle');setRunState('idle');
  };
  const reset=()=>{setMessages([]);setSessionId(null);};
  return {messages,sessionId,createdSessionId:sessionId,loadingSession:false,connection,runState,steerError:null,error:null,pendingPermission:null,pendingClarification:null,activities:[],send,reset,openSession:async()=>{},abort:async()=>{setConnection('idle');setRunState('idle');},steer:async()=>true,respondToPermission:async()=>{},respondToClarification:async()=>{},editAssistantMessage:async()=>true,deleteMessage:async()=>true};
}`;
const stubs={
  'next/link': 'export default function Link({children,...props}) { return <a {...props}>{children}</a>; }',
  'next/navigation': 'export function useRouter(){return {back(){},push(){},refresh(){}}};export function usePathname(){return "/pdf"};export function useSearchParams(){return new URLSearchParams()};',
  'next/dynamic': 'export default function dynamic(){return ()=>null}',
  'next-auth/react': 'export function useSession(){return {data:{user:{id:"1",name:"QA"}},status:"authenticated"}};export function signIn(){};export function signOut(){};',
  '@/app/components/navbar-flower-wind': 'export default function Flower(){return null}',
  '@/app/components/navigation-progress': 'export function startNavigationProgress(){};export function cancelNavigationProgress(){}',
  './hermes/use-agent-session': sessionStub,
};
await build({absWorkingDir:root,stdin:{contents:`import {createRoot} from 'react-dom/client';import Viewer from './src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client';createRoot(document.getElementById('root')).render(<Viewer title="Signals and systems" browserTitle="signals.pdf" sourceUrl="/fixture.pdf" readOnly showNavbarFlowers={false}/>);`,resolveDir:root,loader:'tsx'},bundle:true,outfile:fileURLToPath(new URL('bundle.js',out)),platform:'browser',define:{'process.env':'{}'},format:'iife',jsx:'automatic',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'jsx',resolveDir:root}));}}]});
const cssPath=root+'src/app/globals.css';
const css=await postcss([tailwind({base:root})]).process(await readFile(cssPath,'utf8'),{from:cssPath});
await writeFile(new URL('base.css',out),css.css);
const html=`<!doctype html><html data-theme="light" style="--font-source-sans:'Segoe UI';--font-schibsted:'Segoe UI';--font-ibm-plex-mono:monospace"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root" style="height:100vh;display:flex;flex-direction:column"></div><script src="/bundle.js"></script></body></html>`;
let uploads=0;
let captureView=true;
const viewRequests=[];
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture.pdf'){res.writeHead(200,{'content-type':'application/pdf'});res.end(pdfBytes);return;}
    if(url.pathname.startsWith('/api/pdfjs/')){
      const name=url.pathname.slice('/api/pdfjs/'.length);
      const path=name==='pdf_viewer.mjs'||name==='pdf_viewer.css'?'web/'+name:name.startsWith('images/')?'web/'+name:'build/'+name;
      res.writeHead(200,{'content-type':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/javascript'});res.end(await readFile(root+'node_modules/pdfjs-dist/legacy/'+path));return;
    }
    if(url.pathname.startsWith('/api/')){
      let data={}; if(url.pathname==='/api/hermes/commands')data={groups:{skills:[],mcp:[],prompts:[],agents:[]},runtime:{enabled:true}};
      if(url.pathname==='/api/pdf-assistant/view-decision'){
        let body='';for await(const chunk of req)body+=chunk;viewRequests.push(JSON.parse(body));data={captureView};
      }
      if(url.pathname==='/api/chat-attachments/documents'){for await(const _ of req){};uploads++;data={blobId:'doc_'+ 'a'.repeat(32),format:'pdf',sizeBytes:pdfBytes.length,text:''};}
      if(url.pathname==='/api/hermes/sessions')data={sessions:[]};
      if(url.pathname==='/api/models')data={models:['gpt-5.4']};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));return;
    }
    const name={'/base.css':'base.css','/bundle.js':'bundle.js','/bundle.css':'bundle.css'}[url.pathname];
    res.writeHead(200,{'content-type':name?.endsWith('.js')?'text/javascript':name?.endsWith('.css')?'text/css':'text/html'});res.end(name?await readFile(new URL(name,out)):html);
  }catch(error){res.writeHead(404);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
async function selectText(needle){
  await page.evaluate(needle=>{const spans=[...document.querySelectorAll('.textLayer span')];const span=spans.find(s=>s.textContent.includes(needle));if(!span)throw new Error('missing text: '+needle);const range=document.createRange();range.selectNodeContents(span);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);span.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));},needle);
  await page.getByRole('toolbar',{name:'Selected text actions'}).waitFor();
}
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.page[data-loaded="true"] .textLayer span').first().waitFor({timeout:90000});
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  await page.getByRole('textbox',{name:'',exact:true}).count();
  assert.equal(await page.getByRole('button',{name:/Capture view|Preview current PDF screenshot/}).count(),0);
  assert.equal(await page.getByRole('checkbox',{name:'Include current view'}).count(),0);
  await page.screenshot({path:fileURLToPath(new URL('assistant-light.png',out))});
  await selectText('A signal carries');
  await page.getByRole('button',{name:'Highlight blue',exact:true}).click();
  const mark=page.locator('[data-pdf-highlight]').first();await mark.waitFor();
  const markColor=await mark.evaluate(n=>getComputedStyle(n).backgroundColor);
  assert.notEqual(markColor,'rgba(0, 0, 0, 0)');
  assert.ok(markColor.includes('0.45'),'reader highlights must leave PDF text legible');
  const originalBounds=await mark.boundingBox();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.waitForTimeout(450);
  await page.locator('[data-pdf-highlight]').first().waitFor();
  const zoomedBounds=await page.locator('[data-pdf-highlight]').first().boundingBox();
  assert.ok(zoomedBounds.width>originalBounds.width,'highlight geometry scales with the PDF');
  await page.reload();await page.locator('[data-pdf-highlight]').first().waitFor();
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  await selectText('This is physical page');
  await page.getByRole('button',{name:'Ask in chat',exact:true}).click();
  await page.locator('#pdf-assistant-panel textarea').fill('Explain this excerpt.');
  await page.locator('#pdf-assistant-panel textarea').press('Enter');
  await page.waitForFunction(()=>window.qaSends?.length===1,{},{timeout:45000});
  const turn=await page.evaluate(()=>window.qaSends[0]);
  assert.equal(turn.textSelection.mode,'chat');
  assert.ok(turn.attachments.some(a=>a.type==='image'&&a.dataUrl.startsWith('data:image/png;base64,')));
  assert.ok(turn.attachments.some(a=>a.type==='document'&&a.text.includes('[PDF page 3]')));
  assert.ok(turn.attachments.some(a=>a.type==='text'&&a.text.includes('"currentPage":1')));
  await page.waitForTimeout(700);
  await selectText('Figure 1. Periodic');
  await page.getByRole('button',{name:'Ask here',exact:true}).click();
  await page.locator('#pdf-assistant-panel textarea').fill('What does this figure show?');
  await page.locator('#pdf-assistant-panel textarea').press('Enter');
  await page.waitForFunction(()=>window.qaSends?.length===2,{},{timeout:45000});
  await page.getByRole('dialog',{name:'Answer about highlighted text'}).waitFor();
  await page.waitForTimeout(650);
  await page.screenshot({path:fileURLToPath(new URL('inline-answer.png',out))});
  assert.equal(uploads,1,'unchanged PDF bytes should reuse the stored document');
  await page.getByRole('button',{name:'Close PDF assistant',exact:true}).click();
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.page[data-page-number="2"]')?.dataset.loaded==='true');
  await page.locator('#pdf-assistant-panel textarea').fill('Explain page two.');
  await page.locator('#pdf-assistant-panel textarea').press('Enter');
  await page.waitForFunction(()=>window.qaSends?.length===3);
  const nextTurn=await page.evaluate(()=>window.qaSends[2]);
  assert.ok(nextTurn.attachments.some(a=>a.type==='text'&&a.text.includes('"currentPage":2')));
  assert.notEqual(nextTurn.attachments.find(a=>a.type==='image').dataUrl,turn.attachments.find(a=>a.type==='image').dataUrl,'each question captures the new visible page');
  await page.waitForTimeout(650);
  await page.evaluate(()=>{document.querySelector('.page[data-page-number="2"]').dataset.loaded='false';});
  await page.locator('#pdf-assistant-panel textarea').fill('Keep my question if capture fails.');
  await page.locator('#pdf-assistant-panel textarea').press('Enter');
  await page.getByText('The visible PDF page is still rendering. Try your question again when it is ready.',{exact:true}).waitFor();
  assert.equal(await page.locator('#pdf-assistant-panel textarea').inputValue(),'Keep my question if capture fails.');
  assert.equal(await page.evaluate(()=>window.qaSends.length),3);
  await page.evaluate(()=>{document.querySelector('.page[data-page-number="2"]').dataset.loaded='true';});
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.waitForFunction(()=>window.qaSends?.length===4);
  assert.ok((await page.evaluate(()=>window.qaSends[3].attachments)).some(a=>a.type==='image'));
  await page.waitForTimeout(650);
  captureView=false;
  await page.evaluate(()=>{document.querySelector('.page[data-page-number="2"]').dataset.loaded='false';});
  await page.locator('#pdf-assistant-panel textarea').fill('Summarize the document text.');
  await page.locator('#pdf-assistant-panel textarea').press('Enter');
  await page.waitForFunction(()=>window.qaSends?.length===5);
  assert.ok(!(await page.evaluate(()=>window.qaSends[4].attachments)).some(a=>a.type==='image'),'no capture when the assistant chooses document text alone, even if canvas is not rendered');
  assert.equal(viewRequests.at(-1).question,'Summarize the document text.');
  assert.ok(viewRequests.at(-1).pageText.includes('physical page 2'));
  assert.ok(viewRequests.at(-1).history.length>0,'the assistant gets recent conversation for follow-up decisions');
  await page.evaluate(()=>{document.querySelector('.page[data-page-number="2"]').dataset.loaded='true';});
  await page.waitForTimeout(650);
  await page.evaluate(()=>{
    const root=document.querySelector('[data-chat-selectable-message]');
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const text=walker.nextNode();
    const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(text.length,30));getSelection().removeAllRanges();getSelection().addRange(range);
    root.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  });
  await page.getByRole('toolbar',{name:'Selected text actions'}).waitFor();
  await page.getByRole('button',{name:'Highlight green',exact:true}).click();
  await page.locator('[data-chat-highlight-color="green"]').first().waitFor();
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.waitForTimeout(350);
  await page.screenshot({path:fileURLToPath(new URL('assistant-dark.png',out))});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Close PDF assistant',exact:true}).click();
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  const panelBounds=await page.locator('#pdf-assistant-panel').boundingBox();assert.ok(panelBounds.x>=0&&panelBounds.x+panelBounds.width<=391);
  await page.screenshot({path:fileURLToPath(new URL('assistant-mobile.png',out))});
  assert.deepEqual(errors,[]);
  await writeFile(new URL('results.json',out),JSON.stringify({passed:true,uploads,turns:await page.evaluate(()=>window.qaSends.length),errors},null,2));
  console.log('PASS: real PDF.js rendering, screenshot capture, full document context, saved highlights, Ask in chat, Ask here, cached uploads, dark theme and mobile panel.');
}catch(error){await page.screenshot({path:fileURLToPath(new URL('failure.png',out))});console.log('Browser errors:',errors);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
