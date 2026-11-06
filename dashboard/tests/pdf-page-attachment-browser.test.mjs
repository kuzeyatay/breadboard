import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");

test("PDF messages retain the page and pixels from Send through preparation, queueing, and reload", { timeout: 120_000 }, async (t) => {
  const sessionStub = `
    export * from '${root.replaceAll("\\", "/")}/src/app/components/hermes/use-agent-session.ts';
    import {useState} from 'react';
    import {chatMessageAttachments,normalizeChatMessageAttachments} from '@/lib/chat-attachments';
    export function useAgentSession(){
      const [messages,setMessages]=useState(()=>JSON.parse(localStorage.getItem('qa:pdf-messages')||'[]'));
      const [connection,setConnection]=useState('idle');
      const [runState,setRunState]=useState('idle');
      const send=async(text,opts)=>{
        const id=crypto.randomUUID();
        const question={id,clientMessageId:id,role:'user',content:text,createdAt:new Date().toISOString(),attachments:chatMessageAttachments(opts.attachments)};
        const answer={id:id+'a',clientMessageId:id,role:'assistant',content:'',sources:[],pending:true};
        setMessages(current=>[...current,question,answer]);
        setConnection('streaming');setRunState('running');opts.onTurnStarted?.();
        const attachments=await opts.prepareAttachments(new AbortController().signal);
        window.qaSends??=[];window.qaSends.push({text,attachments});
        question.attachments=normalizeChatMessageAttachments(JSON.parse(JSON.stringify(chatMessageAttachments(attachments))));
        setMessages(current=>current.map(item=>item.id===id?{...question}:item));
        if(window.qaHoldResponse)await new Promise(resolve=>window.qaFinishResponse=resolve);
        answer.content='The explanation for '+text;answer.pending=false;
        setMessages(current=>{const next=current.map(item=>item.id===id+'a'?{...answer}:item);localStorage.setItem('qa:pdf-messages',JSON.stringify(next));return next;});
        setConnection('idle');setRunState('idle');opts.onTurnPersisted?.('conv_pdfqa');
      };
      return {messages,sessionId:'conv_pdfqa',createdSessionId:'conv_pdfqa',loadingSession:false,connection,runState,
        steerError:null,error:null,pendingPermission:null,pendingClarification:null,activities:[],send,reset(){setMessages([])},
        openSession:async()=>{},abort:async()=>{},steer:async()=>true,respondToPermission:async()=>{},respondToClarification:async()=>{},
        editAssistantMessage:async()=>true,deleteMessage:async()=>true};
    }
  `;
  const stubs = {
    "./hermes/use-agent-session": sessionStub,
    "next/link": "export default function Link({children,...props}){return <a {...props}>{children}</a>}",
    "next/navigation": "export function useRouter(){return {push(){},refresh(){}}};export function usePathname(){return '/pdf'};export function useSearchParams(){return new URLSearchParams()}",
    "next-auth/react": "export function useSession(){return {data:{user:{id:'1'}},status:'authenticated'}};export function signIn(){};export function signOut(){};",
    "next/dynamic": "export default function dynamic(){return ()=>null}",
  };
  const bundle = await build({bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",outdir:"pdf-page-test",
    alias:{"@":path.join(root,"src")},define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},
    stdin:{resolveDir:root,loader:"tsx",contents:`
      import React,{useRef,useState,useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';
      import PdfAssistant from '@/app/components/pdf-assistant';
      import {capturePdfViewport} from '@/lib/pdf-assistant';
      function App(){
        const [page,setPage]=useState(1);const container=useRef(null);const canvas=useRef(null);
        const pdf=useRef({numPages:3,getPage:async(n)=>({getTextContent:async()=>({items:[{str:'Text of page '+n}]})})});
        window.qaCapturePdfViewport=()=>capturePdfViewport(container.current);
        useLayoutEffect(()=>{const ctx=canvas.current.getContext('2d');ctx.fillStyle=['red','blue','green'][page-1];ctx.fillRect(0,0,600,600)},[page]);
        return <main style={{height:'100vh'}}><button onClick={()=>setPage(n=>n%3+1)}>Next PDF page</button>
          <div ref={container} style={{width:600,height:600,overflow:'hidden',background:'white'}}>
            <div className="page" data-page-number={page} data-loaded="true" style={{width:600,height:600,position:'relative'}}>
              <div className="canvasWrapper"><canvas ref={canvas} width={600} height={600} style={{width:600,height:600}}/></div>
              <div className="annotationLayer" style={{position:'absolute',top:0,left:0,width:600,height:600}}/>
            </div>
          </div>
          <PdfAssistant documentKey="pdf:123456789abcdef0" sourceUrl="/sample.pdf" title="Lecture 2.1: Filters" fileName="filters.pdf"
            pageNumber={page} pageCount={3} loading={false} selectionEnabled={false} containerRef={container} pdfDocumentRef={pdf}
            getBytes={async()=>new Uint8Array([37,80,68,70])}/>
        </main>
      }createRoot(document.getElementById('root')).render(<App/>);
    `},plugins:[{name:"boundaries",setup(b){
      b.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:"stub"}:undefined);
      b.onLoad({filter:/.*/,namespace:"stub"},args=>({contents:stubs[args.path],loader:"jsx",resolveDir:root}));
    }}]});
  const stylesheet=path.join(root,"src/app/globals.css");
  const css=(await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,"utf8"),{from:stylesheet})).css;
  const browser=await chromium.launch({headless:true,channel:"msedge"});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1250,height:950}});
  page.setDefaultTimeout(15_000);
  const errors=[];page.on("pageerror",error=>errors.push(error.stack));
  t.after(()=>{if(errors.length)console.error('Browser errors:',errors)});
  const decisions=[];let releaseDecision;let holdDecision=false;let captureView=true;
  await page.route("https://pdf-page.test/**",async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==="/api/pdf-assistant/view-decision"){
      decisions.push(route.request().postDataJSON());
      if(holdDecision)await new Promise(resolve=>releaseDecision=resolve);
      return route.fulfill({json:{captureView}});
    }
    if(url.pathname==="/api/chat-attachments/documents")return route.fulfill({json:{blobId:'doc_'+'a'.repeat(32),format:'pdf',text:'Full PDF text',sizeBytes:4}});
    if(url.pathname==="/api/hermes/commands")return route.fulfill({json:{groups:{skills:[],mcp:[],prompts:[],agents:[]},runtime:{enabled:true}}});
    if(url.pathname==="/api/assistant-preferences")return route.fulfill({json:{model:"gpt-5.6-sol",reasoningEffort:"medium",agentMode:false,superAgent:false}});
    if(url.pathname.startsWith("/api/"))return route.fulfill({json:{messages:[],sessions:[],artifacts:[],highlights:[],models:["gpt-5.6-sol"],capabilities:[],modelsHealth:{}}});
    return route.fulfill({contentType:"text/html",body:'<!doctype html><html data-theme="light"><div id="root"></div></html>'});
  });
  async function load(){
    await page.goto("https://pdf-page.test");
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
    await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  }
  async function send(text){const input=page.locator('#pdf-assistant-panel textarea');await input.fill(text);await input.press('Enter');}
  const chips=page.getByTestId('pdf-page-attachment');
  await load();
  const annotationPixel=await page.evaluate(async()=>{
    const layer=document.querySelector('.annotationLayer');
    const mark=document.createElement('div');
    mark.style.cssText='position:absolute;left:20px;top:20px;width:60px;height:60px;background:rgb(0,255,0)';
    layer.append(mark);
    const capturing=window.qaCapturePdfViewport();
    mark.style.background='rgb(255,0,255)';
    const snapshot=await capturing;
    const image=new Image();image.src=snapshot.attachment.dataUrl;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,80,80,1,1,0,0,1,1);
    mark.remove();return [...ctx.getImageData(0,0,1,1).data];
  });
  assert.deepEqual(annotationPixel,[0,255,0,255],'annotations freeze before the asynchronous rasterizer runs');
  holdDecision=true;
  await send('Explain this circuit');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText('Viewing page 1');
  await expect.poll(()=>decisions.length).toBe(1);
  await page.getByRole('button',{name:'Next PDF page'}).click();
  await expect(page.locator('[title="Lecture 2.1: Filters — Page 2 of 3"]')).toBeVisible();
  holdDecision=false;releaseDecision();
  await page.waitForFunction(()=>window.qaSends?.length===1);
  const turn=await page.evaluate(()=>window.qaSends[0]);
  assert.equal(decisions[0].pageNumber,1);
  assert.match(turn.attachments.find(a=>a.type==='text').text,/"currentPage":1/);
  assert.match(turn.attachments.find(a=>a.type==='text').text,/Text of page 1/);
  const pixel=await page.evaluate(async dataUrl=>{const image=new Image();image.src=dataUrl;await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(0,0,1,1).data]},turn.attachments.find(a=>a.type==='image').dataUrl);
  assert.deepEqual(pixel,[255,0,0,255],'screenshot remains on red page 1 after scrolling to blue page 2');
  await expect(chips.first()).toContainText('Viewing page 1');

  // While one answer is running, queue a question on page 2 then navigate.
  await page.waitForFunction(()=>localStorage.getItem('qa:pdf-messages'));
  await page.evaluate(()=>window.qaHoldResponse=true);
  await send('Keep answering');
  await page.waitForFunction(()=>window.qaSends?.length===2&&window.qaFinishResponse);
  await send('Queued on page two');
  await expect(page.locator('[data-queued-message]')).toHaveCount(1);
  await page.getByRole('button',{name:'Next PDF page'}).click();
  await page.evaluate(()=>{window.qaHoldResponse=false;window.qaFinishResponse()});
  await page.waitForFunction(()=>window.qaSends?.length===3);
  const queued=await page.evaluate(()=>window.qaSends[2]);
  assert.match(queued.attachments.find(a=>a.type==='text').text,/"currentPage":2/);
  await expect(chips).toHaveCount(3);
  await expect(chips.last()).toContainText('Viewing page 2');

  // Text-only decisions keep the page chip even if no screenshot can be taken.
  captureView=false;
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('qa:pdf-messages')).length===6);
  await page.locator('.page').evaluate(el=>el.dataset.loaded='false');
  await send('Explain the text on page three');
  await page.waitForFunction(()=>window.qaSends?.length===4);
  assert.equal(await page.evaluate(()=>window.qaSends[3].attachments.some(a=>a.type==='image')),false);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('qa:pdf-messages')).length===8);
  await load();
  await expect(chips).toHaveCount(4);
  for(const [index,pageNumber] of [1,2,2,3].entries())await expect(chips.nth(index)).toContainText('Viewing page '+pageNumber);
  await expect(page.getByText('PDF reading context.txt',{exact:true})).toHaveCount(0);
  assert.deepEqual(errors,[]);
  if(process.env.PDF_ATTACHMENT_SCREENSHOT)await page.screenshot({path:process.env.PDF_ATTACHMENT_SCREENSHOT});
});
