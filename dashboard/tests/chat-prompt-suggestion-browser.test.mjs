import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/app/components/assistant-composer.tsx'), 'utf8');
const tree = ts.createSourceFile('composer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let input;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.getText(tree).includes('relative flex min-w-0 flex-1 items-center') && node.getText(tree).includes('<textarea')) input = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(input, 'Exercise the actual composer input, keyboard handlers and ghost text');

test('ghost suggestions accept, dismiss, preserve keyboard navigation and reject stale responses', { timeout: 120_000 }, async t => {
  const bundle = await build({ bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useRef,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {usePromptSuggestion} from '@/app/components/use-prompt-suggestion';
      import PromptSuggestionOverlay from '@/app/components/prompt-suggestion-overlay';
      import {composerSegments} from '@/lib/composer-links';
      import {splitLeadingCommandTokens} from '@/app/components/hermes/command-text';
      function App() {
        const [value,onChange]=useState(''), [state,configure]=useState({chat:'one',busy:false,compact:false,menu:false,personalize:false});
        const [messages,setMessages]=useState([{role:'user',content:'Explain RLC circuits'},{role:'assistant',content:'Resistor, inductor and capacitor.'}]);
        const compact=state.compact;
        const promptSuggestion=usePromptSuggestion({messages,conversationKey:state.chat,model:'test-model',value,enabled:!state.busy,onChange,personalize:state.personalize});
        const internalTextareaRef=useRef(null),commandBackdropRef=useRef(null),assignTextareaRef=internalTextareaRef;
        const slashCommandMenuRef=useRef(null),commandHubRef=useRef(null),addMenuRef=useRef(null);
        slashCommandMenuRef.current={handleKeyDown:event=>{if(state.menu&&event.key==='Tab'){event.preventDefault();window.menuAccepted=true;return true;}return false;}};
        const pendingWorkflowPrompt=null,setPendingWorkflow=()=>{},showSlashCommands=false;
        const menuSearch=null,setMenuSearch=()=>{},closeMenuSearch=()=>{};
        const setSlashQuery=()=>{},setShowSlashCommands=()=>{},setShowCommandHub=()=>{},slashQueryAt=()=>null;
        const onKeyDown=undefined,walkMessageHistory=()=>false,queueHeld=false;
        const uploadQueued=null,uploadQueuedRef=useRef(null),isAddingDocuments=false;
        const canSubmit=Boolean(value.trim()),isSending=false,disabled=false;
        const submitMessage=()=>{window.sent.push(value);onChange('');};
        const handlePaste=()=>{},syncCommandBackdrop=()=>{},textareaStyle=undefined;
        const placeholder='Ask anything';
        window.configure=next=>configure(current=>({...current,...next}));
        window.setDraft=onChange;window.setMessages=setMessages;
        return <div className="p-6"><div id="composer" className="neu-composer flex items-center gap-3 rounded-3xl p-4" style={{width:'100%',maxWidth:700}}>
          ${input}<button id="next">Send</button>
        </div></div>;
      }
      window.sent=[];
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet, 'utf8'), {from:stylesheet})).css;
  const browser = await chromium.launch({headless:true, ...(process.platform==='win32'?{channel:'msedge'}:{})});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:900,height:400}});
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  t.after(()=>assert.deepEqual(errors,[]));
  let requests=0;
  let release;
  let deferred=false;
  let startupRequests=0;
  await page.route('http://suggest.test/api/recommendations',async route=>{
    startupRequests++;
    const body=route.request().postDataJSON();
    assert.equal(body.personalize,true);assert.match(body.localDate,/^\d{4}-\d{2}-\d{2}$/);
    await route.fulfill({json:{recommendations:[{prompt:'Pick up my circuit notes using Recall.'}]}});
  });
  await page.route('http://suggest.test/api/chat-prompt-suggestion', async route=>{
    requests++;
    const payload=route.request().postDataJSON();
    assert.equal(payload.messages.length,2);
    assert.equal(payload.model,'test-model');
    const wait=deferred;
    if(wait) await new Promise(resolve=>{release=resolve;});
    await route.fulfill({json:{suggestion:wait?'Old conversation suggestion':'Show me a worked example'}}).catch(()=>{});
  });
  await page.route('http://suggest.test/', route=>route.fulfill({contentType:'text/html',body:'<html data-theme="light"><body><div id="root"></div></body></html>'}));
  await page.goto('http://suggest.test/');
  await page.addStyleTag({content:css});
  // Freeze the actual CSS animation so both halves can be inspected without
  // racing the renderer. Acceptance must still use the entire real suggestion.
  const pauseMotion=await page.addStyleTag({content:'.bb-composer-suggestion-text { animation-play-state: paused !important; }'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const textarea=page.getByRole('textbox',{name:'Ask anything'});
  const ghost=page.locator('[data-prompt-suggestion]');
  await expect(ghost).toBeVisible().catch(error => { console.error({errors,requests}); throw error; });
  await expect(ghost).toHaveAttribute('data-suggestion-phase','erase');
  await expect(ghost).toContainText('Ask anything');
  await expect(textarea).toHaveAttribute('placeholder','');
  await expect(page.locator('.sr-only')).toContainText('Suggested message: Show me a worked example');
  await expect(textarea).toHaveValue('');
  assert.deepEqual(await page.evaluate(()=>window.sent),[]);
  assert.equal(requests,1);
  await textarea.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.sent),[],'Enter does not send an unaccepted suggestion');

  // Capture the production markup in both themes and a compact narrow layout.
  const artifacts=path.join(root,'artifacts','prompt-suggestion-qa');
  fs.mkdirSync(artifacts,{recursive:true});
  const animatedText=ghost.locator('.bb-composer-suggestion-text');
  const erasing=await animatedText.evaluate(node=>{
    const animation=node.getAnimations()[0];
    animation.currentTime=Number(animation.effect.getTiming().duration)/2;
    return {name:animation.animationName,clip:getComputedStyle(node).clipPath,timing:getComputedStyle(node).animationTimingFunction};
  });
  assert.equal(erasing.name,'bb-chat-title-erase');assert.match(erasing.timing,/steps\(/);
  assert.notEqual(erasing.clip,'none');assert.notEqual(erasing.clip,'inset(0px)');
  await page.locator('#composer').screenshot({path:path.join(artifacts,'erasing-placeholder.png')});
  await animatedText.evaluate(node=>node.getAnimations()[0].finish());
  await expect(ghost).toHaveAttribute('data-suggestion-phase','type');
  await expect(ghost).toContainText('Show me a worked example');
  const typing=await animatedText.evaluate(node=>{
    const animation=node.getAnimations()[0];const timing=animation.effect.getTiming();
    animation.currentTime=Number(timing.delay)+Number(timing.duration)/2;
    return {name:animation.animationName,clip:getComputedStyle(node).clipPath};
  });
  assert.equal(typing.name,'bb-chat-title-type');assert.notEqual(typing.clip,'none');assert.notEqual(typing.clip,'inset(0px)');
  await page.locator('#composer').screenshot({path:path.join(artifacts,'typing-suggestion.png')});
  await animatedText.evaluate(node=>node.getAnimations()[0].finish());
  await expect(ghost).toHaveAttribute('data-suggestion-phase','ready');
  await pauseMotion.evaluate(node=>node.remove());
  await page.locator('#composer').screenshot({path:path.join(artifacts,'light.png')});
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';window.configure({compact:true});});
  await page.setViewportSize({width:390,height:300});
  await expect(ghost).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#composer').screenshot({path:path.join(artifacts,'dark-compact.png')});

  await textarea.press('Shift+Tab');
  await expect(textarea).not.toBeFocused();
  await expect(ghost).toBeVisible();
  await textarea.focus();
  await textarea.evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,isComposing:true})));
  await expect(textarea).toHaveValue('');
  await expect(ghost).toBeVisible();
  await page.evaluate(()=>window.configure({menu:true}));
  await textarea.press('Tab');
  assert.equal(await page.evaluate(()=>window.menuAccepted),true,'command menus get Tab first');
  await expect(textarea).toHaveValue('');
  await page.evaluate(()=>window.configure({menu:false}));
  await textarea.press('Tab');
  await expect(textarea).toHaveValue('Show me a worked example');
  await expect(textarea).toBeFocused();
  assert.equal(await textarea.evaluate(node=>node.selectionStart), 'Show me a worked example'.length, 'the accepted draft is ready to continue typing');
  await expect(ghost).toHaveCount(0);
  assert.deepEqual(await page.evaluate(()=>window.sent),[],'acceptance only edits the draft');
  await textarea.press('!');
  await textarea.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.sent),['Show me a worked example!']);
  await expect(ghost).toHaveCount(0);
  await textarea.press('Tab');
  await expect(page.locator('#next')).toBeFocused();

  await page.evaluate(()=>window.configure({chat:'two'}));
  await expect(ghost).toBeVisible();
  await textarea.press('Escape');
  await expect(ghost).toHaveCount(0);
  await expect(textarea).toHaveValue('');

  await page.evaluate(()=>window.configure({chat:'three'}));
  await expect(ghost).toBeVisible();
  await textarea.fill('My own question');
  await expect(ghost).toHaveCount(0);
  await textarea.fill('');
  await expect(ghost).toHaveCount(0);

  deferred=true;
  await page.evaluate(()=>window.configure({chat:'old'}));
  await expect.poll(()=>Boolean(release)).toBe(true);
  deferred=false;
  await page.evaluate(()=>window.configure({chat:'new'}));
  release();
  await expect(ghost).toContainText('Show me a worked example');
  assert.doesNotMatch(await ghost.textContent(),/Old conversation/);

  deferred=true;release=undefined;
  await page.evaluate(()=>window.configure({chat:'draft-race'}));
  await expect.poll(()=>Boolean(release)).toBe(true);
  await textarea.fill('Keep my draft');
  release();deferred=false;
  await expect(textarea).toHaveValue('Keep my draft');
  await expect(ghost).toHaveCount(0);

  const before=requests;
  await page.evaluate(()=>{window.setDraft('');window.configure({chat:'busy',busy:true});});
  await page.waitForTimeout(850);
  assert.equal(requests,before,'streaming does not generate suggestions');
  await page.evaluate(()=>window.configure({busy:false}));
  await expect(ghost).toBeVisible();
  const after=requests;
  await page.evaluate(()=>window.configure({compact:false}));
  await page.waitForTimeout(850);
  assert.equal(requests,after,'unrelated renders do not repeat the request');
  await page.evaluate(()=>window.setMessages([{role:'user',content:'Next turn'}]));
  await expect(ghost).toHaveCount(0);
  await page.evaluate(()=>{window.setMessages([]);window.configure({chat:'startup',personalize:true});});
  await expect(ghost).toContainText('Pick up my circuit notes using Recall.');
  assert.equal(startupRequests,1);
  await page.evaluate(()=>window.configure({personalize:false}));
  await expect(ghost).toHaveCount(0);
  await page.waitForTimeout(850);assert.equal(startupRequests,1,'disabled personalization never requests private startup context');
  await page.evaluate(()=>window.configure({personalize:true}));
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveAttribute('data-suggestion-phase','erase');
  await textarea.press('Tab');await expect(textarea).toHaveValue('Pick up my circuit notes using Recall.');
  assert.deepEqual(await page.evaluate(()=>window.sent),['Show me a worked example!']);

  // Reduced motion goes straight to the complete suggestion with a gentle
  // fade, including when the preference changes partway through an erase.
  await page.emulateMedia({reducedMotion:'reduce'});
  const pauseFade=await page.addStyleTag({content:'.bb-composer-suggestion-text { animation-play-state: paused !important; }'});
  await page.evaluate(()=>{window.setDraft('');window.configure({chat:'reduced'});});
  await expect(ghost).toHaveAttribute('data-suggestion-phase','type');
  await expect(animatedText).toHaveText('Pick up my circuit notes using Recall.');
  const reduced=await animatedText.evaluate(node=>({name:getComputedStyle(node).animationName,clip:getComputedStyle(node).clipPath}));
  assert.equal(reduced.name,'bb-chat-title-fade');assert.equal(reduced.clip,'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>window.configure({chat:'motion-preference-change'}));
  await expect(ghost).toHaveAttribute('data-suggestion-phase','erase');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(ghost).toHaveAttribute('data-suggestion-phase','type');
  await expect(animatedText).toHaveText('Pick up my circuit notes using Recall.');
  await textarea.press('Escape');await expect(ghost).toHaveCount(0);
  await pauseFade.evaluate(node=>node.remove());
  await expect(textarea).toHaveAttribute('placeholder','Ask anything');
  assert.deepEqual(errors,[]);
});
