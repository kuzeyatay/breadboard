import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");
function treeFor(file) { return ts.createSourceFile(file, fs.readFileSync(path.join(root,file),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX); }
function nodes(tree, predicate) {
  const found=[];
  function visit(n) { if(predicate(n))found.push(n);ts.forEachChild(n,visit); }
  visit(tree);return found;
}
test("both transcripts render proposals inside assistant rows under one provider", () => {
  for(const file of ["src/app/garden/garden-assistant.tsx","src/app/components/hermes/agent-runtime-panel.tsx"]) {
    const tree=treeFor(file);
    const cards=nodes(tree,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(tree)==="InlineProposalCards");
    assert.equal(cards.length,1,"No duplicate or conversation-tail cards");
    assert.equal(nodes(tree,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==="InlineProposalCardsProvider").length,1);
    assert.match(cards[0].getText(tree),/ownerMessageId=/);
    const ancestors=[];for(let n=cards[0].parent;n;n=n.parent)ancestors.push(n);
    assert.ok(ancestors.some(n=>file.includes("garden-assistant")
      ? ts.isFunctionExpression(n)&&n.name?.text==="TranscriptRow"
      : ts.isJsxAttribute(n)&&n.name.getText(tree)==="renderItem"));
  }
});

test("revision ownership survives reload, streaming, virtualized remounts and review actions", {timeout:60000}, async () => {
  const tree=treeFor("src/app/garden/garden-assistant.tsx");
  const row=tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==="TranscriptRow"));
  const provider=nodes(tree,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==="InlineProposalCardsProvider")[0].getText(tree);
  const cssPath=path.join(root,"src/app/globals.css");
  const cssInput=fs.readFileSync(cssPath,"utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";','@source "./components/hermes/inline-proposal-cards.tsx"; @source "./components/chat-markdown.tsx";');
  const css=(await postcss([tailwind({base:root})]).process(cssInput,{from:cssPath})).css;
  const bundle=await build({stdin:{resolveDir:root,loader:"tsx",contents:`
    import React,{memo,useRef,useState} from 'react';import{createRoot}from'react-dom/client';
    import InlineProposalCards,{InlineProposalCardsProvider} from './src/app/components/hermes/inline-proposal-cards';
    import VirtualizedMessageList from './src/app/components/chat/virtualized-message-list';
    import {useChatVirtualBridge} from './src/app/components/use-chat-auto-scroll';
    const gardenAssistantVisibleContent=m=>m.content,uiResourcesForUserRequest=r=>r??[];
    const delegatedThinkingUpdates=()=>[],delegatedAgentCompletedLabelForMessage=()=>'';
    const messageRewriteReview=()=>undefined;
    const ActivityPanel=()=>null,ChatTimeSeparator=()=>null,AssistantMessageActions=()=>null,ChatMessageAttachments=()=>null,ChatVideoLinkEmbeds=()=>null,QuotedChatSelection=()=>null;
    const AssistantRichResponse=({markdown})=>markdown,SelectableAssistantMarkdown=({content})=><p>{content}</p>;
    const CollapsibleUserMessage=({children})=>children,UserMessageText=({content})=><p>{content}</p>;
    ${row.getText(tree)}
    window.changed=[];window.addEventListener('sb:markdown-updated',e=>window.changed.push(e.detail));
    const original=[{id:'msg_2',role:'assistant',content:'Created revision #2'},
      {id:'msg_3',role:'assistant',content:'Created revision #3, superseding #2'},
      {id:'msg_4',role:'assistant',content:'A later answer mentions #2 and #3'}];
    function App(){
      const[viewingConversationId,setConversation]=useState('conv-current'),[chatIsStreaming,setStreaming]=useState(false),[messages,setMessages]=useState(original);
      const activeClusterSlug='em-1',activeChat={isOwn:true},scrollRef=useRef(null),bridge=useChatVirtualBridge();
      window.selectChat=setConversation;window.go=i=>bridge.scrollToIndex(i,'auto');
      window.expand=()=>setMessages(m=>[...m,...Array.from({length:60},(_,i)=>({id:'filler-'+i,role:'assistant',content:'Later answer '+i}))]);
      window.start=()=>{setStreaming(true);setMessages(m=>[...m,{id:'msg_5',role:'assistant',content:'Proposing...'}])};
      window.finish=()=>{setStreaming(false);setMessages(m=>m.map(v=>v.id==='msg_5'?{...v,content:'Created revision #4'}:v))};
      return <main><h1>Quartz assistant</h1><div id="transcript" ref={scrollRef} style={{height:650,overflowY:'auto'}}>
        ${provider}
        <VirtualizedMessageList surface="proposal-test" items={messages} scrollRef={scrollRef} bridge={bridge} gap={16} overscan={2} initialRect={{width:490,height:650}}
          resetKey={viewingConversationId} getItemKey={m=>m.id} estimateSize={()=>160}
          renderItem={message=><div data-message-id={message.id}><TranscriptRow message={message} showActions /></div>} />
        </InlineProposalCardsProvider></div></main>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,outfile:"app.js",format:"iife",platform:"browser",define:{"process.env.NODE_ENV":'"development"'}});
  const base={kind:"page_revision",gardenId:"em-1",gardenName:"EM 1",title:"Why Electromagnetic Fields Matter",pageSlug:"unit/fields",folder:"",characters:120,createdAt:"2026-09-08T12:00:00Z"};
  const proposals=[{...base,id:2,assistantMessageId:"msg_2",rationale:"Original proposal",content:"# Introduction\n\nStart with **atoms and charge**."},
    {...base,id:3,assistantMessageId:"msg_3",rationale:"Updated proposal",content:"# Updated introduction\n\nExplain **electromagnetism** first."}];
  let pending=new Set([2,3]),failApply=false,failList=false;
  const queries=[],decisions=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,"http://localhost");
    if(url.pathname==="/app.js"){res.setHeader("Content-Type","text/javascript");res.end(bundle.outputFiles[0].text);return;}
    if(url.pathname==="/style.css"){res.setHeader("Content-Type","text/css");res.end(css);return;}
    if(url.pathname==="/api/hermes/proposals"){
      queries.push(url.search);res.setHeader("Content-Type","application/json");res.statusCode=failList?500:200;
      res.end(JSON.stringify({proposals:url.searchParams.get("conversationId")==="conv-current"?proposals.filter(p=>pending.has(p.id)):[]}));return;
    }
    if(url.pathname.startsWith("/api/gardens/em-1/proposals/")){
      const id=Number(url.pathname.split("/").at(-1));let text="";for await(const chunk of req)text+=chunk;
      decisions.push({id,decision:JSON.parse(text).decision});res.setHeader("Content-Type","application/json");
      if(failApply){res.statusCode=500;res.end(JSON.stringify({error:"Publication failed"}));return;}
      pending.delete(id);res.end(JSON.stringify({document:{slug:"unit/fields",content:proposals.find(p=>p.id===id).content}}));return;
    }
    res.setHeader("Content-Type","text/html");res.end('<html><head><link rel="stylesheet" href="/style.css"><style>body{display:block;padding:16px}main{max-width:620px}#transcript{padding:6px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const executablePath=["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe","/usr/bin/chromium"].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage({viewport:{width:528,height:780}});const errors=[];page.on("pageerror",e=>{errors.push(e.message);console.error(e.message)});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const revision2=page.locator('[data-message-id="msg_2"] [data-proposal-id="2"]'),revision3=page.locator('[data-message-id="msg_3"] [data-proposal-id="3"]');
    await revision2.getByText("atoms and charge",{exact:true}).waitFor();await revision3.getByText("electromagnetism",{exact:true}).waitFor();
    assert.equal(await page.locator('[data-message-id="msg_4"] [data-proposal-id]').count(),0);
    assert.equal(queries.length,1,"Fetch once for all message rows");
    assert.ok(queries.every(q=>q.includes("conversationId=conv-current")&&q.includes("gardenSlug=em-1")));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.reload();await revision2.waitFor();await revision3.waitFor();
    await page.evaluate(()=>window.selectChat("conv-other"));await revision2.waitFor({state:"detached"});await revision3.waitFor({state:"detached"});
    await page.evaluate(()=>window.selectChat("conv-current"));await revision2.waitFor();await revision3.waitFor();
    failApply=true;await revision3.getByRole("button",{name:"Apply revision",exact:true}).click();
    const owner3=page.locator('[data-message-id="msg_3"]');await owner3.getByRole("alert").getByText("Publication failed").waitFor();
    assert.equal(await page.locator('[data-message-id="msg_2"] [role="alert"]').count(),0);
    await page.evaluate(()=>window.expand());await page.evaluate(()=>window.go(62));await revision3.waitFor({state:"detached"});
    const beforeRemount=queries.length;await page.evaluate(()=>window.go(1));await revision3.waitFor();
    await owner3.getByRole("alert").getByText("Publication failed").waitFor();assert.equal(queries.length,beforeRemount);
    failApply=false;await owner3.getByRole("button",{name:"Retry",exact:true}).click();await revision3.waitFor({state:"detached"});
    assert.deepEqual(decisions,[{id:3,decision:"apply"},{id:3,decision:"apply"}]);
    assert.equal(await page.evaluate(()=>window.changed.at(-1).content),proposals[1].content);
    await page.evaluate(()=>window.go(0));await revision2.waitFor();await revision2.getByRole("button",{name:"Discard",exact:true}).click();await revision2.waitFor({state:"detached"});
    assert.deepEqual(decisions.at(-1),{id:2,decision:"reject"});
    await page.evaluate(()=>window.start());proposals.push({...base,id:4,assistantMessageId:"msg_5",content:"# Streaming proposal"});pending.add(4);
    await page.evaluate(()=>window.finish());await page.evaluate(()=>window.go(63));await page.locator('[data-message-id="msg_5"] [data-proposal-id="4"]').waitFor();
    failList=true;await page.reload();await page.getByRole("alert").getByText("Could not load the proposed Garden changes.").waitFor();
    failList=false;pending=new Set([2,3]);await page.getByRole("button",{name:"Retry",exact:true}).click();await revision2.waitFor();await revision3.waitFor();
    const artifactDir=path.join(root,".tmp-garden-proposal-review");fs.mkdirSync(artifactDir,{recursive:true});await page.evaluate(()=>window.go(0));
    await page.screenshot({path:path.join(artifactDir,"quartz-revision-owned.png")});assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
