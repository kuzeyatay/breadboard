import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import esbuild from 'esbuild';
import {chromium,expect} from '@playwright/test';

test('navbar sway and shooting stars survive idle, pause offscreen and resume on presentation',{timeout:60_000},async()=>{
 const root=path.resolve(import.meta.dirname,'..');
 const bundle=await esbuild.build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import NavbarFlowerWind from './src/app/components/navbar-flower-wind';
 createRoot(document.getElementById('root')).render(<nav style={{position:'relative',height:72,background:'#181d1a'}}><NavbarFlowerWind/></nav>);`},bundle:true,write:false,outdir:'out',jsx:'automatic'});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({reducedMotion:'no-preference',viewport:{width:1280,height:240}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<!doctype html><html data-theme="dark"><style>body{margin:0;background:#0f1210}${css}</style><div id="root"></div><script>
   window.state={enabled:true,selfId:1,activeId:1,visibleId:1,presentedId:1,presentationStatus:'presented',preparingNewTab:false,windowFocused:true,tabs:[{id:1,url:'/new-tab',title:'Terminal',loading:false},{id:2,url:'/new-tab',title:'Terminal',loading:false}]};
   const listeners=new Set();window.breadboardDesktop={getTabsState:async()=>window.state,onTabsState:f=>{listeners.add(f);return()=>listeners.delete(f)},tabs:async()=>true};
   window.updateTabs=patch=>{window.state={...window.state,...patch};listeners.forEach(f=>f(window.state))};
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testHidden?'hidden':'visible'});
   window.setHidden=hidden=>{window.testHidden=hidden;document.dispatchEvent(new Event('visibilitychange'))};
  </script><script>${js}</script>`);
  const wind=page.locator('[class$="_wind"]');
  const plants=page.locator('[class$="_plant"]');
  const comets=page.locator('[class$="_comet"]');
  await expect(wind).toHaveAttribute('data-animation-ready','true');
  await expect(plants).toHaveCount(24);await expect(comets).toHaveCount(3);
  const matrix=()=>plants.first().evaluate(e=>getComputedStyle(e).transform);
  const start=await matrix();await expect.poll(matrix).not.toBe(start);
  // Reading quietly, native toolbar focus and another monitor are not hidden tabs.
  await page.evaluate(()=>{document.documentElement.setAttribute('data-user-idle','');window.dispatchEvent(new Event('blur'));window.updateTabs({windowFocused:false})});
  await expect(wind).toHaveAttribute('data-animation-ready','true');
  assert.equal(await plants.first().evaluate(e=>getComputedStyle(e).animationPlayState),'running');
  const idleStart=await matrix();await expect.poll(matrix).not.toBe(idleStart);
  // Exercise the actual comet keyframes at their visible phase without a long wait.
  const meteor=await comets.first().evaluate(e=>{const a=e.getAnimations()[0];a.pause();a.currentTime=Number(a.effect.getTiming().duration)*2.79+Number(a.effect.getTiming().delay);const c=getComputedStyle(e);return {opacity:Number(c.opacity),transform:c.transform}});
  assert(meteor.opacity>0,'shooting-star streak becomes visible');assert.notEqual(meteor.transform,'none');
  // An outgoing page continues moving until its replacement is actually shown.
  await page.evaluate(()=>window.updateTabs({activeId:2,visibleId:1,presentationStatus:'pending'}));
  await expect(wind).toHaveAttribute('data-animation-ready','true');
  await page.evaluate(()=>window.updateTabs({visibleId:2,presentedId:2,presentationStatus:'presented'}));
  await expect(wind).not.toHaveAttribute('data-animation-ready','true');
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);
  // A prewarmed renderer is quiet even if Chromium calls it visible.
  await page.evaluate(()=>window.updateTabs({activeId:1,visibleId:1,presentedId:1,preparingNewTab:true}));
  await expect(wind).not.toHaveAttribute('data-animation-ready','true');
  await page.evaluate(()=>window.updateTabs({preparingNewTab:false}));
  await expect(wind).toHaveAttribute('data-animation-ready','true');
  await expect.poll(()=>plants.first().evaluate(e=>e.getAnimations().length)).toBe(1);
  await page.evaluate(()=>window.setHidden(true));
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);
  await page.evaluate(()=>window.setHidden(false));
  await expect(wind).toHaveAttribute('data-animation-ready','true');
  const resumed=await matrix();await expect.poll(matrix).not.toBe(resumed);
  // Both panes of a visible split can animate; unrelated retained pages cannot.
  await page.evaluate(()=>window.updateTabs({activeId:2,visibleId:2,groups:[{id:'split',split:true}],tabs:window.state.tabs.map(t=>({...t,groupId:'split'}))}));
  await expect(wind).toHaveAttribute('data-animation-ready','true');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);
  assert.equal(await comets.first().evaluate(e=>getComputedStyle(e).display),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await expect.poll(()=>plants.first().evaluate(e=>e.getAnimations().length)).toBe(1);
  assert.equal(await page.locator('[class$="_skyAnimation"]').evaluate(e=>getComputedStyle(e).display),'none');
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
