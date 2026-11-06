import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const stylesheet = path.join(root, 'src/app/globals.css');
const css = (await postcss([tailwindcss({base: root})]).process(readFileSync(stylesheet, 'utf8'), {from: stylesheet})).css;

// Run each surface's real selection handler, thread projection, and popup JSX.
// Replace only its model dispatch and unrelated artifact renderer.
for (const {surface,pdfChat} of [
  {surface:'components/hermes/agent-runtime-panel.tsx',pdfChat:false},
  {surface:'components/hermes/agent-runtime-panel.tsx',pdfChat:true},
  {surface:'gardens/[clusterSlug]/workspace-client.tsx',pdfChat:false},
]) {
  test(`${pdfChat?'PDF chat: ':''}${surface}: Ask here focuses its own editor and sends without consuming the main draft`, {timeout: 60_000}, async t => {
    const source = readFileSync(path.join(root, 'src/app', surface), 'utf8');
    const tree = ts.createSourceFile(surface, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = new Map();
    let renderAnswer;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && ['beginSelectionQuestion', 'replyToInlineAnswer', 'askInlineSelectionAgain', 'messageSelectionSourceId'].includes(node.name?.text)) {
        declarations.set(node.name.text, node.getText(tree));
      }
      if (ts.isVariableDeclaration(node) && ['inlineSelectionThreads', 'annotationsByMessage', 'openAnnotation'].includes(node.name.getText(tree))) {
        declarations.set(node.name.getText(tree), `const ${node.getText(tree)};`);
      }
      if (ts.isCallExpression(node) && ['openInlineAnswers.map', 'visibleInlineAnswers.map'].includes(node.expression.getText(tree)) &&
          node.arguments[0]?.getText(tree).includes('<InlineSelectionAnswerPopover')) renderAnswer = node.arguments[0].getText(tree);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.equal(declarations.size, 7);
    assert.ok(renderAnswer);
    const bundle = await build({bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      alias: {'@': path.join(root, 'src')}, logLevel: 'silent', stdin: {resolveDir: root, loader: 'tsx', contents: `
      import React,{useRef,useState,useMemo,useCallback} from 'react';import {createRoot} from 'react-dom/client';
      import {chatTextSelectionsOverlap} from '@/lib/chat-text-selection';
      import {reusableChatAttachments} from '@/lib/chat-attachments';
      import {delegatedThinkingUpdates} from '@/lib/hermes/super-agent-activity';
      import {ChatSelectionMenu,SelectableAssistantMarkdown,InlineSelectionAnswerPopover} from '@/app/components/chat-text-selection-ui';
      const InlineArtifactCards=()=>null;
      const surface='dashboard_terminal',sessionId='conv_one',activeChatId=1,clusterSlug='fixture',temporaryChat=false;
      const conversationLocked=false,chatContentLoading=false,canAskSelection=true,sourceAnswer=undefined,webSelection=undefined;
      const deletedInlineSelectionIds=new Set(),chatSelections=new Map();
      ${declarations.get('messageSelectionSourceId')}
      window.requests=[];window.inlineStops=[];window.mainStops=0;
      function App(){
        const [messages,setMessages]=useState([{id:'source',role:'assistant',content:'A selected passage explains the circuit.'}]);
        const [activeRun,setActiveRun]=useState(true);const isStreaming=activeRun;
        const [selectionMenu,setSelectionMenu]=useState(null),[composerSelection,setComposerSelection]=useState(null);
        const [savedInlineSelections,setSavedInlineSelections]=useState([]),[savedChatHighlights,setSavedChatHighlights]=useState([]);
        const [openInlineAnswers,setOpenInlineAnswers]=useState([]);
        const composerTextareaRef=useRef(null),textareaRef=composerTextareaRef;
        const setInlineSelectionRunId=()=>{};
        const onAbortInline=${pdfChat}?id=>{window.inlineStops.push(id);setMessages(current=>current.map(m=>m.role==='assistant'&&m.textSelection?.id===id?{...m,pending:false,interrupted:true,content:'Stopped.'}:m));}:undefined;
        ${declarations.get('inlineSelectionThreads')}
        ${declarations.get('annotationsByMessage')}
        const recordQuestion=async(question,selection)=>{
          window.requests.push({question,selection});setActiveRun(true);
          setMessages(current=>[...current,{id:'user-'+window.requests.length,role:'user',content:question,textSelection:selection},
            {id:'answer-'+window.requests.length,role:'assistant',content:'',pending:true,textSelection:selection,
              reasoning:'I will check the surrounding explanation first.',thinking:'I will check the surrounding explanation first.'}]);
        };
        const onAskSelection=recordQuestion,sendInlineQuestion=recordQuestion;
        const receiveTextSelection=setSelectionMenu;
        const setSelectionMessageTarget=()=>{},setStarredMessageTarget=()=>{};
        ${declarations.get('openAnnotation')}
        const stopInlineAnswer=()=>{window.mainStops++;},stopInlineQuestion=()=>{};
        const deleteInlineSelection=id=>{setSavedInlineSelections(current=>current.filter(s=>s.id!==id));setOpenInlineAnswers([]);};
        ${['beginSelectionQuestion','replyToInlineAnswer','askInlineSelectionAgain'].map(name=>declarations.get(name)).join('\n')}
        window.finish=()=>{if(!${pdfChat})setActiveRun(false);setMessages(current=>current.map(m=>m.pending?{...m,pending:false,content:'The selected passage describes a circuit.'}:m));};
        window.mainActive=activeRun;
        window.startOther=()=>setActiveRun(true);
        const sourceId=messageSelectionSourceId(messages[0],0);
        return <><main data-pdf-assistant-panel={${pdfChat}?'':undefined} style={${pdfChat}?{position:'fixed',right:0,top:60,bottom:0,width:370,zIndex:40,padding:24,background:'var(--paper-bg)',overflow:'auto'}:{maxWidth:680,margin:'80px auto'}}><SelectableAssistantMarkdown content={messages[0].content}
          sourceMessageId={sourceId} annotations={annotationsByMessage.get(sourceId)||[]}
          onSelection={receiveTextSelection} onOpenAnnotation={openAnnotation}/></main>
          {selectionMenu&&<ChatSelectionMenu selection={selectionMenu} onAskHere={()=>beginSelectionQuestion('inline')}
            onAskInChat={()=>beginSelectionQuestion('chat')} onClose={()=>setSelectionMenu(null)}/>}
          <div className='bb-composer-overlay' style={{position:'fixed',bottom:0}}>
            <textarea aria-label='Main composer' ref={composerTextareaRef} defaultValue='Keep my main draft'/>
          </div>{openInlineAnswers.map(${renderAnswer})}</>;
      }createRoot(document.getElementById('root')).render(<App/>);`}});
    const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport:{width:1200,height:900}});
    const errors=[];page.on('pageerror',error=>{errors.push(error.message);t.diagnostic(error.message);});
    t.after(()=>assert.deepEqual(errors,[]));
    await page.route('http://localhost:53166/**',route=>route.fulfill({contentType:'text/html',body:'<html data-theme="light"><body><div id="root"></div></body></html>'}));
    await page.goto('http://localhost:53166/');
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.locator('main [data-chat-selectable-message]').evaluate(element=>{
      const text=document.createTreeWalker(element,NodeFilter.SHOW_TEXT).nextNode();
      const range=document.createRange();range.setStart(text,2);range.setEnd(text,18);
      getSelection().removeAllRanges();getSelection().addRange(range);
      element.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',shiftKey:true,bubbles:true}));
    });
    await page.getByRole('button',{name:'Ask here',exact:true}).click();
    const cards=page.getByRole('dialog',{name:'Answer about highlighted text'});
    const editor=cards.first().getByRole('textbox');
    await expect(editor).toBeFocused();
    await expect(cards.getByRole('button',{name:'Ask',exact:true})).toBeDisabled();
    await editor.press('Enter');
    await expect(editor).toBeFocused();
    assert.equal(await page.evaluate(()=>requests.length),0);
    await editor.fill('Explain this passage');
    const mark=page.locator('main [data-chat-selection-kind="answer"]').first();
    await page.mouse.click(20,20);
    await expect(cards).toHaveCount(0);
    await mark.click();
    await expect(editor).toHaveValue('Explain this passage');
    await expect(editor).toBeFocused();
    await editor.press('Escape');
    await expect(cards).toHaveCount(0);
    await mark.click();
    await expect(editor).toHaveValue('Explain this passage');
    assert.equal(await page.evaluate(()=>requests.length),0,'reopening an unsent draft does not send it');
    const ask=cards.getByRole('button',{name:'Ask',exact:true});
    await expect(ask).toBeEnabled();
    if(pdfChat){
      assert.equal(await ask.evaluate(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'the chat sidebar must not cover Ask here controls');
      assert.ok(Number(await cards.first().evaluate(card=>getComputedStyle(card).zIndex))>40);
    }
    for (const theme of ['light','dark']) {
      await page.locator('html').evaluate((el,theme)=>el.dataset.theme=theme,theme);
      const rect=await ask.boundingBox();
      assert.ok(rect.height>=36 && rect.width>=64,JSON.stringify(rect));
      const sizes=await ask.evaluate(button=>({client:button.clientWidth,scroll:button.scrollWidth,height:button.clientHeight,scrollHeight:button.scrollHeight}));
      assert.ok(sizes.scroll<=sizes.client && sizes.scrollHeight<=sizes.height,'Ask label must fit inside its button');
      if(process.env.ASK_HERE_QA_DIR){mkdirSync(process.env.ASK_HERE_QA_DIR,{recursive:true});await cards.screenshot({path:path.join(process.env.ASK_HERE_QA_DIR,(surface.startsWith('components')?'terminal':'garden')+'-'+theme+'.png')});}
    }
    await ask.click();
    await expect(cards.getByRole('button',{name:'Stop this answer',exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>requests.length),1);
    await cards.getByTitle('Show thinking updates').click();
    await expect(cards.getByRole('list',{name:'Thinking updates'})).toContainText('I will check the surrounding explanation first.');
    await page.evaluate(()=>finish());
    await page.mouse.click(20,20);
    await mark.click();
    await expect(cards.getByRole('textbox')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('breadboard:chat-drafts')||'{}')).filter(key=>key.startsWith('ask_here:')).length),0,'sending clears the saved draft');
    await cards.getByRole('button',{name:'Reply to message',exact:true}).click();
    await expect(cards).toHaveCount(2);
    await expect(cards.last().getByRole('textbox')).toBeFocused();
    await cards.last().getByRole('textbox').fill('Explain further');
    await cards.last().getByRole('button',{name:'Ask',exact:true}).click();
    assert.equal(await page.evaluate(()=>requests.length),2);
    await expect(page.getByRole('textbox',{name:'Main composer'})).toHaveValue('Keep my main draft');
    if(pdfChat){
      assert.equal(await page.evaluate(()=>window.mainActive),true,'the main reply keeps running while the nested question runs');
      assert.ok(Number(await cards.last().evaluate(card=>getComputedStyle(card).zIndex))>40,'nested replies inherit the chat layer');
      await cards.last().getByRole('button',{name:'Stop this answer',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.mainStops),0);
      assert.equal(await page.evaluate(()=>window.inlineStops.at(-1)),await page.evaluate(()=>window.requests.at(-1).selection.id));
      await cards.last().getByRole('button',{name:'Ask this question again',exact:true}).click();
      await expect(cards.last().getByRole('button',{name:'Stop this answer',exact:true})).toBeVisible();
    }
    await page.evaluate(()=>finish());
    await cards.last().getByRole('button',{name:'Edit this question',exact:true}).click();
    await page.setViewportSize({width:390,height:700});
    const retry=cards.last().getByRole('button',{name:'Ask again',exact:true});
    const bounds=await retry.boundingBox();
    assert.ok(bounds.width>=64&&bounds.height>=36&&bounds.x>=0&&bounds.x+bounds.width<=390,JSON.stringify(bounds));
    await cards.last().getByRole('textbox').fill('Explain with an example');
    await retry.click();
    assert.equal(await page.evaluate(()=>requests.at(-1).question),'Explain with an example');
  });
}
