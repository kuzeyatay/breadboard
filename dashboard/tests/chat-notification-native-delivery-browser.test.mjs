import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('real chat cards report native delivery, geometry and sound receipts without a duplicate return chime', {timeout:30_000}, async t => {
  const bundle=await esbuild.build({stdin:{loader:'tsx',resolveDir:root,contents:`
    import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{Toaster}from'./src/app/components/toast';
    import{setNotificationSoundEnabled}from'./src/lib/notification-sound';
    window.setSound=setNotificationSoundEnabled;
    function App(){const[items,setItems]=React.useState([]);window.show=items=>flushSync(()=>setItems(items));
      return <Toaster mode="desktop-overlay" toasts={items} onDismiss={()=>setItems([])}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,outfile:'app.js',format:'iife',platform:'browser',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'services',setup(build){
      build.onResolve({filter:/^(next\/navigation|next\/dynamic|\.\/navigation-progress|\.\/chat-markdown)$/},a=>({path:a.path,namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='./chat-markdown'?'export default()=>null;':a.path==='next/dynamic'?'export default()=>()=>null;':'export const useRouter=()=>({push(){}});export const startNavigationProgress=()=>{};'}));
    }}]});
  const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}else{res.end('<!doctype html><style>.bb-toast-card{width:300px;min-height:90px}.bb-desktop-toast-host{display:inline-flex;flex-direction:column;max-height:300px;overflow:auto}</style><div id="root"></div><script src="/app.js"></script>');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});t.after(()=>browser.close());
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.commands=[];window.notes=0;const stateListeners=new Set(),deliveryListeners=new Set(),visibleListeners=new Set();
    let state={enabled:true,tabs:[],extensions:[],notificationVisibleRects:[]};
    window.breadboardDesktop={getTabsState:async()=>state,onTabsState:cb=>{stateListeners.add(cb);return()=>stateListeners.delete(cb);},
      tabs:async command=>{window.commands.push(command);return true;},onNotificationOverlayVisibility:cb=>{visibleListeners.add(cb);cb(true);return()=>visibleListeners.delete(cb);},
      onChatNotificationDelivered:cb=>{deliveryListeners.add(cb);return()=>deliveryListeners.delete(cb);}};
    window.regions=rects=>{state={...state,notificationVisibleRects:rects};for(const cb of stateListeners)cb(state);};
    window.delivered=ids=>{for(const cb of deliveryListeners)cb(ids);};
    window.AudioContext=class{state='running';currentTime=0;destination={};async resume(){}async close(){this.state='closed';}
      createOscillator(){return{frequency:{setValueAtTime(){}},connect:node=>node,start(){window.notes++;},stop(){}};}
      createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.show);
  const toast=id=>({id,message:'Exact Garden chat',type:'success',title:'Response ready',response:'A complete response',
    target:{surface:'garden_chat',gardenSlug:'signals',chatId:'42',conversationId:'conv_exact'}});
  await page.evaluate(toast=>window.show([toast]),toast('native'));
  await page.waitForFunction(()=>window.commands.some(c=>c.type==='notification-chat-delivery'&&c.cards[0]?.rect));
  let state=await page.evaluate(()=>({cards:window.commands.filter(c=>c.type==='notification-chat-delivery').at(-1).cards,notes:window.notes}));
  assert.equal(state.notes,0,'covered native regions cannot chime');assert.ok(state.cards[0].rect.width>0);
  assert.equal(state.cards[0].urls.length,2);assert.ok(state.cards[0].urls.some(url=>url.includes('conv_exact')));
  await page.evaluate(()=>window.delivered(['native']));
  await page.waitForFunction(()=>window.notes===2,null,{timeout:5_000});
  await page.evaluate(()=>window.regions([{x:0,y:0,width:1200,height:800}]));
  await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.notes),2,'the silent OS alert chimes in-app once; returning does not repeat it');
  // Bursts within a second share one chime; the next card is a separate event.
  await page.waitForTimeout(1_050);
  await page.evaluate(toast=>window.show([toast]),toast('in-app'));
  await page.waitForFunction(()=>window.notes===4);
  await page.evaluate(items=>{
    window.show(items);
    const r=document.querySelector('.bb-toast-card').getBoundingClientRect();
    window.regions([{x:r.x,y:r.y,width:r.width,height:r.height}]);
  },[toast('in-app'),toast('covered-second-card')]);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('breadboard:notification-sound-receipts')).includes('covered-second-card')),false,
    'a visible first card cannot claim the sound receipt for a covered second card');
  await page.evaluate(item=>{
    window.show([item]);const r=document.querySelector('.bb-toast-card').getBoundingClientRect();
    window.regions([{x:r.x,y:r.y,width:1,height:r.height}]);
  },toast('narrow-strip'));
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('breadboard:notification-sound-receipts')).includes('narrow-strip')),false);
  await page.evaluate(()=>{const r=document.querySelector('.bb-toast-card').getBoundingClientRect();window.regions([{x:r.x,y:r.y,width:40,height:r.height}]);});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('breadboard:notification-sound-receipts')).includes('narrow-strip'));
  await page.evaluate(()=>window.setSound(false));
  await page.waitForFunction(()=>window.commands.filter(c=>c.type==='notification-chat-delivery').at(-1)?.cards[0]?.soundEnabled===false);
  await page.evaluate(()=>window.show([]));
  await page.waitForFunction(()=>window.commands.filter(c=>c.type==='notification-chat-delivery').at(-1)?.cards.length===0);
  assert.deepEqual(errors,[]);
});
