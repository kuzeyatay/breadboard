import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { chromium } from 'playwright';

test('shared browser home preserves drafts and playback leases while following native selection', {timeout:45000}, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await esbuild.build({
    stdin: {resolveDir:root,loader:'tsx',contents:`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import BrowserClient from './src/app/browser/browser-client';
      createRoot(document.getElementById('root')).render(<BrowserClient showFlowers={false} restoreOwnerKey="fixture" initialGreetingSignals={{}} />);
    `},
    outfile:'ui.js',bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},
    plugins:[{name:'fixture-heavy-panels',setup(build){
      build.onResolve({filter:/(?:dashboard-agent-terminal|settings-dialog|use-chat-greeting)$/},args=>({path:args.path,namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('use-chat-greeting') ? 'export const useChatGreeting=()=>({greeting:"Hello"});' : 'export default function Panel(){return null}',loader:'js'}));
    }}],
  });
  const calls = [];
  const server = http.createServer((req,res) => {
    if(req.url === '/style.css'){res.setHeader('content-type','text/css');res.end(fs.readFileSync(new URL('../src/app/globals.css',import.meta.url),'utf8').replace(/^@import[^;]+;/gm,'') + bundle.outputFiles.find(f=>f.path.endsWith('.css')).text);return;}
    if(req.url === '/ui.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);return;}
    if(req.url === '/api/browser/spotify/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': ready\n\n');return;}
    if(req.url.startsWith('/api/')){
      calls.push({url:req.url,method:req.method});res.setHeader('content-type','application/json');
      res.end(JSON.stringify(req.url === '/api/browser/spotify' ? {connected:true,engine:{ready:true,status:'ready'},playback:null,history:[]} : req.url.includes('/engine') ? {ready:true,status:'ready'} : {calendars:[],items:[]}));return;
    }
    res.setHeader('content-type','text/html');res.end('<!doctype html><html data-breadboard-desktop="true"><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  const page = await browser.newPage();
  const errors=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack)});
  await page.addInitScript(() => {
    const listeners=new Set();
    const makeTab=id=>({id,generation:1,title:'Browser '+id,url:'',loading:false,browser:{uiKey:'stable-'+id,uiVisited:true,address:'',pageReady:false,terminalOpen:false}});
    window.state={enabled:true,persistentShell:true,selfId:1,activeId:1,presentedId:1,presentationRevision:1,presentationStatus:'presented',tabs:[makeTab(1),makeTab(2)],extensions:[]};
    window.breadboardDesktop={
      getTabsState:async()=>window.state,onTabsState:l=>{listeners.add(l);return()=>listeners.delete(l)},
      tabs:async()=>true,getBrowserBookmarks:async()=>[],getBrowserShortcuts:async()=>[],getBrowserRecentSearches:async()=>[],
      getBrowserDownloads:async()=>({items:[],error:null}),getBrowserHistory:async()=>({items:[],error:null}),
      onBrowserHistoryChanged:()=>()=>{},onBrowserDownloads:()=>()=>{},
    };
    window.select=(id,pending=false)=>{window.state={...window.state,activeId:id,selfId:id,presentedId:pending?window.state.presentedId:id,presentationStatus:pending?'pending':'presented',presentationRevision:window.state.presentationRevision+1};for(const l of listeners)l(window.state)};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/browser`, {waitUntil:'domcontentloaded'});
  const first=page.locator('[data-browser-content-id="1"]');
  const second=page.locator('[data-browser-content-id="2"]');
  await first.getByRole('button',{name:'Add shortcut',exact:true}).click();
  await first.getByPlaceholder('Figma',{exact:true}).fill('Unfinished shortcut');
  await first.getByPlaceholder('figma.com',{exact:true}).fill('example.org/draft');
  await page.waitForFunction(()=>document.querySelector('[data-browser-content-id="1"] .browser-spotify-dock'));
  await page.evaluate(()=>window.select(2));
  await second.waitFor({state:'visible'});
  assert.equal(await first.locator('dialog').evaluate(e=>e.open),false,'a hidden tab cannot leave a modal over another tab');
  await page.evaluate(()=>window.select(1));
  await first.getByRole('button',{name:'Add shortcut',exact:true}).click();
  assert.equal(await first.getByPlaceholder('Figma',{exact:true}).inputValue(),'Unfinished shortcut');
  assert.equal(await first.getByPlaceholder('figma.com',{exact:true}).inputValue(),'example.org/draft');
  await first.getByRole('button',{name:'Close shortcut editor'}).click();
  await page.evaluate(()=>window.select(2,true));
  assert.equal(await first.isVisible(),false,'cold handoffs hide the outgoing home with its native page');
  assert.equal(await second.isVisible(),true,'shared content follows the immediate native selection');
  await page.evaluate(()=>window.select(2));
  assert.equal(await second.isVisible(),true);
  assert.ok(calls.some(c=>c.method==='POST' && c.url.includes('/engine')), 'the test established a playback lease');
  await page.evaluate(()=>window.select(3));
  // Let in-flight UI requests finish, then span the eight-second polling cycle.
  await page.waitForTimeout(250);
  const statusCalls=calls.filter(c=>c.url==='/api/browser/spotify' && c.method==='GET').length;
  const leases=calls.filter(c=>c.url.includes('/engine') && c.method==='POST').length;
  await page.waitForTimeout(8250);
  // Lease renewal runs independently on a twenty-second interval. Wait for
  // that request rather than assuming it uses the eight-second status poll.
  if(calls.filter(c=>c.url.includes('/engine') && c.method==='POST').length===leases) {
    await page.waitForResponse(response=>response.url().includes('/engine') && response.request().method()==='POST', {timeout:25000});
  }
  assert.equal(calls.filter(c=>c.url==='/api/browser/spotify' && c.method==='GET').length,statusCalls,'hidden widgets pause optional status polling');
  assert.ok(calls.filter(c=>c.url.includes('/engine') && c.method==='POST').length>leases,'playback leases keep renewing while hidden');
  assert.equal(calls.filter(c=>c.method==='DELETE' && c.url.includes('/engine')).length,0,'switching does not release playback leases');
  assert.deepEqual(errors,[]);
});
