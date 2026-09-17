import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { normalizeQuartzAssistantSelection, quartzAssistantSelectionPromptContext } from '../src/lib/quartz-assistant-selection.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'src/app/garden/garden-assistant.tsx'), 'utf8');
const tree = ts.createSourceFile('garden.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
for (const node of tree.statements) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(tree));
  if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) {
    declarations.set(item.name.getText(tree), `const ${item.getText(tree)};`);
  }
}

// Mount the actual Quartz transcript row and controller. Runtime dispatch is a
// deterministic turn producer so these checks never call a model or user chat.
const bundle = await build({ bundle: true, write: false, outfile: 'quartz-selection-fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic',
  alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' }, logLevel: 'silent',
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{memo,useState,useRef} from 'react'; import {createRoot} from 'react-dom/client';
    import {useTextSelectionController} from '@/app/components/use-text-selection-controller';
    import {SelectableAssistantMarkdown,SelectionComposerContext,QuotedChatSelection} from '@/app/components/chat-text-selection-ui';
    import AssistantRichResponse from '@/app/components/assistant-rich-response';
    import UserMessageControls from '@/app/components/chat/user-message-controls';
    import {assistantVisibleContent} from '@/lib/hermes/assistant-visible-content';
    import {isClarificationAnswerMessage} from '@/lib/steered-response';
    import {isInlineSelectionNotificationViewed} from '@/lib/notification-view-presence';
    window.isInlineViewed=isInlineSelectionNotificationViewed;
    import {uiResourcesForUserRequest} from '@/lib/generative-ui/request-policy';
    import {chatRowKey} from '@/app/components/chat/chat-row-identity';
    const ActivityPanel=()=>null,AssistantMessageActions=()=>null,ChatTimeSeparator=()=>null,ChatMessageAttachments=()=>null,ChatVideoLinkEmbeds=()=>null,InlineProposalCards=()=>null;
    const delegatedThinkingUpdates=()=>[],delegatedAgentCompletedLabelForMessage=()=>'';
    const CollapsibleUserMessage=({children})=><>{children}</>,UserMessageText=({content})=><p>{content}</p>;
    ${['gardenAssistantVisibleContent','visibleGardenChatMessages','gardenSelectionMessageId','withRecoveredAssistant','TranscriptRow'].map(name => declarations.get(name)).join('\n')}
    function App(){
      const [scope,setScope]=useState('quartz:fixture:1');
      const [messages,setMessages]=useState(()=>JSON.parse(localStorage.getItem('fixture-messages')||'null')||[
        {id:'response-1',role:'assistant',content:'Quartz response **selected passage** continues with context. Another **sentence to remember**.'}
      ]);
      const [input,setInput]=useState(''),[busy,setBusy]=useState(false);
      const composerRef=useRef(null);
      const save=next=>{setMessages(next);localStorage.setItem('fixture-messages',JSON.stringify(next));};
      const mapped=messages.map((m,i)=>({...m,id:gardenSelectionMessageId(m,i)}));
      const ask=(question,selection)=>{
        window.submitted={question,selection};
        const clientMessageId=crypto.randomUUID();
        save([...messages,{role:'user',content:question,selectedText:selection.quote,textSelection:selection,clientMessageId},
          {role:'assistant',content:'Inline answer with **nested explanation** to select.',textSelection:selection,clientMessageId}]);
        setBusy(true);setInput('');
      };
      const controls=useTextSelectionController({scope,messages:mapped,busy,composerRef,onAsk:ask,onStop:()=>setBusy(false),onBeginQuestion:()=>{}});
      window.switchScope=setScope;window.finish=()=>setBusy(false);
      return <><main>{visibleGardenChatMessages(messages).map((message,index)=><TranscriptRow key={gardenSelectionMessageId(message,index)}
        message={message} userRequest="Explain Quartz" sourceMessageId={gardenSelectionMessageId(message,index)}
        annotations={controls.annotations.get(gardenSelectionMessageId(message,index))||[]}
        onTextSelection={controls.receiveSelection} onOpenAnnotation={controls.openAnnotation} onSend={()=>{}} />)}</main>
        {controls.overlays}
        <div className="bb-composer-overlay">
        {controls.composerSelection&&<SelectionComposerContext selection={controls.composerSelection} onCancel={controls.cancelQuestion}/>}
        <textarea aria-label="Question" ref={composerRef} value={input} onChange={e=>setInput(e.target.value)}/>
        <button onClick={()=>{ask(input,controls.composerSelection);controls.clearComposerSelection();}}>Send</button>
        </div>
      </>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` } });

let browser, css;
before(async () => {
  const stylesheet = path.join(root, 'src/app/globals.css');
  css = (await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'), {from:stylesheet})).css;
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
  browser = await chromium.launch({executablePath,headless:true});
});
after(async () => { await browser?.close(); });

async function fixture(t) {
  const page = await browser.newPage({viewport:{width:1100,height:850}});
  page.setDefaultTimeout(8000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
  const stores = new Map();
  await page.route('http://localhost:53139/**',async route=>{
    if (route.request().url().endsWith('/api/text-highlights')) {
      const {key,entries=[],mutations=[]}=route.request().postDataJSON();
      const current=stores.get(key)||new Map(entries.map(item=>[typeof item==='string'?item:item.id,item]));
      for(const mutation of mutations) mutation.value===null?current.delete(mutation.id):current.set(mutation.id,mutation.value);
      stores.set(key,current);
      return route.fulfill({json:{entries:[...current.values()],acknowledged:mutations.map(m=>m.operationId)}});
    }
    return route.fulfill({contentType:'text/html',body:'<html data-theme="light"><body><div id="root" style="max-width:680px;margin:110px auto"></div></body></html>'});
  });
  const mount=async()=>{
    await page.goto('http://localhost:53139/');
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.locator('[data-chat-selectable-message]').first().waitFor();
  };
  await mount();
  return {page,mount,stores};
}

async function select(page, quote, within=page.locator('main'), toolbar=true) {
  const target=within.getByText(quote,{exact:true});
  const points=await target.evaluate(element=>{
    const text=element.firstChild,range=document.createRange();
    range.setStart(text,0);range.setEnd(text,1);const a=range.getBoundingClientRect();
    range.setStart(text,text.length-1);range.setEnd(text,text.length);const b=range.getBoundingClientRect();
    return {x:a.left,y:a.top+a.height/2,endX:b.right,endY:b.top+b.height/2};
  });
  await page.mouse.move(points.x,points.y);await page.mouse.down();
  await page.mouse.move(points.endX,points.endY,{steps:15});await page.mouse.up();
  if(toolbar) await page.getByRole('toolbar',{name:'Selected text actions'}).waitFor();
}

test('Quartz response drag-selection shares highlight, recolor, erase and durable scope isolation',async t=>{
  const {page,mount}=await fixture(t);
  await select(page,'selected passage');
  assert.equal(await page.getByRole('button',{name:'Ask in chat',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Ask here',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Highlight blue',exact:true}).click();
  assert.equal(await page.locator('mark').innerText(),'selected passage');
  await mount();
  assert.equal(await page.locator('mark').innerText(),'selected passage');
  await page.locator('mark').click();
  await page.getByRole('button',{name:'Highlight pink',exact:true}).click();
  await page.locator('mark').click();
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await page.getByRole('textbox',{name:'Note about selected text',exact:true}).fill('Connect this to the worked example.');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.mouse.move(0,0);
  await page.locator('mark').hover();
  assert.equal(await page.getByRole('tooltip').innerText(),'Connect this to the worked example.');
  await mount();
  await page.mouse.move(0,0);
  await page.locator('mark').hover();
  assert.equal(await page.getByRole('tooltip').innerText(),'Connect this to the worked example.');
  await page.locator('mark').click();
  assert.equal(await page.getByRole('textbox',{name:'Note about selected text',exact:true}).isVisible(),true);
  await page.evaluate(()=>window.switchScope('quartz:fixture:2'));
  await page.waitForFunction(()=>document.querySelectorAll('mark').length===0);
  await page.evaluate(()=>window.switchScope('quartz:fixture:1'));
  await page.locator('mark').waitFor();
  await page.locator('mark').click();
  await page.getByRole('button',{name:'Remove highlight',exact:true}).click();
  await mount();
  assert.equal(await page.locator('mark').count(),0);
});

test('notes underline without highlighting and show only the note text as a bubble while the text is hovered',async t=>{
  const {page,mount,stores}=await fixture(t);
  const noteText='Remember this connection.\nRevisit the worked example.';
  await select(page,'selected passage');
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await page.getByRole('textbox',{name:'Note about selected text',exact:true}).fill(noteText);
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.locator('mark').waitFor();
  assert.equal(await page.getByRole('toolbar').count(),0);
  assert.equal(await page.getByRole('note').count(),0,'saving a note adds nothing under the message');
  assert.equal(await page.getByRole('tooltip').count(),0,'the bubble waits for a hover');
  assert.equal(await page.locator('mark').getAttribute('title'),null);
  for(const state of ['normal','hover','focus']) {
    if(state==='hover') await page.locator('mark').hover();
    if(state==='focus') await page.locator('mark').focus();
    const style=await page.locator('mark').evaluate(el=>{
      const css=getComputedStyle(el);
      return {background:css.backgroundColor,decoration:css.textDecorationLine,style:css.textDecorationStyle,padding:css.padding,shadow:css.boxShadow};
    });
    assert.deepEqual(style,{background:'rgba(0, 0, 0, 0)',decoration:'underline',style:'dotted',padding:'0px',shadow:'none'},state);
  }
  await page.mouse.move(0,0);
  await page.getByRole('textbox',{name:'Question',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[role="tooltip"]'));
  const bubble=page.getByRole('tooltip');
  const bubbleShowsOnlyTheNote=async()=>{
    await page.locator('mark').first().hover();
    await bubble.waitFor();
    assert.equal(await bubble.innerText(),noteText,'the bubble is the note text and nothing else');
    assert.equal(await bubble.locator('button, [class*="quote"], [class*="heading"]').count(),0);
    const quoteShown=await bubble.evaluate(el=>el.textContent.includes('selected passage'));
    assert.equal(quoteShown,false,'the bubble never repeats the quoted text');
    const layout=await bubble.evaluate(el=>{
      const rect=el.getBoundingClientRect();
      const mark=document.querySelector('mark').getBoundingClientRect();
      const tail=getComputedStyle(el,'::before');
      return {left:rect.left,right:rect.right,top:rect.top,markBottom:mark.bottom,markLeft:mark.left,
        width:window.innerWidth,contentHeight:el.scrollHeight,visibleHeight:el.clientHeight,tail:tail.content,tailTop:tail.top,placement:el.dataset.placement};
    });
    assert.equal(layout.placement,'below');
    assert.ok(layout.top>layout.markBottom,'the bubble hangs below the underlined text');
    assert.ok(layout.left>=0&&layout.right<=layout.width,JSON.stringify(layout));
    assert.ok(layout.left<=layout.markLeft,'the bubble starts at the underlined text');
    assert.equal(layout.contentHeight,layout.visibleHeight,'the full note stays readable');
    assert.ok(layout.tail==='""'&&parseFloat(layout.tailTop)<0,'the bubble points up at the text');
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>!document.querySelector('[role="tooltip"]'));
  };
  await bubbleShowsOnlyTheNote();
  await mount();
  await page.locator('mark').waitFor();
  await bubbleShowsOnlyTheNote();
  await page.locator('mark').focus();
  await bubble.waitFor();
  assert.equal(await bubble.innerText(),noteText,'keyboard focus shows the same bubble');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('[role="tooltip"]'));
  await page.locator('mark').click();
  assert.equal(await page.getByRole('tooltip').count(),0,'opening the editor dismisses the bubble');
  await page.getByRole('button',{name:'Edit note',exact:true}).click();
  await page.getByRole('textbox',{name:'Note about selected text',exact:true}).fill('Updated note.');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.mouse.move(0,0);
  await page.locator('mark').first().hover();
  await bubble.waitFor();
  assert.equal(await bubble.innerText(),'Updated note.');
  await page.mouse.move(0,0);
  await select(page,'sentence to remember');
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  const longNote='A second note stays readable.\n'+'Long details stay in the bubble. '.repeat(20);
  await page.getByRole('textbox',{name:'Note about selected text',exact:true}).fill(longNote);
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await mount();
  await page.waitForFunction(()=>document.querySelectorAll('mark').length===2);
  const saved=[...stores.get('breadboard:chat-highlights:quartz:fixture:1').values()];
  assert.ok(saved.every(entry=>!entry.color),'adding notes never creates an implicit color highlight');
  assert.equal(saved.find(entry=>entry.quote==='sentence to remember').start,
    'Quartz response selected passage continues with context. Another '.length);
  for(const width of [1100,390]) {
    await page.setViewportSize({width,height:850});
    for(const theme of ['light','dark']) {
      await page.locator('html').evaluate((el,theme)=>el.dataset.theme=theme,theme);
      await page.mouse.move(0,0);
      await page.locator('mark').nth(1).hover();
      await bubble.waitFor();
      const layout=await bubble.evaluate(el=>{
        const rect=el.getBoundingClientRect();
        return {left:rect.left,right:rect.right,contentHeight:el.scrollHeight,visibleHeight:el.clientHeight};
      });
      assert.ok(layout.left>=0&&layout.right<=width,JSON.stringify(layout));
      assert.equal(layout.contentHeight,layout.visibleHeight,'long notes stay readable');
      assert.equal(await bubble.innerText(),longNote.trim());
      if(process.env.NOTE_QA_DIR) {
        fs.mkdirSync(process.env.NOTE_QA_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.NOTE_QA_DIR,`notes-${width}-${theme}.png`),fullPage:true});
      }
      await page.mouse.move(0,0);
      await page.waitForFunction(()=>!document.querySelector('[role="tooltip"]'));
    }
  }
  await page.locator('mark').first().click();
  await page.getByRole('button',{name:'Remove note',exact:true}).click();
  await mount();
  await page.waitForFunction(()=>document.querySelectorAll('mark').length===1);
  assert.deepEqual(await page.locator('mark').allInnerTexts(),['sentence to remember'],
    'removing a note leaves its original text unmarked');
});

test('Ask in chat quotes the response and Ask here supports streaming, nesting, retry and deletion',async t=>{
  const {page,mount}=await fixture(t);
  await page.setViewportSize({width:1860,height:969});
  await select(page,'selected passage');
  await page.getByRole('button',{name:'Ask in chat',exact:true}).click();
  await page.getByRole('textbox',{name:'Question',exact:true}).fill('Explain the passage');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const submitted=await page.evaluate(()=>window.submitted);
  assert.equal(submitted.selection.sourceMessageId,'id:response-1');
  assert.equal(submitted.selection.quote,'selected passage');
  assert.equal(submitted.selection.mode,'chat');
  await page.evaluate(()=>window.finish());
  await select(page,'selected passage');
  await page.getByRole('button',{name:'Ask here',exact:true}).click();
  await page.getByRole('textbox',{name:'Question',exact:true}).fill('Explain inline');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  assert.equal(await page.locator('main').getByText('Explain inline',{exact:true}).count(),0);
  let dialog=page.getByRole('dialog',{name:'Answer about highlighted text'});
  assert.equal(await dialog.locator('[aria-label="Assistant response actions"]').count(),0,'streaming answers have no completion actions');
  await dialog.getByRole('button',{name:'Stop this answer',exact:true}).click();
  await dialog.getByRole('button',{name:'Ask this question again',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.submitted)).question,'Explain inline');
  await page.evaluate(()=>window.finish());
  const actions=dialog.locator('[aria-label="Assistant response actions"]');
  await actions.waitFor();
  for(const name of ['Copy response','Read response aloud','Mark response as helpful','Mark response as not helpful','More response actions']) {
    assert.equal(await actions.getByRole('button',{name,exact:true}).count(),1);
  }
  assert.equal(await actions.getByRole('button',{name:'Regenerate response',exact:true}).count(),0);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedAnswer=text}}}));
  await actions.getByRole('button',{name:'Copy response',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.copiedAnswer),'Inline answer with **nested explanation** to select.');
  await actions.getByRole('button',{name:'Mark response as helpful',exact:true}).click();
  assert.equal(await actions.getByRole('button',{name:'Mark response as helpful',exact:true}).getAttribute('aria-pressed'),'true');
  await actions.getByRole('button',{name:'More response actions',exact:true}).click();
  const download=page.waitForEvent('download');
  await actions.getByRole('button',{name:'Download Markdown',exact:true}).click();
  assert.match((await download).suggestedFilename(),/^breadboard-response-.*\.md$/);
  await actions.getByRole('button',{name:'More response actions',exact:true}).click();
  await actions.getByRole('button',{name:'View evidence',exact:true}).click();
  await page.locator('[aria-label="Response evidence"]').waitFor();
  await page.getByRole('button',{name:'Close evidence',exact:true}).click();
  assert.equal(await dialog.count(),1,'the portalled evidence panel keeps its answer open');
  await select(page,'nested explanation',dialog);
  await page.getByRole('button',{name:'Ask here',exact:true}).click();
  await page.getByRole('textbox',{name:'Question',exact:true}).fill('Explain nested');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const nested=await page.evaluate(()=>window.submitted);
  assert.match(nested.selection.sourceMessageId,/^client:.*:assistant$/);
  await page.evaluate(()=>window.finish());
  await mount();
  await page.locator('main mark').click();
  await dialog.locator('mark').click();
  assert.equal(await dialog.count(),2);
  const assertSeparate=async()=>{
    await page.waitForFunction(()=>{
      const cards=[...document.querySelectorAll('.bb-inline-answer')].map(el=>el.getBoundingClientRect());
      return cards.every((a,i)=>cards.slice(i+1).every(b=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));
    });
  };
  await assertSeparate();
  await select(page,'nested explanation',dialog.last());
  await page.getByRole('button',{name:'Ask here',exact:true}).click();
  await page.getByRole('textbox',{name:'Question',exact:true}).fill('Explain a third level');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.evaluate(()=>window.finish());
  assert.equal(await dialog.count(),3);
  await dialog.last().getByRole('button',{name:'More response actions',exact:true}).click();
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(),3,'Escape closes the action menu before any ancestor answer');
  assert.equal(await dialog.last().getByRole('button',{name:'More response actions',exact:true}).getAttribute('aria-expanded'),'false');
  await page.waitForFunction(()=>window.isInlineViewed(window.submitted.selection.id));
  await assertSeparate();
  const composer=await page.locator('.bb-composer-overlay').boundingBox();
  for(const card of await dialog.all()) {
    const rect=await card.boundingBox();
    assert.ok(rect.y+rect.height<=composer.y,'answers leave the dialogue clear');
  }
  const artifacts=path.join(root,'.tmp-ask-here-qa');fs.mkdirSync(artifacts,{recursive:true});
  await page.screenshot({path:path.join(artifacts,'nested-desktop.png')});
  await page.getByRole('textbox',{name:'Question',exact:true}).fill('I can keep typing');
  assert.equal(await dialog.count(),3,'the composer does not close open answers');
  const before=await dialog.last().boundingBox();
  const handle=await dialog.last().getByRole('button',{name:'Move answer',exact:true}).boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2-50,handle.y+handle.height/2+50,{steps:10});await page.mouse.up();
  const after=await dialog.last().boundingBox();
  assert.ok(Math.abs(after.x-before.x)>20||Math.abs(after.y-before.y)>20,'answers can be rearranged');
  await page.setViewportSize({width:390,height:700});
  await page.waitForFunction(()=>[...document.querySelectorAll('.bb-inline-answer')].every(el=>{
    const rect=el.getBoundingClientRect();return rect.left>=16&&rect.right<=374&&rect.bottom<=document.querySelector('.bb-composer-overlay').getBoundingClientRect().top;
  }));
  await page.screenshot({path:path.join(artifacts,'nested-mobile.png')});
  await page.setViewportSize({width:1860,height:969});
  // Remove the third level, then its parent; deleting does not lose the first answer.
  await dialog.last().getByRole('button',{name:'Delete highlight',exact:true}).click();
  await dialog.last().getByRole('button',{name:'Delete highlight',exact:true}).click();
  await mount();
  await page.locator('main mark').click();
  assert.equal(await dialog.locator('mark').count(),0,'deleted inline anchors stay deleted after history hydration');
});

test('Quartz response follow-ups preserve source context through API normalization',()=>{
  const selection=normalizeQuartzAssistantSelection({requestId:'r1',highlightId:'r1',mode:'chat',text:'selected passage',
    sourceMessageId:'id:response-1',sourceResponse:'Quartz response selected passage continues with context.',prefix:'Quartz response ',suffix:' continues with context.'});
  const prompt=quartzAssistantSelectionPromptContext(selection);
  assert.match(prompt,/earlier assistant response/);
  assert.match(prompt,/"sourceResponse":"Quartz response selected passage continues with context\."/);
  assert.doesNotMatch(prompt,/The user highlighted a specific excerpt on the current Quartz page/);
});

test('Garden page Ask here uses the shared popup across the iframe boundary', async t => {
  const scripts = await Promise.all([
    build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
      entryPoints:[path.join(root,'../quartz/quartz/components/scripts/highlighter.inline.ts')]}),
    build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
      alias:{'@':path.join(root,'src')},loader:{'.css':'empty'},
      stdin:{resolveDir:root,loader:'tsx',contents:`
        import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';
        import QuartzInlineAnswerPopover from '@/app/garden/quartz-inline-answer-popover';
        window.requests=[];addEventListener('message',e=>window.requests.push(e.data));
        window.answerSelections=[];
        const answerSelection={messageIdFor:id=>'page-answer:'+id,annotations:new Map(),
          onSelection:selection=>window.answerSelections.push(selection),onOpenAnnotation:()=>{}};
        function App(){const frame=useRef(null);return <>
          <iframe ref={frame} src="http://localhost:53140/reader" style={{display:'block',marginTop:60,width:'100%',height:'calc(100vh - 60px)',border:0}}/>
          <QuartzInlineAnswerPopover iframeRef={frame} quartzOrigin="http://localhost:53140" answerSelection={answerSelection}/>
        </>;}createRoot(document.getElementById('root')).render(<App/>);
      `}}),
  ]);
  const page = await browser.newPage({viewport:{width:1100,height:850}});
  page.setDefaultTimeout(8000);
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
  const stores=new Map();
  await page.route('http://localhost:*/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/text-highlights'){
      const {key,entries=[],mutations=[]}=route.request().postDataJSON();
      const current=stores.get(key)||new Map(entries.map(item=>[item.id,item]));
      for(const mutation of mutations) mutation.value===null?current.delete(mutation.id):current.set(mutation.id,mutation.value);
      stores.set(key,current);
      return route.fulfill({json:{entries:[...current.values()],acknowledged:mutations.map(m=>m.operationId)},headers:{'Access-Control-Allow-Origin':'*'}});
    }
    if(url.pathname==='/reader.js') return route.fulfill({contentType:'application/javascript',body:scripts[0].outputFiles[0].text});
    if(url.pathname==='/reader') return route.fulfill({contentType:'text/html',body:`
      <html><body data-slug="parity/lesson" style="margin:0;background:#17191b;color:white">
        <article class="popover-hint" style="margin:150px 80px;font:16px/1.6 sans-serif">
          <p>A magnetic field determines the sideways force that a moving charge would experience.</p>
        </article>
        <div class="bb-highlighter" hidden><div class="bb-highlight-menu">
          <button data-highlight-action="ask-inline">Ask here</button><button data-highlight-action="erase">Erase</button>
        </div></div>
        <script>window.cleanups=[];window.addCleanup=fn=>cleanups.push(fn);</script>
        <script src="/reader.js"></script><script>document.dispatchEvent(new Event('nav'));</script>
      </body></html>`});
    return route.fulfill({contentType:'text/html',body:'<html data-theme="dark"><body><div id="root"></div></body></html>'});
  });
  await page.goto('http://localhost:53139/');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:scripts[1].outputFiles[0].text});
  const frame=await page.locator('iframe').elementHandle().then(el=>el.contentFrame());
  await frame.waitForSelector('.bb-highlighter[data-bound="true"]',{state:'attached'});
  await frame.evaluate(()=>{
    const text=document.querySelector('article p').firstChild;
    const range=document.createRange();range.setStart(text,0);range.setEnd(text,text.length);
    getSelection().removeAllRanges();getSelection().addRange(range);
    document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));
  });
  await frame.getByRole('button',{name:'Ask here',exact:true}).click();
  await page.waitForFunction(()=>requests.some(r=>r.type==='second-brain:assistant-ask-here'));
  let request=await page.evaluate(()=>requests.find(r=>r.type==='second-brain:assistant-ask-here'));
  const answer='“This field” means the **magnetic field**.\n\n1. **It deflects moving charges.**\n\n```text\nmagnetic force = sideways push\n```\n\n> Which way would the charge be pushed?\n\n'+('A magnetic field can change the direction of motion.\n\n'.repeat(12));
  const publish=async(state,content=answer)=>page.evaluate(({request,state,content})=>{
    document.querySelector('iframe').contentWindow.postMessage({...request,type:'second-brain:assistant-inline-answer',question:request.question||'explain',answer:content,state,responseDurationMs:29600},'http://localhost:53140');
  },{request,state,content});
  await publish('pending','');
  const dialog=page.getByRole('dialog',{name:'Answer about highlighted text'});
  await dialog.waitFor();
  assert.equal(await frame.locator('.bb-highlight-answer').isVisible(),false,'the old page popup stays hidden');
  await dialog.getByRole('button',{name:'Stop this answer',exact:true}).click();
  await page.waitForFunction(()=>requests.some(r=>r.type==='second-brain:assistant-inline-stop'));
  await publish('complete');
  assert.equal(await dialog.locator('strong').first().innerText(),'magnetic field');
  assert.equal(await dialog.locator('ol li').count(),1);
  assert.equal(await dialog.locator('pre code').innerText(),'magnetic force = sideways push\n');
  assert.equal(await dialog.locator('blockquote').innerText(),'Which way would the charge be pushed?');
  // A page answer is selectable like Terminal's, so Ask here can nest inside it.
  await select(page,'Which way would the charge be pushed?',dialog,false);
  await page.waitForFunction(()=>answerSelections.length>0);
  const nested=await page.evaluate(()=>answerSelections.at(-1));
  assert.equal(nested.sourceMessageId,'page-answer:'+request.requestId);
  assert.equal(nested.quote,'Which way would the charge be pushed?');
  await page.evaluate(()=>getSelection().removeAllRanges());
  assert.equal(await dialog.getByRole('button',{name:'Close answer',exact:true}).count(),0);
  for(const viewport of [{width:1100,height:850},{width:390,height:700}]){
    await page.setViewportSize(viewport);
    await page.waitForFunction(()=>{const el=document.querySelector('.bb-inline-answer');return el&&el.getBoundingClientRect().right<=innerWidth;});
    const layout=await dialog.evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,padding:getComputedStyle(el).paddingTop,radius:getComputedStyle(el).borderRadius}));
    assert.ok(layout.rect.left>=16 && layout.rect.right<=layout.width-16,JSON.stringify(layout));
    assert.ok(layout.rect.top>=16 && layout.rect.bottom<=layout.height-16,JSON.stringify(layout));
    assert.equal(layout.padding,viewport.width>=640?'24px':'20px');
    assert.equal(layout.radius,'22.4px');
  }
  await page.setViewportSize({width:1100,height:850});
  if(process.env.QUARTZ_SHARED_ANSWER_SCREENSHOT) await page.screenshot({path:process.env.QUARTZ_SHARED_ANSWER_SCREENSHOT});
  await dialog.getByRole('button',{name:'Edit this question',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Edit question about highlighted text'}).fill('explain sideways force');
  await dialog.getByRole('button',{name:'Ask again',exact:true}).click();
  await page.waitForFunction(()=>requests.filter(r=>r.type==='second-brain:assistant-ask-here').length===2);
  const retry=await page.evaluate(()=>requests.filter(r=>r.type==='second-brain:assistant-ask-here').at(-1));
  assert.equal(retry.question,'explain sideways force');
  assert.equal(retry.highlightId,request.highlightId);
  assert.equal(retry.text,request.text);
  request=retry;
  await publish('pending','');
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  await publish('complete');
  assert.equal(await dialog.count(),0,'streaming updates respect dismissal');
  await frame.locator('mark.bb-hl').click();
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  await frame.locator('mark.bb-hl').click();
  await dialog.waitFor();
  await frame.evaluate(()=>{for(const cleanup of cleanups.splice(0))cleanup();document.dispatchEvent(new Event('nav'));});
  await dialog.waitFor({state:'hidden'});
  await frame.locator('mark.bb-hl').click();
  await dialog.getByRole('button',{name:'Delete highlight',exact:true}).click();
  await frame.waitForFunction(()=>document.querySelectorAll('mark.bb-hl').length===0);
  await frame.goto(frame.url());
  await frame.waitForSelector('article');
  assert.equal(await frame.locator('mark.bb-hl').count(),0);
});
