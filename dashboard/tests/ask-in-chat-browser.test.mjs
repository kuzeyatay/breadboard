import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);

for (const surface of ['components/hermes/agent-runtime-panel.tsx', 'gardens/[clusterSlug]/workspace-client.tsx']) {
  test(`${surface}: Ask-in-chat passages reopen their virtualized question after reload`, { timeout: 60_000 }, async t => {
    const source = readFileSync(path.join(root, 'src/app', surface), 'utf8');
    const tree = ts.createSourceFile(surface, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = new Map();
    function visit(node) {
      if (ts.isVariableDeclaration(node) && ['chatSelections', 'annotationsByMessage', 'openAnnotation'].includes(node.name.getText(tree)))
        declarations.set(node.name.getText(tree), `const ${node.getText(tree)};`);
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'beginSelectionQuestion') declarations.set(node.name.text, node.getText(tree));
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.equal(declarations.size, 4);
    const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React,{useState,useMemo,useCallback,useRef} from 'react';import {createRoot} from 'react-dom/client';
      import {chatQuestionSelections,chatTextSelectionsOverlap} from './src/lib/chat-text-selection';
      import {SelectableAssistantMarkdown,ChatSelectionMenu} from './src/app/components/chat-text-selection-ui';
      import VirtualizedMessageList from './src/app/components/chat/virtualized-message-list';
      import {useChatAutoScroll,useChatVirtualBridge} from './src/app/components/use-chat-auto-scroll';
      import {useStarredMessageJump} from './src/app/components/use-starred-message-jump';
      const sessionId='conv_one',activeChatId='conv_one',inlineSelectionThreads=new Map();
      const savedChatHighlights=[{id:'existing',sourceMessageId:'source',start:0,end:'A selected passage in the source.'.length,quote:'A selected passage in the source.',color:'blue',note:'Keep this note'}];
      function App(){
        const [messages,setMessages]=useState(()=>JSON.parse(localStorage.getItem('messages')||'[]'));
        const [composerSelection,setComposerSelection]=useState(null),[selectionMenu,setSelectionMenu]=useState(null);
        const [openInlineAnswers,setOpenInlineAnswers]=useState([]),[savedInlineSelections,setSavedInlineSelections]=useState([]);
        const [target,setStarredMessageTarget]=useState(null);const setSelectionMessageTarget=setStarredMessageTarget;
        const setSavedChatHighlights=()=>{},composerTextareaRef=useRef(null),textareaRef=composerTextareaRef;
        ${['chatSelections','annotationsByMessage','beginSelectionQuestion','openAnnotation'].map(name=>declarations.get(name)).join('\n')}
        const bridge=useChatVirtualBridge();
        const rows=useMemo(()=>messages.map(message=>({message})),[messages]);
        const scroll=useChatAutoScroll({isResponding:false,responseKey:'fixed',contentKey:messages.length,conversationKey:sessionId,virtual:bridge});
        useStarredMessageJump({target,chatId:sessionId,loading:false,rows,bridge,scrollRef:scroll.ref,scrollToMessage:scroll.scrollToMessage});
        const send=()=>{
          const next=[{id:'question',role:'user',content:'Explain this passage',textSelection:composerSelection},
            ...Array.from({length:100},(_,i)=>({id:'message-'+i,role:'assistant',content:'Later answer '+i}))];
          localStorage.setItem('messages',JSON.stringify(next));setMessages(next);setComposerSelection(null);
        };
        return <><SelectableAssistantMarkdown content='A selected passage in the source.' sourceMessageId='source'
          annotations={annotationsByMessage.get('source')||[]} onSelection={setSelectionMenu} onOpenAnnotation={openAnnotation}/>
          {selectionMenu&&<ChatSelectionMenu selection={selectionMenu} onAskInChat={()=>beginSelectionQuestion('chat')}
            onAskHere={()=>beginSelectionQuestion('inline')} onClose={()=>setSelectionMenu(null)}/>}
          <textarea aria-label='Composer' ref={composerTextareaRef} defaultValue='Keep my draft'/><button onClick={send}>Send</button>
          <div id='scroller' ref={scroll.ref} style={{height:300,overflowY:'auto'}}><VirtualizedMessageList surface='ask-chat-test'
            items={rows} getItemKey={row=>row.message.id} estimateSize={()=>120} renderItem={row=><div style={{height:120}}>{row.message.content}</div>}
            scrollRef={scroll.ref} bridge={bridge} gap={0} resetKey={sessionId}/></div></>;
      }createRoot(document.getElementById('root')).render(<App/>);` },
    });
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://ask-chat.test/**', route => route.fulfill({ contentType:'text/html', body:'<div id="root"></div>' }));
    const mount = async () => { await page.goto('https://ask-chat.test/'); await page.addScriptTag({content:bundle.outputFiles[0].text}); };
    await mount();
    await page.locator('[data-chat-selectable-message]').evaluate(element => {
      const text = document.createTreeWalker(element.querySelector('p'),NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(text,2); range.setEnd(text,18);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      element.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',shiftKey:true,bubbles:true}));
    });
    await page.getByRole('button',{name:'Ask in chat',exact:true}).click();
    const mark = page.getByRole('button',{name:'Open question in chat',exact:true});
    await expect(mark).toHaveText('selected passage');
    await expect(page.locator('mark mark')).toHaveCount(0);
    await expect(page.locator('mark[data-chat-selection-id=existing]').first()).toHaveAttribute('data-chat-note','true');
    await expect(page.getByLabel('Composer')).toBeFocused();
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await mount();
    await expect(mark).toHaveText('selected passage');
    await mark.focus(); await page.keyboard.press('Enter');
    const question = page.locator('[data-starred-message-target]');
    await expect(question).toHaveText('Explain this passage');
    await expect(question).toBeFocused();
    await expect(page.getByLabel('Composer')).toHaveValue('Keep my draft');
    await expect(page.locator('.bb-inline-answer')).toHaveCount(0);
    assert.deepEqual(errors,[]);
  });
}

test('Quartz page marks persist their chat destination and support keyboard navigation', { timeout:60_000 }, async t => {
  const bundle = await build({ entryPoints:[path.join(root,'../quartz/quartz/components/scripts/highlighter.inline.ts')], bundle:true, write:false, platform:'browser', format:'iife' });
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})}); t.after(()=>browser.close());
  const page = await browser.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const stored = new Map();
  await page.route('https://reader.test/**', async route => {
    if (route.request().url().includes('/api/')) {
      const {key,entries=[],mutations=[]}=route.request().postDataJSON();
      const values=stored.get(key)??new Map(entries.map(e=>[e.id,e]));
      for(const mutation of mutations) mutation.value===null?values.delete(mutation.id):values.set(mutation.id,mutation.value);
      stored.set(key,values);
      return route.fulfill({json:{entries:[...values.values()],acknowledged:mutations.map(m=>m.operationId)}});
    }
    return route.fulfill({contentType:'text/html',body:`<body data-slug="lesson"><article class="popover-hint">A saved passage for a question.</article>
      <div class="breadboard-ai"></div><div class="bb-highlighter" hidden><div class="bb-highlight-menu">
      <button data-highlight-action="erase">Erase</button><button data-highlight-action="ask-chat">Ask in chat</button><button data-highlight-action="ask-inline">Ask here</button></div></div></body>`});
  });
  const mount=async()=>{
    await page.goto('https://reader.test/lesson');
    await page.evaluate(()=>{window.addCleanup=()=>{};window.addEventListener('breadboard:assistant-open-chat',event=>window.opened=event.detail.chatLink);});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('nav')));
  };
  await mount();
  await page.evaluate(()=>{
    window.addEventListener('breadboard:assistant-ask-here',event=>window.asked=event.detail);
    const text=document.querySelector('article').firstChild,range=document.createRange();
    range.setStart(text,2);range.setEnd(text,15);getSelection().removeAllRanges();getSelection().addRange(range);
    document.querySelector('article').dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',shiftKey:true,bubbles:true}));
  });
  await page.getByRole('button',{name:'Ask in chat',exact:true}).click();
  const requested = await page.evaluate(()=>window.asked);
  assert.equal(requested.text,'saved passage');
  const link={chatId:'conv_saved',selectionId:'turn_saved',surface:'page'};
  await page.evaluate(({highlightId,chatLink})=>window.dispatchEvent(new CustomEvent('breadboard:assistant-chat-link',{detail:{highlightId,chatLink,pageSlug:'lesson'}})),{highlightId:requested.highlightId,chatLink:link});
  const mark=page.getByRole('button',{name:'Open question in chat',exact:true});
  await expect(mark).toHaveAttribute('data-hl-chat','true');
  await mark.click(); assert.deepEqual(await page.evaluate(()=>window.opened),link);
  await mount(); await mark.focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.opened),link);
  assert.deepEqual(errors,[]);
});
