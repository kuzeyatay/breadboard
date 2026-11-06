import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root=path.resolve(import.meta.dirname,'..');
test('source-backed starter cards fill a draft and clear immediately across private modes, account changes and Recall revocation', {timeout:120_000},async t=>{
  const bundle=await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'src')},
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React,{useState}from'react';import{createRoot}from'react-dom/client';
      import{useRecommendations}from'@/app/components/use-recommendations';
      import{usePersonalize}from'@/app/components/use-personalize';
      import ChatGreetingEmptyState from'@/app/components/hermes/chat-greeting-empty-state';
      function App(){
        const [config,setConfig]=useState({temporary:false,scope:'mine',gardenSlug:null});
        const [draft,setDraft]=useState('');const [,personalize]=usePersonalize();
        const items=useRecommendations(config);
        window.configure=next=>setConfig(old=>({...old,...next}));window.personalize=personalize;
        return <main className="neu-surface min-h-screen px-6 py-10" style={{background:'var(--paper-surface)',color:'var(--ink)'}}>
          <ChatGreetingEmptyState greeting={{lead:'Good morning',question:'Where would you like to start?',name:null,leadId:'test',questionId:'test'}}
            suggestions={items.map(item=>item.prompt)}
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
  const requests=[];let recall=true;let hold=false;let release;let account=1;
  const items=()=>[
    {id:'mail',prompt:account===1?'Draft a response to the feedback on my lab report.':'Review the design meeting agenda.',sourceLabel:'Gmail',sourceIds:['gmail:1']},
    {id:'event',prompt:'Help me prepare for tomorrow’s circuits lab meeting.',sourceLabel:'Calendar · Gmail',sourceIds:['calendar:1','gmail:1']},
    ...(recall?[{id:'recall',prompt:'Pick up the transient-response derivation I was reading.',sourceLabel:'Recall',sourceIds:['recall:1']}]:[]),
    {id:'task',prompt:'Break my unfinished circuit simulation into next steps.',sourceLabel:'Plan · Your garden',sourceIds:['task:1','garden:1']},
  ];
  await page.route('http://recommend.test/api/recommendations',async route=>{
    const body=route.request().postDataJSON();requests.push(body);
    const result=items();if(hold)await new Promise(resolve=>{release=resolve;});
    await route.fulfill({json:{recommendations:result}}).catch(()=>{});
  });
  await page.route('http://recommend.test/',route=>route.fulfill({contentType:'text/html',body:'<html data-theme="light"><div id="root"></div></html>'}));
  await page.goto('http://recommend.test/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  const cards=page.locator('.bb-terminal-suggestion');await expect(cards).toHaveCount(4).catch(error=>{console.error({errors,requests});throw error;});
  await expect(cards.filter({hasText:'transient-response'})).toHaveCount(1);
  await expect(cards.filter({hasText:/Gmail|Calendar · Gmail|Recall|Plan · Your garden/})).toHaveCount(0);
  const screenshotDir=path.join(root,'artifacts','recommendations-qa');fs.mkdirSync(screenshotDir,{recursive:true});
  await page.locator('main > div').first().screenshot({path:path.join(screenshotDir,'light.png')});
  await cards.first().click();await expect(page.getByRole('textbox',{name:'Draft'})).toHaveValue('Draft a response to the feedback on my lab report.');
  assert.deepEqual(await page.evaluate(()=>window.sent),[],'selecting a recommendation never sends a message');
  const initial=requests.length;
  await page.evaluate(()=>window.configure({temporary:true}));await expect(cards).toHaveCount(0);
  await page.waitForTimeout(150);assert.equal(requests.length,initial);
  await page.evaluate(()=>window.configure({temporary:false,scope:'public'}));await expect(cards).toHaveCount(0);
  await page.waitForTimeout(150);assert.equal(requests.length,initial);
  await page.evaluate(()=>window.configure({scope:'mine'}));await expect(cards).toHaveCount(4);
  await page.evaluate(()=>window.personalize(false));await expect(cards).toHaveCount(0);
  await page.evaluate(()=>window.personalize(true));await expect(cards).toHaveCount(4);

  // A slow old garden read cannot win after the context changes.
  hold=true;release=undefined;
  await page.evaluate(()=>window.configure({gardenSlug:'old-garden'}));await expect.poll(()=>Boolean(release)).toBe(true);
  hold=false;account=2;
  await page.evaluate(()=>window.configure({gardenSlug:'new-garden'}));release();
  await expect(cards.first()).toContainText('design meeting');
  assert.equal(requests.at(-1).gardenSlug,'new-garden');

  // Revoking Recall discards displayed private suggestions before re-reading.
  recall=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('breadboard:recall-settings-changed')));
  await expect(cards).toHaveCount(3);await expect(cards.filter({hasText:'transient-response'})).toHaveCount(0);
  assert.equal(requests.at(-1).refresh,true);
  await page.evaluate(()=>window.dispatchEvent(new Event('breadboard:auth-changed')));await expect(cards).toHaveCount(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(cards).toHaveCount(3);
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.setViewportSize({width:420,height:800});await expect(cards.first()).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('main > div').first().screenshot({path:path.join(screenshotDir,'dark-narrow.png')});
});
