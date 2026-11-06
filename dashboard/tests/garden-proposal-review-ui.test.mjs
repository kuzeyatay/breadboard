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
import { applyGardenRevision } from "../src/lib/garden-revision.ts";

const root = path.resolve(import.meta.dirname, "..");
function treeFor(file) { return ts.createSourceFile(file, fs.readFileSync(path.join(root,file),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX); }
function nodes(tree, predicate) {
  const found=[];
  function visit(n) { if(predicate(n))found.push(n);ts.forEachChild(n,visit); }
  visit(tree);return found;
}
test("all chat surfaces render proposals inside assistant rows under one provider", () => {
  for(const file of ["src/app/garden/garden-assistant.tsx","src/app/components/hermes/agent-runtime-panel.tsx","src/app/gardens/[clusterSlug]/workspace-client.tsx"]) {
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

test("full Garden chat shows pending reviews on reload and completion, scoped to their conversation", {timeout:60000}, async () => {
  const file="src/app/gardens/[clusterSlug]/workspace-client.tsx",tree=treeFor(file);
  const wanted=new Set(["ChatTranscript","buildTranscriptRows","transcriptRowKey","transcriptRowHeight","EMPTY_CHAT_ANNOTATIONS","messageSelectionSourceId","hasRunningExternalAgent"]);
  const statements=tree.statements.filter(node=>
    (ts.isFunctionDeclaration(node)&&wanted.has(node.name?.text))||
    (ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>wanted.has(d.name.getText(tree)))));
  const used=new Set();
  function visit(node){if(ts.isIdentifier(node))used.add(node.text);ts.forEachChild(node,visit);}
  statements.forEach(visit);
  const imports=[],stubs=[];
  for(const node of tree.statements){
    if(!ts.isImportDeclaration(node)||!node.importClause||node.importClause.isTypeOnly)continue;
    const clause=node.importClause;
    const bindings=[...(clause.name?[{name:clause.name.text,imported:"default"}]:[]),
      ...(clause.namedBindings&&ts.isNamedImports(clause.namedBindings)?clause.namedBindings.elements.filter(i=>!i.isTypeOnly).map(i=>({name:i.name.text,imported:i.propertyName?.text??i.name.text})):[])];
    for(const {name,imported} of bindings){
      if(!used.has(name))continue;
      if(name==="SelectableAssistantMarkdown")stubs.push("const SelectableAssistantMarkdown=({content})=><p>{content}</p>;");
      else if(/^[A-Z]/.test(name)&&!["InlineProposalCards","VirtualizedMessageList"].includes(name))stubs.push(`const ${name}=({children})=>children??null;`);
      else imports.push(imported==="default"?`import ${name} from ${JSON.stringify(node.moduleSpecifier.text)};`:`import {${imported} as ${name}} from ${JSON.stringify(node.moduleSpecifier.text)};`);
    }
  }
  // Exercise the real workspace provider props as well as its real transcript.
  const provider=nodes(tree,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==="InlineProposalCardsProvider")[0];
  assert.ok(provider,"The full Garden workspace must mount the review provider");
  const bundle=await build({stdin:{resolveDir:path.dirname(path.join(root,file)),loader:"tsx",contents:`
    ${imports.join('\n')}
    import React from 'react';import{createRoot}from'react-dom/client';
    import {InlineProposalCardsProvider} from '@/app/components/hermes/inline-proposal-cards';
    import {useChatVirtualBridge} from '@/app/components/use-chat-auto-scroll';
    ${stubs.join('\n')}
    ${statements.map(n=>n.getText(tree)).join('\n')}
    const original=[{id:'msg_28',role:'assistant',content:'The first revision is pending.'},
      {id:'msg_45',role:'assistant',content:'The replacement is pending review.'}];
    window.requested=[];window.changed=[];
    window.addEventListener('sb:markdown-updated',event=>window.changed.push(event.detail));
    function App(){
      const[viewingConversationId,setConversation]=useState('conv-current'),[activeChat,setActiveChat]=useState({isOwn:true});
      const[messages,setMessages]=useState(original),[transcriptResponding,setBusy]=useState(false),[mounted,setMounted]=useState(false);
      useEffect(()=>setMounted(true),[]);
      const clusterSlug='em-1',scroll=useRef(null),bridge=useChatVirtualBridge();
      const queueFollowUp=(prompt,attachments)=>window.requested.push({prompt,attachments,conversationId:viewingConversationId});
      window.selectChat=(id,isOwn=true)=>{setConversation(id);setActiveChat({isOwn})};
      window.start=()=>{setBusy(true);setMessages([...original,{id:'msg_49',role:'assistant',content:'Preparing another revision.'}])};
      window.finish=()=>setBusy(false);
      return <div ref={scroll} style={{height:700,overflow:'auto'}}>
        {mounted ? ${provider.getText(tree)}
          <ChatTranscript clusterName='EM 1' clusterSlug={clusterSlug} chatSessionId={893}
            messages={messages} branchGroups={{}} modelChangesFor={()=>[]} naturalRewriteFor={()=>undefined}
            isStreaming={transcriptResponding} connection={transcriptResponding?'streaming':'idle'} loadingChats={false}
            gardenSourceAttachments={[]} activities={[]} annotationsByMessage={new Map()} delegationInFlight={false}
            transcriptScrollRef={scroll} transcriptVirtual={bridge}/>
        </InlineProposalCardsProvider> : null}
      </div>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",alias:{"@":path.join(root,"src")},logLevel:"silent"});
  const base={kind:"page_revision",gardenId:"em-1",gardenName:"EM 1",title:"From Abstract Vector Spaces to Electromagnetic Fields",pageSlug:"vector-spaces",folder:"",characters:120,createdAt:"2026-09-23T14:27:26Z"};
  let proposals=[{...base,id:11,assistantMessageId:"msg_28",gardenId:"circuits",gardenName:"Circuits",content:"First revision"},
    {...base,id:12,assistantMessageId:"msg_45",content:"Integrated Cartesian explanation"}];
  const queries=[],decisions=[];
  let conflict=false;
  const executablePath=["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe","/usr/bin/chromium"].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage();const errors=[];page.on("pageerror",error=>{errors.push(error.message);console.error(error.message)});
    await page.route("http://localhost:53148/**",async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==="/api/hermes/proposals"){
        queries.push(url.search);
        return route.fulfill({json:{proposals:url.searchParams.get("conversationId")==="conv-current"?proposals.filter(p=>!url.searchParams.has('gardenSlug')||p.gardenId===url.searchParams.get('gardenSlug')):[]}});
      }
      if(/^\/api\/gardens\/(em-1|circuits)\/proposals\//.test(url.pathname)){
        const id=Number(url.pathname.split("/").at(-1)),decision=route.request().postDataJSON().decision;
        decisions.push({id,decision});
        if(conflict)return route.fulfill({status:409,json:{code:"revision_conflict",error:"The page has changed."}});
        proposals=proposals.filter(p=>p.id!==id);
        return route.fulfill({json:{document:{slug:"vector-spaces",content:"Applied revision"}}});
      }
      if(url.pathname==="/app.js")return route.fulfill({contentType:"text/javascript",body:bundle.outputFiles[0].text});
      return route.fulfill({contentType:"text/html",body:'<!doctype html><div id="root"></div><script src="/app.js"></script>'});
    });
    await page.goto("http://localhost:53148/");
    const revision11=page.locator('[data-owner-message-id="msg_28"] [data-proposal-id="11"]');
    const revision12=page.locator('[data-owner-message-id="msg_45"] [data-proposal-id="12"]');
    await revision11.waitFor();await revision12.getByText("Integrated Cartesian explanation").waitFor();
    assert.equal(queries.length,1,"One shared request for the workspace transcript");
    await page.reload();await revision11.waitFor();await revision12.waitFor();
    await page.evaluate(()=>window.selectChat("conv-other"));await revision11.waitFor({state:"detached"});
    await page.waitForFunction(()=>!document.querySelector('[data-proposal-id]'));
    await page.evaluate(()=>window.selectChat("conv-current"));await revision11.waitFor();await revision12.waitFor();
    const beforeShared=queries.length;
    await page.evaluate(()=>window.selectChat("conv-shared",false));await revision12.waitFor({state:"detached"});
    await page.evaluate(()=>window.selectChat("conv-current"));await revision12.waitFor();
    assert.equal(queries.length,beforeShared+1,"Shared chats do not fetch the viewer's proposals");
    await revision12.getByRole("button",{name:"Apply revision",exact:true}).click();await revision12.waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>window.changed.at(-1).content),"Applied revision");
    await revision11.getByRole("button",{name:"Discard",exact:true}).click();await revision11.waitFor({state:"detached"});
    await Promise.all([
      page.waitForResponse(response=>response.url().includes("/api/hermes/proposals")),
      page.evaluate(()=>window.start()),
    ]);
    proposals.push({...base,id:13,assistantMessageId:"msg_49",content:"New proposal after streaming"});
    await page.evaluate(()=>window.finish());
    const revision13=page.locator('[data-owner-message-id="msg_49"] [data-proposal-id="13"]');
    await revision13.waitFor();
    conflict=true;await revision13.getByRole("button",{name:"Apply revision",exact:true}).click();
    await page.getByRole("button",{name:"Request fresh revision",exact:true}).click();
    await page.waitForFunction(()=>window.requested.length===1);
    const [requested]=await page.evaluate(()=>window.requested);
    assert.equal(requested.conversationId,"conv-current");assert.deepEqual(requested.attachments,[]);
    assert.match(requested.prompt,/Proposal #13/);
    assert.deepEqual(decisions,[{id:12,decision:"apply"},{id:11,decision:"reject"},{id:13,decision:"apply"}]);
    assert.ok(queries.every(query=>!query.includes("gardenSlug=")&&!query.includes("conv-shared")), 'Conversation reviews include their authorized destinations in other Gardens');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("revision ownership survives reload, streaming, virtualized remounts and review actions", {timeout:60000}, async () => {
  const tree=treeFor("src/app/garden/garden-assistant.tsx");
  const row=tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==="TranscriptRow"));
  const provider=nodes(tree,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==="InlineProposalCardsProvider")[0].getText(tree);
  const cssPath=path.join(root,"src/app/globals.css");
  const cssInput=fs.readFileSync(cssPath,"utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";','@source "./components/hermes/inline-proposal-cards.tsx"; @source "./components/chat-markdown.tsx";');
  const css=fs.readFileSync(path.join(root,"node_modules/katex/dist/katex.min.css"),"utf8")+
    (await postcss([tailwind({base:root})]).process(cssInput,{from:cssPath})).css;
  const bundle=await build({stdin:{resolveDir:root,loader:"tsx",contents:`
    import React,{memo,useRef,useState} from 'react';import{createRoot}from'react-dom/client';
    import InlineProposalCards,{InlineProposalCardsProvider} from './src/app/components/hermes/inline-proposal-cards';
    import {useQueuedFollowUps} from './src/app/components/hermes/queued-follow-ups';
    import VirtualizedMessageList from './src/app/components/chat/virtualized-message-list';
    import {useChatVirtualBridge} from './src/app/components/use-chat-auto-scroll';
    const gardenAssistantVisibleContent=m=>m.content,uiResourcesForUserRequest=r=>r??[];
    const delegatedThinkingUpdates=()=>[],delegatedAgentCompletedLabelForMessage=()=>'';
    const messageRewriteReview=()=>undefined;
    const ActivityPanel=()=>null,ChatTimeSeparator=()=>null,AssistantMessageActions=()=>null,ChatMessageAttachments=()=>null,ChatVideoLinkEmbeds=()=>null,QuotedChatSelection=()=>null,InlineArtifactCards=()=>null;
    const AssistantRichResponse=({markdown})=>markdown,SelectableAssistantMarkdown=({content})=><p>{content}</p>;
    const CollapsibleUserMessage=({children})=>children,UserMessageText=({content})=><p>{content}</p>;
    ${row.getText(tree)}
    window.changed=[];window.requested=[];window.addEventListener('sb:markdown-updated',e=>window.changed.push(e.detail));
    const original=[{id:'msg_2',role:'assistant',content:'Created revision #2'},
      {id:'msg_3',role:'assistant',content:'Created revision #3, superseding #2'},
      {id:'msg_4',role:'assistant',content:'A later answer mentions #2 and #3'}];
    function App(){
      const[viewingConversationId,setConversation]=useState('conv-current'),[chatIsStreaming,setStreaming]=useState(false),[messages,setMessages]=useState(original);
      const activeClusterSlug='em-1',activeChat={isOwn:true},scrollRef=useRef(null),bridge=useChatVirtualBridge();
      const {queueFollowUp,headerContent}=useQueuedFollowUps({conversationKey:viewingConversationId,runInFlight:chatIsStreaming,steerableRunActive:false,
        onRestoreDraft:()=>{},onSendQueued:async(text,attachments)=>{window.requested.push({text,attachments,conversationId:viewingConversationId})}});
      window.setBusy=setStreaming;
      window.selectChat=setConversation;window.go=i=>bridge.scrollToIndex(i,'auto');
      window.expand=()=>setMessages(m=>[...m,...Array.from({length:60},(_,i)=>({id:'filler-'+i,role:'assistant',content:'Later answer '+i}))]);
      window.start=()=>{setStreaming(true);setMessages(m=>[...m,{id:'msg_5',role:'assistant',content:'Proposing...'}])};
      window.finish=()=>{setStreaming(false);setMessages(m=>m.map(v=>v.id==='msg_5'?{...v,content:'Created revision #4'}:v))};
      return <main><h1>Quartz assistant</h1><div id="transcript" ref={scrollRef} style={{height:650,overflowY:'auto'}}>
        ${provider}
        <VirtualizedMessageList surface="proposal-test" items={messages} scrollRef={scrollRef} bridge={bridge} gap={16} overscan={2} initialRect={{width:490,height:650}}
          resetKey={viewingConversationId} getItemKey={m=>m.id} estimateSize={()=>160}
          renderItem={message=><div data-message-id={message.id}><TranscriptRow message={message} showActions /></div>} />
        </InlineProposalCardsProvider></div>{headerContent}</main>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,outfile:"app.js",format:"iife",platform:"browser",define:{"process.env.NODE_ENV":'"development"'}});
  const base={kind:"page_revision",gardenId:"em-1",gardenName:"EM 1",title:"Why Electromagnetic Fields Matter",pageSlug:"unit/fields",folder:"",characters:120,createdAt:"2026-09-08T12:00:00Z"};
  const proposals=[{...base,id:2,assistantMessageId:"msg_2",rationale:"Original proposal",originalText:"# Introduction\n\nOld opening paragraph.\n\n$\\mathbf E$",content:"# Introduction\n\nStart with **atoms and charge**.\n\n\\[\\mathbf E = \\frac{\\mathbf F}{q}\\]"},
    {...base,id:3,assistantMessageId:"msg_3",rationale:"Updated proposal",originalText:"# Introduction\n\nOld opening paragraph.",content:"# Updated introduction\n\nExplain **electromagnetism** first."}];
  let pending=new Set([2,3]),failApply=false,failList=false;
  const queries=[],decisions=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,"http://localhost");
    if(url.pathname==="/app.js"){res.setHeader("Content-Type","text/javascript");res.end(bundle.outputFiles[0].text);return;}
    if(url.pathname==="/style.css"){res.setHeader("Content-Type","text/css");res.end(css);return;}
    if(/^\/fonts\/KaTeX_[\w-]+\.(?:woff2?|ttf)$/.test(url.pathname)){
      res.end(fs.readFileSync(path.join(root,"node_modules/katex/dist/fonts",path.basename(url.pathname))));return;
    }
    if(url.pathname==="/api/hermes/proposals"){
      queries.push(url.search);res.setHeader("Content-Type","application/json");res.statusCode=failList?500:200;
      res.end(JSON.stringify({proposals:url.searchParams.get("conversationId")==="conv-current"?proposals.filter(p=>pending.has(p.id)):[]}));return;
    }
    if(url.pathname.startsWith("/api/gardens/em-1/proposals/")){
      const id=Number(url.pathname.split("/").at(-1));let text="";for await(const chunk of req)text+=chunk;
      decisions.push({id,decision:JSON.parse(text).decision});res.setHeader("Content-Type","application/json");
      if(failApply){res.statusCode=failApply==="conflict"?409:500;res.end(JSON.stringify(failApply==="conflict"
        ?{code:"revision_conflict",error:"This patch does not match the current page. Request a fresh revision before applying it."}
        :{error:"Publication failed"}));return;}
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
    await revision2.getByLabel("Passage to replace").getByText("Old opening paragraph.",{exact:true}).waitFor();
    await revision3.getByLabel("Passage to replace").getByText("Old opening paragraph.",{exact:true}).waitFor();
    assert.equal(await revision2.getByLabel("Passage to replace").locator(".katex").count(),1);
    assert.equal(await revision2.getByLabel("Proposed content").locator(".katex-display").count(),1);
    assert.equal(await revision2.locator(".katex-error").count(),0);
    assert.equal(await page.locator('[data-message-id="msg_4"] [data-proposal-id]').count(),0);
    assert.equal(queries.length,1,"Fetch once for all message rows");
    assert.ok(queries.every(q=>q.includes("conversationId=conv-current")&&!q.includes("gardenSlug=")));
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
    const mathSource="# Fields\n\nThe field $\\mathbf E$ is a vector.\n\n$$\n\\mathbf E = \\mathbf F\n$$\n\nKeep `\\mathbf E` as code.\n";
    const mathPatch="@@\n-# Fields\n+# Streaming proposal\n@@\n-\\mathbf E = \\mathbf F\n+\\mathbf E = \\frac{\\mathbf F}{q}";
    await page.evaluate(()=>window.start());proposals.push({...base,id:4,assistantMessageId:"msg_5",content:mathPatch,previewContent:applyGardenRevision(mathSource,mathPatch)});pending.add(4);
    await page.evaluate(()=>window.finish());await page.evaluate(()=>window.go(63));await page.locator('[data-message-id="msg_5"] [data-proposal-id="4"]').waitFor();
    const owner4=page.locator('[data-message-id="msg_5"]'),revision4=owner4.locator('[data-proposal-id="4"]');
    assert.equal(await revision4.getByLabel("Proposed content").locator(".katex").count(),2);
    assert.equal(await revision4.getByLabel("Proposed content").locator(".katex-display").count(),1);
    assert.equal(await revision4.locator(".katex-error").count(),0);
    assert.equal(await revision4.getByLabel("Proposed content").locator("code").innerText(),"\\mathbf E");
    await revision4.getByText("Source patch",{exact:true}).click();
    assert.equal(await revision4.locator("details details pre").innerText(),mathPatch);
    await revision4.getByText("Source patch",{exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const mathArtifactDir=path.join(root,".tmp-garden-proposal-review");fs.mkdirSync(mathArtifactDir,{recursive:true});
    await page.screenshot({path:path.join(mathArtifactDir,"quartz-revision-math.png")});
    failApply="conflict";await revision4.getByRole("button",{name:"Apply revision",exact:true}).click();
    await owner4.getByRole("button",{name:"Request fresh revision",exact:true}).waitFor();
    assert.equal(await revision4.getByRole("button",{name:"Apply revision",exact:true}).isDisabled(),true);
    assert.equal(await revision4.getByRole("button",{name:"Discard",exact:true}).isEnabled(),true);
    assert.equal(await owner4.getByRole("button",{name:"Retry",exact:true}).count(),0);
    // A request made while the assistant works must wait in this chat's queue,
    // and a rapid second click must not enqueue it twice or reapply the patch.
    await page.evaluate(()=>window.setBusy(true));
    await owner4.getByRole("button",{name:"Request fresh revision",exact:true}).evaluate(button=>{button.click();button.click()});
    await owner4.getByRole("status").getByText(/A fresh revision has been requested/).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.requested),[]);
    await page.evaluate(()=>window.setBusy(false));
    await page.waitForFunction(()=>window.requested.length===1);
    const [requested]=await page.evaluate(()=>window.requested);
    assert.equal(requested.conversationId,"conv-current");assert.deepEqual(requested.attachments,[]);
    for(const expected of ['"unit/fields"','"em-1"','Proposal #4','garden_get_page','nextOffset','originalText','complete source lines','# Streaming proposal','do not apply it automatically'])assert.ok(requested.text.includes(expected),expected);
    assert.deepEqual(decisions.filter(d=>d.id===4),[{id:4,decision:"apply"}]);
    assert.equal(pending.has(4),true,"The failed proposal has not been applied or silently discarded");
    failApply=false;
    failList=true;await page.reload();await page.getByRole("alert").getByText("Could not load the proposed Garden changes.").waitFor();
    failList=false;pending=new Set([2,3]);await page.getByRole("button",{name:"Retry",exact:true}).click();await revision2.waitFor();await revision3.waitFor();
    const artifactDir=path.join(root,".tmp-garden-proposal-review");fs.mkdirSync(artifactDir,{recursive:true});await page.evaluate(()=>window.go(0));
    await page.screenshot({path:path.join(artifactDir,"quartz-revision-owned.png")});assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
