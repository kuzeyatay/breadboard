import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('PDF branch cache stores only the selected turn without broadcasting attachment payloads', {timeout:30_000}, async t=>{
  const root=path.resolve(import.meta.dirname,'..');
  const bundle=await build({bundle:true,write:false,platform:'browser',format:'iife',
    stdin:{resolveDir:root,contents:`import * as cache from './src/app/components/hermes/conversation-branch-cache';
      import {applyBranchVariant} from './src/app/components/hermes/conversation-branches';window.cache=cache;window.applyBranchVariant=applyBranchVariant;`}});
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const context=await browser.newContext();
  await context.route('https://branch.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  const page=await context.newPage(),other=await context.newPage();
  for(const p of [page,other]){await p.goto('https://branch.test');await p.addScriptTag({content:bundle.outputFiles[0].text});}
  await other.evaluate(()=>{window.storageEvents=[];window.addEventListener('storage',e=>window.storageEvents.push({key:e.key,newSize:e.newValue?.length??0}));});
  const result=await page.evaluate(async()=>{
    const history=Array.from({length:48},(_,i)=>({id:'m'+i,clientMessageId:'t'+Math.floor(i/2),role:i%2?'assistant':'user',content:'Earlier message',attachments:[{type:'image',dataUrl:'x'.repeat(40000)}]}));
    const question={id:'q',clientMessageId:'q',role:'user',content:'Circular loop',attachments:[{type:'image',dataUrl:'y'.repeat(100000)}]};
    const answer={id:'a',clientMessageId:'q',role:'assistant',content:'Original answer'};
    const retry={...question,id:'r',clientMessageId:'r',branchGroupId:'q'};
    const groups={q:{id:'q',activeIndex:1,variants:[[...history,question,answer],[...history,retry,{...answer,id:'ra',clientMessageId:'r',content:'New answer'}]]}};
    const before=JSON.stringify(groups).length;
    localStorage.setItem(cache.BRANCH_STORAGE_PREFIX+'pdf',JSON.stringify(groups));
    const migrated=await cache.loadConversationBranches('pdf');
    const after=JSON.stringify(migrated).length;
    const later={id:'later',role:'user',content:'Follow-up'};
    const restored=applyBranchVariant({messages:[...history,retry,{...answer,id:'ra'},later],variant:migrated.q.variants[0],groupId:'q'});
    window.savedGroups=migrated;
    return {before,after,counts:migrated.q.variants.map(v=>v.length),legacy:localStorage.getItem(cache.BRANCH_STORAGE_PREFIX+'pdf'),restored:restored.map(m=>m.id),data:migrated.q.variants[0][0].attachments[0].dataUrl.length};
  });
  assert.ok(result.before>4_000_000);assert.ok(result.after<210_000);
  assert.deepEqual(result.counts,[2,2]);assert.equal(result.legacy,null);assert.equal(result.data,100000);
  assert.deepEqual(result.restored.slice(-3),['q','a','later']);
  assert.equal(await page.evaluate(()=>{
    const history=[{role:'user',content:'Earlier'},{role:'assistant',content:'Earlier answer'}];
    const question={role:'user',content:'Legacy question'};
    const id='message-2-Legacy question';
    const groups={[id]:{id,activeIndex:0,variants:[[...history,question,{role:'assistant',content:'First answer'}],[...history,question,{role:'assistant',content:'Second answer'}]]}};
    const compact=cache.compactConversationBranches(groups);
    const result=applyBranchVariant({messages:groups[id].variants[0],variant:compact[id].variants[1],groupId:id});
    return result.length===4&&result[3].content==='Second answer';
  }),true,'compaction must preserve legacy anchors based on transcript position');
  await other.waitForFunction(()=>window.storageEvents.some(e=>e.key.endsWith('pdf')&&e.newSize===0));
  await other.evaluate(()=>window.storageEvents=[]);
  await page.evaluate(async()=>{for(let i=0;i<4;i++){window.savedGroups.q.variants[1][1].content='Completed '+i;await cache.saveConversationBranches('pdf',window.savedGroups)}});
  await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});
  assert.equal(await page.evaluate(async()=>(await cache.loadConversationBranches('pdf')).q.variants[1][1].content),'Completed 3');
  assert.deepEqual(await other.evaluate(()=>window.storageEvents),[],'IndexedDB updates must not send large storage events to other loaded tabs');
  const blocked=await context.newPage();await blocked.goto('https://branch.test');await blocked.addScriptTag({content:bundle.outputFiles[0].text});
  assert.equal(await blocked.evaluate(async()=>{
    const legacy=JSON.stringify({q:{id:'q',activeIndex:0,variants:[[{id:'q',role:'user',content:'Keep this'}],[{id:'q',role:'user',content:'And this'}]]}});
    localStorage.setItem(cache.BRANCH_STORAGE_PREFIX+'blocked',legacy);
    Object.defineProperty(window,'indexedDB',{value:{open(){throw new Error('Storage blocked')}}});
    const restored=await cache.loadConversationBranches('blocked');
    return restored.q.variants.length===2&&localStorage.getItem(cache.BRANCH_STORAGE_PREFIX+'blocked')===legacy;
  }),true,'failed migrations must preserve the legacy history');
});
