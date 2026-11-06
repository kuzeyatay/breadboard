import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'src/app/garden/garden-assistant.tsx');
const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(tree));
  if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) declarations.set(item.name.getText(tree), `const ${item.getText(tree)};`);
  ts.forEachChild(node, visit);
}
visit(tree);

test('Quartz panel, page answers and nested Ask here stars use durable IDs and appear in their Garden', {timeout:60_000}, async t => {
  // Use the real transcript row, selection mapping, and page-answer bridge.
  // HTTP and unrelated runtime/artifact widgets are the only substitutes.
  const bundle = await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
    alias:{'@':path.join(root,'src')}, define:{'process.env.NODE_ENV':'"production"'}, logLevel:'silent',
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React,{memo,useMemo,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
      import AssistantMessageActions,{MessageActionsSlot} from '@/app/components/assistant-message-actions';
      import {SelectableAssistantMarkdown} from '@/app/components/chat-text-selection-ui';
      import {useTextSelectionController} from '@/app/components/use-text-selection-controller';
      import QuartzInlineAnswerPopover from '@/app/garden/quartz-inline-answer-popover';
      import StarredMessagesPanel from '@/app/components/hermes/starred-messages-panel';
      import {reusableChatAttachments} from '@/lib/chat-attachments';
      import {isClarificationAnswerMessage} from '@/lib/steered-response';
      const gardenAssistantVisibleContent=m=>m.content,uiResourcesForUserRequest=r=>r??[],chatRowKey=m=>m.id;
      const delegatedThinkingUpdates=()=>[],delegatedAgentCompletedLabelForMessage=()=>'',messageRewriteReview=()=>undefined;
      const ActivityPanel=()=>null,ChatTimeSeparator=()=>null,InlineProposalCards=()=>null,InlineArtifactCards=()=>null;
      const AssistantRichResponse=({markdown})=>markdown;
      ${declarations.get('TranscriptRow')}
      ${declarations.get('gardenSelectionMessageId')}
      const selection={id:'nested',mode:'inline',sourceMessageId:'client:page-turn:assistant',start:0,end:4,quote:'Page'};
      const messages=[{id:'display-main',clientMessageId:'main-turn',role:'assistant',content:'Main Quartz answer'},
        {id:'display-page',clientMessageId:'page-turn',role:'assistant',content:'Page answer',inlineSelection:{requestId:'page-request'}},
        {id:'display-question',clientMessageId:'nested-turn',role:'user',content:'Explain more',textSelection:selection},
        {id:'display-nested',clientMessageId:'nested-turn',role:'assistant',content:'Nested Quartz answer',textSelection:selection}];
      function App(){
        const frame=useRef(null),composerRef=useRef(null),starConversationId='conv_quartz';
        const [canStar,setCanStar]=useState(true),[showStars,setShowStars]=useState(false);
        ${declarations.get('selectionMessages')}
        const textSelection=useTextSelectionController({scope:'quartz:physics:42',conversationId:starConversationId,canStar,
          messages:selectionMessages,busy:false,concurrentInline:true,composerRef,onAsk:()=>{},onStop:()=>{},onBeginQuestion:()=>{},onOpenChatQuestion:()=>{}});
        ${declarations.get('inlineAnswerMessageIds')}
        ${declarations.get('quartzAnswerSelection')}
        const anchor={left:100,right:200,top:80,bottom:100,width:100,height:20};
        window.control={setCanStar,showStars:()=>setShowStars(true),openNested:()=>textSelection.openAnnotation('nested',anchor),
          page:open=>window.dispatchEvent(new MessageEvent('message',{source:frame.current.contentWindow,origin:location.origin,
            data:{type:'second-brain:assistant-inline-popover',open,requestId:'page-request',highlightId:'mark',question:'Explain',answer:'Page answer',state:'complete',anchor,viewportWidth:800,viewportHeight:300}}))};
        if(showStars)return <StarredMessagesPanel gardenSlug='physics' onOpenMessage={()=>{}}/>;
        return <><iframe ref={frame} srcDoc='<p>Reader</p>' style={{width:800,height:300}}/>
          <section aria-label='Main answer'><TranscriptRow message={messages[0]} conversationId={starConversationId} canStar={canStar}
            sourceMessageId='client:main-turn:assistant' showActions annotations={[]} onTextSelection={()=>{}} onOpenAnnotation={()=>{}}/></section>
          <QuartzInlineAnswerPopover iframeRef={frame} quartzOrigin={location.origin} answerSelection={quartzAnswerSelection}/>
          {textSelection.overlays}</>;
      }createRoot(document.getElementById('root')).render(<App/>);
    `}});
  const executablePath = [chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  const browser = await chromium.launch({headless:true,executablePath});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1300,height:900}});
  page.setDefaultTimeout(8000);
  const errors=[],writes=[];
  let stars=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://localhost:53161/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/starred-messages'){
      if(route.request().method()==='PUT'){
        const body=route.request().postDataJSON();writes.push(body);
        stars=stars.filter(star=>star.clientMessageId!==body.messageId);
        if(body.starred)stars.push({conversationId:body.conversationId,chatId:body.conversationId,messageId:'msg_'+writes.length,
          clientMessageId:body.messageId,title:body.messageId,preview:'Saved Quartz answer',gardenSlug:'physics',workspaceChat:false});
      }
      return route.fulfill({json:{messages:stars}});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{entries:[],messages:[],artifacts:[]}});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});
  });
  await page.goto('http://localhost:53161/');
  await page.addStyleTag({content:'.bb-inline-answer{position:fixed;overflow:auto;background:white;border:1px solid #ccc;padding:20px;box-sizing:border-box}svg{width:16px;height:16px}'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const main=page.getByRole('region',{name:'Main answer'});
  await main.getByRole('button',{name:'Star message',exact:true}).click();
  await expect(main.getByRole('button',{name:'Unstar message',exact:true})).toBeVisible();
  assert.deepEqual(writes[0],{conversationId:'conv_quartz',messageId:'main-turn',starred:true});
  await page.evaluate(()=>window.control.setCanStar(false));
  await expect(main.getByRole('button',{name:'Unstar message',exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.control.setCanStar(true));
  await page.evaluate(()=>window.control.page(true));
  const popup=page.getByRole('dialog',{name:'Answer about highlighted text'});
  await popup.getByRole('button',{name:'Star message',exact:true}).click();
  await expect(popup.getByRole('button',{name:'Unstar message',exact:true})).toBeVisible();
  assert.deepEqual(writes[1],{conversationId:'conv_quartz',messageId:'page-turn',starred:true});
  await page.evaluate(()=>{window.control.page(false);window.control.openNested();});
  await popup.getByRole('button',{name:'Star message',exact:true}).click();
  await expect(popup.getByRole('button',{name:'Unstar message',exact:true})).toBeVisible();
  assert.deepEqual(writes[2],{conversationId:'conv_quartz',messageId:'nested-turn',starred:true});
  stars.push({conversationId:'other',messageId:'msg_99',chatId:'other',title:'Other Garden',preview:'Other',gardenSlug:'another-garden'});
  await page.evaluate(()=>window.control.showStars());
  const panel=page.getByRole('region',{name:'Starred messages'});
  for(const id of ['main-turn','page-turn','nested-turn'])await expect(panel.getByRole('button',{name:new RegExp(id)})).toBeVisible();
  await expect(panel.getByText('Other Garden')).toHaveCount(0);
  assert.deepEqual(errors,[]);
});
