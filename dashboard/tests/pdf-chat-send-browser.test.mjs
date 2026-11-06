import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { chromium } from 'playwright';

test('PDF send, failed response and retry remain stable with a measured chat history', {timeout:60_000}, async t=>{
  const root=path.resolve(import.meta.dirname,'..');
  const stubs={
    'next/link':'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
    'next/dynamic':'export default function dynamic(){return ()=>null}',
    'next/navigation':'export const useRouter=()=>({push(){},replace(){}});export const usePathname=()=>"/pdf";export const useSearchParams=()=>new URLSearchParams();',
    'next-auth/react':'export const useSession=()=>({data:{user:{id:"1"}},status:"authenticated"});export function signIn(){};export function signOut(){}',
  };
  const bundle=await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'pdf-send.js',
    alias:{'@':path.join(root,'src')},define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},loader:{'.css':'empty'},
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React,{useRef,useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';
      import PdfAssistant from '@/app/components/pdf-assistant';
      function App(){const container=useRef(null),canvas=useRef(null);
        const pdf=useRef({numPages:80,getPage:async()=>({getTextContent:async()=>({items:[{str:'Circular current loop magnetic field'}]})})});
        useLayoutEffect(()=>{canvas.current.getContext('2d').fillRect(0,0,600,600)},[]);
        return <><div ref={container} style={{width:600,height:600,overflow:'hidden'}}>
          <div className="page" data-page-number="43" data-loaded="true" style={{width:600,height:600}}>
            <div className="canvasWrapper"><canvas ref={canvas} width={600} height={600}/></div></div></div>
          <PdfAssistant documentKey="pdf:send-test" title="Lecture 7" fileName="lecture7.pdf" pageNumber={43} pageCount={80}
            loading={false} selectionEnabled={false} containerRef={container} pdfDocumentRef={pdf} getBytes={async()=>new Uint8Array([37,80,68,70])}/>
        </>;
      }createRoot(document.getElementById('root')).render(<App/>);
    `},plugins:[{name:'next-boundaries',setup(b){
      b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'stub'}:undefined);
      b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'jsx',resolveDir:root}));
    }}]});
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1250,height:950}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.stack));
  t.after(()=>{if(errors.length)t.diagnostic(JSON.stringify(errors));});
  const stylesheet=path.join(root,'src/app/globals.css');
  const css=(await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'),{from:stylesheet})).css;
  const messages=Array.from({length:24},(_,i)=>[
    {id:'u'+i,clientMessageId:'turn'+i,role:'user',content:'Explain question '+i},
    {id:'a'+i,clientMessageId:'turn'+i,role:'assistant',content:'The field is $H=I/(2a)$.\n\n'+'A circular loop produces an axial magnetic field. '.repeat(70)},
  ]).flat();
  let sends=0;
  await page.route('https://pdf-send.test/**',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    if(p==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root" style="height:100vh"></div>'});
    if(p==='/api/hermes/sessions')return route.fulfill({json:{sessions:[{id:'conv_pdfsend',pageSlug:'pdf:send-test',title:'Lecture 7'}]}});
    if(p==='/api/hermes/sessions/conv_pdfsend')return route.fulfill({json:{session:{id:'conv_pdfsend',messages,runState:'idle'}}});
    if(p==='/api/hermes/sessions/conv_pdfsend/direct'){
      sends++;
      if(sends===1)return route.fulfill({status:500,json:{error:'Test service interrupted'}});
      return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'delta',text:'The loop field was calculated successfully. Attempt '+sends})+'\n\ndata: [DONE]\n\n'});
    }
    if(p==='/api/pdf-assistant/view-decision')return route.fulfill({json:{captureView:false}});
    if(p==='/api/chat-attachments/documents')return route.fulfill({json:{blobId:'doc_'+'a'.repeat(32),format:'pdf',text:'Circular loop',sizeBytes:4}});
    if(p==='/api/assistant-preferences')return route.fulfill({json:{model:'gpt-5.6-sol',reasoningEffort:'medium',agentMode:false,superAgent:false}});
    if(p==='/api/hermes/commands')return route.fulfill({json:{groups:{skills:[],mcp:[],prompts:[],agents:[]},runtime:{enabled:true}}});
    return route.fulfill({json:{messages:[],sessions:[],artifacts:[],highlights:[],models:[],unread:[],entries:[]}});
  });
  await page.goto('https://pdf-send.test');
  await page.addStyleTag({content:css});
  await page.evaluate(()=>localStorage.setItem('breadboard:agent-mode','false'));
  await page.evaluate(()=>{
    window.branchWrites=[];
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...args){
      if(this.transaction.db.name==='breadboard-conversation-branches')window.branchWrites.push(value);
      return put.call(this,value,...args);
    };
    const fetch=window.fetch;
    let directRequests=0;
    window.fetch=async(...args)=>{
      const response=await fetch(...args);
      if(!String(args[0]).endsWith('/direct')||++directRequests!==3)return response;
      const encoder=new TextEncoder();
      return new Response(new ReadableStream({start(controller){
        const delta=text=>controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'delta',text})+'\n\n'));
        delta('Retry is streaming');
        window.advanceRetry=()=>delta(' with more tokens');
        window.finishRetry=()=>{delta('. Completed retry.');controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close()};
      }}),{headers:{'content-type':'text/event-stream'}});
    };
  });
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('button',{name:'Open PDF assistant',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('[data-message-count]')?.getAttribute('data-message-count'))>0);
  const input=page.getByPlaceholder('Ask about this PDF…');
  await input.fill('Formulate a circular loop problem and calculate H');await input.press('Enter');
  await page.getByText('Test service interrupted',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Regenerate response',exact:true}).last().click();
  await page.getByText('The loop field was calculated successfully. Attempt 2',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Regenerate response',exact:true}).last().click();
  await page.getByText('Retry is streaming',{exact:false}).waitFor();
  const writes=await page.evaluate(()=>window.branchWrites.length);
  for(let i=0;i<4;i++){
    await page.evaluate(()=>window.advanceRetry());
    await page.waitForTimeout(80);
  }
  assert.equal(await page.evaluate(()=>window.branchWrites.length),writes,'streaming tokens must not rewrite branch snapshots');
  await page.evaluate(()=>window.finishRetry());
  await page.waitForFunction(()=>window.branchWrites.some(groups=>Object.values(groups).some(group=>
    group.variants.some(variant=>variant.some(message=>message.content.includes('Completed retry.'))))));
  const saved=await page.evaluate(()=>Object.values(window.branchWrites.at(-1)));
  assert.deepEqual(saved[0].variants.map(variant=>variant.length),[2,2],'save only the retried turn');
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('breadboard:conversation-branches:'))),false);
  for(let i=0;i<2;i++){
    await input.fill('Formulate a circular loop problem and calculate H '+i);await input.press('Enter');
    await page.getByText('The loop field was calculated successfully. Attempt '+(i+4),{exact:false}).waitFor();
  }
  assert.equal(sends,5);
  assert.deepEqual(errors,[]);
  assert.doesNotMatch(await page.locator('body').innerText(),/Minified React error|Maximum update depth|Interrupted/);
});
