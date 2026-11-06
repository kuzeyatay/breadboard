import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import esbuild from 'esbuild';
import {chromium, expect} from '@playwright/test';
import {WALLPAPERS} from '../src/lib/page-appearance.ts';

const root = path.resolve(import.meta.dirname, '..');
test('utility panels open without waiting or rerendering Terminal, and use small cached previews', {timeout: 60_000}, async t => {
  const bundle = await esbuild.build({
    stdin: {loader:'tsx', resolveDir:root, contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Notifications from './src/app/components/dashboard-notifications';
      import Appearance from './src/app/components/page-appearance';
      import Background from './src/app/components/spotify-ambient-background';
      window.parentRenders=0; window.refreshes=0;
      function App(){
        window.parentRenders++;
        const [heavy,setHeavy]=React.useState(false); window.expandHistory=()=>setHeavy(true);
        const history=Array.from({length:200},(_,i)=>({id:'old-'+i,type:'success',title:'Earlier conversation '+i,message:'Research complete',response:('The **answer** has steps and equations: $x^2+y^2=1$. ').repeat(200),updatedAt:new Date(Date.now()-i*60000).toISOString(),read:false}));
        return <><div id="ambient" style={{position:"fixed",inset:0}}><Background theme="light" spotifyColors={false} randomColors/></div><main style={{position:"relative"}}><h1>Where to, stargazer?</h1><div className="sample-garden">My gardens</div></main>
          <Notifications enabled notifications={heavy ? history : [
            {id:'one',type:'success',title:'Study plan',message:'Your plan is ready to review.',updatedAt:new Date().toISOString(),read:false},
            {id:'two',type:'success',title:'Garden updated',message:'Your latest notes have been saved.',updatedAt:new Date(Date.now()-60000).toISOString(),read:false}
          ]} status="ready" onRefresh={()=>{window.refreshes++;return new Promise(resolve=>{window.finishRefresh=resolve})}}
          onDismiss={()=>{}} onRead={()=>{}} onClear={()=>{}} onOpenChat={()=>false} toasts={[]} onDismissToast={()=>{}} />
          <Appearance page="new-tab" ownerKey="panel-test" triggerIcon="palette" placement="terminal" />
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `}, bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic', outfile:'panels.js',
    plugins:[{name:'navigation',setup(build){
      build.onResolve({filter:/^(next\/navigation|\.\/navigation-progress)$/},args=>({path:args.path,namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useRouter=()=>({push:()=>{}});export const startNavigationProgress=()=>{};'}));
    }}],
  });
  const script=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const globals=fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace(/^@import[^;]+;/gm,'');
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[]; page.on('pageerror',error=>{errors.push(error.message);t.diagnostic(error.stack);});
  const imageRequests=[];let searches=0, saved={}, heldImage, selected;
  await page.route('https://panels.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:script});
    if(url.pathname==='/style.css')return route.fulfill({contentType:'text/css',body:globals+'\n'+css+`
      html {--font-source-sans:Arial;--font-schibsted:Arial;} body {margin:0;background:radial-gradient(at 30% 20%,#dce7d3,#b0c6bb);}
      main {padding:170px 100px;} h1 {font:600 40px Arial;color:var(--ink-heading);} .sample-garden {margin-top:80px;padding:48px;border:1px solid var(--line);border-radius:16px;width:360px;background:var(--paper-surface);color:var(--ink);}
    `});
    if(url.pathname.startsWith('/browser-wallpapers/')){
      imageRequests.push(url.pathname);
      const body=fs.readFileSync(path.join(root,'public',url.pathname));
      if(!url.pathname.includes('/thumbnails/')) {selected=url.pathname;heldImage=()=>route.fulfill({contentType:'image/webp',body});return;}
      return route.fulfill({contentType:'image/webp',body,headers:{'Cache-Control':'public,max-age=86400'}});
    }
    if(url.pathname==='/api/profile/page-appearance'){
      if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();saved[body.theme]=body.value;return route.fulfill({json:{value:body.value}});}
      return route.fulfill({json:{preferences:saved}});
    }
    if(url.pathname==='/api/browser-wallpapers/pixabay'){
      searches++;
      return route.fulfill({json:{ok:true,images:[{id:42,name:'Quiet coast',creator:'Test photographer',previewSrc:WALLPAPERS[5].previewSrc,pageUrl:'https://pixabay.com/photos/42/'}]}});
    }
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>'});
  });
  await page.goto('https://panels.test');
  const bell=page.getByRole('button',{name:'Notifications, 2 unread',exact:true});
  await expect(bell).toBeVisible();
  const initialRenders=await page.evaluate(()=>window.parentRenders);
  const timing=await bell.evaluate(async button=>{
    const start=performance.now();button.click();
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const panel=document.querySelector('[data-notification-center]');
    return {elapsed:performance.now()-start,visible:!!panel&&getComputedStyle(panel).opacity==='1',refreshes:window.refreshes};
  });
  assert(timing.visible,'panel is visible on its first frames while refresh is unresolved');
  assert.equal(timing.refreshes,1);
  assert.equal(await page.evaluate(()=>window.parentRenders),initialRenders,'opening the panel does not rerender the Terminal page');
  t.diagnostic(`Notification panel visible after ${Math.round(timing.elapsed)} ms; refresh still pending`);
  const style=async locator=>locator.evaluate(node=>{
    const s=getComputedStyle(node);const header=getComputedStyle(node.querySelector('header'));
    return {width:s.width,radius:s.borderRadius,background:s.backgroundColor,filter:s.backdropFilter,headerPadding:header.padding};
  });
  const dialog=page.getByRole('dialog',{name:'Notifications',exact:true});
  const notificationStyle=await style(dialog);
  assert.equal(notificationStyle.filter,'none');
  assert.equal(notificationStyle.background,'rgb(250, 247, 239)','the panel uses the opaque app surface');
  const screenshot=async name=>{
    if(process.env.BREADBOARD_PANEL_SCREENSHOT_DIR){fs.mkdirSync(process.env.BREADBOARD_PANEL_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.BREADBOARD_PANEL_SCREENSHOT_DIR,name+'.png')});}
  };
  await screenshot('notifications-light');
  await page.getByRole('button',{name:'Close notifications'}).click();
  assert.equal(await page.evaluate(()=>window.parentRenders),initialRenders,'closing remains local too');
  await page.evaluate(()=>window.finishRefresh());

  const appearance=page.getByRole('button',{name:'Customize appearance'});
  await appearance.hover();
  await expect.poll(()=>imageRequests.length).toBe(6);
  assert(imageRequests.every(url=>url.includes('/thumbnails/')),'hover only warms small previews');
  await appearance.click();
  const picker=page.getByRole('dialog',{name:'Appearance',exact:true});
  await expect(picker).toBeVisible();
  assert.deepEqual(await style(picker),notificationStyle,'both panels use the same geometry, material and header');
  const previews=picker.locator('.browser-wallpaper-thumbnail > img');
  await expect(previews).toHaveCount(6);
  await expect.poll(()=>previews.evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth===400))).toBe(true);
  const bytes=WALLPAPERS.reduce((sum,preset)=>sum+fs.statSync(path.join(root,'public',preset.previewSrc)).size,0);
  const originals=WALLPAPERS.reduce((sum,preset)=>sum+fs.statSync(path.join(root,'public',preset.src)).size,0);
  assert(bytes<originals/10,'preview payload is under a tenth of the full wallpapers');
  assert(imageRequests.every(url=>url.includes('/thumbnails/')),'opening the picker never fetches the full wallpapers');
  t.diagnostic(`Wallpaper previews: ${bytes} bytes versus ${originals} bytes full-size`);
  await screenshot('appearance-light');
  await previews.first().scrollIntoViewIfNeeded();
  await screenshot('wallpapers-light');
  await picker.getByRole('button',{name:'Alpine dawn, Places',exact:true}).click();
  await expect.poll(()=>selected).toBe(WALLPAPERS[0].src);
  assert.equal(saved.light,undefined,'selection waits for full image decode without blanking the current background');
  await heldImage();
  await expect.poll(()=>saved.light?.background).toBe('alpine-dawn');

  await picker.getByRole('button',{name:'Human',exact:true}).click();
  await expect(picker.getByRole('button',{name:'Quiet coast, photo by Test photographer on Pixabay'})).toBeVisible();
  assert.equal(searches,1);
  await picker.getByRole('button',{name:'Generated',exact:true}).click();
  await picker.getByRole('button',{name:'Human',exact:true}).click();
  await expect(picker.getByRole('button',{name:'Quiet coast, photo by Test photographer on Pixabay'})).toBeVisible();
  assert.equal(searches,1,'source toggling reuses the photo search');
  await page.getByRole('button',{name:'Close appearance'}).click();
  await appearance.click();
  await picker.getByRole('button',{name:'Human',exact:true}).click();
  await expect(picker.getByRole('button',{name:'Quiet coast, photo by Test photographer on Pixabay'})).toBeVisible();
  assert.equal(searches,1,'reopening the picker reuses results too');

  await picker.getByRole('group',{name:'App theme',exact:true}).getByRole('button',{name:'Dark',exact:true}).click();
  await page.setViewportSize({width:375,height:812});
  let box=await picker.boundingBox();assert(box.x>=0&&box.x+box.width<=375&&box.y+box.height<=812);
  assert.equal(await picker.evaluate(node=>node.scrollWidth>node.clientWidth),false);
  await screenshot('appearance-dark-mobile');
  await page.getByRole('button',{name:'Close appearance'}).click();
  await bell.click();
  box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=375&&box.y+box.height<=812);
  assert.equal(await dialog.evaluate(node=>node.scrollWidth>node.clientWidth),false);
  await screenshot('notifications-dark-mobile');
  await page.getByRole('button',{name:'Close notifications'}).click();
  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(()=>window.expandHistory());
  const heavyBell=page.getByRole('button',{name:'Notifications, 200 unread',exact:true});
  const background=page.locator('#ambient [data-spotify-background]');
  await expect(background).toHaveAttribute('data-playing','true');
  const continuity=await heavyBell.evaluate(async button=>{
    const light=document.querySelector('#ambient [data-ambient-layer="random"] > span');
    const animations=light.getAnimations({subtree:true});
    const before=animations.map(a=>Number(a.currentTime));
    const start=performance.now(),frames=[];
    let previous=start;
    button.click();
    await new Promise(resolve=>{
      const frame=now=>{frames.push(now-previous);previous=now;if(now-start<1000)requestAnimationFrame(frame);else resolve()};
      requestAnimationFrame(frame);
    });
    return {before,after:animations.map(a=>Number(a.currentTime)),maxGap:Math.max(...frames),frames:frames.length,elapsed:performance.now()-start};
  });
  t.diagnostic('Background while opening 200 notifications: '+JSON.stringify(continuity));
  await expect(background).toHaveAttribute('data-playing','true');
  assert((continuity.after[0]-continuity.before[0]+28000)%28000>500,'background motion continues under notifications');
  assert((continuity.after[2]-continuity.before[2]+20000)%20000>500,'color blending continues under notifications');
  assert(continuity.maxGap<250 && continuity.frames>=20,'opening a full history must not stall the animation loop');
  const richCards=page.locator('[data-notification-id]:has(.katex)');
  assert(await richCards.count()<20,'offscreen responses are not eagerly formatted');
  const lastCard=page.locator('[data-notification-id="old-199"]');
  await lastCard.scrollIntoViewIfNeeded();
  await expect(lastCard.locator('.katex').first()).toBeVisible();
  assert.deepEqual(errors,[]);
});
