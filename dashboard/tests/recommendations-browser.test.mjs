import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { completeRecommendations, evidenceRecommendations } from '../src/lib/recommendations/types.ts';

  const root=path.resolve(process.env.BREADBOARD_TEST_SOURCE_ROOT ?? path.resolve(import.meta.dirname,'..'));
test('starter cards refresh, erase and type safely, preserve drafts, and immediately clear private context', {timeout:120_000},async t=>{
  const bundle=await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'src')},
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React,{useState}from'react';import{createRoot}from'react-dom/client';
      import{useChatGreeting}from'@/app/components/hermes/use-chat-greeting';
      import{usePersonalize}from'@/app/components/use-personalize';
      import ChatGreetingEmptyState from'@/app/components/hermes/chat-greeting-empty-state';
      function App(){
        const [config,setConfig]=useState({temporary:false,scope:'mine',gardenSlug:window.initialGardenSlug??null});
        const [draft,setDraft]=useState('');const [,personalize]=usePersonalize();
        const greeting=useChatGreeting({scope:config.scope,temporary:config.temporary,garden:config.gardenSlug?{slug:config.gardenSlug,name:config.gardenSlug}:null});
        window.configure=next=>setConfig(old=>({...old,...next}));window.personalize=personalize;
        return <main className="neu-surface min-h-screen px-6 py-10" style={{background:'var(--paper-surface)',color:'var(--ink)'}}>
          <ChatGreetingEmptyState greeting={greeting.greeting}
            suggestions={greeting.suggestions} suggestionScopeKey={greeting.suggestionScopeKey}
            onSelectSuggestion={setDraft}/>
          <div className="mx-auto max-w-xl"><textarea aria-label="Draft" className="neu-composer w-full rounded-2xl p-4" value={draft} onChange={event=>setDraft(event.target.value)}/>
          <button id="send" onClick={()=>window.sent.push(draft)}>Send</button></div>
        </main>;
      }window.sent=[];createRoot(document.getElementById('root')).render(<App/>);
    `}});
  const stylesheet=path.join(root,'src/app/globals.css');
  const css=(await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'),{from:stylesheet})).css;
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:650}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
  await page.clock.install({time:new Date('2026-11-07T10:30:00')});
  await page.clock.pauseAt(new Date('2026-11-07T10:30:00'));
  const requests=[];let recall=true;let hold=false;let release;let account=1;let rotation=0;let offline=false;
  let greetingRelease,greetingHeld=true;
  await page.route('http://recommend.test/api/chat-greeting',async route=>{
    if(greetingHeld){greetingHeld=false;await new Promise(resolve=>{greetingRelease=resolve;});}
    await route.fulfill({json:{gardenCount:0,recentGardens:[],recentChats:[],promptsToday:0,daysSinceJoined:0}});
  });
  const prompts=[
    'Draft a response to the feedback on my lab report.',
    'Use my recent RLC reading to prepare questions for tomorrow’s lab.',
    'Help me resolve the overlap between my lab and project tutorial.',
    'Plan 25 minutes of circuit simulation in my afternoon calendar opening.',
  ];
  const items=()=>[
    {id:'mail',prompt:account===1?prompts[rotation]:'Review the design meeting agenda.',sourceLabel:'Gmail',sourceIds:['gmail:1']},
    {id:'event',prompt:rotation>=2?'Review the measurement checklist for tomorrow’s circuits lab.':'Help me prepare for tomorrow’s circuits lab meeting.',sourceLabel:'Calendar · Gmail',sourceIds:['calendar:1','gmail:1']},
    ...(recall?[{id:'recall',prompt:'Pick up the transient-response derivation I was reading.',sourceLabel:'Recall',sourceIds:['recall:1']}]:[]),
    {id:'task',prompt:'Break my unfinished circuit simulation into next steps.',sourceLabel:'Plan · Your garden',sourceIds:['task:1','garden:1']},
  ];
  await page.route('http://recommend.test/api/recommendations',async route=>{
    const body=route.request().postDataJSON();requests.push(body);
    if(offline){await route.fulfill({status:503,json:{error:'offline'}});return;}
    const evidence=body.gardenSlug?[{id:'garden:'+body.gardenSlug,source:'garden',title:body.gardenSlug,summary:'Garden notes',gardenSlug:body.gardenSlug}]:[];
    const result=body.gardenSlug?completeRecommendations(evidenceRecommendations(evidence,[],body),body):items();
    if(hold)await new Promise(resolve=>{release=resolve;});
    await route.fulfill({json:{recommendations:result}}).catch(()=>{});
  });
  await page.route('http://recommend.test/',route=>route.fulfill({contentType:'text/html',body:'<html data-theme="light"><div id="root"></div></html>'}));
  await page.goto('http://recommend.test/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  const cards=page.locator('.bb-terminal-suggestion');await expect(cards).toHaveCount(4).catch(error=>{console.error({errors,requests});throw error;});
  await expect.poll(()=>requests.length).toBe(1);await expect.poll(()=>Boolean(greetingRelease)).toBe(true);
  // The real greeting hook must retain its scope while its separate signals
  // arrive, or React remounts the cards and silently skips the rewrite.
  greetingRelease();
  await expect(cards.first().locator('[data-card-suggestion-phase]')).toHaveAttribute('data-card-suggestion-phase','erase');
  await page.clock.runFor(2500);
  await expect(cards.filter({hasText:'transient-response'})).toHaveCount(1);
  await expect(cards.filter({hasText:/Gmail|Calendar · Gmail|Recall|Plan · Your garden/})).toHaveCount(0);
  const screenshotDir=process.env.BREADBOARD_RECOMMENDATION_SCREENSHOTS ?? path.join(root,'artifacts','recommendations-qa');fs.mkdirSync(screenshotDir,{recursive:true});
  await page.locator('main > div').first().screenshot({path:path.join(screenshotDir,'light.png')});
  await cards.first().click();await expect(page.getByRole('textbox',{name:'Draft'})).toHaveValue('Draft a response to the feedback on my lab report.');
  assert.deepEqual(await page.evaluate(()=>window.sent),[],'selecting a recommendation never sends a message');

  // A three-minute refresh replaces whole prompts through an interruptible
  // erase/type transition, without shrinking a wrapping card mid-animation.
  const draft=page.getByRole('textbox',{name:'Draft'});
  await draft.focus();await page.mouse.move(0,0);
  rotation=1;
  await page.clock.fastForward(180_001);
  await expect.poll(()=>requests.length).toBe(2);
  assert.match(requests.at(-1).localTime,/^\d{2}:\d{2}$/);assert.ok(requests.at(-1).timeZone);
  const visibleText=cards.first().locator('.bb-card-suggestion-text');
  const phase=cards.first().locator('[data-card-suggestion-phase]');
  await expect(phase).toHaveAttribute('data-card-suggestion-phase','erase');
  await page.clock.runFor(240);
  const erasing=await visibleText.textContent();
  assert.ok(prompts[0].startsWith(erasing)&&erasing.length>0&&erasing.length<prompts[0].length);
  const height=await cards.first().evaluate(node=>node.getBoundingClientRect().height);
  await page.locator('main > div').first().screenshot({path:path.join(screenshotDir,'erasing-cards.png'),animations:'allow'});
  await cards.first().hover();
  await page.clock.fastForward(1000);
  await expect(visibleText).toHaveText(erasing);
  await cards.first().click();await expect(draft).toHaveValue(prompts[0]);
  await draft.focus();await page.mouse.move(0,0);
  await page.clock.runFor(800);
  await expect(phase).toHaveAttribute('data-card-suggestion-phase','type');
  const typing=await visibleText.textContent();
  assert.ok(prompts[1].startsWith(typing)&&typing.length>0&&typing.length<prompts[1].length);
  assert.equal(await cards.first().evaluate(node=>node.getBoundingClientRect().height),height);
  await page.locator('main > div').first().screenshot({path:path.join(screenshotDir,'typing-cards.png'),animations:'allow'});
  await page.clock.runFor(1600);await expect(visibleText).toHaveText(prompts[1]);
  await expect(draft).toHaveValue(prompts[0]);
  await page.locator('main > div').first().screenshot({path:path.join(screenshotDir,'refreshed-light.png')});

  // Keyboard focus protects the action even after fresh calendar data arrives.
  await cards.first().focus();rotation=2;
  await page.evaluate(()=>window.dispatchEvent(new Event('breadboard:calendar:changed')));
  await expect.poll(()=>requests.length).toBe(3);assert.equal(requests.at(-1).refresh,true);
  await page.clock.runFor(2500);await expect(visibleText).toHaveText(prompts[1]);
  await expect(cards.nth(1).locator('.bb-card-suggestion-text')).toHaveText('Review the measurement checklist for tomorrow’s circuits lab.');
  await page.keyboard.press('Enter');await expect(draft).toHaveValue(prompts[1]);
  await draft.focus();await page.clock.runFor(2500);await expect(visibleText).toHaveText(prompts[2]);

  // A provider outage preserves the useful cards and retries; reduced motion
  // replaces the text without replaying character animation.
  offline=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('breadboard:plan-changed')));
  await expect.poll(()=>requests.length).toBe(4);await expect(visibleText).toHaveText(prompts[2]);
  offline=false;rotation=3;await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.fastForward(60_001);
  await expect.poll(()=>requests.length).toBe(5);await expect(visibleText).toHaveText(prompts[3]);
  await expect(phase).toHaveAttribute('data-card-suggestion-phase','ready');
  // Hidden tabs pause reads and refresh once visible again.
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.fastForward(180_001);assert.equal(requests.length,5);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>requests.length).toBe(6);
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'breadboard:calendar:changed',newValue:'updated'})));
  await expect.poll(()=>requests.length).toBe(7);

  const initial=requests.length;
  await page.evaluate(()=>window.configure({temporary:true}));await expect(cards).toHaveCount(4);
  await expect(cards.filter({hasText:'transient-response'})).toHaveCount(0);
  await page.clock.runFor(150);assert.equal(requests.length,initial);
  await page.evaluate(()=>window.configure({temporary:false,scope:'public'}));await expect(cards).toHaveCount(4);
  await page.clock.runFor(150);assert.equal(requests.length,initial);
  await page.evaluate(()=>window.configure({scope:'mine'}));await expect(cards).toHaveCount(4);
  await page.evaluate(()=>window.personalize(false));await expect(cards).toHaveCount(4);
  await expect(cards.filter({hasText:'transient-response'})).toHaveCount(0);
  await page.evaluate(()=>window.personalize(true));await expect(cards).toHaveCount(4);

  // A slow old garden read cannot win after the context changes.
  hold=true;release=undefined;
  await page.evaluate(()=>window.configure({gardenSlug:'old-garden'}));await expect.poll(()=>Boolean(release)).toBe(true);
  await expect(cards).toHaveCount(4);
  await expect(cards.filter({hasText:/calendar opening|lab report|transient-response/})).toHaveCount(0);
  hold=false;account=2;
  await page.evaluate(()=>window.configure({gardenSlug:'new-garden'}));release();
  await expect(cards.first()).toContainText('new-garden');
  await expect(cards.filter({hasText:/old-garden|design meeting|lab report|transient-response/})).toHaveCount(0);
  assert.equal(requests.at(-1).gardenSlug,'new-garden');

  // Revoking Recall discards displayed private suggestions before re-reading.
  recall=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('breadboard:recall-settings-changed')));
  await expect(cards).toHaveCount(4);await expect(cards.filter({hasText:'transient-response'})).toHaveCount(0);
  assert.equal(requests.at(-1).refresh,true);
  await page.evaluate(()=>window.dispatchEvent(new Event('breadboard:auth-changed')));await expect(cards).toHaveCount(4);
  await expect(cards.filter({hasText:'using my garden notes.'})).toHaveCount(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(cards).toHaveCount(4);
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.setViewportSize({width:420,height:800});await expect(cards.first()).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('main > div').first().screenshot({path:path.join(screenshotDir,'dark-narrow.png')});

  // Cold garden load: even before greeting signals or providers arrive, the
  // four visible/actionable cards belong to the garden. An outage, temporary
  // mode and disabled personalization must never substitute general prompts.
  greetingHeld=true;greetingRelease=undefined;offline=true;
  await page.goto('http://recommend.test/');
  await page.evaluate(()=>{window.initialGardenSlug='Circuits';});
  await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  await expect(cards).toHaveCount(4);
  const assertGardenCards=async()=>{
    const labels=await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
    assert.ok(labels.every(text=>/this garden|Circuits|\bhere\b/i.test(text)),JSON.stringify(labels));
    assert.ok(labels.every(text=>!/rough idea|calendar|rent|gym|other gardens/i.test(text)));
  };
  await assertGardenCards();await expect.poll(()=>Boolean(greetingRelease)).toBe(true);
  greetingRelease();await page.clock.runFor(3000);await assertGardenCards();
  for(const temporary of [true,false]){
    await page.evaluate(temporary=>window.configure({temporary}),temporary);
    await page.clock.runFor(3000);await expect(cards).toHaveCount(4);await assertGardenCards();
  }
  await page.evaluate(()=>window.personalize(false));await page.clock.runFor(3000);await assertGardenCards();
});
